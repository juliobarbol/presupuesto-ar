// test/navegacion.test.cjs — Facilidad de uso, tanda 1.
//
// Lo que se protege:
//
//   1. Botón "Atrás" del teléfono (js/nav.js). Antes la app no lo escuchaba y
//      en Android cerraba la app entera aunque hubiera una ventana abierta.
//      Ahora: cierra lo abierto → si no, vuelve al Editor → si no, sale.
//   2. "+ Nuevo" en la barra superior, sin confirmación, con "Deshacer".
//   3. Historial: los avisos se pliegan en una línea y el buscador queda arriba.
//   4. Avisos de backup con botones, y uno solo por apertura.
//   5. La tarjeta del historial dice "Abrir", no "Cargar".
//
// Nota sobre el punto 1: page.goBack() va a la entrada anterior por CDP y no
// pasa por la regla de Chrome que saltea entradas apiladas sin gesto. Esa
// regla se cubre en el código (solo se apila con navigator.userActivation);
// acá se prueba la lógica: qué cierra cada "Atrás" y que no queden capas
// colgadas. Los toques son clics reales (page.click), que sí dan gesto.
//
// Uso:  node test/navegacion.test.cjs

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
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// La app se abre DESPUÉS de about:blank: así "salir de la app" se ve como
// volver a about:blank.
async function nuevaPagina(browser, antesDeCargar) {
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740 });
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.goto('about:blank');
  await page.evaluateOnNewDocument((pre) => {
    try {
      if (sessionStorage.getItem('__pre')) return;
      sessionStorage.setItem('__pre', '1');
      localStorage.clear();
      localStorage.setItem('pq_onboarded', '1');
      localStorage.setItem('pq_last_backup', '2099-01-01');
      if (pre) Object.keys(pre).forEach(k => localStorage.setItem(k, pre[k]));
    } catch (_) {}
  }, antesDeCargar || null);
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await espera(1200);
  // Fuera lo que se abre solo al arrancar (aviso del día, bienvenida).
  await page.evaluate(() => {
    document.querySelectorAll('.open').forEach(o => { if (/overlay/.test(o.id)) o.classList.remove('open'); });
  });
  await espera(100);
  return page;
}

async function atras(page) {
  await page.goBack({ timeout: 4000 }).catch(() => {});
  await espera(350);
}

