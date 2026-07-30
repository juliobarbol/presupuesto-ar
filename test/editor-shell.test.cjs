// test/editor-shell.test.cjs — Shell del editor (Fase 1 del rediseño).
//
// Lo que este test protege son las invariantes de docs/rediseno-editor.md, que
// son la razón por la que el shell es aditivo y no una reescritura:
//
//   I2  'clasica' es la app de hoy: todo desplegado, sin encabezados nuevos, y
//       es el destino del fallback ante cualquier valor raro.
//   I3  cambiar de vista es SOLO presentación: no toca S, no reconstruye el DOM
//       y no pierde lo que el usuario ya escribió en pantalla.
//   I4  vistaEditor es configuración: abrir un presupuesto viejo del historial
//       no puede cambiarte la vista del editor.
//   I5  entra por sanitize: un valor fuera de la lista blanca cae a 'clasica'.
//   I6  los 3 modos son un eje ortogonal: las 6 combinaciones andan, y la
//       numeración se calcula sobre las secciones visibles de cada modo.
//
// Uso:  node test/editor-shell.test.cjs

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

// Lee el estado del shell tal como lo ve el usuario: qué fichas hay, con qué
// número, estado y si están abiertas.
const LEER = `(() => {
  const vis = [];
  document.querySelectorAll('#panel-editor .esec').forEach(w => {
    if (w.hidden) return;
    vis.push({
      id: w.id,
      num: w.querySelector('.esec-num').textContent,
      titulo: w.querySelector('.esec-title').textContent,
      estado: w.querySelector('.esec-status').textContent,
      abierta: w.classList.contains('is-open'),
      done: w.classList.contains('is-done'),
    });
  });
  return {
    vista: document.getElementById('panel-editor').dataset.vista,
    vis,
    progreso: document.getElementById('esh-count').textContent,
    segmentos: document.getElementById('esh-bar').children.length,
    modo: document.getElementById('esh-mode').textContent,
  };
})()`;

