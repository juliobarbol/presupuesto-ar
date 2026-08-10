// test/gcal-agenda.test.cjs — Qué manda la app a Google Calendar en una sync.
//
// El caso que lo pidió: "las visitas no me quedan agendadas en el calendario de
// Google". La sync es silenciosa y de fondo, así que sin un test que mire los
// pedidos HTTP no hay manera de saber si el problema es que la app no las manda
// o que Google no las muestra. Acá se corre una `gcalSync()` completa con la
// API interceptada y se mira exactamente qué sale.
//
// Lo que se protege acá:
//   1. Los CINCO conceptos de la Agenda salen a Google: trabajo, visita, nota,
//      recontacto y vencimiento/seguimiento (de hoy en adelante).
//   2. Las visitas hechas y lo que ya pasó NO salen.
//   3. Cada evento lleva su pqKey/pqHash (idempotencia) y las visitas con hora
//      salen con horario.
//   4. La sync deja anotado cuántos eventos quedaron arriba (LS.GCAL_N): es el
//      número que distingue "no se mandaron" de "no se ven".
//   5. El calendario se marca como VISIBLE en la cuenta (calendarList.selected).
//   6. Una segunda pasada sin cambios no reescribe nada (ni un POST ni un PATCH).
//
// Uso:  node test/gcal-agenda.test.cjs

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

// Agenda de prueba + API de Google interceptada. Devuelve todo lo que se pidió.
const CORRER = `
  localStorage.clear();
  const hoy = today(), man = _calAddDays(hoy, 1), pas = _calAddDays(hoy, 2), ayer = _calAddDays(hoy, -1);
  setH([
    { id:1, quoteNumber:'0001', clientName:'Cliente Trabajo', estado:'aceptado', total:100000,
      currency:'ARS', agFechas:[man], fechaTrabajo:man,
      snapshot:{ clientName:'Cliente Trabajo', workAddress:'Calle 1', dateExpiry:pas } },
    { id:2, quoteNumber:'0002', clientName:'Cliente Recontacto', estado:'aceptado', total:50000,
      currency:'ARS', recontactoEn:man, snapshot:{ clientName:'Cliente Recontacto' } },
  ]);
  setNotes([
    { id:'n_v1', fecha:man,  texto:'Ir a pintar con Gastón', hecho:false, cliente:'Gaston', tipo:'visita', hora:'07:00' },
    { id:'n_v2', fecha:pas,  texto:'Visita sin hora',        hecho:false, cliente:'Otro',   tipo:'visita' },
    { id:'n_v3', fecha:man,  texto:'Visita ya hecha',        hecho:true,  tipo:'visita' },
    { id:'n_v4', fecha:ayer, texto:'Visita de ayer',         hecho:false, tipo:'visita' },
    { id:'n_n1', fecha:man,  texto:'Nota suelta',            hecho:false },
  ]);

  // API de Google interceptada: guarda cada pedido y devuelve lo mínimo viable.
  const reqs = [];
  const serverEvents = [];
  window.netFetch = async (url, opt) => {
    opt = opt || {}; url = String(url);
    const body = opt.body ? JSON.parse(opt.body) : null;
    reqs.push({ m: opt.method || 'GET', url: url, body: body });
    const j = (o) => ({ ok:true, status:200, json: async()=>o, text: async()=>JSON.stringify(o) });
    if (/\\/users\\/me\\/calendarList\\//.test(url)) return j({ id:'cal1', selected:true });
    if (/\\/events\\?/.test(url)) return j({ items: serverEvents.slice() });   // list
    if (/\\/events$/.test(url) && (opt.method === 'POST')) {                   // insert
      const ev = { id:'ev' + serverEvents.length, extendedProperties: body.extendedProperties };
      serverEvents.push(ev);
      return j(ev);
    }
    if (/\\/calendars\\/[^/]+$/.test(url)) return j({ id:'cal1' });             // get calendar
    return j({ id:'ok' });
  };
  window.gcalGetToken = async () => 'tok';
  localStorage.setItem(LS.GCAL_ON, '1');
  localStorage.setItem(LS.GCAL_ID, 'cal1');
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    const r = await page.evaluate(new Function(`return (async () => {
      ${CORRER}
      let err = '';
      try { await gcalSync(); } catch(e) { err = (e && e.message) || String(e); }
      const posts = reqs.filter(x => x.m === 'POST' && /\\/events$/.test(x.url)).map(x => x.body);
      const primera = { posts: posts.length, sums: posts.map(b => b.summary).sort() };
      // Segunda pasada, sin tocar nada: no debería escribir nada.
      const antes = reqs.length;
      try { await gcalSync(); } catch(e) { err = err || ((e && e.message) || String(e)); }
      const segunda = reqs.slice(antes).filter(x => x.m === 'POST' || x.m === 'PATCH' || x.m === 'DELETE').length;
      const visita = posts.find(b => /Ir a pintar/.test(b.summary));
      const sinHora = posts.find(b => /Visita sin hora/.test(b.summary));
      return {
        err, primera, segunda,
        visita, sinHora,
        n: localStorage.getItem(LS.GCAL_N),
        // PATCH de visibilidad del calendario (calendarList)
        visible: reqs.some(x => x.m === 'PATCH' && /calendarList/.test(x.url) && x.body && x.body.selected === true),
      };
    })();`), { timeout: 20000 });

    check('La sync corre sin error', r.err === '', r.err);
    check('Salen los 5 conceptos de la Agenda (y nada más)',
      r.primera.posts === 5, r.primera.posts + ' eventos: ' + r.primera.sums.join(' / '));
    check('La VISITA con hora sale a Google',
      !!(r.visita && r.visita.summary === 'Visita: Ir a pintar con Gastón'),
      r.visita && r.visita.summary);
    check('…como evento con horario (dateTime + zona)',
      !!(r.visita && r.visita.start.dateTime && r.visita.start.timeZone && !r.visita.start.date),
      JSON.stringify(r.visita && r.visita.start));
    check('La visita sin hora sale como día completo',
      !!(r.sinHora && r.sinHora.start.date && !r.sinHora.start.dateTime),
      JSON.stringify(r.sinHora && r.sinHora.start));
    check('Cada evento lleva pqKey y pqHash',
      !!(r.visita && r.visita.extendedProperties.private.pqKey && r.visita.extendedProperties.private.pqHash),
      JSON.stringify(r.visita && r.visita.extendedProperties.private));
    check('La visita hecha y la de ayer NO salen',
      !r.primera.sums.some(s => /ya hecha|de ayer/.test(s)), r.primera.sums.join(' / '));
    check('La sync anota cuántos eventos quedaron arriba', r.n === '5', 'LS.GCAL_N=' + r.n);
    check('El calendario queda marcado como visible en la cuenta', r.visible);
    check('Una segunda pasada sin cambios no reescribe nada', r.segunda === 0, r.segunda + ' escritura(s)');

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
