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
// Lo que se protege acá:
//   1. En "Atrasado" manda la fecha: lo más reciente arriba.
//   2. Lo de HOY sigue arriba de todo y ordenado por prioridad de tipo.
//   3. Un vencimiento descartado no vuelve como pendiente (ni suma al badge).
//   4. La antigüedad se lee en el subtítulo ("hace 3 días", "hace 5 meses").
//   5. La cola vieja se pliega y el botón la despliega entera.
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

    // ── 1: en "Atrasado" lo más reciente va arriba ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (() => {
        ${RESET}
        mkVencidos([190, 60, 12, 3, 1]);
        const pend = notifBuildPendientes();
        // Mismo orden que aplica notifRender al bucket 'atrasado'.
        const byOrd = (a, b) => (a.ord || 9) - (b.ord || 9);
        const atras = pend.filter(p => p.bucket !== 'hoy').sort((a, b) => {
          const fa = a.fecha || '', fb = b.fecha || '';
          if (fa !== fb) return fa < fb ? 1 : -1;
          return byOrd(a, b);
        });
        return {
          n: atras.length,
          dias: atras.map(p => p.dias),
          entrada: pend.filter(p => p.bucket !== 'hoy').map(p => p.dias),
          subs: atras.map(p => p.sub),
        };
      })()`));
      check('Los 5 vencidos entran como atrasados', r.n === 5, String(r.n));
      check('El más reciente queda arriba y el más viejo al fondo',
        JSON.stringify(r.dias) === JSON.stringify([1, 3, 12, 60, 190]), JSON.stringify(r.dias));
      check('El subtítulo dice la antigüedad, no solo "atrasado"',
        /hace 3 días/.test(r.subs[1] || '') && /hace \d+ meses/.test(r.subs[4] || ''),
        JSON.stringify(r.subs));
      await page.close();
    }

    // ── 2: lo de HOY manda, y ordenado por prioridad de tipo ──
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
        const byOrd = (a, b) => (a.ord || 9) - (b.ord || 9);
        const hoyP = pend.filter(p => p.bucket === 'hoy').sort(byOrd);
        return {
          kinds: hoyP.map(p => p.kind),
          todosHoy: hoyP.every(p => p.dias === 0),
          atras: pend.filter(p => p.bucket !== 'hoy').length,
        };
      })()`));
      check('El trabajo de hoy va antes que la visita de hoy',
        r.kinds.indexOf('trabajo') === 0 && r.kinds.indexOf('visita') === 1, JSON.stringify(r.kinds));
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
