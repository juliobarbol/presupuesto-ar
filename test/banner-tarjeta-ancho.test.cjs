// Las tarjetas de los banners del Historial no se pueden comer el texto.
//
// El caso real (reporte con captura, celular de 360 px): al sumarse el botón
// "Nueva versión" a las tarjetas del banner de VENCIDOS quedaron tres acciones
// al lado del texto. El bloque de acciones no encogía (flex-shrink:0), así que
// le comió el ancho al texto y la tarjeta quedó ilegible: el número partido en
// dos ("2026-" / "0058"), el cliente reducido a "F…" y "venció hace 4 días"
// bajando una palabra por renglón.
//
// Los tres botones piden ~293 px y la tarjeta en un celular de 360 da 280: no
// entran en fila DE NINGUNA MANERA sin apretar algo. Por eso la tarjeta de
// vencidos se arma apilada (texto + ✓ arriba, "Nueva versión" y "WhatsApp"
// abajo a ancho completo) y el ✓ es el que sube, porque es el descarte del
// aviso y no una acción del trabajo.
//
// Y como regla general, `.fub-item` ahora envuelve con un piso de 120 px para
// el texto (`flex:1 1 120px`): en un celular angosto las acciones bajan solas
// antes de apretar el número. Lo que este test fija es que en NINGÚN ancho el
// texto se parta ni la tarjeta desborde, y que las tarjetas de 2 acciones
// (seguimiento y recontactos) sigan entrando en una línea en un celular normal.

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.CHROME_PATH
  || '/root/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

// Mide la primera tarjeta de cada banner con el historial cargado a mano.
async function medir(page, ancho) {
  await page.setViewport({ width: ancho, height: 1200, deviceScaleFactor: 1 });
  return page.evaluate(() => {
    const hoy = new Date();
    const iso = (d) => { const x = new Date(hoy); x.setDate(x.getDate() - d); return toLocalISODate(x); };
    const mk = (id, num, cli, dEnv, dVenc) => ({
      id, quoteNumber: num, clientName: cli, clientPhone: '3512345678',
      estado: 'enviado', enviadoEn: new Date(Date.now() - dEnv * 864e5).toISOString(),
      total: 500000, savedAt: iso(dEnv),
      snapshot: Object.assign({}, JSON.parse(JSON.stringify(DEF)), {
        quoteNumber: num, clientName: cli, clientPhone: '3512345678',
        dateIssue: iso(dEnv), dateExpiry: iso(dVenc),
      }),
    });
    // Uno para seguimiento (vigente) y otro vencido, con un nombre largo que
    // es justo el que se comía el ancho.
    setH([
      mk(1, '2026-0065', 'Sergio', 13, -30),
      mk(2, '2026-0058', 'Fernando Gutiérrez', 25, 4),
    ]);
    renderFollowupBanner();
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-historial').classList.add('active');

    const leer = (sel) => {
      const it = document.querySelector(sel + ' .fub-item');
      if (!it) return null;
      const info = it.querySelector('.fub-item-info');
      const acts = it.querySelector('.fub-item-acts');
      const num = it.querySelector('.fub-item-num');
      const dias = it.querySelector('.fub-item-days');
      const ri = info.getBoundingClientRect(), ra = acts.getBoundingClientRect();
      // Una línea = el alto no llega a dos renglones de su propia tipografía.
      const unaLinea = (el) => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 1.9;
      return {
        acciones: acts.children.length,
        // ¿Las acciones quedaron debajo del texto en vez de al lado?
        debajo: ra.top >= ri.bottom - 1,
        infoAncho: Math.round(ri.width),
        numUnaLinea: unaLinea(num),
        clienteUnaLinea: unaLinea(it.querySelector('.fub-item-client')),
        diasUnaLinea: unaLinea(dias),
        // ¿Algo se sale del ancho de la tarjeta?
        desborda: it.scrollWidth > it.clientWidth + 1,
        // ✓ de "no avisarme más": en vencidos va arriba, con el texto.
        okArriba: !!it.querySelector('.fub-item-top .fub-done'),
      };
    };
    return { seg: leer('#followup-banner'), venc: leer('#expiry-banner') };
  });
}

const anchos = [320, 360, 390, 420, 800];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => req.url().startsWith('file://') ? req.continue() : req.abort());
  // Sin el cartel de bienvenida tapando el historial.
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('pq_onboarded', '1'); } catch (_) {} });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));

  const m = {};
  for (const w of anchos) m[w] = await medir(page, w);

  // ── Lo que rompió el reporte: el texto apretado ──────────────────────
  for (const w of anchos) {
    const v = m[w].venc, s = m[w].seg;
    check(v.numUnaLinea && v.clienteUnaLinea && v.diasUnaLinea,
      `${w}px · vencidos: número, cliente y "venció hace N días" enteros`, JSON.stringify(v));
    check(s.numUnaLinea && s.clienteUnaLinea && s.diasUnaLinea,
      `${w}px · seguimiento: el texto entra igual`, JSON.stringify(s));
    check(!v.desborda && !s.desborda, `${w}px · ninguna tarjeta desborda su ancho`);
  }

  // ── La tarjeta de vencidos: apilada y con el ✓ arriba ────────────────
  check(anchos.every(w => m[w].venc.okArriba),
    'El ✓ ("no avisarme más") va arriba con el texto, no en la fila de acciones');
  check(anchos.every(w => m[w].venc.acciones === 2),
    'Abajo quedan las dos acciones reales: Nueva versión + WhatsApp');
  check(anchos.every(w => m[w].venc.debajo),
    'Y esa fila va SIEMPRE debajo del texto (en 360px los 3 botones no entran)');

  // ── Las de 2 acciones no cambian en un celular normal ────────────────
  check(m[360].seg.debajo === false && m[390].seg.debajo === false && m[800].seg.debajo === false,
    'La tarjeta de seguimiento sigue en una línea de 360px para arriba',
    JSON.stringify({ 360: m[360].seg.debajo, 390: m[390].seg.debajo, 800: m[800].seg.debajo }));
  check(m[320].seg.debajo === true,
    'En un celular angosto (320px) también baja, antes que apretar el texto');

  await browser.close();
  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
