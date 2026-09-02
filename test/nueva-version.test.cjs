// test/nueva-version.test.cjs — Segunda versión de un presupuesto vencido.
//
// Pedido: "hay veces en las que un presupuesto ya se venció y el cliente me
// contacta, o porque quiere realizar el trabajo o porque quiere preguntar si
// el precio se actualizó. Me gustaría poder hacer una segunda versión de ese
// presupuesto para mandársela".
//
// El modelo es el de las revisiones de obra (Rev. A / Rev. B) y el de las
// versiones de cotización de cualquier CRM: la versión nueva es OTRO
// presupuesto ligado al anterior, y el anterior queda marcado como
// reemplazado. Lo que se protege acá:
//
//   1. La v2 se crea ligada al original: número con sufijo, emitida hoy,
//      vigencia nueva, y el viejo marcado como reemplazado (y fuera del banner
//      de vencidos: el pendiente pasó a la versión nueva).
//   2. La actualización de precios corre sobre TODOS los precios (escenario A,
//      escenario B y estimativo) y el total que queda en el historial es el
//      mismo que calcula el documento — el bug C2 fue justamente un total
//      recalculado a mano que no coincidía con el PDF.
//   3. El redondeo deja cifras de oficio (miles), no $554.600.
//   4. Una versión NO consume número correlativo: el próximo presupuesto nuevo
//      sigue donde correspondía.
//   5. El PDF aclara a qué presupuesto actualiza (y el toggle lo saca).
//   6. El número del presupuesto anterior se ESCAPA en el documento.
//   7. Al enviar una versión por WhatsApp sale la plantilla de actualización,
//      y si el usuario la edita sale la suya.
//   8. Guardar la config de seguimiento no pisa esa plantilla.
//   9. El presupuesto reemplazado no suma dos veces al acumulado del cliente.
//  10. Un snapshot anterior a la función no hereda la referencia del
//      presupuesto que estaba abierto (misma trampa que la disposición).
//
// Uso:  node test/nueva-version.test.cjs

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

