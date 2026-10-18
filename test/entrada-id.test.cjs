// test/entrada-id.test.cjs — Editar un presupuesto no le cambia la identidad.
//
// Hasta la v252, autoSaveToHistory rehacía la entrada del historial en cada
// guardado: id nuevo (Date.now()) y solo una lista fija de campos copiados de
// la anterior. Lo que no estaba en la lista se perdía al primer retoque:
//   · versionDe / versionN → la v2 se desligaba del original (y perdía su "v2");
//   · reemplazadoPor       → abrir y tocar el original lo devolvía al mapa y a
//                            los acumulados: el mismo trabajo contado dos veces;
//   · esTrabajoPropio / tipoTrabajo → un trabajo sin presupuesto pasaba a ser
//                            presupuesto (y a contar en la conversión).
// Y el id nuevo dejaba apuntando a la nada a los eventos de Google Calendar,
// los push ya enviados, la campanita y el "Deshacer".
//
// Lo que se protege acá:
//   1. Re-guardar conserva el id, el ciclo comercial y cualquier campo que la
//      entrada tenga (también uno que esta versión de la app no conozca);
//      savedAt sí se actualiza (es la última modificación, la usa el import).
//   2. Retocar la v2 y el original no rompe los vínculos de versión.
//   3. Un trabajo sin presupuesto sigue siéndolo después de editarlo.
//   4. migrateRepararVersiones rearma los vínculos ya perdidos desde el
//      snapshot, no toca los válidos y es idempotente.
//
// Uso:  node test/entrada-id.test.cjs

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

