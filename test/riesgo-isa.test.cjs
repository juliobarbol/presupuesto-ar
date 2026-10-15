// test/riesgo-isa.test.cjs — Informe de riesgo con la metodología de la ISA (v243).
//
// Pedido: "mañana debo hacer un informe de riesgo con trepa incluida… necesito
// que tenga una buena presentación para mostrárselo al cliente". La revisión
// encontró que la matriz de la app NO era la de la ISA aunque el documento
// decía "Método ISA Basic": en 26 de las 48 combinaciones comparables daba más
// riesgo (nunca menos). Ej.: falla probable, casa debajo, consecuencias severas
// → la app decía EXTREMO; la ISA dice ALTO.
//
// Lo que se protege acá:
//   1. La matriz nueva es exactamente la de la ISA (manual de buenas prácticas,
//      2ª ed., matrices 1 y 2), celda por celda, con una tabla escrita aparte.
//   2. Un informe ya entregado (sin `metodo`, con la evaluación cargada) sigue
//      con la matriz vieja y NO cambia de nivel al reabrirlo; uno nuevo arranca
//      con la ISA. "Pasar a la metodología ISA" corre el impacto un escalón.
//   3. Riesgo residual: el nivel después del trabajo propuesto.
//   4. Fotos por defecto: entran al backup (collectPhotoIds), se migran a
//      IndexedDB y pasan por la validación de datos importados.
//   5. El documento: nombra el método sin decir "TRAQ" (no hay credencial),
//      numera las secciones en el orden en que salen, trae las limitaciones,
//      escapa lo que escribe el usuario y el informe viejo sale como antes.
//   6. Quién evalúa y el descargo general son config del negocio: abrir un
//      presupuesto viejo no los pisa.
//
// Uso:  node test/riesgo-isa.test.cjs

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

const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Familia García';
  S.items = [{ id:1, type:'tree', species:'Eucalipto', desc:'Reducción de copa', price:'850000' }];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); setMode('riesgo');