// Estado limpio + un presupuesto ENVIADO que venció hace 20 días, que es la
// situación exacta que dispara la función.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.numPrefix = '2026-'; S.numNext = 1;
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.coName = 'Poda en Altura AR';
  S.clientName = 'Consorcio Rivadavia 2210';
  S.clientContact = '3543 68-0871';
  S.items = [
    { id:1, type:'tree',    species:'Tipuana', desc:'Extracción', price:'245000', qty:1 },
    { id:2, type:'service', desc:'Volquete',   price:'62000', qty:2 },
    { id:3, type:'note',    desc:'Sin precio' },
  ];
  noSync = true; restoreUI(); noSync = false;
  renderItems(); renderEstItems(); applyMode('normal');
  autoSaveToHistory();
  // Envidado y vencido: fecha de vencimiento 20 días atrás.
  (function(){
    const h = getH();
    const e = h.find(x => x.quoteNumber === S.quoteNumber);
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

    // ── 1: la versión queda ligada y el viejo sale del banner de vencidos ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        const vencAntes = getExpiredQuotes().length;
        crearNuevaVersion(orig, 0, true);
        const h = getH();
        const v2 = h.find(x => x.quoteNumber === '2026-0001-v2');
        const o  = h.find(x => x.id === orig.id);
        return {
          num: v2 && v2.quoteNumber,
          versionDe: v2 && v2.versionDe === orig.id,
          versionN: v2 && v2.versionN,
          estado: v2 && v2.estado,
          emitidaHoy: v2 && v2.snapshot.dateIssue === today(),
          venceDespues: v2 && v2.snapshot.dateExpiry > today(),
          reemplazadoPor: o && o.reemplazadoPor === v2.id,
          vistoMarcado: !!(o && o.vencimientoVistoEn),
          vencAntes, vencDespues: getExpiredQuotes().length,
          // El seguimiento también pasa a la versión: el viejo no puede
          // seguir pidiendo que se llame al cliente por lo mismo.
          segViejo: getPendingFollowups().some(p => p.entry.id === orig.id),
          badgeSeg: followupBadgeFor(getH().find(x => x.id === orig.id)),
          abierta: S.quoteNumber,
          refNum: S.versionDeNum, refFecha: S.versionDeFecha,
        };
      })()`));
      check('La v2 lleva el mismo número con sufijo', r.num === '2026-0001-v2', String(r.num));
      check('Queda ligada al original (versionDe + versionN)', r.versionDe && r.versionN === 2, 'v' + r.versionN);
      check('Nace como borrador, emitida hoy y con vigencia nueva',
        r.estado === 'borrador' && r.emitidaHoy && r.venceDespues,
        `${r.estado} · hoy:${r.emitidaHoy} · vigente:${r.venceDespues}`);
      check('El original queda marcado como reemplazado', r.reemplazadoPor && r.vistoMarcado);
      check('…y deja de reclamar en el banner de vencidos',
        r.vencAntes === 1 && r.vencDespues === 0, `${r.vencAntes} → ${r.vencDespues}`);
      check('…ni pide seguimiento (el pendiente pasó a la versión)',
        !r.segViejo && r.badgeSeg === '', `pendiente:${r.segViejo} badge:"${r.badgeSeg}"`);
      check('La versión queda abierta en el editor con la referencia cargada',
        r.abierta === '2026-0001-v2' && r.refNum === '2026-0001' && !!r.refFecha,
        `${r.abierta} ← ${r.refNum} ${r.refFecha}`);
      await page.close();
    }

    // ── 2: los precios se actualizan en los 3 juegos de ítems ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // Escenario B y estimativo cargados: la actualización tiene que
        // alcanzarlos (si no, el PDF de un presupuesto con dos opciones sale
        // con una actualizada y la otra del año pasado).
        S.scenariosEnabled = true;
        S.itemsB = [{ id:9, type:'tree', species:'Fresno', price:'180000', qty:1 }];
        S.estItems = [
          { id:11, type:'work',    desc:'Poda de altura', price:'300000' },
          { id:12, type:'service', desc:'Chipeadora',     price:'40000', qty:2 },
        ];
        autoSaveToHistory();
        const orig = getH().find(x => x.quoteNumber === '2026-0001');
        crearNuevaVersion(orig, 20, true);
        const v2 = getH().find(x => x.quoteNumber === '2026-0001-v2');
        return {
          arbol:   S.items[0].price,      // 245.000 +20% = 294.000
          serv:    S.items[1].price,      // 62.000  +20% = 74.400 → 74.000
          nota:    S.items[2].price === undefined || S.items[2].price === '' || !S.items[2].price,
          b:       S.itemsB[0].price,     // 180.000 +20% = 216.000
          estWork: S.estItems[0].price,   // 300.000 +20% = 360.000
          estSvc:  S.estItems[1].price,   // 40.000  +20% = 48.000
          // El total del historial tiene que salir de la MISMA cuenta que el
          // documento (calcTotals), no de una suma paralela.
          totalHist: v2.total,
          totalCalc: calcTotals(S.items).total,
          // Y el original, intacto.
          origArbol: getH().find(x => x.quoteNumber === '2026-0001').snapshot.items[0].price,
        };
      })()`));
      check('Actualiza los ítems del escenario A', r.arbol === 294000, String(r.arbol));
      check('…los del escenario B', r.b === 216000, String(r.b));
      check('…y los del estimativo (trabajos y servicios)',
        r.estWork === 360000 && r.estSvc === 48000, `${r.estWork} / ${r.estSvc}`);
      check('Las notas no tienen precio que actualizar', r.nota);
      check('El total guardado coincide con el que calcula el documento',
        r.totalHist === r.totalCalc && r.totalHist > 0, `${r.totalHist} vs ${r.totalCalc}`);
      check('El presupuesto original queda intacto', r.origArbol === '245000', String(r.origArbol));
      await page.close();
    }

    // ── 3: redondeo a cifras de oficio ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 13, true);   // 245.000 +13% = 276.850
        return {
          arbol: S.items[0].price,
          serv:  S.items[1].price,           // 62.000 +13% = 70.060
          chico: (function(){ const o = { type:'service', price:'8300' };
                              ajustarPreciosEn({ items:[o] }, 13); return o.price; })(),
          cero:  (function(){ const o = { type:'tree', price:'' };
                              ajustarPreciosEn({ items:[o] }, 50); return o.price; })(),
        };
      })()`));
      check('Redondea al millar los importes grandes', r.arbol === 277000 && r.serv === 70000,
        `${r.arbol} / ${r.serv}`);
      check('…y a la centena los chicos (un flete de $8.300)', r.chico === 9400, String(r.chico));
      check('Un ítem sin precio queda sin precio', r.cero === '');
      await page.close();
    }

    // ── 4: una versión no consume número correlativo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 0, true);
        const siguiente = calcNextNumFromHistory();
        // Y una versión de la versión sigue la cadena.
        const v2 = getH().find(x => x.quoteNumber === '2026-0001-v2');
        crearNuevaVersion(v2, 0, true);
        return {
          siguiente,
          v3: S.quoteNumber,
          refV3: S.versionDeNum,
          base: numBaseSinVersion('2026-0001-v12'),
        };
      })()`));
      check('El próximo presupuesto nuevo sigue siendo el 2 (no el 3)',
        r.siguiente === 2, String(r.siguiente));
      check('La versión de una versión encadena a v3', r.v3 === '2026-0001-v3' && r.refV3 === '2026-0001-v2',
        `${r.v3} ← ${r.refV3}`);
      check('numBaseSinVersion saca el sufijo', r.base === '2026-0001', r.base);
      await page.close();
    }

    // ── 5 y 6: el documento aclara a qué actualiza, y escapa ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 10, true);
        buildDoc();
        const con = document.getElementById('doc-a4').innerHTML;
        S.versionEnDoc = false; buildDoc();
        const sin = document.getElementById('doc-a4').innerHTML;
        // Los otros dos modos también la llevan.
        S.versionEnDoc = true;
        S.isEstimative = true; buildDoc();
        const est = document.getElementById('doc-a4').innerHTML;
        S.isEstimative = false; S.isRisk = true; buildDoc();
        const rie = document.getElementById('doc-a4').innerHTML;
        S.isRisk = false;
        // Un número de presupuesto envenenado (backup ajeno) no puede inyectar.
        S.versionDeNum = '<img src=x onerror=alert(1)>';
        buildDoc();
        const doc = document.getElementById('doc-a4');
        return {
          con: con.includes('Actualiza el presupuesto N° 2026-0001'),
          sin: !sin.includes('Actualiza el presupuesto'),
          est: est.includes('Actualiza el presupuesto N° 2026-0001'),
          rie: rie.includes('Actualiza el presupuesto N° 2026-0001'),
          imgs: doc.querySelectorAll('img[onerror]').length,
          crudo: doc.innerHTML.includes('&lt;img'),
        };
      })()`));
      check('El documento dice a qué presupuesto actualiza', r.con);
      check('El toggle lo saca sin borrar el dato', r.sin);
      check('También sale en estimativo y en riesgo', r.est && r.rie, `est:${r.est} riesgo:${r.rie}`);
      check('El número anterior se escapa (no inyecta)', r.imgs === 0 && r.crudo);
      await page.close();
    }

    // ── 7: el WhatsApp de una versión usa la plantilla de actualización ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const abiertas = [];
        window.open = (u) => { abiertas.push(u); return null; };
        // Presupuesto normal → plantilla de envío
        _sendCurrentWhatsappGo();
        const original = decodeURIComponent(abiertas.pop() || '');
        const orig = getH()[0];
        crearNuevaVersion(orig, 15, true);
        _sendCurrentWhatsappGo();
        const version = decodeURIComponent(abiertas.pop() || '');
        // Y el colega que quiere otro texto lo edita.
        const cfg = getFollowupCfg();
        cfg.waActualizacionTemplate = 'Che {cliente}, te paso el precio nuevo. {empresa}';
        setFollowupCfg(cfg);
        _sendCurrentWhatsappGo();
        const propio = decodeURIComponent(abiertas.pop() || '');
        return {
          original: original.includes('Te paso el presupuesto N°'),
          version: version.includes('presupuesto actualizado con los valores al día de hoy'),
          propio: propio.includes('Che Consorcio Rivadavia 2210, te paso el precio nuevo'),
          conCliente: version.includes('Consorcio Rivadavia 2210'),
        };
      })()`));
      check('Un presupuesto normal sigue usando la plantilla de envío', r.original);
      check('Una versión usa la de actualización', r.version && r.conCliente);
      check('…y si el colega la edita, sale la suya', r.propio);
      await page.close();
    }

    // ── 8: guardar el seguimiento no pisa la plantilla ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        const cfg = getFollowupCfg();
        cfg.waActualizacionTemplate = 'MI TEXTO';
        cfg.waCobroTemplate = 'MI COBRO';
        setFollowupCfg(cfg);
        // El usuario cambia los días del seguimiento en Empresa.
        loadFollowupUI();
        document.getElementById('fu-days').value = '15';
        saveFollowupFromUI();
        const after = getFollowupCfg();
        // Y sobreviven la ida y vuelta por el backup (el saneado descarta lo
        // que no está en su lista blanca: una plantilla afuera se perdía al
        // restaurar en el teléfono nuevo).
        const bk = JSON.parse(JSON.stringify(buildBackupObject()));
        setFollowupCfg(Object.assign({}, FOLLOWUP_DEF));
        applyBackupObject(bk);
        const post = getFollowupCfg();
        return {
          act: after.waActualizacionTemplate, cobro: after.waCobroTemplate, dias: after.days,
          bkAct: post.waActualizacionTemplate, bkCobro: post.waCobroTemplate,
        };
      })()`));
      check('Cambiar los días del seguimiento no borra las plantillas',
        r.act === 'MI TEXTO' && r.cobro === 'MI COBRO' && r.dias === 15,
        `${r.act} / ${r.cobro} / ${r.dias}d`);
      check('Las plantillas sobreviven al backup y su restauración',
        r.bkAct === 'MI TEXTO' && r.bkCobro === 'MI COBRO', `${r.bkAct} / ${r.bkCobro}`);
      await page.close();
    }

    // ── 9: el reemplazado no cuenta dos veces ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 20, true);   // el total cambia: 369.000 → 442.000
        switchTab('historial');
        const f = document.getElementById('hist-client-filter');
        f.value = 'Consorcio Rivadavia 2210';
        renderHistory();
        const txt = document.getElementById('history-list').textContent;
        const v2 = getH().find(x => x.quoteNumber === '2026-0001-v2');
        // Y lo mismo en el subtotal del mes (sin filtros, agrupado).
        f.value = ''; renderHistory();
        const mes = document.querySelector('.hmonth-total').textContent;
        return {
          acumulado: txt.includes(fmtM(v2.total, 'ARS')),
          doble: txt.includes(fmtM(v2.total * 2, 'ARS')),
          mes: mes.trim(), mesEsperado: fmtM(v2.total, 'ARS'),
          badge: !!document.querySelector('.hbadge-reemplazado'),
          badgeV2: !!document.querySelector('.hbadge-version'),
        };
      })()`));
      check('El acumulado del cliente cuenta la versión una sola vez',
        r.acumulado && !r.doble, `una:${r.acumulado} doble:${r.doble}`);
      check('…y el subtotal del mes tampoco lo cuenta dos veces',
        r.mes === r.mesEsperado, `${r.mes} (esperado ${r.mesEsperado})`);
      check('Las tarjetas muestran "v2" y "reemplazado"', r.badge && r.badgeV2);
      await page.close();
    }

    // ── 10: un snapshot viejo no hereda la referencia ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        crearNuevaVersion(orig, 10, true);
        // Con la versión abierta, se carga un presupuesto ANTERIOR a la
        // función (snapshot sin los campos de versión).
        const h = getH();
        const viejo = h.find(x => x.quoteNumber === '2026-0001');
        delete viejo.snapshot.versionN;
        delete viejo.snapshot.versionDeNum;
        delete viejo.snapshot.versionDeFecha;
        setH(h);
        loadFromHistory(viejo.id);
        buildDoc();
        return {
          n: S.versionN, num: S.versionDeNum,
          doc: document.getElementById('doc-a4').innerHTML.includes('Actualiza el presupuesto'),
        };
      })()`));
      check('Abrir un presupuesto viejo no hereda la referencia de la versión',
        (!r.n || r.n < 2) && !r.num && !r.doc, `v${r.n} ← "${r.num}" doc:${r.doc}`);
      await page.close();
    }

    // ── 11: el diálogo (atajos, cuenta y confirmación) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const orig = getH()[0];
        nuevaVersionQuote(orig.id);
        const abierto = document.getElementById('nv-overlay').classList.contains('open');
        nvSetPct(20);
        const viejo = document.getElementById('nv-prev-old').textContent;
        const nuevo = document.getElementById('nv-prev-new').textContent;
        const chipOn = document.querySelectorAll('.nv-chip.is-active').length;
        nvConfirm();
        const cerrado = !document.getElementById('nv-overlay').classList.contains('open');
        return {
          abierto, cerrado, chipOn, viejo, nuevo,
          creada: S.quoteNumber,
          precio: S.items[0].price,
          recordado: localStorage.getItem(LS.VER_PCT),
        };
      })()`));
      check('El diálogo abre y cierra al confirmar', r.abierto && r.cerrado);
      check('Los atajos marcan el % elegido', r.chipOn === 1, String(r.chipOn));
      // 245.000 + 62.000×2 = 369.000, y con +20% redondeado = 442.000.
      check('La cuenta muestra el total viejo y el nuevo',
        /369\.000/.test(r.viejo) && /442\.000/.test(r.nuevo), `${r.viejo} → ${r.nuevo}`);
      check('Confirmar crea la versión con ese %', r.creada === '2026-0001-v2' && r.precio === 294000,
        `${r.creada} · ${r.precio}`);
      check('Recuerda el último % usado para la próxima', r.recordado === '20', String(r.recordado));
      await page.close();
    }

    // ── 12: la cadena de versiones sobrevive el cambio de dispositivo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        crearNuevaVersion(getH()[0], 20, true);
        const bk = JSON.parse(JSON.stringify(buildBackupObject()));
        setH([]);
        applyBackupObject(bk);
        const h = getH();
        const v2 = h.find(x => x.quoteNumber === '2026-0001-v2');
        const o  = h.find(x => x.quoteNumber === '2026-0001');
        // Un backup manipulado no puede meter un id inventado en el onclick.
        const sucio = sanitizeHistory([{ id: 1, quoteNumber: 'x',
          versionDe: '2) alert(1', reemplazadoPor: { malo: true }, versionN: 'dos' }])[0];
        return {
          liga: !!(v2 && o && v2.versionDe === o.id && o.reemplazadoPor === v2.id),
          n: v2 && v2.versionN,
          refNum: v2 && v2.snapshot.versionDeNum,
          refFecha: !!(v2 && v2.snapshot.versionDeFecha),
          sucioDe: sucio.versionDe, sucioPor: sucio.reemplazadoPor, sucioN: sucio.versionN,
        };
      })()`));
      check('Los vínculos entre versiones sobreviven al backup',
        r.liga && r.n === 2, `liga:${r.liga} v${r.n}`);
      check('…y la referencia que se imprime también',
        r.refNum === '2026-0001' && r.refFecha, `${r.refNum}`);
      check('Un vínculo manipulado se descarta (no inventa un id)',
        r.sucioDe === undefined && r.sucioPor === undefined && r.sucioN === 0,
        `${r.sucioDe} / ${r.sucioPor} / ${r.sucioN}`);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
