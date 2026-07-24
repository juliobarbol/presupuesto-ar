// test/money.test.cjs — Regresión de los cálculos de dinero.
//
// Cubre C2 de docs/auditoria-2026-07-24.md (tanda 2): el total de un
// presupuesto ESTIMATIVO se guardaba en el historial ignorando la cantidad de
// los servicios. El cliente recibía un PDF por $710.000 y el historial —que es
// lo que pre-carga el monto al facturar y suma al tope de monotributo— guardaba
// $470.000.
//
// La regla que se verifica: la barra de totales, el documento/PDF y lo que se
// asienta en el historial tienen que dar SIEMPRE el mismo número.
//
// Uso:  node test/money.test.cjs

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

// Extrae el número de un texto tipo "$ 710.000,00" → 710000
const aNum = (txt) => {
  const m = String(txt || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(m);
};

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch(_){} });
  return page;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    // ── C2 · Estimativo con un servicio de cantidad > 1 ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.isEstimative = true; S.isRisk = false;
        S.clientName = 'Cliente Prueba'; S.quoteNumber = '2026-0099'; S.currency = 'ARS';
        S.estItems = [
          { id:1, type:'work',    desc:'Poda de gomero', price:'350000' },
          { id:2, type:'service', desc:'Volquete',       price:'120000', qty:3, showQty:true },
          { id:3, type:'note',    desc:'No suma nada',   price:'' },
        ];
        noSync = true; restoreUI(); noSync = false; renderEstItems();
        updateTotalsBar();
        const barra = (document.getElementById('tb-est-total')||{}).textContent;
        buildEstDoc();
        const pdf = (document.querySelector('#doc-a4 .ptotal-amt')||{}).textContent;
        setH([]); autoSaveToHistory();
        return { barra, pdf, historial: (getH()[0]||{}).total };
      });
      const barra = aNum(r.barra), pdf = aNum(r.pdf);
      check('C2 · barra de totales = 710.000 (350.000 + 120.000×3)', barra === 710000, 'barra=' + r.barra);
      check('C2 · documento/PDF = 710.000', pdf === 710000, 'pdf=' + r.pdf);
      check('C2 · historial = 710.000 (era 470.000: ignoraba la cantidad)',
        r.historial === 710000, 'historial=' + r.historial);
      check('C2 · los tres coinciden', barra === pdf && pdf === r.historial);
      await page.close();
    }

    // ── El desglose del PDF (trabajos vs servicios) también sale de la misma fuente ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.estItems = [
          { id:1, type:'work',    desc:'Trabajo A', price:'100000' },
          { id:2, type:'work',    desc:'Trabajo B', price:'50000'  },
          { id:3, type:'service', desc:'Camión',    price:'20000', qty:2 },
        ];
        const t = calcEstTotals(S.estItems);
        return { work: t.work, svc: t.svc, total: t.total };
      });
      check('Desglose: trabajos 150.000 · servicios 40.000 · total 190.000',
        r.work === 150000 && r.svc === 40000 && r.total === 190000, JSON.stringify(r));
      await page.close();
    }

    // ── Centavos: nada de errores de punto flotante ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        // 0.1 + 0.2 en floats da 0.30000000000000004
        S.estItems = [
          { id:1, type:'work',    desc:'a', price:'0.10' },
          { id:2, type:'service', desc:'b', price:'0.20', qty:1 },
        ];
        return calcEstTotals(S.estItems).total;
      });
      check('Centavos: 0,10 + 0,20 = 0,30 exacto', r === 0.3, 'total=' + r);
      await page.close();
    }

    // ── Modo normal: el total no cambió ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        S.isEstimative = false; S.isRisk = false; S.discount = 0;
        S.clientName = 'Cliente'; S.quoteNumber = '2026-0001';
        S.items = [
          { id:1, type:'tree',    species:'Fresno', price:'250000', qty:1 },
          { id:2, type:'service', desc:'Camión',    price:'80000',  qty:2, showQty:true },
        ];
        noSync = true; restoreUI(); noSync = false; renderItems();
        setH([]); autoSaveToHistory();
        return { calc: calcTotals().total, historial: (getH()[0]||{}).total };
      });
      check('Modo normal: 250.000 + 80.000×2 = 410.000 y coincide con el historial',
        r.calc === 410000 && r.historial === 410000, JSON.stringify(r));
      await page.close();
    }

    // ── Migración de los estimativos ya guardados con el total de menos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(() => {
        // Entrada tal como la dejaba la versión con el bug: total sin la cantidad.
        setH([{
          _type:'presupuesto_individual', id: 5001, savedAt: new Date().toISOString(),
          quoteNumber:'2026-0050', clientName:'Cliente viejo', currency:'ARS',
          total: 470000, itemCount: 2, isEstimative: true, estado:'realizado',
          snapshot: { isEstimative: true, items: [], estItems: [
            { id:1, type:'work',    desc:'Poda de gomero', price:'350000' },
            { id:2, type:'service', desc:'Volquete',       price:'120000', qty:3 },
          ]},
        }, {
          // Un presupuesto NORMAL no se toca.
          _type:'presupuesto_individual', id: 5002, savedAt: new Date().toISOString(),
          quoteNumber:'2026-0051', clientName:'Otro', currency:'ARS',
          total: 99999, itemCount: 1, isEstimative: false, estado:'enviado',
          snapshot: { items: [{ id:1, type:'tree', species:'X', price:'123', qty:1 }] },
        }]);
        const n1 = migrateFixEstTotals();
        const tras1 = getH().map(e => e.total);
        const n2 = migrateFixEstTotals();   // idempotente: no debe volver a tocar
        const tras2 = getH().map(e => e.total);
        return { n1, n2, tras1, tras2 };
      });
      check('Migración: corrige el estimativo guardado de menos (470.000 → 710.000)',
        r.n1 === 1 && r.tras1[0] === 710000, JSON.stringify(r.tras1));
      check('Migración: no toca los presupuestos normales', r.tras1[1] === 99999);
      check('Migración: es idempotente (segunda pasada no cambia nada)',
        r.n2 === 0 && JSON.stringify(r.tras1) === JSON.stringify(r.tras2));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
