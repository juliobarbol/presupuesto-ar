// test/uso-tanda3.test.cjs — Facilidad de uso, tanda 3.
//
// Lo que se protege:
//
//   1. En el celular las pestañas van ABAJO (zona del pulgar) y lo que flota
//      (barra de totales, avisos) se apoya encima de ellas. En la compu siguen
//      arriba. Con el teclado abierto (body.is-typing) se esconden.
//   2. Tarjeta del árbol en el orden en que se piensa el trabajo
//      (Especie → Trabajo → Precio) y sugerencia del último precio cobrado por
//      esa especie, que se usa con un toque y nunca se carga sola.
//   3. Configuración repartida: mensajes en "Textos", backup en "Datos".
//   4. Toques de 44 px y letra legible en la barra de arriba, las pestañas y
//      los textos de ayuda.
//   5. Con la lista de trabajos vacía solo se ve "+ Árbol / Trabajo": los
//      servicios y "Dos opciones" aparecen después del primer trabajo.
//
// Uso:  node test/uso-tanda3.test.cjs

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

async function nuevaPagina(browser, ancho, tactil) {
  const page = await browser.newPage();
  await page.setViewport({ width: ancho, height: 740, isMobile: !!tactil, hasTouch: !!tactil });
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
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
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => {
    document.querySelectorAll('.open').forEach(o => { if (/overlay/.test(o.id)) o.classList.remove('open'); });
    document.querySelectorAll('#toast-container .toast').forEach(t => t.remove());
  });
  return page;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  try {

    // ── 1: pestañas abajo en el celular ──
    {
      const page = await nuevaPagina(browser, 360, true);
      const r = await page.evaluate(async () => {
        const rect = id => document.getElementById(id).getBoundingClientRect();
        switchTab('editor');
        await new Promise(r => setTimeout(r, 200));
        const tabs = rect('tabs'), main = rect('main'), bar = rect('sticky-totals');
        toast('Prueba de aviso', 'info', 5000);
        await new Promise(r => setTimeout(r, 100));
        const tst = document.querySelector('#toast-container .toast').getBoundingClientRect();
        const btn = document.querySelector('.tab-btn').getBoundingClientRect();
        // Teclado: enfocar un campo de texto esconde las pestañas.
        document.getElementById('client-name').focus();
        await new Promise(r => setTimeout(r, 100));
        const tipeando = { clase: document.body.classList.contains('is-typing'),
          tabsVisibles: getComputedStyle(document.getElementById('tabs')).display !== 'none',
          barraAbajo: Math.round(rect('sticky-totals').bottom) };
        document.getElementById('client-name').blur();
        await new Promise(r => setTimeout(r, 300));
        const trasSalir = { clase: document.body.classList.contains('is-typing'),
          tabsVisibles: getComputedStyle(document.getElementById('tabs')).display !== 'none' };
        return { alto: innerHeight, tabsTop: Math.round(tabs.top), tabsBottom: Math.round(tabs.bottom),
          mainBottom: Math.round(main.bottom), barBottom: Math.round(bar.bottom),
          toastBottom: Math.round(tst.bottom), btnAlto: Math.round(btn.height), tipeando, trasSalir };
      });
      check('En el celular las pestañas van abajo de todo', r.tabsBottom === r.alto && r.tabsTop > r.alto - 80,
        `top=${r.tabsTop} bottom=${r.tabsBottom} de ${r.alto}`);
      check('El contenido termina donde empiezan las pestañas', r.mainBottom <= r.tabsTop + 1,
        `main=${r.mainBottom} tabs=${r.tabsTop}`);
      check('La barra de totales queda encima de las pestañas', r.barBottom <= r.tabsTop + 1,
        `barra=${r.barBottom} tabs=${r.tabsTop}`);
      check('Los avisos salen encima de las pestañas', r.toastBottom <= r.tabsTop, `aviso=${r.toastBottom}`);
      check('Cada pestaña tiene alto de dedo (≥ 56 px)', r.btnAlto >= 56, r.btnAlto + 'px');
      check('Con el teclado abierto las pestañas se esconden y la barra baja',
        r.tipeando.clase && !r.tipeando.tabsVisibles && r.tipeando.barraAbajo === r.alto,
        JSON.stringify(r.tipeando));
      check('Al salir del campo vuelven', !r.trasSalir.clase && r.trasSalir.tabsVisibles,
        JSON.stringify(r.trasSalir));
      await page.close();
    }
    {
      const page = await nuevaPagina(browser, 1024, false);
      const r = await page.evaluate(() => {
        const t = document.getElementById('tabs').getBoundingClientRect();
        const top = document.getElementById('topbar').getBoundingClientRect();
        return { tabsTop: Math.round(t.top), topbarBottom: Math.round(top.bottom) };
      });
      check('En la compu las pestañas siguen arriba', Math.abs(r.tabsTop - r.topbarBottom) <= 1,
        JSON.stringify(r));
      await page.close();
    }

    // ── 2: tarjeta del árbol + precio sugerido ──
    {
      const page = await nuevaPagina(browser, 360, true);
      const r = await page.evaluate(async () => {
        const espera = ms => new Promise(r => setTimeout(r, ms));
        S.numPrefix = '2026-'; S.numNext = 1;
        const guardar = (dias, especie, precio, desc) => {
          const d = new Date(); d.setDate(d.getDate() - dias);
          S.dateIssue = toLocalISODate(d); calcExpiry(); S.quoteNumber = mkQN(); S.numNext++;
          S.clientName = 'Cliente ' + dias;
          S.items = [{ id: 1, type: 'tree', species: especie, desc, price: precio, qty: 1 }];
          noSync = true; restoreUI(); noSync = false; renderItems(); autoSaveToHistory();
        };
        guardar(10, 'Eucalipto', '350000', 'Extracción reciente');
        guardar(200, 'eucalipto ', '200000', 'Extracción vieja');   // guardado después, pero más viejo
        guardar(5, 'Pino', '90000', 'Poda');
        // Presupuesto nuevo con un árbol.
        resetToNewQuote();
        addItem('tree');
        await espera(100);
        const card = document.querySelector('#items-list .icard, .icard');
        const y = sel => card.querySelector(sel).getBoundingClientRect().top;
        const orden = y('.sp-f') < y('.ds-f') && y('.ds-f') < y('.pr-f');
        const sf = card.querySelector('.sp-f'), pf = card.querySelector('.pr-f');
        const sug = () => card.querySelector('.pr-sug');
        const vacio = sug().hidden;
        sf.value = 'Eucalípto'; sf.dispatchEvent(new Event('input', { bubbles: true }));
        await espera(400);
        const conEspecie = { visible: !sug().hidden, txt: sug().textContent.replace(/\s+/g, ' ').trim() };
        const precioNoTocado = pf.value === '' && !S.items[0].price;
        sug().querySelector('.pr-sug-btn').click();
        await espera(100);
        const usado = { campo: pf.value, estado: S.items[0].price, oculta: sug().hidden };
        // Con precio cargado no se sugiere nada.
        sf.dispatchEvent(new Event('input', { bubbles: true }));
        await espera(400);
        const conPrecio = sug().hidden;
        // Especie sin historial: nada.
        pf.value = ''; pf.dispatchEvent(new Event('input', { bubbles: true }));
        sf.value = 'Ceibo'; sf.dispatchEvent(new Event('input', { bubbles: true }));
        await espera(400);
        const sinHistorial = sug().hidden;
        return { orden, vacio, conEspecie, precioNoTocado, usado, conPrecio, sinHistorial };
      });
      check('La tarjeta va Especie → Trabajo → Precio', r.orden === true);
      check('Sin especie no hay sugerencia', r.vacio === true);
      check('Con la especie aparece el último precio (por fecha, sin tildes ni mayúsculas)',
        r.conEspecie.visible && /350\.000/.test(r.conEspecie.txt) && /Extracción reciente/.test(r.conEspecie.txt),
        r.conEspecie.txt);
      check('La sugerencia nunca carga el precio sola', r.precioNoTocado === true);
      check('"Usar" carga el precio en el campo y en el presupuesto',
        r.usado.campo === '350000' && String(r.usado.estado) === '350000' && r.usado.oculta,
        JSON.stringify(r.usado));
      check('Con precio cargado no se sugiere nada', r.conPrecio === true);
      check('Una especie sin historial no muestra nada', r.sinHistorial === true);
      await page.close();
    }

    // ── 3: Configuración repartida ──
    {
      const page = await nuevaPagina(browser, 360, true);
      const r = await page.evaluate(async () => {
        const dentro = (sub, id) => !!document.querySelector('#subpanel-' + sub + ' #' + id);
        const msj = [...document.querySelectorAll('#subpanel-textos .fu-config .st')].map(e => e.textContent.trim());
        avisoBackup('Prueba');
        await new Promise(r => setTimeout(r, 100));
        [...document.querySelectorAll('#toast-container .toast-btn')].find(b => b.textContent === 'Más opciones').click();
        await new Promise(r => setTimeout(r, 400));
        return {
          backupEnDatos: dentro('datos', 'backup-file-section') && dentro('datos', 'gdrive-section') && dentro('datos', 'gcal-section'),
          negocioSinBackup: !dentro('negocio', 'backup-file-section'),
          mensajesEnTextos: msj.some(t => /Mensaje al enviar/.test(t)) && msj.some(t => /Seguimiento/.test(t)),
          negocioSinMensajes: ![...document.querySelectorAll('#subpanel-negocio .st')].some(e => /Mensaje/.test(e.textContent)),
          cobroEnNegocio: [...document.querySelectorAll('#subpanel-negocio .st')].some(e => /Datos para cobrar/.test(e.textContent)),
          irA: (document.querySelector('.subtab-btn.active') || {}).textContent.trim(),
        };
      });
      check('Backup, Drive y Calendar viven en "Datos"', r.backupEnDatos && r.negocioSinBackup);
      check('Los mensajes de WhatsApp y el seguimiento viven en "Textos"', r.mensajesEnTextos && r.negocioSinMensajes);
      check('"Negocio" conserva los datos para cobrar', r.cobroEnNegocio);
      check('El aviso de backup lleva a "Datos"', /Datos/.test(r.irA), r.irA);
      await page.close();
    }

    // ── 4: toques y letra ──
    {
      const page = await nuevaPagina(browser, 360, true);
      const r = await page.evaluate(() => {
        const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        const fs = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
        switchTab('historial');
        return {
          campanita: box('#btn-notif'), engranaje: box('#btn-config'), nuevo: box('#btn-nuevo'),
          letraPestana: fs('.tab-btn'), letraHint: fs('.hint'), letraIsub: (() => { addItem('tree'); return fs('.isub'); })(),
        };
      });
      check('Campanita y engranaje miden al menos 44×40 px',
        r.campanita[0] >= 44 && r.campanita[1] >= 40 && r.engranaje[0] >= 44 && r.engranaje[1] >= 40,
        `campanita=${r.campanita} engranaje=${r.engranaje}`);
      check('"+ Nuevo" mide al menos 40 px de alto', r.nuevo[1] >= 40, String(r.nuevo));
      check('La letra de las pestañas y las ayudas no baja de 12,5 px',
        r.letraPestana >= 12.5 && r.letraHint >= 12.5 && r.letraIsub >= 12.5,
        `pestaña=${r.letraPestana} hint=${r.letraHint} isub=${r.letraIsub}`);
      await page.close();
    }

    // ── 5: Trabajos vacíos → solo "+ Árbol / Trabajo" a la vista ──
    {
      const page = await nuevaPagina(browser, 412, true);
      const r = await page.evaluate(async () => {
        const espera = ms => new Promise(r => setTimeout(r, ms));
        const vis = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
        // Un servicio frecuente guardado, para que los chips tengan qué mostrar.
        if (typeof saveServiceToDB === 'function') saveServiceToDB('Camión - Viaje', '50000');
        resetToNewQuote();
        setVistaEditor('consola'); editorSetEtapa('trabajos');
        renderQuickServices(); renderItems();
        await espera(100);
        const btn = document.querySelector('.add-tree').getBoundingClientRect();
        const barra = document.getElementById('sticky-totals').getBoundingClientRect();
        const vacio = { arbol: vis('.add-tree'), servicio: vis('.add-svc'), nota: vis('.add-note'),
          chips: vis('#quick-services'), dosOpciones: vis('#scenarios-panel'),
          aLaVista: btn.top > 0 && btn.bottom < barra.top };
        document.querySelector('.add-tree').click();
        await espera(100);
        const conTrabajo = { servicio: vis('.add-svc'), nota: vis('.add-note'), dosOpciones: vis('#scenarios-panel'),
          botonesAntesQueChips: (() => { const a = document.querySelector('.items-add').getBoundingClientRect().top,
            q = document.getElementById('quick-services').getBoundingClientRect().top; return a < q; })() };
        // Con "Dos opciones" prendido y el escenario B vacío, el control no se esconde.
        S.items = []; S.scenariosEnabled = true; activeScenario = 'B'; S.itemsB = [];
        renderItems();
        const abPrendido = vis('#scenarios-panel');
        S.scenariosEnabled = false; activeScenario = 'A'; renderItems();
        setVistaEditor('clasica');
        return { vacio, conTrabajo, abPrendido };
      });
      check('Sin trabajos se ve solo "+ Árbol / Trabajo"',
        r.vacio.arbol && !r.vacio.servicio && !r.vacio.nota && !r.vacio.chips && !r.vacio.dosOpciones,
        JSON.stringify(r.vacio));
      check('…y queda a la vista al entrar a la etapa Trabajos', r.vacio.aLaVista === true);
      check('Con el primer trabajo vuelven servicio, nota y "Dos opciones"',
        r.conTrabajo.servicio && r.conTrabajo.nota && r.conTrabajo.dosOpciones, JSON.stringify(r.conTrabajo));
      check('Los botones van antes que los servicios rápidos', r.conTrabajo.botonesAntesQueChips === true);
      check('Con "Dos opciones" prendido el control no se esconde aunque B esté vacío', r.abPrendido === true);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
