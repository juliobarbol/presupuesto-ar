// test/notif-orden.test.cjs — Orden y limpieza de los pendientes de la campanita.
//
// Reporte: "el sistema para ver las notificaciones anteriores parece que está
// funcionando mal, me muestra arriba de todo notificaciones de hace mucho
// tiempo". El panel abría en "ATRASADO · 25" con el vencimiento más VIEJO del
// historial arriba de todo (uno de marzo, mirado en septiembre).
//
// Dos causas:
//   1. Los pendientes de calBuildIndex entraban recorriendo las fechas en
//      orden ASCENDENTE y el render solo ordenaba por tipo de aviso. Al ser
//      todos vencimientos, el orden de entrada mandaba: lo más viejo primero.
//   2. El vencimiento que el usuario ya había descartado con el ✓ del banner
//      (vencimientoVistoEn) volvía igual a la campanita — el banner y el push
//      sí lo respetan. Por eso se acumulaban 25.
//
// Sobre eso, el switch "Ordenar por Fecha / Tipo": las dos lecturas del panel
// son legítimas (buscar el último aviso vs. trabajar el día por prioridad) y
// ninguna sirve para las dos cosas, así que la elige el usuario.
//
// Lo que se protege acá:
//   1. Por FECHA (el default) lo más reciente va arriba, en los dos grupos.
//   2. Por TIPO manda la prioridad del aviso, con la fecha de desempate.
//   3. El switch se guarda y se relee (y un valor manipulado no pasa).
//   4. Lo de HOY sigue arriba de todo, con cualquiera de los dos criterios.
//   5. Un vencimiento descartado no vuelve como pendiente (ni suma al badge).
//   6. La antigüedad se lee en el subtítulo ("hace 3 días", "hace 5 meses").
//   7. La cola vieja se pliega y el botón la despliega entera.
//
// Uso:  node test/notif-orden.test.cjs

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

