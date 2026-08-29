// test/clima-compartir.test.cjs — Compartir el pronóstico de un día agendado.
//
// El caso que lo pidió: se agenda una poda y hay que avisarle al compañero (o
// al colega que da una mano) cómo va a estar el día — si va la altura, si hay
// que llevar agua, si conviene salir temprano. Hasta ahora el pronóstico se
// podía MIRAR (panel de detalle) pero no salía de la app.
//
// Dos caminos, un solo constructor de texto (climaResumenLineas):
//   A. Botón "Compartir" en el pie del panel de clima → mensaje completo.
//   D. El "Compartir" que ya tenían las tarjetas de la Agenda ahora lleva
//      también el pronóstico del día.
//
// Lo que se protege acá:
//   1. Un día feo se cuenta entero: lluvia, ráfaga con "peligro en altura", UV.
//   2. Un día tranquilo NO se llena de ruido (brisa suave y UV bajo no van) y
//      lo dice con todas las letras.
//   3. Sin pronóstico cacheado no se inventa nada: [] y el botón no se dibuja
//      (mandar "no sé cómo va a estar" no es compartir el clima).
//   4. Las horas feas se resumen en rangos ("de 11 a 16 h"), no hora por hora.
//   5. El mensaje del panel se entiende suelto: quién, qué día y las
//      recomendaciones accionables.
//   6. El compartir de la Agenda incluye el clima sin perder lo que ya decía.
//   7. Todo sale del cache: anda sin señal, que es cuando hace falta coordinar.
//
// Uso:  node test/clima-compartir.test.cjs

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