`;

// Matrices de la ISA, escritas a mano a partir del manual (no se copian del
// código: si alguien "arregla" una celda en index.html, esto lo marca).
// Paso 1: falla × impacto (muy baja, baja, media, alta) → probabilidad combinada.
const ISA_M1 = {
  inminente:  ['improbable', 'algo',       'probable',   'muy'],
  probable:   ['improbable', 'improbable', 'algo',       'probable'],
  posible:    ['improbable', 'improbable', 'improbable', 'algo'],
  improbable: ['improbable', 'improbable', 'improbable', 'improbable'],
};
// Paso 2: combinada × consecuencias (insignif., menores, signif., severas) → nivel.
const ISA_M2 = {
  muy:        ['bajo', 'moderado', 'alto',     'extremo'],
  probable:   ['bajo', 'moderado', 'alto',     'alto'],
  algo:       ['bajo', 'bajo',     'moderado', 'moderado'],
  improbable: ['bajo', 'bajo',     'bajo',     'bajo'],
};
const IMPACTOS = ['muybaja', 'baja', 'media', 'alta'];
const CONSEC   = ['insignificantes', 'menores', 'significativas', 'severas'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: la matriz es la de la ISA, celda por celda ──
    {
      const page = await nuevaPagina(browser);
      const esperado = {};
      for (const f of Object.keys(ISA_M1)) IMPACTOS.forEach((ip, i) => CONSEC.forEach((c, j) => {
        esperado[`${f}|${ip}|${c}`] = ISA_M2[ISA_M1[f][i]][j];
      }));
      const r = await page.evaluate((esperado) => {
        const malas = [];
        Object.keys(esperado).forEach(k => {
          const [f, ip, c] = k.split('|');
          const got = calcRiskLevel(f, ip, c, 'isa2');
          if (got !== esperado[k]) malas.push(`${k}: ${got} ≠ ${esperado[k]}`);
        });
        return {
          total: Object.keys(esperado).length, malas,
          catastrofica: RISK_OPTS.isa2.consequences.some(o => o[0] === 'catastroficas'),
          impactos: RISK_OPTS.isa2.impactProbability.map(o => o[0]).join(','),
          incompleto: calcRiskLevel('probable', '', 'severas', 'isa2'),
        };
      }, esperado);
      check('Matriz ISA: las 64 combinaciones coinciden con el manual', r.total === 64 && !r.malas.length,
        r.malas.slice(0, 4).join(' | '));
      check('Con la ISA no existe "Catastróficas"', !r.catastrofica);
      check('Impacto con los 4 niveles de la ISA', r.impactos === 'muybaja,baja,media,alta', r.impactos);
      check('Sin los tres datos no hay nivel', r.incompleto === null, String(r.incompleto));
      await page.close();
    }

    // ── 2: informes viejos conservan su matriz; los nuevos usan la ISA ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        const nuevo = riskMetodo(S.riskData);
        // Snapshot de antes de la v243: sin 'metodo' y con la evaluación hecha.
        const viejo = { species:'Tipa', defects:[], failureProbability:'probable',
                        impactProbability:'alta', consequences:'severas' };
        const vacioViejo = riskMetodo({ species:'Tipa', defects:[] });
        S.riskData = JSON.parse(JSON.stringify(viejo));
        normalizeRiskData();
        const tras = S.riskData.metodo;
        const nivelViejo = riskEval(S.riskData).nivel;
        noSync = true; restoreUI(); noSync = false;
        const banner = !document.getElementById('risk-legacy').hidden;
        const optsV1 = [...document.getElementById('risk-consequences').options].map(o => o.value).join(',');
        const conservaSel = document.getElementById('risk-consequences').value;
        // Pasarlo a la ISA: la "Media" vieja (uso ocasional) es "Baja" en la ISA;
        // la "Alta" vieja juntaba frecuente y constante → se vacía para elegir.
        riskPasarAIsa();
        const trasAlta = { metodo:S.riskData.metodo, ip:S.riskData.impactProbability, banner: !document.getElementById('risk-legacy').hidden };
        S.riskData = { metodo:'v1', failureProbability:'posible', impactProbability:'media', consequences:'catastroficas', defects:[] };
        riskPasarAIsa();
        const trasMedia = { ip:S.riskData.impactProbability, c:S.riskData.consequences, nivel:riskEval(S.riskData).nivel };
        return { nuevo, vacioViejo, tras, nivelViejo, banner, optsV1, conservaSel, trasAlta, trasMedia };
      `));
      check('Un presupuesto nuevo arranca con la ISA', r.nuevo === 'isa2', r.nuevo);
      check('Uno viejo sin evaluar también (no hay nada que conservar)', r.vacioViejo === 'isa2', r.vacioViejo);
      check('Uno viejo ya evaluado queda con la matriz anterior al normalizarlo', r.tras === 'v1', r.tras);
      check('…y conserva el nivel que se le entregó (probable/alta/severas = EXTREMO)', r.nivelViejo === 'extremo', r.nivelViejo);
      check('El editor avisa que usa la matriz anterior', r.banner);
      check('…y le deja sus opciones de entonces', /catastroficas/.test(r.optsV1) && r.conservaSel === 'severas', r.optsV1);
      check('Pasar a la ISA: "Alta" vieja se vacía para elegir de nuevo',
        r.trasAlta.metodo === 'isa2' && r.trasAlta.ip === '' && !r.trasAlta.banner, JSON.stringify(r.trasAlta));
      check('Pasar a la ISA: "Media" vieja → "Baja", "Catastróficas" → "Severas"',
        r.trasMedia.ip === 'baja' && r.trasMedia.c === 'severas' && r.trasMedia.nivel === 'bajo', JSON.stringify(r.trasMedia));
      await page.close();
    }

    // ── 3: riesgo residual y lectura de la UI ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        Object.assign(S.riskData, { failureProbability:'probable', impactProbability:'alta', consequences:'severas' });
        const sinRes = riskEval(S.riskData);
        S.riskData.resFailure = 'improbable';
        const conRes = riskEval(S.riskData);
        // Bajar el impacto (mover el blanco) sin tocar la falla también cuenta.
        S.riskData.resFailure = 'probable'; S.riskData.resImpact = 'baja';
        const moverBlanco = riskEval(S.riskData).residual;
        // syncFromUI no puede borrar la evaluación si los desplegables todavía
        // no tienen opciones (antes del primer restoreUI).
        S.riskData.resFailure = ''; S.riskData.resImpact = '';
        ['risk-fail-prob','risk-impact-prob','risk-consequences'].forEach(id => document.getElementById(id).innerHTML = '');
        syncFromUI();
        const tras = [S.riskData.failureProbability, S.riskData.impactProbability, S.riskData.consequences].join('/');
        return { sinRes, conRes, moverBlanco, tras };
      `));
      check('Probable / Alta / Severas = ALTO con la ISA (la matriz vieja decía EXTREMO)',
        r.sinRes.nivel === 'alto' && r.sinRes.combinada === 'probable', JSON.stringify(r.sinRes));
      check('Sin la falla "después del trabajo" no hay residual', r.sinRes.residual === null);
      check('Residual: con la falla improbable después del trabajo queda BAJO', r.conRes.residual === 'bajo', r.conRes.residual);
      check('Residual: bajar el impacto también baja el riesgo', r.moverBlanco === 'bajo', r.moverBlanco);
      check('syncFromUI con desplegables vacíos no borra la evaluación', r.tras === 'probable/alta/severas', r.tras);
      await page.close();
    }

    // ── 4: fotos por defecto — backup, IndexedDB y validación ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const ref = await savePhoto('${PIX}');
        S.riskData.defects = [{ type:'caries', location:'base', desc:'Cavidad', altura:'1', orient:'N', photos:[ref] }];
        const ids = new Set(); collectPhotoIds(S, ids);
        const enBackup = ids.has(ref);
        const st = { riskData:{ defects:[{ type:'crack', photos:['${PIX}'] }] } };
        const migradas = migrateInlinePhotosToIDB(st);
        const migrada = st.riskData.defects[0].photos[0];
        const san = sanitizeStateObj({ riskData: {
          defects: [null, 'texto', { type:'<img>', location:'copa', desc:'ok', orient:'X', photos:['javascript:alert(1)', ref, '${PIX}'] }],
          tecnicas: ['aerea', 'aerea', 'hackeo'], nivel:'9', plazo:'999',
          impactProbability:'<b>', consequences:'catastroficas', metodo:'otro' } });
        const sd = san.riskData;
        return { enBackup, migradas, migradaEsId: /^p_/.test(migrada),
          nDef: sd.defects.length, tipo: sd.defects[0].type, orient: sd.defects[0].orient,
          fotos: sd.defects[0].photos.length, tecnicas: sd.tecnicas.join(','), nivel: sd.nivel,
          plazo: sd.plazo, ip: sd.impactProbability, cons: sd.consequences, metodo: sd.metodo };
      })()`));
      check('Las fotos de los defectos entran al backup', r.enBackup);
      check('Una foto embebida en un defecto se mueve a IndexedDB', r.migradas === 1 && r.migradaEsId);
      check('Validación: se descartan los defectos que no son objetos', r.nDef === 1, String(r.nDef));
      check('Validación: tipo, orientación y fotos por lista blanca',
        r.tipo === '' && r.orient === '' && r.fotos === 2, `${r.tipo}|${r.orient}|${r.fotos}`);
      check('Validación: técnicas sin repetir ni inventadas', r.tecnicas === 'aerea', r.tecnicas);
      check('Validación: desplegables fuera de lista quedan vacíos (y "catastróficas" se respeta para la v1)',
        r.nivel === '' && r.plazo === '12' && r.ip === '' && r.cons === 'catastroficas' && r.metodo === undefined,
        JSON.stringify(r));
      await page.close();
    }

    // ── 5: el documento ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const ref = await savePhoto('${PIX}');
        S.coEvaluador = 'Julio B. — 12 años de oficio';
        Object.assign(S.riskData, {
          species:'Eucalyptus', nivel:'3', tecnicas:['suelo','aerea'], plazo:'12',
          target:'<img src=x onerror=alert(1)>Vivienda',
          defects:[{ type:'codomin', location:'copa', desc:'Grieta <b>activa</b>', altura:'9', orient:'NE', photos:[ref] }],
          failureProbability:'probable', impactProbability:'alta', consequences:'severas',
          resFailure:'improbable', reinsp:'12', mitigationGoals:'Reducción de copa',
          limitaciones:'Cuello de raíz tapado' });
        buildDoc();
        const html = document.getElementById('doc-a4').innerHTML;
        const txt = document.getElementById('doc-a4').innerText;
        const nums = [...document.querySelectorAll('#doc-a4 .psec-t')].map(e => e.textContent.trim())
          .filter(t => /^\\d+\\./.test(t)).map(t => parseInt(t, 10));
        // Informe viejo: misma carga, matriz anterior.
        S.riskData.metodo = 'v1';
        buildDoc();
        const txtV1 = document.getElementById('doc-a4').innerText;
        return { html, txt, nums, txtV1, xss: !!document.querySelector('#doc-a4 img[src="x"]') };
      })()`));
      check('Nombra la metodología de la ISA', /Basada en la metodología de evaluación de riesgo de la ISA/.test(r.txt));
      check('No dice "TRAQ" ni "Método ISA Basic" (no hay credencial)', !/TRAQ/.test(r.txt) && !/ISA Basic/.test(r.txt));
      check('Nivel ALTO con la probabilidad combinada y qué significa',
        /\bALTO\b/.test(r.txt) && /Probabilidad de falla e impacto:\s*Probable/.test(r.txt) && /Qué significa/.test(r.txt));
      check('Riesgo actual → residual', /Riesgo actual\s*ALTO/i.test(r.txt) && /Riesgo residual[\s\S]*?BAJO/i.test(r.txt));
      check('Alcance: nivel 3, inspección aérea, plazo y evaluador',
        /Nivel 3/.test(r.txt) && /Inspección aérea con trepa/.test(r.txt) && /1 año/.test(r.txt) && /12 años de oficio/.test(r.txt));
      check('Defecto con altura, orientación y su foto',
        /a 9 m/.test(r.txt) && /orientación NE/.test(r.txt) && /prisk-defect-photos/.test(r.html));
      check('Reinspección y limitaciones (las propias y el descargo general)',
        /Reinspección recomendada/.test(r.txt) && /Cuello de raíz tapado/.test(r.txt) && /opinión técnica/.test(r.txt));
      check('Secciones numeradas en orden, sin saltos',
        r.nums.length >= 6 && r.nums.every((n, i) => n === i + 1), r.nums.join(','));
      check('Lo que escribe el usuario se escapa', !r.xss && /&lt;img/.test(r.html) && !/<b>activa/.test(r.html));
      check('Informe viejo: sale con su encabezado y su nivel de entonces',
        /ISA Basic/.test(r.txtV1) && /EXTREMO/.test(r.txtV1) && !/Alcance de la Inspección/i.test(r.txtV1) && !/Limitaciones/i.test(r.txtV1));
      await page.close();
    }

    // ── 6: evaluador y descargo son config del negocio ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        S.coEvaluador = 'Hoy'; S.docRiskLimits = 'Descargo de hoy';
        const snap = JSON.parse(JSON.stringify(S));
        snap.coEvaluador = 'De antes'; snap.docRiskLimits = 'Descargo viejo';
        assignSnapshot(S, snap);
        return { enLista: CFG_GLOBAL_FIELDS.includes('coEvaluador') && CFG_GLOBAL_FIELDS.includes('docRiskLimits'),
                 ev: S.coEvaluador, lim: S.docRiskLimits, def: /opinión técnica/.test(DEF.docRiskLimits) };
      `));
      check('Evaluador y descargo están en CFG_GLOBAL_FIELDS', r.enLista);
      check('Abrir un presupuesto viejo no los pisa', r.ev === 'Hoy' && r.lim === 'Descargo de hoy', `${r.ev} | ${r.lim}`);
      check('El descargo trae un texto por defecto', r.def);
      await page.close();
    }

  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK — riesgo-isa' : '\nFALLÓ — riesgo-isa');
  process.exit(allOk ? 0 : 1);
})();
