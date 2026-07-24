// test/backup-sync.test.cjs — Regresión del ciclo de backup y de las
// sincronizaciones automáticas. Cubre A1 y A3 de docs/auditoria-2026-07-24.md.
//
//   A1 · La config de seguimiento (días, estados y las TRES plantillas de
//        WhatsApp que el usuario redactó) no entraba al backup: al cambiar de
//        teléfono volvían al texto de fábrica.
//   A3 · Los fallos del auto-backup a Drive y de la sync con Calendar eran
//        totalmente silenciosos: el cartel seguía diciendo "Conectado ✓" con la
//        fecha del último éxito y el usuario se creía respaldado.
//
// Uso:  node test/backup-sync.test.cjs

const path = require('node:path');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh');
  process.exit(2);
}
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }

const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch(_){} });
  return page;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    // ── A1 · La config de seguimiento sobrevive un cambio de teléfono ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        // El podador personaliza sus mensajes y sus tiempos.
        setFollowupCfg({
          enabled: true, days: 21, expiryEnabled: false,
          estados: ['enviado','aceptado'],
          waTemplate: 'Hola {cliente}, ¿pudiste ver el presupuesto?',
          waSendTemplate: 'Te paso el presu N° {numero}. Abrazo, {empresa}',
          waRecontactoTemplate: '¿Arrancamos con la poda?',
        });
        const backup = buildBackupObject();
        // Teléfono nuevo: sin nada guardado.
        localStorage.clear();
        const antes = getFollowupCfg();
        applyBackupObject(JSON.parse(JSON.stringify(backup)));
        const despues = getFollowupCfg();
        return { enBackup: !!backup.followup, antes, despues };
      });
      check('A1 · la config de seguimiento viaja en el backup', r.enBackup);
      check('A1 · en un teléfono nuevo arranca en los valores de fábrica',
        r.antes.days === 10 && r.antes.waTemplate.startsWith('Hola {cliente}, ¿cómo andás?'));
      check('A1 · tras restaurar vuelven los días y los estados configurados',
        r.despues.days === 21 && r.despues.expiryEnabled === false &&
        r.despues.estados.join(',') === 'enviado,aceptado', JSON.stringify(r.despues.estados));
      check('A1 · y las TRES plantillas de WhatsApp',
        r.despues.waTemplate === 'Hola {cliente}, ¿pudiste ver el presupuesto?' &&
        r.despues.waSendTemplate === 'Te paso el presu N° {numero}. Abrazo, {empresa}' &&
        r.despues.waRecontactoTemplate === '¿Arrancamos con la poda?');
      await page.close();
    }

    // ── A1b · La config también se valida (viene de un archivo ajeno) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        applyBackupObject({ _type:'backup_completo', followup: {
          days: 99999, estados: ['inventado','enviado'], enabled: 'sí',
          waTemplate: 'x'.repeat(5000),
        }});
        const c = getFollowupCfg();
        return { days: c.days, estados: c.estados, enabled: c.enabled, largo: c.waTemplate.length };
      });
      check('A1b · días fuera de rango se acotan', r.days === 365, 'days=' + r.days);
      check('A1b · estados desconocidos se filtran', r.estados.join(',') === 'enviado', r.estados.join(','));
      check('A1b · plantilla gigante se recorta', r.largo === 1500, 'largo=' + r.largo);
      await page.close();
    }

    // ── A3 · Un fallo aislado no molesta; dos seguidos avisan ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        localStorage.setItem('pq_gdrive_on', '1');
        localStorage.setItem('pq_gdrive_last', new Date(Date.now() - 86400000*120).toISOString());
        switchTab('empresa');
        const sec = document.getElementById('gdrive-section');
        const status = document.getElementById('gdrive-status');
        const cBtn = document.getElementById('gdrive-connect');
        // Simular que la subida falla (token revocado desde la cuenta de Google)
        const orig = window.gdriveUpload;
        window.gdriveUpload = async () => { throw new Error('Drive update 401'); };
        const toasts = [];
        const origToast = window.toast;
        window.toast = (m, t) => { toasts.push(m); };

        await gdriveAutoUpload();                       // 1er fallo
        const tras1 = { fail: sec.classList.contains('is-fail'), txt: status.textContent, toasts: toasts.length };
        await gdriveAutoUpload();                       // 2º fallo → avisa
        const tras2 = { fail: sec.classList.contains('is-fail'), txt: status.textContent,
                        toasts: toasts.length, btn: cBtn.textContent, visible: cBtn.style.display !== 'none' };
        await gdriveAutoUpload();                       // 3er fallo → no repite el toast
        const tras3 = { toasts: toasts.length };

        // Se recupera la conexión
        window.gdriveUpload = async () => { localStorage.setItem('pq_gdrive_last', new Date().toISOString()); };
        await gdriveAutoUpload();
        const tras4 = { fail: sec.classList.contains('is-fail'), txt: status.textContent,
                        toasts: toasts.slice(-1)[0], btn: cBtn.textContent };

        window.gdriveUpload = orig; window.toast = origToast;
        return { tras1, tras2, tras3, tras4 };
      });
      check('A3 · un fallo aislado no marca ni avisa',
        r.tras1.fail === false && r.tras1.toasts === 0, JSON.stringify(r.tras1));
      check('A3 · al 2º fallo la sección se marca en rojo', r.tras2.fail === true);
      check('A3 · el cartel dice desde cuándo NO hay copia',
        /No se pudo copiar desde el/.test(r.tras2.txt), r.tras2.txt);
      check('A3 · avisa con un toast accionable', r.tras2.toasts === 1);
      check('A3 · y ofrece "Reconectar"', r.tras2.btn === 'Reconectar' && r.tras2.visible);
      check('A3 · no repite el aviso en cada fallo', r.tras3.toasts === 1);
      check('A3 · al recuperarse vuelve a "Conectado ✓" y avisa',
        r.tras4.fail === false && /Conectado ✓/.test(r.tras4.txt) &&
        /restablecida/.test(r.tras4.toasts) && r.tras4.btn === 'Conectar Google Drive',
        JSON.stringify(r.tras4));
      await page.close();
    }

    // ── A3b · Calendar: mismo tratamiento, con el mensaje traducido ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        localStorage.setItem('pq_gcal_on', '1');
        switchTab('empresa');
        const sec = document.getElementById('gcal-section');
        const status = document.getElementById('gcal-status');
        const orig = window.gcalSync;
        const toasts = [];
        const origToast = window.toast;
        window.toast = (m) => toasts.push(m);
        // 403 con accessNotConfigured = falta habilitar la Calendar API
        window.gcalSync = async () => { const e = new Error('calendars 403'); e.status = 403; e.detail = 'accessNotConfigured'; throw e; };
        await gcalAutoSync(); await gcalAutoSync();
        const out = { fail: sec.classList.contains('is-fail'), txt: status.textContent, toast: toasts[0] || '' };
        window.gcalSync = orig; window.toast = origToast;
        return out;
      });
      check('A3b · Calendar también se marca al 2º fallo', r.fail === true);
      check('A3b · y explica exactamente qué hacer (reusa _gcalErrMsg)',
        /Falta habilitar la Google Calendar API/.test(r.txt) &&
        /Falta habilitar la Google Calendar API/.test(r.toast), r.txt);
      await page.close();
    }

    // ── A3c · Un evento que falla no debe cortar el resto de la pasada ──
    // Antes, el primer insert fallido tiraba y se salteaba todo lo que venía
    // después — incluido el borrado —, así que la agenda quedaba a medias.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        localStorage.setItem('pq_gcal_on', '1');
        localStorage.setItem('pq_gcal_id', 'cal-test');
        // Dos trabajos agendados (→ 2 inserts) y un evento viejo a borrar.
        const hoy = today();
        setH([
          { id: 1, quoteNumber:'2026-0001', clientName:'A', currency:'ARS', total: 1, estado:'aceptado',
            fechasTrabajo:[hoy], snapshot:{ items:[] } },
          { id: 2, quoteNumber:'2026-0002', clientName:'B', currency:'ARS', total: 1, estado:'aceptado',
            fechasTrabajo:[hoy], snapshot:{ items:[] } },
        ]);
        const llamadas = { POST: 0, DELETE: 0 };
        const origFetch = window.fetch;
        window.fetch = async (url, opt) => {
          const m = (opt && opt.method) || 'GET';
          const u = String(url);
          if (u.includes('/calendars/') && m === 'GET' || u.includes('/events?')) {
            // listado: devuelve un evento huérfano que hay que borrar
            return { ok: true, json: async () => ({ items: [
              { id:'viejo', extendedProperties:{ private:{ pqKey:'e999-trabajo-20200101', pqHash:'x' } } }
            ]}) };
          }
          if (m === 'POST') { llamadas.POST++; return { ok: false, status: 500, text: async () => 'boom' }; }
          if (m === 'DELETE') { llamadas.DELETE++; return { ok: true }; }
          return { ok: true, json: async () => ({}) };
        };
        window.gcalGetToken = async () => 'tok';
        window.gcalEnsureCalendar = async () => 'cal-test';
        let tiro = false;
        try { await gcalSync(); } catch(_) { tiro = true; }
        window.fetch = origFetch;
        return { llamadas, tiro };
      });
      check('A3c · intenta TODOS los eventos aunque el primero falle',
        r.llamadas.POST === 2, 'inserts intentados=' + r.llamadas.POST);
      check('A3c · y el borrado de lo viejo igual se ejecuta',
        r.llamadas.DELETE === 1, 'deletes=' + r.llamadas.DELETE);
      check('A3c · pero el error se reporta al final (no se traga)', r.tiro === true);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
