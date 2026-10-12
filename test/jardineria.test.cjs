// test/jardineria.test.cjs — Presupuestos de jardinería (v241).
//
// Pedido: "que dentro de la app también se puedan hacer presupuestos para
// jardinería. Por ejemplo, cuando tengo que limpiar un terreno o podar un cerco
// de jazmín amarillo". Decisiones del usuario: casi nunca mezcla árboles y
// jardinería en el mismo trabajo; el encabezado (subtítulo del negocio) queda
// igual; el documento de jardinería NO lleva "Plan de trabajo" ni "Cómo
// Trabajamos"; cobra "a ojo" pero quiere poder cobrar por metro o por jornada.
//
// Lo que se protege acá:
//   1. El rubro es dato DEL PRESUPUESTO (viaja en el snapshot, no en
//      CFG_GLOBAL_FIELDS); los títulos de jardinería son config global.
//   2. Un snapshot anterior a la función es de arbolado y no hereda el rubro
//      del presupuesto abierto; un valor raro desde un backup cae a arbolado.
//   3. Documento normal y estimativo de jardinería: su título, sin plan ni
//      criterios, columna "Planta / Sector". Arbolado queda igual que antes.
//   4. El informe de riesgo ignora el rubro.
//   5. Cobro por unidad: precio × cantidad (con decimales y coma), el total
//      del historial coincide con el del PDF, el desglose sale en el PDF; un
//      trabajo sin unidad sigue a precio cerrado aunque tenga qty.
//   6. Una unidad fuera de la lista blanca no se usa ni se imprime.
//   7. Editor: el selector cambia etiquetas, oculta las opciones que no van y
//      el cobro por metro arranca con cantidad 1 (el total no salta).
//   8. El precio sugerido compara solo precios cobrados de la misma forma.
//
// Uso:  node test/jardineria.test.cjs

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

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Familia Ortiz';
  S.items = [];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode('normal');
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
  const run = (body) => page.evaluate(new Function(`return (async () => { ${RESET} ${body} })()`));

  try {
    // ── 1-2: estado, migración y sanitizado ──
    {
      const r = await run(`
        return {
          rubroGlobal: CFG_GLOBAL_FIELDS.includes('rubro'),
          titulosGlobales: CFG_GLOBAL_FIELDS.includes('docTitleJard') && CFG_GLOBAL_FIELDS.includes('docTitleEstJard'),
          def: DEF.rubro,
          viejo: migrateState({ items: [] }).rubro,
          raro: sanitizeStateObj({ rubro: '<img src=x onerror=alert(1)>' }).rubro,
          bueno: sanitizeStateObj({ rubro: 'jardineria' }).rubro,
          heredado: (() => { S.rubro = 'jardineria'; assignSnapshot(S, migrateState({ items: [] })); return S.rubro; })(),
        };
      `);
      check('El rubro NO es config global (viaja en el snapshot)', !r.rubroGlobal);
      check('Los títulos de jardinería SÍ son config global', r.titulosGlobales);
      check('Default: arbolado', r.def === 'arbolado');
      check('Snapshot anterior a la función → arbolado', r.viejo === 'arbolado');
      check('Rubro raro desde un backup → arbolado', r.raro === 'arbolado' && r.bueno === 'jardineria');
      check('Abrir un presupuesto viejo no hereda el rubro del abierto', r.heredado === 'arbolado');
    }

    // ── 3: documento normal ──
    {
      const r = await run(`
        S.rubro = 'jardineria'; S.showCriteria = true; S.showWorkPlan = true;
        S.items = [{ id:1, type:'tree', species:'Cerco de jazmín amarillo', desc:'Poda con terminación a tijera', price:'3000', qty:40, unidad:'m' }];
        buildDoc();
        const doc = document.getElementById('doc-a4');
        const jard = {
          titulo: doc.querySelector('.ptitle').textContent.trim(),
          plan: !!doc.querySelector('.pplan'),
          crit: !!doc.querySelector('.pcrit'),
          col: doc.querySelector('.ptable th:nth-child(2)').textContent.trim(),
          precio: doc.querySelector('.ptable .td-pr').textContent.replace(/\\s+/g, ' ').trim(),
        };
        S.rubro = 'arbolado';
        S.items = [{ id:2, type:'tree', species:'Tipuana', desc:'Poda', price:'245000', qty:1 }];
        buildDoc();
        const arb = {
          titulo: doc.querySelector('.ptitle').textContent.trim(),
          plan: !!doc.querySelector('.pplan'),
          crit: !!doc.querySelector('.pcrit'),
          col: doc.querySelector('.ptable th:nth-child(2)').textContent.trim(),
        };
        return { jard, arb, defJ: DEF.docTitleJard, defA: S.docTitle };
      `);
      check('Jardinería: título propio', r.jard.titulo === r.defJ, r.jard.titulo);
      check('Jardinería: sin Plan de trabajo ni Cómo Trabajamos', !r.jard.plan && !r.jard.crit);
      check('Jardinería: columna "Planta / Sector"', r.jard.col === 'Planta / Sector', r.jard.col);
      check('Por metro: el PDF desglosa cantidad × precio y da el total',
        /40 m × \$\s?3\.000/.test(r.jard.precio) && /120\.000/.test(r.jard.precio), r.jard.precio);
      check('Arbolado: igual que antes (título, plan, criterios, "Especie/s")',
        r.arb.titulo === r.defA && r.arb.plan && r.arb.crit && r.arb.col === 'Especie/s');
    }

    // ── 3b-4: estimativo y riesgo ──
    {
      const r = await run(`
        S.rubro = 'jardineria'; S.isEstimative = true;
        S.estItems = [{ id:1, type:'work', desc:'Limpieza de terreno', price:'180000' }];
        buildDoc();
        const doc = document.getElementById('doc-a4');
        const est = {
          titulo: doc.querySelector('.ptitle').textContent.trim(),
          factores: !!doc.querySelector('.pest-factors'),
          plan: !!doc.querySelector('.pplan'),
        };
        S.isEstimative = false; S.isRisk = true;
        S.items = [{ id:2, type:'tree', species:'Fresno', price:'90000' }];
        buildDoc();
        const riesgo = doc.querySelector('.ptitle').textContent.trim();
        return { est, riesgo, defE: DEF.docTitleEstJard, defR: S.docTitleRisk, esJ: esJardineria() };
      `);
      check('Estimativo de jardinería: título propio, sin factores ni plan',
        r.est.titulo === r.defE && !r.est.factores && !r.est.plan, r.est.titulo);
      check('Riesgo ignora el rubro', r.riesgo === r.defR && r.esJ === false);
    }

    // ── 5-6: totales con unidad ──
    {
      const r = await run(`
        const t = (it) => itemTotalCents(Object.assign({ type:'tree' }, it));
        S.items = [
          { id:1, type:'tree', species:'Cerco', price:'3000', qty:'12,5', unidad:'m' },
          { id:2, type:'tree', species:'Ligustro', price:'50000', qty:5 },
          { id:3, type:'service', desc:'Volquete', price:'100000', qty:2 },
        ];
        const tot = calcTotals(S.items).total;
        S.rubro = 'jardineria';
        autoSaveToHistory();
        const e = getH()[0];
        return {
          metro: t({ price:'3000', qty:40, unidad:'m' }),
          decimal: t({ price:'3000', qty:'12,5', unidad:'m' }),
          jornada: t({ price:'85000', qty:2, unidad:'jornada' }),
          sinUnidad: t({ price:'50000', qty:5 }),
          cantMala: t({ price:'3000', qty:'abc', unidad:'m2' }),
          raro: t({ price:'3000', qty:7, unidad:'"><b>x' }),
          raroTxt: itemCantTxt({ type:'tree', qty:7, unidad:'"><b>x' }),
          txt: [itemCantTxt({ type:'tree', qty:1, unidad:'jornada' }), itemCantTxt({ type:'tree', qty:3, unidad:'jornada' }), itemCantTxt({ type:'tree', qty:'12,5', unidad:'m2' })],
          tot, hist: parseFloat(e && e.total), snapRubro: e && e.snapshot && e.snapshot.rubro,
        };
      `);
      check('Por metro: 40 × $3.000 = $120.000', r.metro === 12000000, String(r.metro));
      check('Cantidad con coma decimal: 12,5 × $3.000 = $37.500', r.decimal === 3750000, String(r.decimal));
      check('Por jornada: 2 × $85.000', r.jornada === 17000000);
      check('Sin unidad sigue a precio cerrado aunque tenga qty', r.sinUnidad === 5000000);
      check('Cantidad inválida cuenta como 1', r.cantMala === 300000);
      check('Unidad fuera de la lista blanca: precio cerrado y nada impreso', r.raro === 300000 && r.raroTxt === '');
      check('Textos de cantidad', r.txt.join('|') === '1 jornada|3 jornadas|12,5 m²', r.txt.join('|'));
      check('El total del historial coincide con el del presupuesto', r.tot === 287500 && r.hist === r.tot, `${r.tot} / ${r.hist}`);
      check('El rubro viaja en el snapshot', r.snapRubro === 'jardineria');
    }

    // ── 7: editor ──
    {
      const r = await run(`
        S.items = [{ id:1, type:'tree', species:'', desc:'', price:'4000', qty:1 }];
        renderItems();
        const panel = document.getElementById('panel-editor');
        const card = () => document.querySelector('#items-list .icard');
        const antes = { chips: !!card().querySelector('.cobro-seg'), clase: panel.classList.contains('is-jardineria') };
        setRubro('jardineria');
        const badge = card().querySelector('.ibadge').textContent.trim();
        const chips = card().querySelectorAll('.cobro-b').length;
        const planOculto = getComputedStyle(document.getElementById('show-work-plan').closest('.trow')).display === 'none';
        const btnTxt = [...document.querySelectorAll('.add-tree span')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.textContent.trim()).join('');
        card().querySelector('.cobro-b[data-u="m"]').click();
        const it = S.items[0];
        const trasMetro = { unidad: it.unidad, qty: it.qty, total: calcTotals().total, cant: !!card().querySelector('.cant-f') };
        const cf = card().querySelector('.cant-f'); cf.value = '25'; cf.dispatchEvent(new Event('input', { bubbles:true }));
        const prev = card().querySelector('.cobro-prev').textContent;
        const total25 = calcTotals().total;
        card().querySelector('.cobro-b[data-u=""]').click();
        const aOjo = { unidad: S.items[0].unidad, total: calcTotals().total };
        setRubro('arbolado');
        const vuelta = { badge: card().querySelector('.ibadge').textContent.trim(), chips: !!card().querySelector('.cobro-seg'), clase: panel.classList.contains('is-jardineria') };
        setMode('riesgo');
        const rubroOculto = document.getElementById('rubro-switch').hidden;
        setMode('normal');
        S.rubro = 'jardineria'; resetToNewQuote();
        return { antes, badge, chips, planOculto, btnTxt, trasMetro, prev, total25, aOjo, vuelta, rubroOculto, nuevo: S.rubro };
      `);
      check('Arbolado: sin selector de cobro', !r.antes.chips && !r.antes.clase);
      check('Jardinería: tarjeta "Trabajo" con 4 formas de cobro', /Trabajo/.test(r.badge) && !/Árbol/.test(r.badge) && r.chips === 4, r.badge);
      check('Jardinería: se ocultan las opciones de plan y criterios', r.planOculto);
      check('Jardinería: el botón dice "+ Trabajo"', r.btnTxt === '+ Trabajo', r.btnTxt);
      check('Pasar a "Por metro" arranca con cantidad 1 (el total no salta)',
        r.trasMetro.unidad === 'm' && r.trasMetro.qty === 1 && r.trasMetro.total === 4000 && r.trasMetro.cant);
      check('Cargar 25 m actualiza total y desglose', r.total25 === 100000 && /25 m ×/.test(r.prev), r.prev);
      check('Volver a "A ojo" saca la unidad', r.aOjo.unidad === undefined && r.aOjo.total === 4000);
      check('Volver a arbolado restituye la tarjeta', /Árbol/.test(r.vuelta.badge) && !r.vuelta.chips && !r.vuelta.clase);
      check('El selector de rubro se oculta en riesgo', r.rubroOculto === true);
      check('Presupuesto nuevo arranca en arbolado', r.nuevo === 'arbolado');
    }

    // ── 8: precio sugerido por la misma forma de cobro ──
    {
      const r = await run(`
        setH([
          { id: 11, quoteNumber: 'X-1', estado: 'enviado', total: 120000, snapshot: { dateIssue: '2026-09-01', items: [{ type:'tree', species:'Cerco de jazmín', price:'3000', qty:40, unidad:'m' }] } },
          { id: 12, quoteNumber: 'X-2', estado: 'enviado', total: 150000, snapshot: { dateIssue: '2026-08-01', items: [{ type:'tree', species:'Cerco de jazmín', price:'150000', qty:1 }] } },
        ]);
        return {
          metro: (ultimoPrecioEspecie('cerco de jazmin', 'm') || {}).price,
          cerrado: (ultimoPrecioEspecie('Cerco de jazmín', '') || {}).price,
          jornada: ultimoPrecioEspecie('Cerco de jazmín', 'jornada'),
        };
      `);
      check('Sugerido por metro toma el precio por metro', r.metro === '3000', String(r.metro));
      check('Sugerido a ojo toma el precio cerrado', r.cerrado === '150000', String(r.cerrado));
      check('Sin antecedente con esa unidad, no sugiere', r.jornada === null);
    }
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nHAY FALLAS');
  process.exit(allOk ? 0 : 1);
})();
