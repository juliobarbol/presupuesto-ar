// test/net-salud.test.cjs — Salud de la conexión (js/net.js).
//
// El caso real: el celular se queda sin datos pero sigue "conectado". Los
// pedidos salen, nunca vuelven y la app se siente trabada. navigator.onLine no
// alcanza (sigue en true), y ningún fetch de la app tenía timeout: uno colgado
// dejaba trabado el candado del módulo (CLIMA._fetching) por el resto de la
// sesión.
//
// Lo que se protege acá:
//   1. netEsLenta() lee navigator.connection (2g / rtt alto / Ahorro de datos).
//   2. netFetch corta por timeout en vez de esperar para siempre.
//   3. Dos fallos de red seguidos abren el cortacircuitos; un éxito lo cierra.
//   4. Con la red mal, lo AUTOMÁTICO no sale (clima); lo MANUAL sí.
//   5. Un HTTP 500 NO cuenta como fallo de red (el server contestó).
//   6. El estado se ve en el topbar y no rompe el "✓ Guardado".
//
// Uso:  node test/net-salud.test.cjs

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

// Simula lo que informa el navegador sobre la red.
const RED = (o) => `
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    get: () => (${JSON.stringify(o)} === null ? undefined : Object.assign({ addEventListener(){} }, ${JSON.stringify(o)})),
  });
`;

