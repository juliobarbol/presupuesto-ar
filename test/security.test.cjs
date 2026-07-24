// test/security.test.cjs — Regresión de seguridad e integridad de datos.
//
// Cubre los hallazgos críticos de docs/auditoria-2026-07-24.md, arreglados en
// la tanda 1 (js/sanitize.js). Todos parten del mismo escenario real: el
// usuario restaura un backup .json que le pasó un colega (o baja la copia de
// Google Drive de una cuenta comprometida). Ese archivo es input NO confiable.
//
//   C1 · XSS — 4 vectores: id de nota (Agenda), notifLog (campanita), id de
//        entrada del historial, y S.pdfTheme (documento/PDF). Dos de ellos se
//        disparaban sin que el usuario tocara nada.
//   C3 · App rota de forma permanente por un `history` que no es un array.
//   A2 · Restauración a medias: si falla, tiene que revertir.
//
// Uso:  node test/security.test.cjs
// Requiere $PUPPETEER_EXECUTABLE_PATH (lo deja el SessionStart hook).

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
const HOY = (() => { const d=new Date(), p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })();

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

// Abre la app limpia (cada caso arranca sin datos de los anteriores).
async function nuevaPagina(browser) {
  const page = await browser.newPage();
  page.on('pageerror', () => {});
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
    // ── C1.1 · Nota de la Agenda: se ejecutaba con solo abrir la pestaña ──
    {
      const page = await nuevaPagina(browser);
      await page.evaluate((hoy) => {
        window.__PWNED = false;
        applyBackupObject({ _type:'backup_completo', notes: [{
          id: 'x"><img src=noexiste onerror="window.__PWNED=true">',
          fecha: hoy, texto: 'nota inocente', hecho: false }] });
        switchTab('agenda');
      }, HOY);
      await new Promise(r => setTimeout(r, 800));
      const pwned = await page.evaluate(() => window.__PWNED);
      check('C1 · id de nota no inyecta al abrir la Agenda', pwned === false);
      await page.close();
    }

    // ── C1.2 · Bitácora de la campanita (notifLog) ──
    {
      const page = await nuevaPagina(browser);
      await page.evaluate(() => {
        window.__PWNED = false;
        applyBackupObject({ _type:'backup_completo', notifLog: [{
          id:'n_1', ts: Date.now(), text:'Aviso inocente', kind:'info',
          icon:'<img src=noexiste onerror="window.__PWNED=true">' }] });
        notifRender();
      });
      await new Promise(r => setTimeout(r, 800));
      const pwned = await page.evaluate(() => window.__PWNED);
      check('C1 · notifLog no inyecta al abrir la campanita', pwned === false);
      await page.close();
    }

    // ── C1.3 · Id de entrada del historial (se dispara al tocar la tarjeta) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        window.__PWNED = false;
        applyBackupObject({ _type:'backup_completo', history: [{
          id: '0);window.__PWNED=true;//', savedAt: new Date().toISOString(),
          quoteNumber:'2026-0001', clientName:'Cliente', currency:'ARS',
          total: 1000, itemCount: 1, estado:'borrador',
          snapshot:{ items:[], dateIssue:'2026-07-24' } }] });
        switchTab('historial');
        document.querySelectorAll('#history-list [onclick]').forEach(b => { try { b.click(); } catch(_){} });
        return { pwned: window.__PWNED, idNumerico: typeof (getH()[0]||{}).id === 'number', entradas: getH().length };
      });
      check('C1 · id de entrada no inyecta al tocar el historial', r.pwned === false);
      check('C1 · el id inválido se reemplaza por uno numérico (sin perder el presupuesto)',
        r.idNumerico && r.entradas === 1);
      await page.close();
    }

    // ── C1.4 · S.pdfTheme interpolado en el class del documento ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        window.__PWNED = false;
        applyBackupObject({ _type:'backup_completo', state: {
          clientName:'Cliente', quoteNumber:'2026-0001', items:[],
          pdfTheme: 'clasico"><img src=noexiste onerror="window.__PWNED=true' } });
        buildDoc();
        return { tema: S.pdfTheme };
      });
      await new Promise(r2 => setTimeout(r2, 800));
      const pwned = await page.evaluate(() => window.__PWNED);
      check('C1 · pdfTheme no inyecta al construir el documento', pwned === false);
      check('C1 · un tema desconocido cae al default', r.tema === 'clasico', 'tema=' + r.tema);
      await page.close();
    }

    // ── C3 · `history` que no es array: no debe romper la app ──
    {
      const page = await nuevaPagina(browser);
      await page.evaluate(() => {
        applyBackupObject({ _type:'backup_completo',
          history: { '0': { id: 1, quoteNumber:'2026-0001', clientName:'Rescatado' } } });
      });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1200));
      const r = await page.evaluate(() => {
        const o = { errHist: null, errCal: null };
        try { switchTab('historial'); } catch (e) { o.errHist = e.message; }
        try { switchTab('agenda'); } catch (e) { o.errCal = e.message; }
        o.entradas = getH().length;
        o.esArray = Array.isArray(getH());
        return o;
      });
      check('C3 · el Historial abre sin excepción tras un import malformado', r.errHist === null, r.errHist || '');
      check('C3 · la Agenda abre sin excepción tras un import malformado', r.errCal === null, r.errCal || '');
      check('C3 · el historial queda como array y se rescata la entrada',
        r.esArray && r.entradas === 1, 'entradas=' + r.entradas);
      await page.close();
    }

    // ── A2 · Restauración fallida a mitad de camino: tiene que revertir ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        setH([
          { id: 111, quoteNumber:'2026-0001', clientName:'VIEJO A', currency:'ARS', total: 1000, estado:'enviado', snapshot:{items:[]} },
          { id: 222, quoteNumber:'2026-0002', clientName:'VIEJO B', currency:'ARS', total: 2000, estado:'borrador', snapshot:{items:[]} },
        ]);
        safeSetLS(CLIENT_KEY, JSON.stringify([{name:'VIEJO A',contact:'',address:'',maplink:''}]));
        const antes = { hist: getH().length, cli: getClientDB().length };
        const orig = window.factInit;
        window.factInit = function(){ throw new Error('falla simulada'); };
        const resultado = applyBackupObject({ _type:'backup_completo',
          state: { clientName:'NUEVO', items:[] },
          history: [{ id: 999, quoteNumber:'2099-0001', clientName:'NUEVO', currency:'ARS', total: 5, estado:'borrador', snapshot:{items:[]} }],
          clients: [{name:'NUEVO'},{name:'Otro NUEVO'}] });
        window.factInit = orig;
        const despues = { hist: getH().length, cli: getClientDB().length };
        return { resultado, antes, despues, nombres: getH().map(e => e.clientName) };
      });
      check('A2 · una restauración fallida devuelve false', r.resultado === false);
      check('A2 · y revierte: los datos previos siguen intactos',
        JSON.stringify(r.antes) === JSON.stringify(r.despues) &&
        r.nombres.join(',') === 'VIEJO A,VIEJO B',
        'quedó: ' + r.nombres.join(', '));
      await page.close();
    }

    // ── Datos legítimos: la validación NO debe romper el uso normal ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.clientName = 'Juan Pérez'; S.quoteNumber = '2026-0007'; S.currency = 'ARS';
        S.items = [{id:1,type:'tree',species:'Fresno',price:'250000',qty:1},
                   {id:2,type:'service',desc:'Camión',price:'80000',qty:2,showQty:true}];
        noSync = true; restoreUI(); noSync = false; renderItems();
        setH([]); autoSaveToHistory();
        const backup = buildBackupObject();
        setH([]); S.clientName = 'otro';
        const aplicado = applyBackupObject(JSON.parse(JSON.stringify(backup)));
        return { aplicado, entradas: getH().length, cliente: S.clientName,
                 total: (getH()[0]||{}).total };
      });
      check('Backup legítimo: ida y vuelta sin pérdidas',
        r.aplicado === true && r.entradas === 1 && r.cliente === 'Juan Pérez' && r.total === 410000,
        JSON.stringify(r));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
