// test/gestos.test.cjs — Gestos táctiles y botones del teléfono (v235).
//
// Lo que se protege:
//
//   1. Ninguna función global declarada dos veces. Todo el JS vive en un único
//      <script> con ámbito global: si dos secciones declaran `function X`, la
//      segunda pisa a la primera SIN error. Así se rompió el swipe entre
//      pestañas en la v225: js/nav.js agregó `_navTab(name)` (botón Atrás) y
//      pisó al `_navTab(dir)` del gesto, que desde entonces no hacía nada.
//   2. Swipe entre pestañas con toques reales (CDP Input.dispatchTouchEvent):
//      izquierda → siguiente, derecha → anterior (con wrap), uno corto o
//      vertical no navega y la pantalla vuelve a su lugar, y en el Mapa se
//      puede salir deslizando sobre la barra de pestañas.
//   3. "Atrás" después de un swipe vuelve al Editor (la capa de pestaña).
//   4. Tecla "Siguiente" del teclado: Enter en un campo del Editor pasa al
//      siguiente y el teclado recibe `enterkeyhint`.
//   5. Visor de fotos: doble toque acerca y vuelve, un toque cierra, y
//      deslizar hacia abajo cierra.
//   6. Accesos directos del ícono: Agenda y Mapa, y ?go=mapa resuelve.
//   7. Agenda: deslizar sobre la grilla de Mes / 3 días cambia de mes o de
//      días (no de pestaña); en la vista Agenda (lista) sigue cambiando de
//      pestaña.
//   8. "Tocá Atrás de nuevo para salir": en el Editor el primer "Atrás" avisa
//      y no sale; el segundo sale.
//   9. Ventanas que se cierran deslizando hacia abajo; un tirón corto no
//      cierra, y con la lista scrolleada el gesto es scroll, no cierre.
//
// Uso:  node test/gestos.test.cjs

const path = require('node:path');
const fs = require('node:fs');

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (e) {
  console.error('Falta puppeteer-core. Corré .claude/hooks/session-start.sh');
  process.exit(2);
}
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;
if (!EXEC) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..');
const APP = 'file://' + path.join(ROOT, 'index.html');

let allOk = true;
const check = (name, ok, extra) => {
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1. Estático: funciones globales duplicadas ──
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const js = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');
  const nombres = [...js.matchAll(/^(?:async )?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
  const vistos = new Set(), dup = new Set();
  nombres.forEach(n => (vistos.has(n) ? dup.add(n) : vistos.add(n)));
  check('1  ninguna función global declarada dos veces', dup.size === 0, [...dup].join(', '));
  check('1b el gesto usa _swipeTab, no _navTab(dir)', /_swipeTab\(dx < 0 \? 1 : -1\)/.test(js) && !/function _navTab\(dir\)/.test(js));
}

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.goto('about:blank');
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__pre')) return;
      sessionStorage.setItem('__pre', '1');
      localStorage.clear();
      localStorage.setItem('pq_onboarded', '1');
      localStorage.setItem('pq_last_backup', '2099-01-01');
    } catch (_) {}
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await espera(1200);
  await page.evaluate(() => {
    document.querySelectorAll('.open').forEach(o => { if (/overlay/.test(o.id)) o.classList.remove('open'); });
  });
  await espera(100);
  return page;
}

// Un dedo de (x0,y0) a (x1,y1) en `pasos` movimientos.
async function deslizar(page, x0, y0, x1, y1, pasos = 8) {
  const cdp = await page.target().createCDPSession();
  const tp = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x0, y0) });
  for (let i = 1; i <= pasos; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: tp(x0 + (x1 - x0) * i / pasos, y0 + (y1 - y0) * i / pasos) });
    await espera(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await espera(350);
}

