// test/espacio.test.cjs — Snapshots sin configuración + medidor de espacio.
//
// Cada entrada del historial guardaba S ENTERO como snapshot, configuración del
// negocio incluida (textos del PDF, diseño, datos de cobro): ~70 % de un
// snapshot típico, contra el tope de ~5 MB de localStorage y en cada backup. Y
// no se usaba: assignSnapshot nunca restaura CFG_GLOBAL_FIELDS. Ahora el
// snapshot va sin eso (snapshotSinConfig) y la pasada de sanitización del
// arranque aliviana lo que ya estaba guardado.
//
// Lo que se protege acá:
//   1. El autoguardado, el trabajo sin presupuesto y "Exportar presupuesto" no
//      copian la configuración; los datos DEL presupuesto siguen todos.
//   2. Abrir y ver un presupuesto viejo da el mismo documento que antes.
//   3. La migración: un historial viejo queda sin configuración, más liviano,
//      con los presupuestos intactos, y la segunda pasada no reescribe nada.
//   4. El medidor dice cuánto se usa y, pasado el 80 %, marca la sección y
//      avisa al abrir una sola vez por día.
//
// Uso:  node test/espacio.test.cjs

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
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  return page;
}

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.numPrefix = '2026-'; S.numNext = 1;
  S.coName = 'Poda en Altura AR'; S.coCbu = '0000003100012345678901'; S.coAliasPago = 'poda.altura';
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Consorcio Rivadavia 2210'; S.currency = 'ARS';
  S.items = [{ id:1, type:'tree', species:'Tipuana', desc:'Extracción', price:'245000', qty:1 }];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); applyMode('normal');
