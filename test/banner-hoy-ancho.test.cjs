// test/banner-hoy-ancho.test.cjs — La tarjeta del banner "Agenda de hoy" no
// puede salirse de la pantalla.
//
// El caso real (captura del usuario, celular de ~400 px): "el botón de
// 'Realizado' queda un poco por fuera de la pantalla". La causa no eran los
// botones: la DIRECCIÓN del trabajo ("Avenida Sarmiento esq. Río Negro,
// Salsipuedes, Córdoba…") iba en una línea sin cortes (`.fub-item-days` tiene
// white-space:nowrap). Esa línea ensanchaba la tarjeta entera más allá del
// banner —la dirección también salía cortada— y, como la tarjeta "tenía
// lugar", la fila de acciones no bajaba de renglón y "Realizado" quedaba
// afuera.
//
// Lo que se fija acá, en celulares de 320 a 412 px y en la compu:
//   1. Ninguna tarjeta ni botón se sale del banner.
//   2. La dirección se lee entera (envuelve en vez de cortarse).
//   3. Los cuatro botones siguen ahí (Cómo llegar, Voy en camino, Ver,
//      Realizado).
//   4. Sin hueco entre el texto y los botones: `.fub-item-info` trae un
//      `flex:1 1 120px` pensado para tarjetas en fila; en la columna del
//      banner ese piso se volvía alto (~120 px vacíos, visible en la captura).
//
// Uso:  node test/banner-hoy-ancho.test.cjs

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

const DIR = 'Avenida Sarmiento esq. Río Negro, Salsipuedes, Córdoba, Argentina';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const ancho of [320, 360, 400, 412, 1024]) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
      const movil = ancho < 600;
      await page.setViewport({ width: ancho, height: 900, isMobile: movil, hasTouch: movil });
      await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1200));
      const r = await page.evaluate((DIR) => {
        document.querySelectorAll('.open').forEach(o => o.classList.remove('open'));
        const hoy = today();
        setH([{
          id: 1001, quoteNumber: '2026-0058', clientName: 'Felipe', estado: 'aceptado',
          total: 1903150, currency: 'ARS', fechasTrabajo: [hoy, hoy.slice(0, 8) + '28'],
          clientContact: '3515551234',
          snapshot: {
            dateIssue: hoy, clientName: 'Felipe', clientContact: '3515551234',
            workAddress: DIR,
            items: [{ type: 'tree', species: 'Eucalipto', price: '1903150', qty: 4 }],
          },
        }]);
        switchTab('editor');
        renderMorningBanner();
        const banner = document.getElementById('morning-banner');
        const card = banner.querySelector('.fub-item');
        const bR = banner.getBoundingClientRect();
        const fuera = [...banner.querySelectorAll('.fub-item, .mb-act, .fub-item-days')]
          .filter(x => x.getBoundingClientRect().right > bR.right + 0.5)
          .map(x => (x.className + ' ' + x.textContent.trim()).slice(0, 60));
        const dirEl = [...card.querySelectorAll('.fub-item-days')].find(x => x.textContent.includes('Sarmiento'));
        return {
          visible: banner.style.display !== 'none',
          fuera,
          pantalla: document.documentElement.scrollWidth <= window.innerWidth,
          dirEntera: !!dirEl && dirEl.scrollWidth <= dirEl.clientWidth + 1 && dirEl.textContent.includes('Argentina'),
          botones: [...card.querySelectorAll('.mb-act')].map(b => b.textContent.trim()),
          hueco: (() => {
            const info = card.querySelector('.fub-item-info');
            const ult = [...info.children].pop().getBoundingClientRect().bottom;
            return Math.round(card.querySelector('.mb-acts').getBoundingClientRect().top - ult);
          })(),
        };
      }, DIR);
      check(`${ancho}px · el banner de hoy aparece`, r.visible);
      check(`${ancho}px · ninguna tarjeta ni botón se sale del banner`, r.fuera.length === 0, r.fuera.join(' | '));
      check(`${ancho}px · sin scroll horizontal en la página`, r.pantalla);
      check(`${ancho}px · la dirección se lee entera`, r.dirEntera);
      check(`${ancho}px · sin hueco entre el texto y los botones`, r.hueco <= 16, r.hueco + ' px');
      check(`${ancho}px · están los 4 botones`, r.botones.length === 4 && /Realizado/.test(r.botones[3]), r.botones.join(', '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nHAY FALLAS');
  process.exit(allOk ? 0 : 1);
})();