// Presupuesto en blanco. Todas las páginas comparten el origen file://, así que
// lo que un bloque anterior guardó en localStorage lo levanta loadLS() ANTES de
// que corra el localStorage.clear() de nuevaPagina(). Los bloques que miran el
// estado "sin datos" tienen que partir de cero a mano.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode(currentMode());
`;

// Un presupuesto con datos en todas las secciones.
const SEMBRAR = RESET + `
  S.clientName = 'Consorcio Rivadavia 2210';
  S.items = [{ id:1, type:'tree', species:'Tipuana', price:'245000', qty:1 },
             { id:2, type:'service', desc:'Retiro', price:'51000', qty:1 }];
  // OJO: en el modo estimativo los trabajos son type:'work' (no 'tree', que es
  // del modo normal). calcEstTotals solo suma 'work' y 'service'; con 'tree' el
  // total da 0. Ver addEstItem().
  S.estItems = [{ id:3, type:'work', desc:'Poda estimada por fotos', price:'180000' }];
  S.paymentConditions = '50% al inicio, 50% contra entrega.';
  S.estObservations = 'Sujeto a inspección.';
  S.surcharge = 12; S.discount = 5;
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode(currentMode());
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── I2: la vista por defecto es 'clasica' y no pliega nada ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        return {
        def: DEF.vistaEditor, activa: currentVistaEditor(), shell: ${LEER},
        headVisible: getComputedStyle(document.querySelector('.esec-head')).display,
        eshVisible: getComputedStyle(document.getElementById('editor-shell-head')).display,
        stVisible: getComputedStyle(document.querySelector('#esec-ident .st')).display,
      }`));
      check('El default es la vista clásica',
        r.def === 'clasica' && r.activa === 'clasica', r.def + ' / ' + r.activa);
      check('En clásica NO se ven los encabezados nuevos del shell',
        r.headVisible === 'none' && r.eshVisible === 'none',
        'head=' + r.headVisible + ' esh=' + r.eshVisible);
      check('…y los títulos .st de siempre siguen a la vista',
        r.stVisible !== 'none', r.stVisible);
      check('…con todas las secciones desplegadas',
        r.shell.vis.length === 5 && r.shell.vis.every(s => s.abierta),
        r.shell.vis.map(s => s.id + (s.abierta ? '' : '(plegada)')).join(', '));
      await page.close();
    }

    // ── I6: numeración y progreso por modo (las 6 combinaciones) ──
    {
      const page = await nuevaPagina(browser);
      for (const vista of ['clasica', 'fichas']) {
        const r = await page.evaluate(new Function(`
          ${SEMBRAR}
          setVistaEditor('${vista}');
          const out = {};
          ['normal','estimativo','riesgo'].forEach(m => { setMode(m); out[m] = ${LEER}; });
          setMode('normal');
          return out;
        `));
        const fmt = o => o.vis.map(s => s.num + ' ' + s.titulo).join(' · ');

        check(`[${vista}] Normal: 5 secciones numeradas 01→05`,
          r.normal.vis.length === 5 &&
          r.normal.vis.map(s => s.num).join() === '01,02,03,04,05' &&
          r.normal.vis.map(s => s.id).join() ===
            'esec-ident,esec-cliente,esec-items,esec-conditions,esec-adjust',
          fmt(r.normal));
        check(`[${vista}] Estimativo: 4 secciones, sin Ajustes de precio`,
          r.estimativo.vis.length === 4 &&
          r.estimativo.vis.map(s => s.id).join() ===
            'esec-ident,esec-cliente,esec-est-items,esec-est-obs',
          fmt(r.estimativo));
        check(`[${vista}] Riesgo: 6 secciones (el informe ISA cuenta como UNA)`,
          r.riesgo.vis.length === 6 &&
          r.riesgo.vis.map(s => s.id).join() ===
            'esec-ident,esec-cliente,esec-items,esec-risk,esec-conditions,esec-adjust',
          fmt(r.riesgo));
        check(`[${vista}] La barra de progreso tiene un segmento por sección visible`,
          r.normal.segmentos === 5 && r.estimativo.segmentos === 4 && r.riesgo.segmentos === 6,
          [r.normal.segmentos, r.estimativo.segmentos, r.riesgo.segmentos].join('/'));
        check(`[${vista}] La píldora del encabezado dice el modo activo`,
          r.normal.modo === 'Normal' && r.estimativo.modo === 'Estimativo' &&
          r.riesgo.modo === 'Riesgo',
          [r.normal.modo, r.estimativo.modo, r.riesgo.modo].join('/'));
      }
      await page.close();
    }

    // ── El estado de cada sección refleja los datos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        setVistaEditor('fichas');
        const vacio = ${LEER};
        ${SEMBRAR}
        const lleno = ${LEER};
        return { vacio, lleno };
      `));
      const est = (o, id) => (o.vis.find(s => s.id === id) || {}).estado;
      check('Sin datos: Cliente / Trabajos / Condiciones están PENDIENTE',
        est(r.vacio, 'esec-cliente') === 'Pendiente' &&
        est(r.vacio, 'esec-items') === 'Pendiente' &&
        est(r.vacio, 'esec-conditions') === 'Pendiente',
        JSON.stringify(r.vacio.vis.map(s => s.estado)));
      check('Identificación siempre está resuelta (se autocompleta) y muestra el N°',
        /^\d{4}-\d{4}$/.test(est(r.vacio, 'esec-ident')) &&
        r.vacio.vis.find(s => s.id === 'esec-ident').done,
        est(r.vacio, 'esec-ident'));
      check('Ajustes de precio: vacío es una respuesta válida → SIN AJUSTES, resuelta',
        est(r.vacio, 'esec-adjust') === 'Sin ajustes' &&
        r.vacio.vis.find(s => s.id === 'esec-adjust').done);
      check('Con datos: el cliente pasa a COMPLETO',
        est(r.lleno, 'esec-cliente') === 'Completo ✓', est(r.lleno, 'esec-cliente'));
      check('…los trabajos muestran la cantidad de ítems',
        est(r.lleno, 'esec-items') === '2 ítems', est(r.lleno, 'esec-items'));
      check('…y los ajustes muestran recargo y descuento',
        est(r.lleno, 'esec-adjust') === '+12% · −5%', est(r.lleno, 'esec-adjust'));
      check('El progreso cuenta las secciones resueltas sobre las visibles',
        r.vacio.progreso === '2 de 5 secciones' && r.lleno.progreso === '5 de 5 secciones',
        r.vacio.progreso + ' → ' + r.lleno.progreso);
      await page.close();
    }

    // ── El informe de riesgo muestra el nivel calculado ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        setVistaEditor('fichas'); setMode('riesgo');
        const pendiente = ${LEER};
        S.riskData.failureProbability = 'probable';
        S.riskData.impactProbability  = 'alta';
        S.riskData.consequences       = 'severas';
        sched();
        return { pendiente, calculado: ${LEER} };
      `));
      const est = (o) => (o.vis.find(s => s.id === 'esec-risk') || {}).estado;
      check('Sin evaluar, el informe de riesgo está PENDIENTE',
        est(r.pendiente) === 'Pendiente', est(r.pendiente));
      check('Evaluado, muestra el nivel calculado',
        /^Riesgo (BAJO|MODERADO|ALTO|EXTREMO)$/.test(est(r.calculado)), est(r.calculado));
      await page.close();
    }

    // ── I3: cambiar de vista y plegar es SOLO presentación ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        const antes = JSON.stringify(S);
        const totalAntes = document.getElementById('st-total').textContent;
        setVistaEditor('fichas');
        // Lo que el usuario acaba de tipear, todavía sin sincronizar.
        const inp = document.getElementById('observations');
        inp.value = 'Escrito a mano en la vista fichas';
        // Plegar/desplegar y volver a la clásica no puede perderlo.
        editorToggleSection('items');
        editorToggleSection('conditions');
        setVistaEditor('clasica');
        const despues = JSON.parse(JSON.stringify(S));
        delete despues.vistaEditor;
        const previo = JSON.parse(antes); delete previo.vistaEditor;
        return {
          textoIntacto: document.getElementById('observations').value,
          clienteIntacto: document.getElementById('client-name').value,
          estadoIntacto: JSON.stringify(previo) === JSON.stringify(despues),
          // Los nodos siguen siendo los mismos: el shell no reconstruye el DOM.
          mismoNodo: inp === document.getElementById('observations'),
          totalAntes, totalDespues: document.getElementById('st-total').textContent,
        };
      `));
      check('Plegar y cambiar de vista NO pierde lo escrito en pantalla',
        r.textoIntacto === 'Escrito a mano en la vista fichas' &&
        r.clienteIntacto === 'Consorcio Rivadavia 2210',
        r.textoIntacto + ' / ' + r.clienteIntacto);
      check('…no reconstruye el DOM del editor (mismos nodos, mismos listeners)',
        r.mismoNodo);
      check('…y no toca nada del presupuesto salvo la vista', r.estadoIntacto);
      check('…con los totales intactos',
        r.totalDespues === r.totalAntes && /\d/.test(r.totalDespues),
        r.totalAntes + ' → ' + r.totalDespues);
      await page.close();
    }

    // ── En fichas hay UNA sección abierta, y siempre una válida ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        setVistaEditor('fichas');
        const inicial = ${LEER};
        editorToggleSection('adjust');
        const traAbrirAjustes = ${LEER};
        // Ajustes no existe en estimativo: el shell tiene que reabrir otra.
        setMode('estimativo');
        const traCambiarModo = ${LEER};
        return { inicial, traAbrirAjustes, traCambiarModo };
      `));
      const abiertas = o => o.vis.filter(s => s.abierta).map(s => s.id);
      check('En fichas arranca abierta la primera sección',
        abiertas(r.inicial).join() === 'esec-ident', abiertas(r.inicial).join());
      check('…y se abre una sola a la vez',
        abiertas(r.traAbrirAjustes).join() === 'esec-adjust',
        abiertas(r.traAbrirAjustes).join());
      check('Si el modo esconde la sección abierta, se abre la primera visible',
        abiertas(r.traCambiarModo).join() === 'esec-ident',
        abiertas(r.traCambiarModo).join());
      await page.close();
    }

    // ── I5: la vista entra por la lista blanca de sanitize ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        return {
        lista: EDITOR_VIEWS.slice(),
        basura: sanitizeStateObj({ vistaEditor: '"><script>alert(1)</script>' }).vistaEditor,
        vacio: sanitizeStateObj({}).vistaEditor,
        valida: sanitizeStateObj({ vistaEditor: 'fichas' }).vistaEditor,
        // Un valor podrido ya guardado en el dispositivo
        enMemoria: (() => { S.vistaEditor = 'consola<script>'; return currentVistaEditor(); })(),
        // setVistaEditor tampoco acepta cualquier cosa
        porSetter: (() => { setVistaEditor('otra-cosa'); return S.vistaEditor; })(),
      }`));
      check('EDITOR_VIEWS es la lista blanca de las 3 vistas',
        r.lista.join() === 'clasica,fichas,consola', r.lista.join());
      check('Un backup con vistaEditor basura cae a clásica',
        r.basura === 'clasica' && r.vacio === 'clasica', r.basura + ' / ' + r.vacio);
      check('…pero una vista válida se conserva', r.valida === 'fichas', r.valida);
      check('Un valor podrido en memoria se lee como clásica (fallback I2)',
        r.enMemoria === 'clasica', r.enMemoria);
      check('setVistaEditor rechaza lo que no está en la lista',
        r.porSetter === 'clasica', r.porSetter);
      await page.close();
    }

    // ── I4: es configuración, no dato del presupuesto ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        // Un presupuesto guardado cuando el usuario usaba la vista clásica…
        S.vistaEditor = 'clasica';
        S.clientName = 'Cliente Viejo'; S.quoteNumber = '2025-0001';
        S.items = [{ id:1, type:'tree', species:'Fresno', price:'100000', qty:1 }];
        noSync = true; restoreUI(); noSync = false; renderItems();
        setH([]); autoSaveToHistory();
        const idViejo = getH()[0].id;
        // …y hoy usa fichas.
        setVistaEditor('fichas');
        loadFromHistory(idViejo);
        const traCargar = S.vistaEditor;
        const vistaDOM = document.getElementById('panel-editor').dataset.vista;
        return {
          enCfgGlobal: CFG_GLOBAL_FIELDS.indexOf('vistaEditor') >= 0,
          traCargar, vistaDOM, cliente: S.clientName,
        };
      `));
      check('vistaEditor está en CFG_GLOBAL_FIELDS', r.enCfgGlobal);
      check('Abrir un presupuesto viejo NO te cambia la vista del editor',
        r.traCargar === 'fichas' && r.vistaDOM === 'fichas',
        r.traCargar + ' / ' + r.vistaDOM);
      check('…pero sí trae los datos del presupuesto',
        r.cliente === 'Cliente Viejo', r.cliente);
      await page.close();
    }

    // ── Fase 4: el selector de Empresa → Estilo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        const btns = () => Array.from(document.querySelectorAll('#vista-editor-mode .theme-mode-btn'))
          .map(b => b.dataset.vista + (b.classList.contains('active') ? '*' : ''));
        const enEstilo = !!document.querySelector('#subpanel-estilo #vista-editor-mode');
        const inicial = btns();
        // Tocar el botón, como el usuario
        document.querySelector('#vista-editor-mode [data-vista="fichas"]').click();
        const traTocar = { botones: btns(), S: S.vistaEditor,
                           dom: document.getElementById('panel-editor').dataset.vista };
        // Y que quede guardado en localStorage (vía saveLS → safeSetLS)
        const enDisco = JSON.parse(localStorage.getItem(LS.STATE) || '{}').vistaEditor;
        document.querySelector('#vista-editor-mode [data-vista="clasica"]').click();
        return { enEstilo, inicial, traTocar, enDisco, traVolver: btns() };
      `));
      check('El selector vive en Empresa → Estilo', r.enEstilo);
      check('Arranca marcando Clásica (el default no cambió en esta fase)',
        r.inicial.join() === 'clasica*,fichas', r.inicial.join());
      check('Tocar "Fichas" cambia la vista y marca el botón',
        r.traTocar.botones.join() === 'clasica,fichas*' &&
        r.traTocar.S === 'fichas' && r.traTocar.dom === 'fichas',
        JSON.stringify(r.traTocar));
      check('…y queda persistido en localStorage', r.enDisco === 'fichas', r.enDisco);
      check('Volver a "Clásica" también', r.traVolver.join() === 'clasica*,fichas',
        r.traVolver.join());
      await page.close();
    }

    // ── Fase 2: la barra inferior fija es la única barra de totales ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        const txt = id => (document.getElementById(id) || {}).textContent;
        const visible = id => { const e = document.getElementById(id);
          return !!e && getComputedStyle(e).display !== 'none'; };
        const leer = () => ({
          total: txt('st-total'), count: txt('st-count'),
          sub: visible('st-sub-row') ? txt('st-sub') : null,
          desc: visible('st-disc-row') ? txt('st-disc') : null,
          rec: visible('st-surcharge-row') ? txt('st-surcharge') : null,
          variante: ['st-normal','st-ab','st-est'].filter(visible).join(),
        });
        const conAjustes = leer();
        S.discount = 0; S.surcharge = 0; sched();
        const sinAjustes = leer();
        setMode('estimativo');
        const est = { val: txt('st-est-val'), count: txt('st-est-count'),
                      variante: ['st-normal','st-ab','st-est'].filter(visible).join() };
        setMode('normal');
        S.scenariosEnabled = true; updateTotalsBar();
        const ab = { a: txt('st-a'), b: txt('st-b'),
                     variante: ['st-normal','st-ab','st-est'].filter(visible).join() };
        S.scenariosEnabled = false; updateTotalsBar();
        return {
          conAjustes, sinAjustes, est, ab,
          // Las acciones viven en la barra
          acciones: Array.from(document.querySelectorAll('#sticky-totals .stb-actions button'))
            .map(b => (b.getAttribute('aria-label') || b.textContent).trim()),
          // Y lo que se sacó del flujo ya no está
          restos: ['totals-bar','tb-total','tb-sub','tb-disc','tb-est-total',
                   'tb-normal-cols','tb-est-cols'].filter(id => document.getElementById(id)),
          ctaVieja: document.querySelectorAll('#panel-editor .btn-cta').length,
        };
      `));
      check('La barra muestra TOTAL + cantidad de ítems',
        /\d/.test(r.conAjustes.total) && r.conAjustes.count === '2 ítems',
        r.conAjustes.total + ' / ' + r.conAjustes.count);
      check('Con descuento y recargo, la columna de apoyo los muestra',
        r.conAjustes.sub && r.conAjustes.desc && r.conAjustes.rec === '+12%',
        JSON.stringify(r.conAjustes));
      check('Sin ajustes, la columna de apoyo desaparece entera',
        !r.sinAjustes.sub && !r.sinAjustes.desc && !r.sinAjustes.rec,
        JSON.stringify(r.sinAjustes));
      check('Estimativo: su propia variante, con total y cantidad',
        r.est.variante === 'st-est' && /180/.test(r.est.val) && r.est.count === '1 ítem',
        JSON.stringify(r.est));
      check('Escenarios A/B: la variante de dos totales',
        r.ab.variante === 'st-ab' && /\d/.test(r.ab.a) && /\d/.test(r.ab.b),
        JSON.stringify(r.ab));
      check('Solo una variante visible a la vez',
        r.conAjustes.variante === 'st-normal', r.conAjustes.variante);
      check('Imprimir / PDF, vista previa y WhatsApp están en la barra',
        r.acciones.length === 3 && /Imprimir/.test(r.acciones[0]) &&
        r.acciones[1] === 'Vista previa' && /WhatsApp/.test(r.acciones[2]),
        JSON.stringify(r.acciones));
      check('El #totals-bar inline y sus tb-* ya no existen',
        r.restos.length === 0, r.restos.join());
      check('…ni el CTA duplicado al final del flujo', r.ctaVieja === 0);
      await page.close();
    }

    // ── El FAB de "subir" se apoya en el alto MEDIDO de la barra ──
    // Con la barra de una fila alcanzaba un 56px a mano en el CSS; con las dos
    // filas de la Fase 2 el FAB quedaba encima de la barra.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        switchTab('editor'); reserveStickySpace();
        const bar = document.getElementById('sticky-totals');
        const fab = document.querySelector('.scrolltop-fab');
        const alto = Math.round(bar.getBoundingClientRect().height);
        const px = v => parseFloat(v) || 0;
        return {
          alto,
          stickyVar: px(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h')),
          fabBottom: px(getComputedStyle(fab).bottom),
          padMain: px(getComputedStyle(document.getElementById('main')).paddingBottom),
        };
      `));
      check('--sticky-h refleja el alto real de la barra',
        r.stickyVar === r.alto && r.alto > 0, r.stickyVar + ' vs ' + r.alto);
      check('El FAB de "subir" queda POR ENCIMA de la barra',
        r.fabBottom >= r.alto, 'fab=' + r.fabBottom + ' barra=' + r.alto);
      check('…y #main reserva espacio para que la barra no tape nada',
        r.padMain >= r.alto, 'padding=' + r.padMain + ' barra=' + r.alto);
      await page.close();
    }

    // ── La vista viaja en el backup (por CFG_GLOBAL_FIELDS, sin código extra) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        setVistaEditor('fichas');
        const b = buildBackupObject();
        return { enBackup: b.state.vistaEditor,
                 traRestaurar: sanitizeBackup(JSON.parse(JSON.stringify(b))).state.vistaEditor };
      `));
      check('La vista elegida viaja en el backup y sobrevive la restauración',
        r.enBackup === 'fichas' && r.traRestaurar === 'fichas',
        r.enBackup + ' / ' + r.traRestaurar);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
