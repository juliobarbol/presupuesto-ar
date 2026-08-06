// test/clima-refresh.test.cjs — Botón "Actualizar" del panel de clima.
//
// El pronóstico se cachea por zona con TTL de 3 h y TODOS los caminos
// automáticos (abrir la app, volver del segundo plano, agendar, abrir el panel)
// lo respetan. Eso está bien para no golpear la API, pero dejaba al usuario sin
// salida: el panel decía "hace 2 h" y no había forma de pedir el dato de ahora
// (el caso que lo pidió: mover una visita de día y querer el pronóstico nuevo).
//
// Lo que se protege acá:
//   1. Dentro del TTL, el camino automático NO sale a la red (sigue barato).
//   2. climaForceRefresh SÍ sale, aunque el cache esté fresco, y actualiza `at`.
//   3. Sin conexión no intenta nada y lo dice ('offline'); el cache queda intacto.
//   4. El botón está en el pie del panel y tras tocarlo el pie dice "recién".
//   5. Se refrescan TODAS las zonas próximas, no solo la del panel abierto.
//
// La API se stubea (fetch falso): el test no depende de Open-Meteo ni de la red.
//
// Uso:  node test/clima-refresh.test.cjs

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

// fetch falso con la forma que devuelve Open-Meteo + contador de llamadas, y
// dos visitas en zonas DISTINTAS (Córdoba y Alta Gracia) con cache fresco
// (hace 30 min) para que el TTL de 3 h esté vigente.
const SEMBRAR = `
  window._fetchCalls = [];
  window.fetch = async (url) => {
    window._fetchCalls.push(String(url));
    const dias = [], codes = [], pps = [], mms = [], tmax = [], tmin = [], wind = [], gust = [], uv = [];
    for (let i = 0; i < 16; i++) {
      dias.push(_calAddDays(today(), i));
      codes.push(51); pps.push(80); mms.push(6); tmax.push(18); tmin.push(7);
      wind.push(12); gust.push(30); uv.push(3);
    }
    return { ok: true, json: async () => ({
      daily: { time: dias, weather_code: codes, precipitation_probability_max: pps,
               precipitation_sum: mms, temperature_2m_max: tmax, temperature_2m_min: tmin,
               wind_speed_10m_max: wind, wind_gusts_10m_max: gust, uv_index_max: uv },
      hourly: { time: [], temperature_2m: [], precipitation_probability: [],
                precipitation: [], weather_code: [], wind_gusts_10m: [], uv_index: [] },
    }) };
  };
  const F2 = _calAddDays(today(), 2);
  setNotes([
    { id:'n_cba', fecha:F2, texto:'Poda De Phoenix con Augusto', hecho:false,
      cliente:'Augusto', tel:'+54 9 351 617-3556', ubic:'-31.1660270, -64.3195100', tipo:'visita' },
    { id:'n_ag',  fecha:F2, texto:'Ver tipa en Alta Gracia', hecho:false,
      ubic:'-31.6580000, -64.4280000', tipo:'visita' },
  ]);
  // Cache "fresco" (hace 30 min) para las dos zonas.
  const viejo = {};
  [[-31.166, -64.31951], [-31.658, -64.428]].forEach(ll => {
    const days = {}; for (let i = 0; i < 16; i++) {
      days[_calAddDays(today(), i)] = { code:0, pp:0, mm:0, tmax:20, tmin:8, wind:5, gust:9, uv:2 };
    }
    viejo[_climaKey(ll)] = { at: Date.now() - 30 * 60 * 1000, v: CLIMA.VER, days, hours:{} };
  });
  localStorage.setItem(LS.CLIMA, JSON.stringify(viejo));
  renderCal();
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1 y 2: TTL respetado por el camino automático, salteado por el manual ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${SEMBRAR}
        const atAntes = _climaCache()[_climaKey([-31.166,-64.31951])].at;
        await climaRefresh();                       // camino automático
        const autoCalls = window._fetchCalls.length;
        const res = await climaForceRefresh();      // botón "Actualizar"
        const zona = _climaCache()[_climaKey([-31.166,-64.31951])];
        return { autoCalls, forceCalls: window._fetchCalls.length, res,
                 atAntes, atDespues: zona.at, pp: zona.days[_calAddDays(today(),2)].pp,
                 urls: window._fetchCalls.slice() };
      })()`));
      check('Con cache fresco el refresco automático NO sale a la red',
        r.autoCalls === 0, r.autoCalls + ' llamada(s)');
      check('"Actualizar" sí sale, aunque el cache esté fresco',
        r.res === 'ok' && r.forceCalls > 0, r.res + ', ' + r.forceCalls + ' llamada(s)');
      check('…y el dato queda actualizado (at nuevo + valores nuevos)',
        r.atDespues > r.atAntes && r.pp === 80, 'pp=' + r.pp);
      // 5: las dos zonas, no solo la del panel
      check('Refresca TODAS las zonas próximas de una vez',
        r.forceCalls === 2 && /-31\.1[67]/.test(r.urls.join(' ')) && /-31\.6[56]/.test(r.urls.join(' ')),
        r.forceCalls + ' zonas: ' + r.urls.map(u => (u.match(/latitude=([-\d.]+)/) || [])[1]).join(' + '));
      await page.close();
    }

    // ── 3: sin conexión no intenta nada y no pisa el cache ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${SEMBRAR}
        Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
        const atAntes = _climaCache()[_climaKey([-31.166,-64.31951])].at;
        const res = await climaForceRefresh();
        return { res, calls: window._fetchCalls.length, atAntes,
                 atDespues: _climaCache()[_climaKey([-31.166,-64.31951])].at };
      })()`));
      check('Sin conexión avisa y no llama a la API',
        r.res === 'offline' && r.calls === 0, r.res + ', ' + r.calls + ' llamada(s)');
      check('…y el pronóstico guardado queda intacto', r.atDespues === r.atAntes);
      await page.close();
    }

    // ── 4: el botón vive en el pie del panel y refleja el refresco ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${SEMBRAR}
        climaOpenDetail('n', 'n_cba', _calAddDays(today(), 2));
        const antes = document.querySelector('#clima-dlg-body .cw-src').textContent;
        const hayBtn = !!document.getElementById('cw-refresh');
        await climaRefrescarAhora(document.getElementById('cw-refresh'));
        const despues = document.querySelector('#clima-dlg-body .cw-src').textContent;
        const abierto = document.querySelector('#clima-overlay.open') !== null;
        closeClimaDetail();
        return { hayBtn, antes, despues, abierto, calls: window._fetchCalls.length };
      })()`));
      check('El panel trae el botón "Actualizar" en el pie', r.hayBtn);
      check('Antes decía la edad del dato viejo', /hace 30 min/.test(r.antes), r.antes);
      check('…y tras actualizar dice que es de recién',
        /recién/.test(r.despues), r.despues);
      check('…sin cerrar el panel', r.abierto);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