// Un fetch que NUNCA responde: es exactamente el pedido de una red moribunda.
const FETCH_COLGADO = `
  window._fetchCalls = 0;
  window.fetch = (u, o) => { window._fetchCalls++; return new Promise((_, rej) => {
    if (o && o.signal) o.signal.addEventListener('abort', () => {
      const e = new Error('abort'); e.name = 'AbortError'; rej(e);
    });
  }); };
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: lectura de navigator.connection ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        const out = {};
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}   out.g4     = netEsLenta();
        ${RED({ effectiveType: '2g', rtt: 300, downlink: 1 })}  out.g2     = netEsLenta();
        ${RED({ effectiveType: 'slow-2g', rtt: 2000 })}         out.slow2g = netEsLenta();
        ${RED({ effectiveType: '4g', rtt: 1400, downlink: 5 })} out.rtt    = netEsLenta();
        ${RED({ effectiveType: '4g', rtt: 60, saveData: true })} out.save  = netEsLenta();
        ${RED({ effectiveType: '3g', rtt: 300, downlink: 1.2 })} out.g3    = netEsLenta();
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}
        out.estado4g = netEstado(); out.auto4g = netPuedeAuto();
        ${RED({ effectiveType: '2g', rtt: 300 })}
        out.estado2g = netEstado(); out.auto2g = netPuedeAuto(); out.etiqueta = netEtiqueta();
        return out;
      `));
      check('4G y 3G no son "lenta"', r.g4 === false && r.g3 === false);
      check('2G, slow-2G, rtt alto y Ahorro de datos sí lo son',
        r.g2 && r.slow2g && r.rtt && r.save,
        `2g=${r.g2} slow=${r.slow2g} rtt=${r.rtt} saveData=${r.save}`);
      check('Con 4G lo automático puede salir', r.estado4g === 'ok' && r.auto4g === true);
      check('Con 2G lo automático NO sale y se etiqueta',
        r.estado2g === 'lenta' && r.auto2g === false && r.etiqueta === 'Red lenta',
        r.estado2g + ' / ' + r.etiqueta);
      await page.close();
    }

    // ── 2 y 3: timeout + cortacircuitos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}
        ${FETCH_COLGADO}
        const t0 = Date.now();
        let err1 = '';
        try { await netFetch('https://ejemplo.test/1', {}, { timeout: 300 }); }
        catch (e) { err1 = e.message; }
        const tardo = Date.now() - t0;
        const trasUno = { fails: NET._fails, cortada: netCortada() };
        try { await netFetch('https://ejemplo.test/2', {}, { timeout: 300 }); } catch (e) {}
        const trasDos = { fails: NET._fails, cortada: netCortada(), estado: netEstado(), etiqueta: netEtiqueta() };
        // Un éxito cierra el corte
        window.fetch = async () => ({ ok: true, status: 200 });
        await netFetch('https://ejemplo.test/3');
        return { err1, tardo, trasUno, trasDos, cerrado: !netCortada(), estadoFinal: netEstado() };
      })()`));
      check('netFetch corta por timeout en vez de colgarse',
        /tardó demasiado/.test(r.err1) && r.tardo < 2000, r.err1 + ' (' + r.tardo + ' ms)');
      check('Un fallo aislado NO corta nada',
        r.trasUno.fails === 1 && r.trasUno.cortada === false);
      check('Dos fallos seguidos abren el cortacircuitos',
        r.trasDos.cortada === true && r.trasDos.estado === 'cortada' && r.trasDos.etiqueta === 'Sin datos',
        r.trasDos.estado + ' / ' + r.trasDos.etiqueta);
      check('Un pedido exitoso cierra el corte enseguida',
        r.cerrado && r.estadoFinal === 'ok', r.estadoFinal);
      await page.close();
    }

    // ── 5: un HTTP 500 no es un fallo de red ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}
        window.fetch = async () => ({ ok: false, status: 500 });
        await netFetch('https://ejemplo.test/a');
        await netFetch('https://ejemplo.test/b');
        await netFetch('https://ejemplo.test/c');
        return { fails: NET._fails, cortada: netCortada() };
      })()`));
      check('Tres respuestas 500 no abren el corte (el server contestó)',
        r.fails === 0 && r.cortada === false, 'fails=' + r.fails);
      await page.close();
    }

    // ── El "Ahorro de datos" no puede dejarte sin copia de seguridad ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        const out = {};
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8, saveData: true })}
        out.ahorroClima  = netPuedeAuto();             // prescindible: frenado
        out.ahorroBackup = netPuedeAutoImportante();   // importante: sigue
        ${RED({ effectiveType: '2g', rtt: 300 })}
        out.g2Backup = netPuedeAutoImportante();       // red real mala: frenado
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}
        NET._corteHasta = Date.now() + 60000;
        out.corteBackup = netPuedeAutoImportante();    // cortacircuitos: frenado
        NET._corteHasta = 0;
        return out;
      `));
      check('Con Ahorro de datos se frena el clima pero NO la copia a Drive',
        r.ahorroClima === false && r.ahorroBackup === true,
        'clima=' + r.ahorroClima + ' backup=' + r.ahorroBackup);
      check('Con 2G real la copia sí se pospone', r.g2Backup === false);
      check('Con el cortacircuitos abierto también', r.corteBackup === false);
      await page.close();
    }

    // ── 4: automático vs. manual, sobre el clima ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RED({ effectiveType: '2g', rtt: 400 })}
        window._fetchCalls = 0;
        window.fetch = async (u) => {
          window._fetchCalls++;
          const dias = []; for (let i = 0; i < 16; i++) dias.push(_calAddDays(today(), i));
          return { ok: true, status: 200, json: async () => ({
            daily: { time: dias, weather_code: dias.map(() => 0), precipitation_probability_max: dias.map(() => 5),
                     precipitation_sum: dias.map(() => 0), temperature_2m_max: dias.map(() => 20),
                     temperature_2m_min: dias.map(() => 8), wind_speed_10m_max: dias.map(() => 9),
                     wind_gusts_10m_max: dias.map(() => 15), uv_index_max: dias.map(() => 3) },
            hourly: { time: [] } }) };
        };
        setNotes([{ id:'n_1', fecha:_calAddDays(today(),2), texto:'Visita', hecho:false,
                    ubic:'-31.1660270, -64.3195100', tipo:'visita' }]);
        localStorage.removeItem(LS.CLIMA);
        await climaRefresh();                    // automático, con red 2G
        const auto = window._fetchCalls;
        const res = await climaForceRefresh();   // manual: el usuario lo pidió
        return { auto, manual: window._fetchCalls, res };
      })()`));
      check('Con red lenta el clima automático no sale a la red',
        r.auto === 0, r.auto + ' llamada(s)');
      check('…pero el botón "Actualizar" del usuario sí funciona',
        r.res === 'ok' && r.manual > 0, r.res + ', ' + r.manual + ' llamada(s)');
      await page.close();
    }

    // ── 6: el topbar muestra el estado sin romper el "Guardado" ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RED({ effectiveType: '4g', rtt: 80, downlink: 8 })}
        _lastSaveAt = Date.now();
        _renderSaveStatus();
        const bien = document.getElementById('save-status').textContent;
        ${RED({ effectiveType: '2g', rtt: 400 })}
        netRenderEstado();
        const el = document.getElementById('save-status');
        return { bien, mal: el.textContent, clase: el.className, clickeable: typeof el.onclick === 'function' };
      `));
      check('Con red sana el topbar dice solo "Guardado"',
        r.bien === '✓ Guardado', r.bien);
      check('Con red mala lo dice al lado, sin tapar el guardado',
        /Guardado/.test(r.mal) && /Red lenta/.test(r.mal), r.mal);
      check('…y se puede tocar para entender qué pasa',
        r.clickeable && /net-mala/.test(r.clase), r.clase);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
