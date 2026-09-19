// test/notif-bitacora.test.cjs — Recientes + "Deshacer" de la campanita.
//
// La campanita se creó para dos cosas: volver a ver avisos que ya pasaron, y
// deshacer lo que se tocó sin querer. Este test cubre la segunda mitad, que
// no tenía ninguna red:
//
//   1. Toda acción reversible deja entrada en la bitácora, venga del camino
//      que venga. El caso que lo pidió: el ✓ del vencimiento dejaba
//      "Deshacer" desde la campanita y NO desde el banner — el mismo toque,
//      reversible o no según dónde se diera. Ídem visita hecha (banner sí,
//      Agenda no) y seguimiento registrado (ningún lado).
//   2. Cada "Deshacer" revierte de verdad, y el pendiente vuelve a aparecer.
//   3. Un solo toque deja UNA entrada, no dos (el banner de visitas llamaba a
//      calToggleNote y además registraba por su cuenta).
//   4. El "Deshacer" SOBREVIVE al backup. `sanitizeNotifUndo` tiene lista
//      blanca de tipos: un tipo que no esté ahí se descarta callado, y como
//      migrateSanitizeStored corre al arrancar, el botón desaparecía solo.
//   5. El `kind` de la bitácora también sobrevive (NOTIF_KINDS tenía los
//      cuatro tonos genéricos y convertía en 'info' todos los conceptos).
//
// Uso:  node test/notif-bitacora.test.cjs

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