const estado = (page) => page.evaluate(() => ({
  url: location.href,
  tab: (document.querySelector('.tab-panel.active') || {}).id || '',
  abiertos: [...document.querySelectorAll('[id$="overlay"].open')].map(o => o.id),
  pops: document.querySelectorAll('.csel-pop,.cal-pop').length,
  capas: (typeof _navCapas !== 'undefined') ? _navCapas.length : -1,
}));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  try {

    // ── 1a: ventana abierta en el Editor ──
    {
      const page = await nuevaPagina(browser);
      await page.click('button[aria-label="Vista previa"]');
      await espera(400);
      let s = await estado(page);
      check('Tocar Vista previa la abre y apila una capa',
        s.abiertos.includes('doc-preview-overlay') && s.capas === 1, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('"Atrás" cierra la vista previa y la app sigue abierta',
        !s.abiertos.length && s.url.startsWith('file:') && s.capas === 0, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('En el Editor sin nada abierto, "Atrás" sale de la app',
        s.url === 'about:blank', s.url);
      await page.close();
    }

    // ── 1b: pestaña + ventana encima ──
    {
      const page = await nuevaPagina(browser);
      await page.click('#tabs .tab-btn:nth-child(2)');   // Historial
      await espera(300);
      await page.click('#btn-config');                    // Configuración: sigue siendo UNA capa de pestaña
      await espera(300);
      await page.click('#btn-notif');
      await espera(400);
      let s = await estado(page);
      check('Pestaña + campanita = dos capas (cambiar de pestaña no apila de más)',
        s.tab === 'panel-empresa' && s.abiertos.includes('notif-overlay') && s.capas === 2, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('Primer "Atrás": cierra la campanita y deja la pestaña',
        !s.abiertos.length && s.tab === 'panel-empresa', JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('Segundo "Atrás": vuelve al Editor', s.tab === 'panel-editor' && s.capas === 0, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('Tercer "Atrás": sale de la app', s.url === 'about:blank', s.url);
      await page.close();
    }

    // ── 1c: cerrar por la UI no deja "Atrás" en el aire ──
    {
      const page = await nuevaPagina(browser);
      await page.click('#btn-notif');
      await espera(400);
      await page.click('#notif-overlay [aria-label="Cerrar"]');
      await espera(500);
      let s = await estado(page);
      check('Cerrar la campanita con su botón consume la capa', !s.abiertos.length && s.capas === 0, JSON.stringify(s));
      await page.click('#tabs .tab-btn:nth-child(2)');
      await espera(300);
      await page.click('#tabs .tab-btn:nth-child(1)');   // volver al Editor tocando
      await espera(500);
      s = await estado(page);
      check('Volver al Editor tocando consume la capa de pestaña', s.tab === 'panel-editor' && s.capas === 0, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('…y el próximo "Atrás" sale de una (no hay toques perdidos)', s.url === 'about:blank', s.url);
      await page.close();
    }

    // ── 1d: desplegable ──
    {
      const page = await nuevaPagina(browser);
      await page.click('#tabs .tab-btn:nth-child(2)');
      await espera(300);
      await page.evaluate(() => document.querySelector('#panel-historial .csel-btn').scrollIntoView());
      await page.click('#panel-historial .csel-btn');
      await espera(300);
      let s = await estado(page);
      check('Abrir un desplegable apila una capa', s.pops === 1 && s.capas === 2, JSON.stringify(s));
      await atras(page);
      s = await estado(page);
      check('"Atrás" cierra el desplegable y deja el Historial',
        s.pops === 0 && s.tab === 'panel-historial', JSON.stringify(s));
      await page.close();
    }

    // ── 2: "+ Nuevo" sin confirmación, con Deshacer ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        S.numPrefix = '2026-'; S.numNext = 1; S.quoteNumber = mkQN();
        S.clientName = 'Juan Pérez';
        S.items = [{ id: 1, type: 'tree', species: 'Pino', desc: 'Extracción', price: '250000', qty: 1 }];
        noSync = true; restoreUI(); noSync = false; renderItems();
        const antes = S.quoteNumber;
        switchTab('historial');
        document.getElementById('btn-nuevo').click();
        await new Promise(r => setTimeout(r, 300));
        const confirmAbierto = document.getElementById('confirm-overlay').classList.contains('open');
        const nuevo = { num: S.quoteNumber, cliente: S.clientName, items: S.items.length,
          tab: document.querySelector('.tab-panel.active').id };
        const toastBtn = [...document.querySelectorAll('#toast-container .toast-btn')].find(b => b.textContent === 'Deshacer');
        const guardado = getH().some(e => e.quoteNumber === antes && e.clientName === 'Juan Pérez');
        if (toastBtn) toastBtn.click();
        await new Promise(r => setTimeout(r, 300));
        return { antes, confirmAbierto, nuevo, hayDeshacer: !!toastBtn, guardado,
          vuelta: { num: S.quoteNumber, cliente: S.clientName, items: S.items.length } };
      });
      check('"+ Nuevo" no pide confirmación', r.confirmAbierto === false);
      check('"+ Nuevo" desde otra pestaña abre un presupuesto en blanco en el Editor',
        r.nuevo.num !== r.antes && !r.nuevo.cliente && r.nuevo.items === 0 && r.nuevo.tab === 'panel-editor',
        JSON.stringify(r.nuevo));
      check('El presupuesto anterior quedó guardado en el historial', r.guardado === true);
      check('El aviso ofrece "Deshacer"', r.hayDeshacer === true);
      check('"Deshacer" vuelve a abrir el anterior con sus datos',
        r.vuelta.num === r.antes && r.vuelta.cliente === 'Juan Pérez' && r.vuelta.items === 1,
        JSON.stringify(r.vuelta));
      await page.close();
    }

    // ── 3: avisos del Historial plegados, buscador arriba ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.numPrefix = '2026-'; S.numNext = 1;
        for (let i = 0; i < 6; i++) {
          const d = new Date(); d.setDate(d.getDate() - 60 - i);
          S.dateIssue = toLocalISODate(d); calcExpiry(); S.quoteNumber = mkQN(); S.numNext++;
          S.clientName = 'Cliente ' + i;
          S.items = [{ id: 1, type: 'tree', species: 'Pino', desc: 'Poda', price: '100000', qty: 1 }];
          noSync = true; restoreUI(); noSync = false; renderItems();
          autoSaveToHistory();
          const h = getH(); h[0].estado = 'enviado'; h[0].enviadoEn = d.toISOString(); setH(h);
        }
        switchTab('historial');
        const wrap = document.getElementById('hist-avisos');
        const body = document.getElementById('hist-avisos-body');
        const search = document.getElementById('hist-search');
        const y = el => el.getBoundingClientRect().top;
        const plegado = {
          visible: !wrap.hidden, bodyOculto: body.hidden,
          chips: document.getElementById('hist-avisos-chips').textContent.replace(/\s+/g, ' ').trim(),
          buscadorY: Math.round(y(search)),
        };
        document.getElementById('hist-avisos-res').click();
        const desplegado = { bodyOculto: body.hidden, guardado: localStorage.getItem(LS.HIST_AVISOS),
          aria: document.getElementById('hist-avisos-res').getAttribute('aria-expanded') };
        return { plegado, desplegado };
      });
      check('Con pendientes, la línea de avisos se ve y los banners arrancan plegados',
        r.plegado.visible && r.plegado.bodyOculto, JSON.stringify(r.plegado));
      check('La línea dice las cantidades', /para seguimiento/.test(r.plegado.chips) && /vencido/.test(r.plegado.chips),
        r.plegado.chips);
      check('El buscador queda en la primera pantalla', r.plegado.buscadorY < 300, 'y=' + r.plegado.buscadorY);
      check('Tocar la línea despliega los banners y recuerda la elección',
        !r.desplegado.bodyOculto && r.desplegado.guardado === '1' && r.desplegado.aria === 'true',
        JSON.stringify(r.desplegado));
      const vacio = await page.evaluate(() => { setH([]); renderHistory(); renderFollowupBanner();
        return document.getElementById('hist-avisos').hidden; });
      check('Sin pendientes la línea no se dibuja', vacio === true);
      await page.close();
    }

    // ── 4: aviso de backup ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        avisoBackup('Primero');
        avisoBackup('Segundo');
        await new Promise(r => setTimeout(r, 100));
        const toasts = [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent);
        const btns = [...document.querySelectorAll('#toast-container .toast-btn')].map(b => b.textContent);
        [...document.querySelectorAll('#toast-container .toast-btn')].find(b => b.textContent === 'Más opciones').click();
        await new Promise(r => setTimeout(r, 400));
        return { toasts, btns, tab: document.querySelector('.tab-panel.active').id,
          sub: (document.querySelector('.subtab-btn.active') || {}).textContent || '' };
      });
      check('Un solo aviso de backup por apertura', r.toasts.filter(t => /Primero|Segundo/.test(t)).length === 1,
        JSON.stringify(r.toasts));
      check('El aviso trae "Exportar ahora" y "Más opciones"',
        r.btns.includes('Exportar ahora') && r.btns.includes('Más opciones'), r.btns.join(' · '));
      check('"Más opciones" lleva a Configuración → Datos (donde vive el backup)',
        r.tab === 'panel-empresa' && /Datos/.test(r.sub), `${r.tab} · ${r.sub.trim()}`);
      const exp = await page.evaluate(async () => {
        _avisoBackupMostrado = false;
        avisoBackup('Tercero');
        [...document.querySelectorAll('#toast-container .toast-btn')].find(b => b.textContent === 'Exportar ahora').click();
        await new Promise(r => setTimeout(r, 200));
        return document.getElementById('moverlay').classList.contains('open');
      });
      check('"Exportar ahora" abre el diálogo de exportación', exp === true);
      const viejo = await page.evaluate(() => /Mi empresa/.test(checkBackupReminder.toString()));
      check('El recordatorio ya no manda a "Mi empresa" (no existe)', viejo === false);
      await page.close();
    }

    // ── 5: "Abrir" en la tarjeta ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.numPrefix = '2026-'; S.numNext = 1; S.quoteNumber = mkQN(); S.clientName = 'Ana';
        S.items = [{ id: 1, type: 'tree', species: 'Pino', desc: 'Poda', price: '100000', qty: 1 }];
        noSync = true; restoreUI(); noSync = false; renderItems(); autoSaveToHistory();
        switchTab('historial');
        const b = document.querySelector('#history-list .hcargar');
        return b ? b.textContent.trim() : '';
      });
      check('La tarjeta del historial dice "Abrir"', r === 'Abrir', r);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