// Un presupuesto ENVIADO y vencido, asentado en el historial.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.numPrefix = '2026-'; S.numNext = 1;
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Consorcio Rivadavia 2210';
  S.items = [{ id:1, type:'tree', species:'Tipuana', desc:'Extracción', price:'245000', qty:1 }];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); applyMode('normal');
  autoSaveToHistory();
  (function(){
    const h = getH();
    const e = h[0];
    const d = new Date(); d.setDate(d.getDate() - 20);
    e.estado = 'enviado';
    e.enviadoEn = new Date(Date.now() - 30 * 86400000).toISOString();
    e.snapshot.dateExpiry = toLocalISODate(d);
    setH(h);
  })();
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: re-guardar conserva identidad y metadata ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        const h0 = getH();
        h0[0].campoFuturo = 'de una versión más nueva';
        h0[0].savedAt = '2026-01-01T00:00:00.000Z';
        setH(h0);
        const antes = Object.assign({}, getH()[0]);
        await new Promise(r => setTimeout(r, 5));   // que Date.now() cambie
        document.getElementById('observations').value = 'retoque'; autoSaveToHistory();
        const e = getH()[0];
        return {
          n: getH().length,
          mismoId: e.id === antes.id,
          estado: e.estado, enviadoEn: e.enviadoEn === antes.enviadoEn,
          campoFuturo: e.campoFuturo,
          savedAtNuevo: e.savedAt > antes.savedAt,
          contenido: e.snapshot.observations,
        };
      })()`));
      check('Re-guardar no duplica la entrada', r.n === 1, 'entradas=' + r.n);
      check('Re-guardar conserva el id', r.mismoId);
      check('Conserva estado y fecha de envío', r.estado === 'enviado' && r.enviadoEn);
      check('Conserva un campo que esta versión no conoce', r.campoFuturo === 'de una versión más nueva');
      check('savedAt se actualiza (última modificación)', r.savedAtNuevo);
      check('El contenido nuevo queda guardado', r.contenido === 'retoque');
      await page.close();
    }

    // ── 2: retocar la v2 y el original no rompe los vínculos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 0, true);
        const v2id = getH().find(x => x.quoteNumber === '2026-0001-v2').id;
        // Retocar la v2 recién creada (lo más natural: ajustar algún precio)
        S.observations = 'retoque v2'; autoSaveToHistory();
        let v2 = getH().find(x => x.quoteNumber === '2026-0001-v2');
        const v2tras = { id: v2.id === v2id, versionDe: v2.versionDe === orig.id, versionN: v2.versionN,
                         badge: /v2/.test(versionBadgeFor(v2)) };
        // Abrir el ORIGINAL y tocarlo
        loadFromHistory(orig.id); S.observations = 'retoque original'; autoSaveToHistory();
        const o = getH().find(x => x.quoteNumber === '2026-0001');
        v2 = getH().find(x => x.quoteNumber === '2026-0001-v2');
        return { v2tras, origId: o.id === orig.id, reemplazadoPor: o.reemplazadoPor === v2.id,
                 esReemplazado: esReemplazado(o), v2sigue: v2.versionDe === o.id };
      })()`));
      check('La v2 retocada conserva su id', r.v2tras.id);
      check('La v2 retocada sigue ligada al original', r.v2tras.versionDe && r.v2tras.versionN === 2,
        JSON.stringify(r.v2tras));
      check('La v2 retocada sigue mostrando "v2"', r.v2tras.badge);
      check('El original retocado conserva su id', r.origId);
      check('El original retocado sigue reemplazado (no vuelve a contar)', r.reemplazadoPor && r.esReemplazado);
      check('Los dos vínculos siguen apuntando entre sí', r.v2sigue);
      await page.close();
    }

    // ── 3: un trabajo sin presupuesto sigue siéndolo al editarlo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const h = getH();
        Object.assign(h[0], { esTrabajoPropio: true, tipoTrabajo: 'directo', estado: 'realizado' });
        setH(h);
        loadFromHistory(h[0].id); S.observations = 'x'; autoSaveToHistory();
        const e = getH()[0];
        return { propio: e.esTrabajoPropio, tipo: e.tipoTrabajo, conv: cuentaEnConversion(e) };
      })()`));
      check('El trabajo directo editado sigue siendo trabajo directo',
        r.propio === true && r.tipo === 'directo' && r.conv === false, JSON.stringify(r));
      await page.close();
    }

    // ── 4: reparación de los vínculos ya perdidos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 0, true);
        // Daño como lo dejaba la v252: la v2 sin vínculos y el original
        // apuntando a un id que ya no existe.
        let h = getH();
        const v2 = h.find(x => x.quoteNumber === '2026-0001-v2');
        const o  = h.find(x => x.quoteNumber === '2026-0001');
        delete v2.versionDe; delete v2.versionN;
        o.reemplazadoPor = 123;
        setH(h);
        const cambios = migrateRepararVersiones();
        h = getH();
        const v2r = h.find(x => x.quoteNumber === '2026-0001-v2');
        const or  = h.find(x => x.quoteNumber === '2026-0001');
        const res = { cambios, versionDe: v2r.versionDe === or.id, versionN: v2r.versionN,
                      reemplazadoPor: or.reemplazadoPor === v2r.id };
        res.segunda = migrateRepararVersiones();
        // Un vínculo VÁLIDO no se toca, aunque no sea el que la reparación elegiría
        const otro = { id: 777, quoteNumber: 'X-1', snapshot: {}, estado: 'borrador' };
        h = getH(); h.push(otro);
        h.find(x => x.quoteNumber === '2026-0001').reemplazadoPor = 777;
        setH(h);
        migrateRepararVersiones();
        res.validoIntacto = getH().find(x => x.quoteNumber === '2026-0001').reemplazadoPor === 777;
        // Un presupuesto sin versiones no gana vínculos
        res.sinVersion = getH().find(x => x.quoteNumber === 'X-1').reemplazadoPor === undefined;
        return res;
      })()`));
      check('La reparación rearma versionDe y versionN de la v2',
        r.versionDe && r.versionN === 2, JSON.stringify(r));
      check('La reparación rearma reemplazadoPor del original', r.reemplazadoPor);
      check('La reparación es idempotente', r.cambios > 0 && r.segunda === 0, `1ª=${r.cambios} 2ª=${r.segunda}`);
      check('Un vínculo válido no se toca', r.validoIntacto);
      check('Un presupuesto sin versiones no gana vínculos', r.sinVersion);
      await page.close();
    }

  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