// Un presupuesto enviado y vencido, uno aceptado con recontacto, y una visita.
const RESET = `
  setH([]); setNotes([]); setNotifLog([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  const mk = (id, num, nom, extra) => Object.assign({
    id, quoteNumber: num, clientName: nom, estado: 'enviado',
    total: 100000, savedAt: new Date().toISOString(),
    snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
      quoteNumber: num, clientName: nom, dateIssue: today(),
      dateExpiry: toLocalISODate(new Date(Date.now() - 20 * 86400000)),
      items: [], itemsB: [], estItems: [],
    }),
  }, extra || {});
  setH([
    mk(101, '2026-0001', 'Vencido Uno'),
    mk(102, '2026-0002', 'Seguir Dos', {
      enviadoEn: new Date(Date.now() - 40 * 86400000).toISOString(),
      snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
        quoteNumber: '2026-0002', clientName: 'Seguir Dos', dateIssue: today(),
        dateExpiry: toLocalISODate(new Date(Date.now() + 30 * 86400000)),
        items: [], itemsB: [], estItems: [],
      }),
    }),
    mk(103, '2026-0003', 'Llamar Tres', {
      estado: 'aceptado',
      recontactoEn: toLocalISODate(new Date(Date.now() - 3 * 86400000)),
    }),
  ]);
  setNotes([{ id: 'n_v1', fecha: today(), texto: 'Ver el fresno', tipo: 'visita' }]);
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: el ✓ del vencimiento registra desde los DOS caminos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // Camino A: el ✓ del banner de vencidos.
        marcarVencimientoVisto(101);
        const banner = getNotifLog()[0];
        // Camino B: el ✓ de la campanita, sobre otro presupuesto vencido.
        const h = getH();
        h.push({ id: 104, quoteNumber: '2026-0004', clientName: 'Vencido Cuatro',
          estado: 'enviado', total: 1, savedAt: new Date().toISOString(),
          snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
            quoteNumber: '2026-0004', dateIssue: today(),
            dateExpiry: toLocalISODate(new Date(Date.now() - 5 * 86400000)),
            items: [], itemsB: [], estItems: [] }) });
        setH(h);
        notifOpen();
        document.querySelector('#notif-dlg-body [data-nt-venc]').click();
        const panel = getNotifLog()[0];
        return {
          bannerTxt: banner && banner.text, bannerUndo: banner && banner.undo && banner.undo.type,
          panelTxt: panel && panel.text, panelUndo: panel && panel.undo && panel.undo.type,
          total: getNotifLog().length,
        };
      })()`));
      check('El ✓ del banner deja la entrada con "Deshacer"',
        /no te aviso más/.test(r.bannerTxt || '') && r.bannerUndo === 'vencVisto',
        `${r.bannerTxt} · ${r.bannerUndo}`);
      check('El ✓ de la campanita deja la misma entrada',
        /no te aviso más/.test(r.panelTxt || '') && r.panelUndo === 'vencVisto',
        `${r.panelTxt} · ${r.panelUndo}`);
      check('Dos toques, dos entradas (ni más ni menos)', r.total === 2, String(r.total));
      await page.close();
    }

    // ── 2: cada "Deshacer" revierte de verdad ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const out = {};
        const pendVenc = () => notifBuildPendientes().filter(p => p.kind === 'vencimiento').length;
        const pendSeg  = () => notifBuildPendientes().filter(p => p.kind === 'seguimiento').length;
        const pendRec  = () => notifBuildPendientes().filter(p => p.kind === 'recontacto').length;
        const pendVis  = () => notifBuildPendientes().filter(p => p.kind === 'visita').length;

        out.venc0 = pendVenc();  marcarVencimientoVisto(101);
        out.venc1 = pendVenc();  notifUndo(getNotifLog()[0].id);
        out.venc2 = pendVenc();

        out.seg0 = pendSeg();    marcarSeguimientoHecho(102);
        out.seg1 = pendSeg();    notifUndo(getNotifLog()[0].id);
        out.seg2 = pendSeg();

        out.rec0 = pendRec();    marcarRecontactoHecho(103);
        out.rec1 = pendRec();    notifUndo(getNotifLog()[0].id);
        out.rec2 = pendRec();

        out.vis0 = pendVis();    calToggleNote('n_v1');
        out.vis1 = pendVis();    notifUndo(getNotifLog()[0].id);
        out.vis2 = pendVis();

        // Marcar realizado y volver atrás (el undo más viejo).
        setEstadoHistory(103, 'realizado');
        out.estado1 = getH().find(x => x.id === 103).estado;
        notifUndo(getNotifLog()[0].id);
        out.estado2 = getH().find(x => x.id === 103).estado;
        out.deshechos = getNotifLog().filter(n => n.undoneAt).length;
        return out;
      })()`));
      check('Vencimiento: se apaga y el "Deshacer" lo revive',
        r.venc0 === 1 && r.venc1 === 0 && r.venc2 === 1, `${r.venc0}→${r.venc1}→${r.venc2}`);
      check('Seguimiento: ídem', r.seg0 === 1 && r.seg1 === 0 && r.seg2 === 1,
        `${r.seg0}→${r.seg1}→${r.seg2}`);
      check('Recontacto: ídem', r.rec0 === 1 && r.rec1 === 0 && r.rec2 === 1,
        `${r.rec0}→${r.rec1}→${r.rec2}`);
      check('Visita: ídem', r.vis0 === 1 && r.vis1 === 0 && r.vis2 === 1,
        `${r.vis0}→${r.vis1}→${r.vis2}`);
      check('Estado "realizado": vuelve al estado previo',
        r.estado1 === 'realizado' && r.estado2 === 'aceptado', `${r.estado1} → ${r.estado2}`);
      check('Los cinco quedan marcados como deshechos', r.deshechos === 5, String(r.deshechos));
      await page.close();
    }

    // ── 3: un toque = una entrada (la visita del banner no duplica) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        marcarVisitaHecha('n_v1');
        const desdeBanner = getNotifLog().length;
        const txt = getNotifLog()[0] && getNotifLog()[0].text;
        setNotifLog([]);
        // Y desde la Agenda, el mismo toque deja el mismo registro.
        calToggleNote('n_v1');   // la vuelve a desmarcar (alterna)
        const alDesmarcar = getNotifLog().length;
        calToggleNote('n_v1');   // y a marcar
        const desdeAgenda = getNotifLog().length;
        return { desdeBanner, txt, alDesmarcar, desdeAgenda };
      })()`));
      check('Cerrar la visita desde el banner deja UNA entrada',
        r.desdeBanner === 1 && /Visita marcada hecha/.test(r.txt || ''), `${r.desdeBanner} · ${r.txt}`);
      check('Desmarcarla no registra nada', r.alDesmarcar === 0, String(r.alDesmarcar));
      check('Cerrarla desde la Agenda registra igual que desde el banner',
        r.desdeAgenda === 1, String(r.desdeAgenda));
      await page.close();
    }

    // ── 4: el "Deshacer" sobrevive al backup y al arranque ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        marcarVencimientoVisto(101);
        marcarSeguimientoHecho(102);
        marcarRecontactoHecho(103);
        calToggleNote('n_v1');
        setEstadoHistory(103, 'realizado');
        const antes = getNotifLog();
        // Ida y vuelta por el sanitizador (es lo que corre al importar un
        // backup y, vía migrateSanitizeStored, en cada arranque).
        const despues = sanitizeNotifLog(JSON.parse(JSON.stringify(antes)));
        const tipos = (arr) => arr.map(n => n.undo && n.undo.type).filter(Boolean).sort();
        const kinds = (arr) => arr.map(n => n.kind).sort();
        // Y el backup entero.
        const bk = buildBackupObject();
        const enBackup = sanitizeNotifLog(JSON.parse(JSON.stringify(bk.notifLog || [])));
        return {
          nAntes: antes.length, nDespues: despues.length,
          tiposAntes: tipos(antes), tiposDespues: tipos(despues),
          kindsAntes: kinds(antes), kindsDespues: kinds(despues),
          undosEnBackup: tipos(enBackup),
        };
      })()`));
      check('La bitácora entera sobrevive al sanitizador',
        r.nAntes === 5 && r.nDespues === 5, `${r.nAntes} → ${r.nDespues}`);
      check('…y NINGÚN "Deshacer" se pierde en el camino',
        JSON.stringify(r.tiposAntes) === JSON.stringify(r.tiposDespues),
        JSON.stringify(r.tiposAntes) + ' → ' + JSON.stringify(r.tiposDespues));
      check('…ni el concepto de cada aviso (kind)',
        JSON.stringify(r.kindsAntes) === JSON.stringify(r.kindsDespues),
        JSON.stringify(r.kindsAntes) + ' → ' + JSON.stringify(r.kindsDespues));
      check('El backup se lleva los "Deshacer" completos',
        JSON.stringify(r.undosEnBackup) === JSON.stringify(r.tiposAntes),
        JSON.stringify(r.undosEnBackup));
      await page.close();
    }

    // ── 5: un "Deshacer" manipulado no toca nada ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const sucio = sanitizeNotifLog([
          { text: 'a', undo: { type: 'rm -rf', id: 101 } },
          { text: 'b', undo: { type: 'estado', id: '101) alert(1', prev: 'inventado' } },
          { text: 'c', undo: { type: 'vencVisto', id: 'no-numero' } },
        ]);
        const limpio = sanitizeNotifLog([
          { text: 'd', undo: { type: 'estado', id: '101', prev: 'inventado' } },
        ]);
        return {
          uno: sucio[0].undo, dos: sucio[1].undo, tres: sucio[2].undo,
          textos: sucio.map(n => n.text),
          okId: limpio[0].undo.id, okPrev: limpio[0].undo.prev,
        };
      })()`));
      check('Un tipo de "Deshacer" inventado se descarta', r.uno === null, JSON.stringify(r.uno));
      check('Un id manipulado tira el deshacer entero, no inventa otro',
        r.dos === null, JSON.stringify(r.dos));
      check('Un id no numérico tampoco pasa', r.tres === null, JSON.stringify(r.tres));
      check('…y la entrada de la bitácora se conserva igual (sin botón)',
        JSON.stringify(r.textos) === JSON.stringify(['a', 'b', 'c']), JSON.stringify(r.textos));
      check('Un id válido sí pasa, y el estado previo cae en la lista blanca',
        r.okId === 101 && r.okPrev === 'borrador', `${r.okId} / ${r.okPrev}`);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
