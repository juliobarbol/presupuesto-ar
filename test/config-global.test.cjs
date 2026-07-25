// test/config-global.test.cjs — La configuración del negocio no se pisa al
// abrir presupuestos viejos.
//
// Síntoma reportado: "cada tanto el nombre de la empresa y el subtítulo se
// resetean y ponen mi nombre y una especialidad distinta; tengo que andar muy
// atento de que no se haya cambiado cuando mando los presupuestos".
//
// Causa: la config de la empresa (coName, coSubtitle, CUIT, textos del PDF,
// diseño, numeración) vive en S, y S entero se guarda como snapshot en cada
// entrada del historial. Al abrir un presupuesto viejo se hacía
// Object.assign(S, snapshot), que traía de vuelta los valores de entonces — y
// el autoguardado los dejaba asentados. Cada camino preservaba su propia lista
// incompleta de campos (loadFromHistory 5, impIndividual 1, la previa 3).
//
// Uso:  node test/config-global.test.cjs

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
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.clear(); } catch(_){} });
  return page;
}

// Deja en el historial un presupuesto guardado cuando la empresa se llamaba
// distinto, y después pone la config actual. Devuelve el id de esa entrada.
const SEMBRAR = `
  // Config vieja (como estaba hace meses)
  S.coName = 'Julio Barrientos Bolbochan';
  S.coSubtitle = 'Servicios de jardinería';
  S.coCuit = '20-11111111-1';
  S.accentColor = '#7c3aed';
  S.workPlanTitle = 'Qué incluye (viejo)';
  S.clientName = 'Cliente Viejo'; S.quoteNumber = '2025-0001';
  S.items = [{ id:1, type:'tree', species:'Fresno', price:'100000', qty:1 }];
  noSync = true; restoreUI(); noSync = false; renderItems();
  setH([]); autoSaveToHistory();
  const idViejo = getH()[0].id;

  // Config de HOY
  S.coName = 'Arbórea Córdoba';
  S.coSubtitle = 'Poda en Altura y Servicios Forestales';
  S.coCuit = '20-39388759-2';
  S.accentColor = '#064e3b';
  S.workPlanTitle = 'Plan de Trabajo';
  noSync = true; restoreUI(); noSync = false;
`;

const ACTUAL = `({
  coName: S.coName, coSubtitle: S.coSubtitle, coCuit: S.coCuit,
  accentColor: S.accentColor, workPlanTitle: S.workPlanTitle,
})`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    // ── Cargar un presupuesto viejo en el editor ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        loadFromHistory(idViejo);
        return { cfg: ${ACTUAL}, cliente: S.clientName, num: S.quoteNumber };
      `));
      check('Cargar un presupuesto viejo NO cambia el nombre de la empresa',
        r.cfg.coName === 'Arbórea Córdoba', 'quedó: ' + r.cfg.coName);
      check('…ni el subtítulo / especialidad',
        r.cfg.coSubtitle === 'Poda en Altura y Servicios Forestales', 'quedó: ' + r.cfg.coSubtitle);
      check('…ni el CUIT, el color ni los textos del PDF',
        r.cfg.coCuit === '20-39388759-2' && r.cfg.accentColor === '#064e3b' &&
        r.cfg.workPlanTitle === 'Plan de Trabajo', JSON.stringify(r.cfg));
      check('…pero sí trae los datos del presupuesto',
        r.cliente === 'Cliente Viejo' && r.num === '2025-0001',
        r.cliente + ' / ' + r.num);
      await page.close();
    }

    // ── Y que el autoguardado no deje asentada la config vieja ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        loadFromHistory(idViejo);
        autoSaveToHistory();              // lo que pasa sin hacer nada más
        saveLS();
        const guardado = JSON.parse(localStorage.getItem('pq_s'));
        return { coName: guardado.coName, coSubtitle: guardado.coSubtitle };
      `));
      check('El autoguardado posterior tampoco asienta la config vieja',
        r.coName === 'Arbórea Córdoba' && r.coSubtitle === 'Poda en Altura y Servicios Forestales',
        JSON.stringify(r));
      await page.close();
    }

    // ── El documento de un presupuesto viejo sale con los datos de HOY ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        const html = _buildDocHTMLForEntry(getH().find(x => x.id === idViejo)) || '';
        return {
          tieneNuevo: html.includes('Arbórea Córdoba'),
          tieneViejo: html.includes('Julio Barrientos Bolbochan'),
          subtituloNuevo: html.includes('Poda en Altura y Servicios Forestales'),
          cfgIntacta: ${ACTUAL},
        };
      `));
      check('Compartir un presupuesto viejo sale con el nombre de empresa ACTUAL',
        r.tieneNuevo && !r.tieneViejo, 'nuevo=' + r.tieneNuevo + ' viejo=' + r.tieneViejo);
      check('…y con el subtítulo actual', r.subtituloNuevo);
      check('…sin dejar el estado tocado después',
        r.cfgIntacta.coName === 'Arbórea Córdoba');
      await page.close();
    }

    // ── La vista previa desde el historial, igual ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        previewFromHistory(idViejo);
        // La previa construye en #doc-a4, copia al modal y restaura #doc-a4.
        const html = (document.getElementById('doc-preview-content')||{}).innerHTML || '';
        const durante = ${ACTUAL};
        _restorePreviewState();
        return { tieneNuevo: html.includes('Arbórea Córdoba'),
                 tieneViejo: html.includes('Julio Barrientos Bolbochan'),
                 durante, despues: ${ACTUAL} };
      `));
      check('La vista previa del historial usa la empresa actual',
        r.tieneNuevo && !r.tieneViejo, 'nuevo=' + r.tieneNuevo + ' viejo=' + r.tieneViejo);
      check('…y al cerrarla el estado queda intacto',
        r.despues.coName === 'Arbórea Córdoba' && r.despues.coSubtitle.startsWith('Poda en Altura'));
      await page.close();
    }

    // ── Importar un presupuesto de un colega no importa SU empresa ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        // showImpOpts sale temprano si el modal de import no está abierto
        // (#imp-opts se crea con él), así que dejamos el pendiente igual que él.
        _pendingImport = sanitizeImport({
          _type: 'presupuesto_individual',
          quoteNumber: '2026-0500', clientName: 'Cliente Ajeno', currency: 'ARS', total: 5000,
          snapshot: { clientName:'Cliente Ajeno', quoteNumber:'2026-0500', items:[],
                      coName:'Podas El Colega', coSubtitle:'Otra especialidad', coCuit:'27-99999999-9' },
        });
        impIndividual();
        return { cfg: ${ACTUAL}, cliente: S.clientName };
      `));
      check('Importar el presupuesto de un colega NO trae los datos de SU empresa',
        r.cfg.coName === 'Arbórea Córdoba' && r.cfg.coSubtitle === 'Poda en Altura y Servicios Forestales' &&
        r.cfg.coCuit === '20-39388759-2', JSON.stringify(r.cfg));
      check('…pero sí carga el presupuesto', r.cliente === 'Cliente Ajeno');
      await page.close();
    }

    // ── La etiqueta del campo ──
    {
      const page = await nuevaPagina(browser);
      const txt = await page.evaluate(() => {
        const inp = document.getElementById('co-name');
        const lbl = inp && inp.closest('.fg') && inp.closest('.fg').querySelector('label');
        return lbl ? lbl.textContent.trim() : '(sin label)';
      });
      check('El campo se llama "Nombre de empresa"', txt === 'Nombre de empresa', txt);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