`;

const SIN_CFG = `snap => CFG_GLOBAL_FIELDS.filter(k => k in snap)`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1 y 2: lo que se guarda y lo que se ve ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const cfgEn = ${SIN_CFG};
        buildDoc();
        const docAntes = document.getElementById('doc-a4').innerHTML;
        autoSaveToHistory();
        const e = getH()[0];
        const res = {
          cfgAuto: cfgEn(e.snapshot),
          datos: e.snapshot.clientName === 'Consorcio Rivadavia 2210' && e.snapshot.items.length === 1
                 && e.snapshot.currency === 'ARS' && e.snapshot.quoteNumber === S.quoteNumber,
        };
        // Abrir el presupuesto guardado y armar su documento: tiene que ser el mismo
        resetToNewQuote();
        loadFromHistory(e.id);
        buildDoc();
        res.mismoDoc = document.getElementById('doc-a4').innerHTML === docAntes;
        res.cfgSigue = S.coName === 'Poda en Altura AR' && S.coCbu === '0000003100012345678901';
        // Trabajo sin presupuesto
        const h = getH();
        res.colab = typeof colabGuardar === 'function';
        // Exportar un presupuesto suelto: capturar lo que se descarga
        let exportado = null;
        const dl = window.dlJSON; window.dlJSON = (obj) => { exportado = obj; };
        try { expCurrent(); } catch (err) { res.expErr = err.message; }
        window.dlJSON = dl;
        res.cfgExport = exportado ? cfgEn(exportado.snapshot) : ['(no exportó)'];
        res.exportDatos = !!(exportado && exportado.snapshot.clientName === 'Consorcio Rivadavia 2210');
        return res;
      })()`));
      check('El autoguardado no copia la configuración', r.cfgAuto.length === 0, r.cfgAuto.join(','));
      check('El snapshot conserva los datos del presupuesto', r.datos);
      check('Abrir el presupuesto guardado da el mismo documento', r.mismoDoc);
      check('Abrirlo no toca la configuración actual', r.cfgSigue);
      check('Exportar un presupuesto no manda la configuración (ni los datos de cobro)',
        r.cfgExport.length === 0, (r.expErr || '') + r.cfgExport.join(','));
      check('Exportar un presupuesto sigue mandando sus datos', r.exportDatos);
      await page.close();
    }

    // ── 1b: trabajo sin presupuesto ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        abrirColaboracion();
        document.getElementById('colab-colega').value = 'Juan Colega'; document.getElementById('colab-nombre').value = 'Jornada de trepa';
        const precio = document.getElementById('colab-precio'); if (precio) precio.value = '80000';
        colabGuardar();
        const e = getH().find(x => x.esTrabajoPropio);
        return { hay: !!e, cfg: e ? (${SIN_CFG})(e.snapshot) : [] };
      })()`));
      check('El trabajo sin presupuesto tampoco copia la configuración',
        r.hay && r.cfg.length === 0, r.hay ? r.cfg.join(',') : 'no se creó');
      await page.close();
    }

    // ── 3: migración de un historial viejo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // 40 presupuestos "a la vieja": S entero como snapshot
        const viejos = [];
        for (let i = 1; i <= 40; i++) {
          const snap = JSON.parse(JSON.stringify(S));
          delete snap.logo;
          snap.quoteNumber = '2026-' + String(i).padStart(4, '0');
          snap.clientName = 'Cliente ' + i;
          viejos.push({ id: 1000 + i, quoteNumber: snap.quoteNumber, clientName: snap.clientName,
            currency: 'ARS', total: 245000, itemCount: 1, estado: 'enviado', snapshot: snap });
        }
        localStorage.setItem(LS.HISTORY, JSON.stringify(viejos));
        const antes = localStorage.getItem(LS.HISTORY).length;
        migrateSanitizeStored();
        const despues = localStorage.getItem(LS.HISTORY);
        const h = JSON.parse(despues);
        const conCfg = h.filter(e => (${SIN_CFG})(e.snapshot).length).length;
        const intactos = h.length === 40 && h.every((e, i) => e.snapshot.clientName === 'Cliente ' + (i + 1)
          && e.snapshot.items.length === 1 && e.estado === 'enviado' && e.id === 1001 + i);
        migrateSanitizeStored();
        return { antes, despues: despues.length, conCfg, intactos,
                 idempotente: localStorage.getItem(LS.HISTORY) === despues };
      })()`));
      check('La migración saca la configuración de todos los snapshots', r.conCfg === 0, 'con config: ' + r.conCfg);
      check('El historial migrado pesa mucho menos',
        r.despues < r.antes * 0.5, `${r.antes} → ${r.despues} caracteres (${Math.round(100 - r.despues / r.antes * 100)} % menos)`);
      check('Los presupuestos quedan intactos (datos, estado, id)', r.intactos);
      check('La segunda pasada no reescribe nada', r.idempotente);
      await page.close();
    }

    // ── 4: medidor y aviso ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        autoSaveToHistory();
        switchTab('empresa'); switchSubtab('datos');
        const sec = document.getElementById('espacio-section');
        const u = espacioUso();
        const res = {
          bajo: { pct: u.pct, txt: document.getElementById('esp-txt').textContent,
                  warn: sec.classList.contains('is-warn') || sec.classList.contains('is-fail') },
        };
        // Encolados (la cola espera a que se cierre la bienvenida) + visibles
        const toasts = () => document.querySelectorAll('#toast-container .toast').length + _colaAvisos.length;
        const t0 = toasts();
        espacioAvisarSiLleno();
        res.sinAvisoBajo = toasts() === t0;
        // Llenar hasta ~85 %
        localStorage.setItem('relleno_test', 'x'.repeat(Math.round(ESPACIO_TOPE * 0.85)));
        espacioRender();
        res.alto = { warn: sec.classList.contains('is-warn'),
                     txt: document.getElementById('esp-txt').textContent };
        espacioAvisarSiLleno();
        res.avisos1 = toasts() - t0;
        espacioAvisarSiLleno();
        res.avisos2 = toasts() - t0;
        localStorage.removeItem('relleno_test');
        return res;
      })()`));
      await new Promise(res => setTimeout(res, 300));
      check('El medidor muestra el uso', /Usado: .* de 5,0\s?MB/u.test(r.bajo.txt) && r.bajo.pct > 0 && r.bajo.pct < 0.1,
        r.bajo.txt.slice(0, 80));
      check('Con poco uso no marca ni avisa', !r.bajo.warn && r.sinAvisoBajo);
      check('Pasado el 80 % marca la sección y explica qué hacer',
        r.alto.warn && /Se está llenando/.test(r.alto.txt));
      check('Pasado el 80 % avisa al abrir, una sola vez por día', r.avisos1 === 1 && r.avisos2 === 1,
        `avisos: ${r.avisos1}, ${r.avisos2}`);
      await page.close();
    }

  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