const tab = (page) => page.evaluate(() => (document.querySelector('.tab-panel.active') || {}).id || '');

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  try {
    // ── 2/3. Swipe entre pestañas ──
    {
      const page = await nuevaPagina(browser);
      // Zona libre del Editor: el título de una sección (no un campo).
      const y = 300;
      await deslizar(page, 300, y, 80, y + 6);
      check('2a deslizar a la izquierda en el Editor → Historial', await tab(page) === 'panel-historial', await tab(page));

      await deslizar(page, 60, y, 300, y);
      check('2b deslizar a la derecha → vuelve al Editor', await tab(page) === 'panel-editor', await tab(page));

      await deslizar(page, 60, y, 300, y);
      check('2c a la derecha desde el Editor → Facturas (wrap)', await tab(page) === 'panel-facturacion', await tab(page));
      await page.evaluate(() => switchTab('editor'));
      await espera(200);

      // Corto: no navega, y la pantalla no queda corrida ni la pastilla prendida.
      await deslizar(page, 250, y, 205, y);
      const corto = await page.evaluate(() => ({
        tab: document.querySelector('.tab-panel.active').id,
        tr: document.getElementById('panel-editor').style.transform,
        hint: (document.getElementById('tab-swipe-hint') || { className: '' }).className,
      }));
      check('2d uno corto no navega y deja todo en su lugar',
        corto.tab === 'panel-editor' && !corto.tr && !/is-on/.test(corto.hint), JSON.stringify(corto));

      await deslizar(page, 200, 500, 170, 200);
      check('2e un gesto vertical no navega', await tab(page) === 'panel-editor', await tab(page));

      // Arrancar sobre un campo de texto (sin escribir en él) también navega:
      // en el Editor casi toda la pantalla son campos.
      {
        const c = await page.evaluate(() => {
          document.getElementById('main').scrollTop = 0;
          const r = document.getElementById('client-name').getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await espera(400);
        await deslizar(page, 300, c.y, 60, c.y);
        check('2e2 arrancando sobre un campo de texto también cambia de pestaña', await tab(page) === 'panel-historial', await tab(page));
        await page.evaluate(() => { switchTab('editor'); document.getElementById('main').scrollTop = 0; });
        await espera(300);
      }

      // Mientras se arrastra: la pastilla dice a dónde va.
      {
        const cdp = await page.target().createCDPSession();
        const tp = (x) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(300) });
        for (const x of [285, 260, 220, 180]) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x) });
          await espera(15);
        }
        const h = await page.evaluate(() => {
          const el = document.getElementById('tab-swipe-hint');
          return el ? { t: el.textContent, c: el.className, tr: document.getElementById('panel-editor').style.transform } : null;
        });
        check('2f la pastilla anuncia el destino y la pantalla acompaña al dedo',
          h && /Historial/.test(h.t) && /is-ready/.test(h.c) && /translateX\(-/.test(h.tr), JSON.stringify(h));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await cdp.detach();
        await espera(300);
        const tr = await page.evaluate(() => document.getElementById('panel-editor').style.transform);
        check('2g cancelado, la pantalla vuelve a su lugar', !tr && await tab(page) === 'panel-editor', tr);
      }

      // Mapa: la pantalla es el mapa; se sale deslizando sobre la barra de pestañas.
      await page.evaluate(() => switchTab('mapa'));
      await espera(600);
      const barra = await page.evaluate(() => {
        const r = document.getElementById('tabs').getBoundingClientRect();
        return { y: r.top + r.height / 2, h: r.height };
      });
      await deslizar(page, 320, barra.y, 60, barra.y);
      check('2h en el Mapa, deslizar sobre la barra de pestañas → Facturas', await tab(page) === 'panel-facturacion', await tab(page));

      // "Atrás" vuelve al Editor (una sola capa de pestaña).
      await page.goBack({ timeout: 4000 }).catch(() => {});
      await espera(400);
      check('3  "Atrás" después de deslizar vuelve al Editor', await tab(page) === 'panel-editor', await tab(page));
      await page.close();
    }

    // ── 4. Tecla Siguiente ──
    {
      const page = await nuevaPagina(browser);
      await page.focus('#client-name');
      await espera(60);
      const hint = await page.$eval('#client-name', el => el.getAttribute('enterkeyhint'));
      await page.keyboard.press('Enter');
      await espera(80);
      const foco = await page.evaluate(() => document.activeElement && document.activeElement.id);
      check('4a Enter en "Cliente" pasa al campo siguiente', hint === 'next' && foco === 'client-contact', `${hint} → ${foco}`);
      // Fuera del Editor/Configuración no se toca: la nota de la Agenda guarda con Enter.
      const fuera = await page.evaluate(() => {
        const i = document.createElement('input');
        document.getElementById('panel-historial').appendChild(i);
        i.focus();
        const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        i.dispatchEvent(ev);
        const r = { prev: ev.defaultPrevented, hint: i.getAttribute('enterkeyhint') };
        i.remove();
        return r;
      });
      check('4b fuera del Editor/Configuración no intercepta Enter', !fuera.prev && !fuera.hint, JSON.stringify(fuera));
      await page.close();
    }

    // ── 5. Visor de fotos ──
    {
      const page = await nuevaPagina(browser);
      const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const abrir = () => page.evaluate((src) => {
        openPhotoViewer(src);
        const img = document.getElementById('photo-viewer-img');
        img.style.width = '300px'; img.style.height = '300px';
      }, PNG);
      const st = () => page.evaluate(() => ({
        open: document.getElementById('photo-viewer-overlay').classList.contains('open'),
        tr: document.getElementById('photo-viewer-img').style.transform,
      }));
      await abrir();
      await espera(100);
      await page.touchscreen.tap(180, 370);
      await espera(120);
      await page.touchscreen.tap(180, 370);
      await espera(400);
      let s = await st();
      check('5a doble toque acerca la foto', s.open && /scale\(2\.5\)/.test(s.tr), JSON.stringify(s));
      await page.touchscreen.tap(180, 370);
      await espera(120);
      await page.touchscreen.tap(180, 370);
      await espera(400);
      s = await st();
      check('5b otro doble toque la devuelve', s.open && !s.tr, JSON.stringify(s));
      await page.touchscreen.tap(180, 370);
      await espera(500);
      s = await st();
      check('5c un toque sin zoom cierra (como antes)', !s.open, JSON.stringify(s));

      await abrir();
      await espera(100);
      await deslizar(page, 180, 300, 185, 520, 10);
      s = await st();
      check('5d deslizar hacia abajo cierra', !s.open, JSON.stringify(s));
      await page.close();
    }

    // ── 6. Accesos directos ──
    {
      const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
      const urls = (m.shortcuts || []).map(x => x.url);
      check('6a el ícono ofrece Agenda y Mapa', urls.includes('./index.html?go=agenda') && urls.includes('./index.html?go=mapa'), urls.join(' '));
      const page = await nuevaPagina(browser);
      await page.evaluate(() => irDestino('mapa'));
      await espera(300);
      check('6b irDestino("mapa") abre el Mapa', await tab(page) === 'panel-mapa', await tab(page));
      await page.close();
    }

    // ── 7. Agenda: deslizar sobre el calendario ──
    {
      const page = await nuevaPagina(browser);
      await page.evaluate(() => { switchTab('agenda'); calSetView('mes'); calToday(); });
      await espera(300);
      const leer = () => page.evaluate(() => ({
        tab: document.querySelector('.tab-panel.active').id,
        tit: document.getElementById('agc-title').textContent, m: _calM, a: _calAnchor,
      }));
      const antes = await leer();
      const r = await page.evaluate(() => {
        const g = document.getElementById('agc-grid').getBoundingClientRect();
        return { y: g.top + Math.min(g.height / 2, 120) };
      });
      // Pastilla durante el gesto: dice el mes de destino.
      {
        const cdp = await page.target().createCDPSession();
        const tp = (x) => [{ x, y: Math.round(r.y), id: 1, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(300) });
        for (const x of [285, 255, 215, 180]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x) }); await espera(15); }
        const h = await page.evaluate(() => document.getElementById('tab-swipe-hint').textContent);
        const esperado = await page.evaluate(() => CAL_MESES[(_calM + 1) % 12]);
        check('7a la pastilla dice el mes siguiente', h.includes(esperado), h);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await espera(350);
      }
      let d = await leer();
      check('7b Mes: deslizar a la izquierda pasa al mes siguiente (sin cambiar de pestaña)',
        d.tab === 'panel-agenda' && d.m === (antes.m + 1) % 12, JSON.stringify(d));
      await deslizar(page, 60, r.y, 300, r.y);
      d = await leer();
      check('7c a la derecha vuelve al mes de antes', d.tab === 'panel-agenda' && d.m === antes.m, JSON.stringify(d));

      await page.evaluate(() => { calSetView('3dias'); calToday(); });
      await espera(200);
      const a0 = (await leer()).a;
      const r3 = await page.evaluate(() => { const g = document.getElementById('agc-grid').getBoundingClientRect(); return g.top + Math.min(g.height / 2, 80); });
      await deslizar(page, 300, r3, 60, r3);
      d = await leer();
      check('7d 3 días: deslizar avanza 3 días', d.tab === 'panel-agenda' && d.a === await page.evaluate((x) => _calAddDays(x, 3), a0), JSON.stringify(d));

      await page.evaluate(() => calSetView('agenda'));
      await espera(200);
      await deslizar(page, 300, 400, 60, 400);
      check('7e en la vista Agenda (lista) deslizar sigue cambiando de pestaña', await tab(page) === 'panel-mapa', await tab(page));
      await page.evaluate(() => calSetView('mes'));
      await page.close();
    }

    // ── 8. "Atrás" de nuevo para salir ──
    {
      const page = await nuevaPagina(browser);
      await page.touchscreen.tap(180, 330);          // un toque cualquiera arma la capa
      await espera(150);
      const capas = await page.evaluate(() => _navCapas.map(c => c.t).join(','));
      await page.goBack({ timeout: 4000 }).catch(() => {});
      await espera(400);
      const s1 = await page.evaluate(() => ({
        app: /index\.html/.test(location.href),
        toast: [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join('|'),
      }));
      check('8a primer "Atrás" en el Editor avisa y no sale',
        capas === 'salir' && s1.app && /Atrás de nuevo/.test(s1.toast), `${capas} ${JSON.stringify(s1)}`);
      await page.goBack({ timeout: 4000 }).catch(() => {});
      await espera(400);
      check('8b el segundo "Atrás" sale', page.url() === 'about:blank', page.url());
      await page.close();
    }
    {
      // Con la capa armada, ir y volver de otra pestaña sigue funcionando.
      const page = await nuevaPagina(browser);
      await page.touchscreen.tap(180, 330);
      await espera(150);
      const btn = await page.evaluate(() => { const r = document.querySelectorAll('.tab-btn')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.touchscreen.tap(btn.x, btn.y);
      await espera(300);
      const c1 = await page.evaluate(() => _navCapas.map(c => c.t).join(','));
      await page.goBack({ timeout: 4000 }).catch(() => {});
      await espera(400);
      const t1 = await tab(page);
      check('8c pestaña → "Atrás" vuelve al Editor, sin aviso de salir',
        c1 === 'salir,tab' && t1 === 'panel-editor' &&
        !(await page.evaluate(() => /Atrás de nuevo/.test(document.getElementById('toast-container').textContent))), `${c1} ${t1}`);
      await page.close();
    }

    // ── 9. Ventanas que se cierran deslizando hacia abajo ──
    {
      const page = await nuevaPagina(browser);
      const abierto = () => page.evaluate(() => document.getElementById('notif-overlay').classList.contains('open'));
      const caja = async () => page.evaluate(() => { const r = document.getElementById('notif-box').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 30 }; });
      await page.evaluate(() => notifOpen());
      await espera(300);
      const grip = await page.evaluate(() => { const bx = document.getElementById('notif-box'); return bx.className + ' ' + getComputedStyle(bx, '::before').content; });
      check('9f la ventana muestra la rayita para agarrar', /hoja-desliza ""/.test(grip), grip);
      let b = await caja();
      await deslizar(page, b.x, b.y, b.x, b.y + 40, 10);
      check('9a un tirón corto no cierra', await abierto());
      const tr = await page.evaluate(() => document.getElementById('notif-box').style.transform);
      check('9b y la ventana vuelve a su lugar', !tr, tr);
      await deslizar(page, b.x, b.y, b.x + 4, b.y + 200, 10);
      await espera(300);
      check('9c deslizar hacia abajo la cierra', !(await abierto()));
      const capas = await page.evaluate(() => _navCapas.filter(c => !c.muerta && c.t === 'ov').length);
      check('9d sin capa de "Atrás" colgada', capas === 0, String(capas));

      // Con el contenido scrolleado, deslizar hacia abajo es scroll.
      await page.evaluate(() => {
        notifOpen();
        const box = document.getElementById('notif-box');
        const relleno = document.createElement('div'); relleno.style.height = '2000px'; relleno.id = '__relleno';
        box.appendChild(relleno);
        box.scrollTop = 300;
      });
      await espera(300);
      b = await caja();
      await deslizar(page, b.x, b.y + 100, b.x, b.y + 320, 10);
      check('9e con la lista scrolleada no cierra', await abierto());
      await page.close();
    }
  } catch (e) {
    allOk = false;
    console.log('ERROR', e && e.stack || e);
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
