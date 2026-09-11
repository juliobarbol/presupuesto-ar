// El cartel "Fondo del mapa sin cargar" tiene que APAGARSE.
//
// El caso real (reporte con captura): en el celular saltó el cartel amarillo y
// el mapa se veía sin fondo. El usuario tocó "Cargar el fondo igual", el fondo
// apareció… y el cartel siguió ahí, diciendo "sin datos" con el mapa cargado
// atrás y el topbar mostrando la conexión sana. Encima el teléfono tenía datos:
// el "sin datos" era el cortacircuitos de js/net.js, ya cerrado para entonces.
//
// La causa no estaba en la lógica sino en el CSS: `.mapa-neti{display:flex}` le
// gana a la regla `[hidden]` del navegador, así que `aviso.hidden = true` no
// apagaba nada (mismo problema que ya había tenido `.notes-count`). De paso, el
// cartel vacío se dibujaba SIEMPRE como una franja amarilla de ~18 px arriba
// del mapa, aun con la red perfecta.
//
// Este test fija las tres puntas:
//   A) con `hidden` puesto, el cartel no ocupa nada (ni siquiera vacío);
//   B) tocar "Cargar el fondo igual" lo apaga de verdad;
//   C) si la red se recupera sola mientras el usuario mira el mapa, el fondo
//      entra y el cartel se apaga sin tener que salir y volver a la pestaña.

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

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Nada sale a la red: los tiles de OpenStreetMap se bloquean (no hacen falta,
  // lo que se mira es la capa y el cartel, no las imágenes).
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().startsWith('file://')) req.continue();
    else req.abort();
  });

  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));

  // ── A) El cartel vacío no se dibuja ──────────────────────────────────
  const vacio = await page.evaluate(() => {
    document.getElementById('panel-mapa').classList.add('active');
    const el = document.getElementById('mapa-neti');
    return { hidden: el.hidden, display: getComputedStyle(el).display, alto: el.getBoundingClientRect().height };
  });
  check(vacio.hidden === true && vacio.display === 'none' && vacio.alto === 0,
    'Con [hidden] el cartel no ocupa lugar', JSON.stringify(vacio));

  // ── B) El cartel aparece con la red cortada y se apaga al cargar el fondo ──
  const b = await page.evaluate(async () => {
    // Cortacircuitos abierto: netEstado() === 'cortada' → netPuedeAuto() false.
    NET._fails = NET.FAILS_ABRE;
    NET._corteHasta = Date.now() + NET.CORTE_MS;

    mapaInit();
    await new Promise((r) => setTimeout(r, 400));

    const el = document.getElementById('mapa-neti');
    const conCorte = {
      visible: getComputedStyle(el).display !== 'none',
      texto: el.textContent,
      tiles: !!_mapaTiles,
    };

    mapaCargarFondo();
    await new Promise((r) => setTimeout(r, 400));

    return {
      conCorte,
      luego: { visible: getComputedStyle(el).display !== 'none', tiles: !!_mapaTiles },
    };
  });
  check(b.conCorte.visible && /sin datos/i.test(b.conCorte.texto) && !b.conCorte.tiles,
    'Con la conexión cortada el mapa se abre sin fondo y avisa', JSON.stringify(b.conCorte));
  check(b.luego.tiles === true, 'El botón "Cargar el fondo igual" pone el fondo');
  check(b.luego.visible === false, 'Y el cartel se apaga (era el bug del reporte)');

  // ── C) Volver a entrar a la pestaña no lo resucita ────────────────────
  const c = await page.evaluate(async () => {
    mapaInit();
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById('mapa-neti');
    return getComputedStyle(el).display !== 'none';
  });
  check(c === false, 'Con el fondo puesto, volver al Mapa no reaparece el cartel');

  // ── D) La red se recupera sola con el usuario parado en el Mapa ────────
  const d = await page.evaluate(async () => {
    // Estado de partida: mapa creado, sin fondo, con el corte abierto.
    if (_mapaTiles) { _mapa.removeLayer(_mapaTiles); _mapaTiles = null; }
    NET._fails = NET.FAILS_ABRE;
    NET._corteHasta = Date.now() + NET.CORTE_MS;
    _mapaAddTiles(window.L);
    const el = document.getElementById('mapa-neti');
    const antes = getComputedStyle(el).display !== 'none';

    // Vuelve la conexión (lo que hace _netOk tras un pedido exitoso).
    NET._fails = 0;
    NET._corteHasta = 0;
    netRenderEstado();
    await new Promise((r) => setTimeout(r, 200));

    return { antes, despues: getComputedStyle(el).display !== 'none', tiles: !!_mapaTiles };
  });
  check(d.antes === true, 'Sin fondo y con el corte abierto, el cartel vuelve a aparecer');
  check(d.despues === false && d.tiles === true,
    'Al recuperarse la red el fondo entra solo y el cartel se apaga', JSON.stringify(d));

  await browser.close();
  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