// Una visita en Alta Gracia pasado mañana + cache con dos días bien distintos:
// F2 feo (lluvia, ráfaga de 49 km/h, UV 6) y F3 tranquilo (despejado, brisa de
// 12 km/h, UV 2). Las horas de F2 traen tres horas feas seguidas (11–13) más
// una suelta (17) para probar el agrupado en rangos.
// SIN red: nada de esto sale a internet, se escribe el cache a mano.
const SEMBRAR = `
  window.fetch = async () => { throw new Error('el test no debe salir a la red'); };
  const LL = [-31.658, -64.428];
  const F2 = _calAddDays(today(), 2), F3 = _calAddDays(today(), 3);
  setNotes([
    { id:'n_ag', fecha:F2, texto:'Poda del fresno de Marta', hecho:false,
      cliente:'Marta', tel:'+54 9 351 555-1234', ubic:'-31.6580000, -64.4280000', tipo:'visita' },
  ]);
  const days = {};
  days[F2] = { code:61, pp:70, mm:6, tmax:20, tmin:12, wind:23, gust:49, uv:6 };
  days[F3] = { code:0,  pp:5,  mm:0, tmax:23, tmin:11, wind:8,  gust:12, uv:2 };
  const horas = [];
  for (let h = 6; h <= 21; h++) {
    const hh = String(h).padStart(2, '0');
    const feo = (h >= 11 && h <= 13) || h === 17;
    horas.push({ h:hh, t:18, pp: feo ? 80 : 5, mm: feo ? 1.2 : 0, code: feo ? 61 : 3,
                 gust: feo ? 50 : 15, uv:3 });
  }
  const hours = {}; hours[F2] = horas;
  const cache = {};
  cache[_climaKey(LL)] = { at: Date.now() - 30 * 60 * 1000, v: CLIMA.VER, days, hours };
  localStorage.setItem(LS.CLIMA, JSON.stringify(cache));
  renderCal();
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1, 2, 3 y 4: el resumen en texto ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        const zona = _climaZona([-31.658, -64.428]);
        return {
          feo:      climaResumenLineas(zona.days[F2]).join('\\n'),
          feoHoras: climaResumenLineas(zona.days[F2], zona, F2).join('\\n'),
          lindo:    climaResumenLineas(zona.days[F3], zona, F3).join('\\n'),
          sinDato:  climaResumenLineas(null).length,
        };
      `));
      check('El día feo cuenta la lluvia con probabilidad y milímetros',
        /🌧️ Lluvia 70% \(6 mm\)/.test(r.feo), r.feo.replace(/\n/g, ' | '));
      check('…la ráfaga con el aviso de peligro en altura',
        /💨 Ráfagas 49 km\/h — peligro en altura/.test(r.feo));
      check('…y el UV alto', /☀️ UV 6 \(alto\)/.test(r.feo));
      check('Las horas feas se agrupan en rangos, no hora por hora',
        /⏰ Se complica de 11 a 13 y a las 17 h/.test(r.feoHoras),
        (r.feoHoras.split('\n').pop() || ''));
      check('El día tranquilo no se llena de ruido (sin brisa ni UV bajo)',
        !/💨/.test(r.lindo) && !/☀️ UV/.test(r.lindo) && !/🌧️/.test(r.lindo),
        r.lindo.replace(/\n/g, ' | '));
      check('…y lo dice con todas las letras',
        /✅ Día tranquilo para trabajar/.test(r.lindo));
      check('…con la descripción y las temperaturas arriba',
        /☀️ Despejado · máx 23° \/ mín 11°/.test(r.lindo));
      check('Sin pronóstico no se inventa nada', r.sinDato === 0);
      await page.close();
    }

    // ── 5 y 7: el botón del panel y su mensaje (sin señal) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
        const F9 = _calAddDays(today(), 9);   // día sin dato en el cache
        climaOpenDetail('n', 'n_ag', F2);
        const pie = document.querySelector('#clima-dlg-body .cw-btns').innerHTML;
        const txt = climaShareTexto();
        climaDetailPick(F3);                  // un día lindo de la tira
        const txtLindo = climaShareTexto();
        const pieLindo = document.querySelector('#clima-dlg-body .cw-btns').innerHTML;
        climaDetailPick(F9);                  // fuera del cache
        const pieSinDato = document.querySelector('#clima-dlg-body .cw-btns').innerHTML;
        const txtSinDato = climaShareTexto();
        closeClimaDetail();
        return { pie, txt, txtLindo, pieLindo, pieSinDato, txtSinDato };
      `));
      check('El panel trae el botón "Compartir" en el pie',
        /climaCompartir\(\)/.test(r.pie));
      check('El mensaje dice de quién y de qué día es',
        /📋 Visita: Poda del fresno de Marta · /.test(r.txt) && /de \d{4}/.test(r.txt),
        (r.txt.split('\n')[0] || ''));
      check('…trae el pronóstico completo',
        /🌧️ Lluvia 70%/.test(r.txt) && /💨 Ráfagas 49/.test(r.txt) && /⏰ Se complica/.test(r.txt));
      check('…y las recomendaciones accionables',
        /• 💨 Viento fuerte \(49 km\/h\)/.test(r.txt) && /• 🧴 UV alto/.test(r.txt));
      check('…citando la fuente', /Open-Meteo/.test(r.txt));
      check('En un día bueno también se puede compartir ("dale que vamos")',
        /climaCompartir\(\)/.test(r.pieLindo) && /✅ Día tranquilo/.test(r.txtLindo));
      check('Sin pronóstico de ese día el botón no se dibuja',
        !/climaCompartir\(\)/.test(r.pieSinDato) && r.txtSinDato === '');
      check('Todo esto anduvo sin conexión (sale del cache)', true);
      await page.close();
    }

    // ── 6: el compartir de la tarjeta de la Agenda ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        calSetView('agenda'); calSelectDay(F2); renderCal();
        const btn = document.querySelector('#agc-list .agc-ev-share');
        return { share: btn ? btn.dataset.share : null };
      `));
      const s = r.share || '';
      check('La tarjeta de la Agenda sigue compartiendo lo de siempre',
        /📋 Visita/.test(s) && /Poda del fresno de Marta/.test(s), s.replace(/\n/g, ' | '));
      check('…y ahora también el pronóstico del día',
        /🌧️ Lluvia 70%/.test(s) && /💨 Ráfagas 49 km\/h — peligro en altura/.test(s));
      check('…sin la franja horaria (la tarjeta no tiene las horas: mensaje corto)',
        !/⏰ Se complica/.test(s));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