// Historial con N presupuestos ENVIADOS, cada uno vencido hace una cantidad
// distinta de días. mkVencidos([190, 12, 3]) → el más viejo primero en el
// array, que es justamente el orden en que entraban al panel.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.numPrefix = '2026-';
  function mkVencidos(dias){
    const h = [];
    dias.forEach((d, i) => {
      const f = new Date(); f.setDate(f.getDate() - d);
      const num = '2026-' + String(i + 1).padStart(4, '0');
      h.push({
        id: 1000 + i,
        quoteNumber: num,
        clientName: 'Cliente ' + d,
        estado: 'enviado',
        // Enviado mucho antes del vencimiento y con el seguimiento ya hecho:
        // así el único pendiente que genera es el vencimiento.
        enviadoEn: new Date(Date.now() - (d + 40) * 86400000).toISOString(),
        seguimientoHechoEn: new Date(Date.now() - (d + 30) * 86400000).toISOString(),
        total: 100000,
        savedAt: new Date(Date.now() - (d + 40) * 86400000).toISOString(),
        snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
          quoteNumber: num, clientName: 'Cliente ' + d,
          dateIssue: toLocalISODate(new Date(Date.now() - (d + 40) * 86400000)),
          dateExpiry: toLocalISODate(f),
          items: [], itemsB: [], estItems: [],
        }),
      });
    });
    setH(h);
    return h;
  }
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: por fecha (el default) lo más reciente va arriba ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        mkVencidos([190, 60, 12, 3, 1]);
        const pend = notifBuildPendientes();
        const atras = pend.filter(p => p.bucket !== 'hoy').sort(_notifCmp(notifGetOrden()));
        return {
          orden: notifGetOrden(),
          n: atras.length,
          dias: atras.map(p => p.dias),
          entrada: pend.filter(p => p.bucket !== 'hoy').map(p => p.dias),
          subs: atras.map(p => p.sub),
        };
      })()`));
      check('Sin preferencia guardada ordena por fecha', r.orden === 'fecha', r.orden);
      check('Los 5 vencidos entran como atrasados', r.n === 5, String(r.n));
      check('El más reciente queda arriba y el más viejo al fondo',
        JSON.stringify(r.dias) === JSON.stringify([1, 3, 12, 60, 190]), JSON.stringify(r.dias));
      check('El subtítulo dice la antigüedad, no solo "atrasado"',
        /hace 3 días/.test(r.subs[1] || '') && /hace \d+ meses/.test(r.subs[4] || ''),
        JSON.stringify(r.subs));
      await page.close();
    }

    // ── 1b: el switch cambia el criterio (fecha ↔ tipo) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // Tres avisos atrasados de tipo distinto, para que los dos criterios
        // den órdenes distintos: vencimiento hace 100, seguimiento hace 3,
        // recontacto hace 20.
        const h = mkVencidos([100]);
        const cfg = getFollowupCfg();
        h.push({
          id: 2001, quoteNumber: '2026-0090', clientName: 'Seguimiento',
          estado: 'enviado',
          enviadoEn: new Date(Date.now() - (3 + (cfg.days || 0)) * 86400000).toISOString(),
          total: 1, savedAt: new Date().toISOString(),
          snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
            quoteNumber: '2026-0090', dateIssue: today(),
            dateExpiry: toLocalISODate(new Date(Date.now() + 30 * 86400000)),
            items: [], itemsB: [], estItems: [],
          }),
        });
        h.push({
          id: 2002, quoteNumber: '2026-0091', clientName: 'Recontacto',
          estado: 'aceptado',
          recontactoEn: toLocalISODate(new Date(Date.now() - 20 * 86400000)),
          total: 1, savedAt: new Date().toISOString(),
          snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
            quoteNumber: '2026-0091', dateIssue: today(),
            dateExpiry: toLocalISODate(new Date(Date.now() + 30 * 86400000)),
            items: [], itemsB: [], estItems: [],
          }),
        });
        setH(h);
        const atrasCon = (o) => notifBuildPendientes()
          .filter(p => p.bucket !== 'hoy').sort(_notifCmp(o));
        const porFecha = atrasCon('fecha');
        const porTipo  = atrasCon('tipo');
        // El switch persiste y se relee.
        notifSetOrden('tipo');
        const guardado = notifGetOrden();
        notifSetOrden('fecha');
        const vuelta = notifGetOrden();
        // Un valor manipulado en localStorage no pasa.
        localStorage.setItem(LS.NOTIF_ORDEN, 'alert(1)');
        const sucio = notifGetOrden();
        return {
          fechaDias: porFecha.map(p => p.dias),
          fechaKinds: porFecha.map(p => p.kind),
          tipoKinds: porTipo.map(p => p.kind),
          tipoDias: porTipo.map(p => p.dias),
          guardado, vuelta, sucio,
        };
      })()`));
      check('Por fecha: el más reciente primero, sin mirar el tipo',
        JSON.stringify(r.fechaDias) === JSON.stringify([3, 20, 100]),
        JSON.stringify(r.fechaDias) + ' ' + JSON.stringify(r.fechaKinds));
      check('Por tipo: recontacto → seguimiento → vencimiento',
        JSON.stringify(r.tipoKinds) === JSON.stringify(['recontacto', 'seguimiento', 'vencimiento']),
        JSON.stringify(r.tipoKinds));
      check('…y los mismos avisos, solo reordenados',
        JSON.stringify(r.tipoDias) === JSON.stringify([20, 3, 100]), JSON.stringify(r.tipoDias));
      check('El switch se guarda y se relee', r.guardado === 'tipo' && r.vuelta === 'fecha',
        `${r.guardado} → ${r.vuelta}`);
      check('Un valor manipulado cae en el default', r.sucio === 'fecha', r.sucio);
      await page.close();
    }

    // ── 2: lo de HOY manda, con cualquiera de los dos criterios ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const h = mkVencidos([100, 4]);
        // Un trabajo agendado para hoy + una visita de hoy.
        h[0].fechaTrabajo = today();
        h[0].estado = 'aceptado';
        setH(h);
        setNotes([{ id:'n1', fecha: today(), texto:'Ver el fresno', tipo:'visita' }]);
        const pend = notifBuildPendientes();
        const hoyCon = (o) => pend.filter(p => p.bucket === 'hoy').sort(_notifCmp(o));
        return {
          kindsTipo: hoyCon('tipo').map(p => p.kind),
          kindsFecha: hoyCon('fecha').map(p => p.kind),
          todosHoy: pend.filter(p => p.bucket === 'hoy').every(p => p.dias === 0),
          atras: pend.filter(p => p.bucket !== 'hoy').length,
        };
      })()`));
      check('El trabajo de hoy va antes que la visita de hoy',
        r.kindsTipo.indexOf('trabajo') === 0 && r.kindsTipo.indexOf('visita') === 1,
        JSON.stringify(r.kindsTipo));
      check('Siendo todos del mismo día, por fecha quedan igual',
        JSON.stringify(r.kindsFecha) === JSON.stringify(r.kindsTipo), JSON.stringify(r.kindsFecha));
      check('Todo lo del bucket "hoy" tiene 0 días de atraso', r.todosHoy);
      await page.close();
    }

    // ── 3: el vencimiento descartado con el ✓ no vuelve ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const h = mkVencidos([190, 120, 5]);
        const antes = notifBuildPendientes().length;
        const badgeAntes = notifBuildPendientes().filter(p => p.kind === 'vencimiento').length;
        // El usuario cierra los dos más viejos desde el banner.
        const hh = getH();
        hh[0].vencimientoVistoEn = new Date().toISOString();
        hh[1].vencimientoVistoEn = new Date().toISOString();
        setH(hh);
        const pend = notifBuildPendientes();
        return {
          antes, badgeAntes,
          despues: pend.length,
          dias: pend.map(p => p.dias),
          banner: getExpiredQuotes().length,
        };
      })()`));
      check('Antes del descarte los 3 vencimientos son pendientes',
        r.antes === 3 && r.badgeAntes === 3, `${r.antes}/${r.badgeAntes}`);
      check('Descartar con el ✓ los saca de la campanita',
        r.despues === 1 && JSON.stringify(r.dias) === JSON.stringify([5]),
        `${r.despues} → ${JSON.stringify(r.dias)}`);
      check('…igual que del banner de vencidos (mismo criterio)', r.banner === 1, String(r.banner));
      await page.close();
    }

    // ── 4: la cola vieja se pliega y el botón la despliega ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const dias = [];
        for (let i = 1; i <= 25; i++) dias.push(i * 7);
        mkVencidos(dias);
        notifOpen();
        const body = document.getElementById('notif-dlg-body');
        const plegado = body.querySelectorAll('.nt-item').length;
        const btn = body.querySelector('.nt-clear[onclick*="notifVerAtrasado"]');
        const txtBtn = btn ? btn.textContent : '';
        notifVerAtrasado();
        const abierto = document.getElementById('notif-dlg-body').querySelectorAll('.nt-item').length;
        // Reabrir vuelve a plegar.
        notifClose(); notifOpen();
        const rePlegado = document.getElementById('notif-dlg-body').querySelectorAll('.nt-item').length;
        // El primero de la lista es el vencido hace 7 días, no el de 175.
        const primero = document.getElementById('notif-dlg-body').querySelector('.nt-item .nt-sub');
        return { plegado, txtBtn, abierto, rePlegado, primero: primero ? primero.textContent : '' };
      })()`));
      check('Con 25 atrasados el panel muestra solo los primeros 8',
        r.plegado === 8, String(r.plegado));
      check('El botón ofrece ver los 17 más viejos',
        /17/.test(r.txtBtn), r.txtBtn);
      check('Al tocarlo se ven los 25', r.abierto === 25, String(r.abierto));
      check('Al reabrir el panel vuelve a plegarse', r.rePlegado === 8, String(r.rePlegado));
      check('El primero de la lista es el vencido hace 7 días',
        /hace 7 días/.test(r.primero), r.primero);
      await page.close();
    }

    // ── 4b: el switch se dibuja en el panel y el toque lo cambia ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        // Vencimiento hace 5 días (lo más RECIENTE) + recontacto hace 20 (el
        // de MÁS prioridad): cada criterio pone uno distinto arriba, así el
        // toque del switch se ve de verdad.
        const h = mkVencidos([5]);
        h.push({
          id: 2002, quoteNumber: '2026-0091', clientName: 'Recontacto',
          estado: 'aceptado',
          recontactoEn: toLocalISODate(new Date(Date.now() - 20 * 86400000)),
          total: 1, savedAt: new Date().toISOString(),
          snapshot: Object.assign(JSON.parse(JSON.stringify(DEF)), {
            quoteNumber: '2026-0091', dateIssue: today(),
            dateExpiry: toLocalISODate(new Date(Date.now() + 30 * 86400000)),
            items: [], itemsB: [], estItems: [],
          }),
        });
        setH(h);
        notifOpen();
        const body = () => document.getElementById('notif-dlg-body');
        const activo = () => { const b = body().querySelector('.nt-ord-b.active'); return b ? b.textContent : ''; };
        const primero = () => { const t = body().querySelector('.nt-item .nt-txt'); return t ? t.textContent : ''; };
        const secs = () => Array.from(body().querySelectorAll('.nt-sec')).map(e => e.textContent);
        const haySwitch = !!body().querySelector('.nt-ord');
        const act1 = activo(), p1 = primero(), secs1 = secs();
        // Toque real sobre el botón "Tipo".
        Array.from(body().querySelectorAll('.nt-ord-b'))
          .find(b => b.textContent === 'Tipo').click();
        const act2 = activo(), p2 = primero(), secs2 = secs();
        // Cerrar y reabrir: la elección se mantiene (es preferencia, no estado
        // de sesión como el plegado).
        notifClose(); notifOpen();
        return { haySwitch, act1, p1, secs1, act2, p2, secs2, act3: activo(), p3: primero() };
      })()`));
      check('El panel dibuja el switch de orden', r.haySwitch);
      check('Los grupos cambian con el criterio',
        r.secs1.join('|') === 'Atrasado · 2|Recientes' &&
        r.secs2.join('|') === 'Recontactos · 1|Vencimientos · 1|Recientes',
        JSON.stringify(r.secs1) + ' → ' + JSON.stringify(r.secs2));
      check('Arranca en Fecha y muestra primero el vencimiento (hace 5 días)',
        r.act1 === 'Fecha' && /^Vence/.test(r.p1), `${r.act1} · ${r.p1}`);
      check('Tocar "Tipo" sube el recontacto, que tiene más prioridad',
        r.act2 === 'Tipo' && /Recontactar/.test(r.p2), `${r.act2} · ${r.p2}`);
      check('La elección sobrevive al cierre del panel',
        r.act3 === 'Tipo', r.act3);
      await page.close();
    }

    // ── 4c: con TODOS los avisos del mismo tipo, el switch igual se nota ──
    // El reporte que lo pidió: los 4 pendientes eran vencimientos, así que los
    // dos criterios daban la misma lista y el control parecía roto. El modo
    // "tipo" no solo reordena: agrupa, y el encabezado lo dice.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        mkVencidos([56, 62, 95, 125]);
        notifOpen();
        const secs = () => Array.from(document.querySelectorAll('#notif-dlg-body .nt-sec')).map(e => e.textContent);
        const txts = () => Array.from(document.querySelectorAll('#notif-dlg-body .nt-item .nt-txt')).map(e => e.textContent);
        const fecha = { secs: secs(), txts: txts() };
        Array.from(document.querySelectorAll('.nt-ord-b')).find(b => b.textContent === 'Tipo').click();
        return { fecha, tipo: { secs: secs(), txts: txts() } };
      })()`));
      check('Por fecha el grupo es "Atrasado · 4"',
        r.fecha.secs[0] === 'Atrasado · 4', JSON.stringify(r.fecha.secs));
      check('Por tipo pasa a ser "Vencimientos · 4" — la pantalla cambia',
        r.tipo.secs[0] === 'Vencimientos · 4', JSON.stringify(r.tipo.secs));
      check('…y siendo todos del mismo tipo, el orden interno no se toca',
        JSON.stringify(r.tipo.txts) === JSON.stringify(r.fecha.txts), JSON.stringify(r.tipo.txts));
      await page.close();
    }

    // ── 4d: un vencimiento SIN enviadoEn se ve y se puede cerrar ──
    // El caso del backup real: 4 presupuestos en estado "enviado" pero sin el
    // sello `enviadoEn` (son anteriores a que ese sello existiera). La
    // campanita los mostraba y el banner no, así que no tenían ✓ por ningún
    // lado: quedaban arriba del panel para siempre. Ahora el criterio es el
    // mismo en los dos, y el ✓ está también en el aviso.
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        const h = mkVencidos([56, 101]);
        delete h[0].enviadoEn;   // el legacy: estado "enviado", sin el sello
        delete h[1].enviadoEn;
        setH(h);
        const banner = getExpiredQuotes().map(v => v.entry.quoteNumber);
        const pend = notifBuildPendientes().map(p => p.text);
        notifOpen();
        const body = () => document.getElementById('notif-dlg-body');
        const btns = body().querySelectorAll('[data-nt-venc]').length;
        const antes = body().querySelectorAll('.nt-item').length;
        body().querySelector('[data-nt-venc]').click();
        const log = getNotifLog()[0];
        const despues = notifBuildPendientes().length;
        // Y el "Deshacer" lo revive.
        notifUndo(log.id);
        return {
          banner, pend, btns, antes, despues,
          logTxt: log.text, undoTipo: log.undo && log.undo.type,
          trasUndo: notifBuildPendientes().length,
          bannerFinal: getExpiredQuotes().length,
        };
      })()`));
      check('Sin enviadoEn, el banner de vencidos igual los muestra',
        r.banner.length === 2, JSON.stringify(r.banner));
      check('…y la campanita muestra los mismos',
        r.pend.length === 2, JSON.stringify(r.pend));
      check('Cada vencimiento trae su ✓ en el panel', r.btns === 2, String(r.btns));
      check('El ✓ lo descarta y queda en Recientes',
        r.despues === 1 && /no te aviso más/.test(r.logTxt), `${r.despues} · ${r.logTxt}`);
      check('El descarte se puede deshacer',
        r.undoTipo === 'vencVisto' && r.trasUndo === 2 && r.bannerFinal === 2,
        `${r.trasUndo} pendientes · ${r.bannerFinal} en el banner`);
      await page.close();
    }

    // ── 5: el badge no cuenta lo descartado ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        mkVencidos([30, 10, 2]);
        localStorage.removeItem(LS.NOTIF_SEEN);
        updateNotifBadge();
        const b = document.getElementById('notif-badge');
        const antes = b.textContent;
        const hh = getH(); hh.forEach(e => { e.vencimientoVistoEn = new Date().toISOString(); }); setH(hh);
        updateNotifBadge();
        return { antes, despues: b.textContent, oculto: b.hidden };
      })()`));
      check('El badge cuenta los 3 vencimientos', r.antes === '3', r.antes);
      check('…y se apaga cuando se descartan todos',
        r.despues === '0' && r.oculto, `${r.despues} oculto:${r.oculto}`);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
