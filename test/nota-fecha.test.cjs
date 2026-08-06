// test/nota-fecha.test.cjs — Mover de día una nota o visita desde su modal.
//
// Caso real: hay una poda agendada como visita y sale alerta de viento para ese
// día. Antes había que borrar la nota y volver a crearla en la fecha nueva; el
// modal de "Editar nota" ahora trae el campo Fecha + atajos (− 1 día / + 1 día /
// + 1 semana / Hoy).
//
// Lo que se protege acá:
//   1. El modal carga la fecha de la nota que se está editando.
//   2. Los atajos corren la fecha ELEGIDA (encadenables), y "Hoy" es absoluto.
//   3. Guardar persiste la fecha nueva en LS.NOTES sin tocar el resto (tipo,
//      contacto, ubicación) y sin cambiar el id.
//   4. Una fecha vacía o inválida NO guarda (la nota no puede quedar sin día).
//   5. El calendario propio del datepicker abre POR ENCIMA del modal — es el
//      mismo problema por el que el <select> de Tipo se volvió un segmentado.
//
// Uso:  node test/nota-fecha.test.cjs

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

// Una visita agendada con todos los datos cargados (como la del caso real).
const SEMBRAR = `
  setNotes([{ id:'n_test1', fecha:'2026-08-06', texto:'Poda De Phoenix con Augusto',
              hecho:false, cliente:'Augusto Bellis Podador', tel:'+54 9 351 617-3556',
              ubic:'-31.1660270, -64.3195100', tipo:'visita' }]);
  renderCal();
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1 y 2: el modal carga la fecha y los atajos la corren ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        calEditNote('n_test1');
        const inp = document.getElementById('agc-edit-fecha');
        const out = { alAbrir: inp.value, visible: !document.getElementById('note-edit-overlay').hidden };
        _neFechaMover(1);  out.mas1  = inp.value;
        _neFechaMover(1);  out.mas2  = inp.value;   // encadenable
        _neFechaMover(7);  out.mas7  = inp.value;
        _neFechaMover(-1); out.menos1 = inp.value;
        out.msg = document.getElementById('agc-edit-fecha-msg').textContent;
        out.movida = document.getElementById('agc-edit-fecha-msg').className.includes('is-moved');
        _neFechaMover('hoy'); out.hoy = inp.value; out.today = today();
        out.msgHoy = document.getElementById('agc-edit-fecha-msg').textContent;
        calCloseNoteEdit();
        return out;
      `));
      check('El modal abre con la fecha de la nota', r.alAbrir === '2026-08-06', r.alAbrir);
      check('"+ 1 día" corre un día y se puede encadenar',
        r.mas1 === '2026-08-07' && r.mas2 === '2026-08-08', r.mas1 + ' → ' + r.mas2);
      check('"+ 1 semana" suma 7 días a la fecha elegida', r.mas7 === '2026-08-15', r.mas7);
      check('"− 1 día" vuelve para atrás', r.menos1 === '2026-08-14', r.menos1);
      check('El aviso dice de dónde a dónde se mueve',
        r.movida && r.msg.includes('viernes 14/08/2026') && r.msg.includes('06/08/2026'), r.msg);
      check('"Hoy" es absoluto (no relativo a lo elegido)', r.hoy === r.today, r.hoy);
      await page.close();
    }

    // ── 3: guardar persiste la fecha nueva y no pisa el resto ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        calEditNote('n_test1');
        _neFechaMover(2);
        calSaveNoteEdit();
        const n = getNotes()[0];
        return { total: getNotes().length, id: n.id, fecha: n.fecha, texto: n.texto,
                 tipo: n.tipo, cliente: n.cliente, tel: n.tel, ubic: n.ubic,
                 enDisco: JSON.parse(localStorage.getItem(LS.NOTES))[0].fecha,
                 abierto: document.getElementById('note-edit-overlay').classList.contains('open') };
      `));
      check('Guardar mueve la nota al día nuevo',
        r.total === 1 && r.fecha === '2026-08-08', r.total + ' nota(s), fecha=' + r.fecha);
      check('…y queda escrita en localStorage', r.enDisco === '2026-08-08', r.enDisco);
      check('…sin tocar id, texto, tipo ni contacto',
        r.id === 'n_test1' && r.texto === 'Poda De Phoenix con Augusto' && r.tipo === 'visita'
        && r.cliente === 'Augusto Bellis Podador' && r.ubic === '-31.1660270, -64.3195100',
        [r.id, r.tipo, r.cliente, r.ubic].join(' | '));
      check('…y el modal se cierra', !r.abierto);
      await page.close();
    }

    // ── 4: sin fecha válida no se guarda ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        calEditNote('n_test1');
        const inp = document.getElementById('agc-edit-fecha');
        inp.value = ''; _neFechaSync();
        calSaveNoteEdit();
        const vacio = { fecha: getNotes()[0].fecha,
                        sigueAbierto: document.getElementById('note-edit-overlay').classList.contains('open'),
                        msg: document.getElementById('agc-edit-fecha-msg').textContent };
        // Valor basura (no puede llegar desde el picker, sí desde un input tocado)
        inp.value = '9999-99-99';
        calSaveNoteEdit();
        vacio.trasBasura = getNotes()[0].fecha;
        calCloseNoteEdit();
        return vacio;
      `));
      check('Una fecha vacía no guarda y deja el modal abierto',
        r.fecha === '2026-08-06' && r.sigueAbierto, r.fecha + ' abierto=' + r.sigueAbierto);
      check('…y lo avisa debajo del campo', /Sin fecha/i.test(r.msg), r.msg);
      check('Una fecha inválida tampoco pisa la nota', r.trasBasura === '2026-08-06', r.trasBasura);
      await page.close();
    }

    // ── 5: el calendario del datepicker abre por encima del modal ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        calEditNote('n_test1');
        const btn = document.getElementById('agc-edit-fecha')._cdateBtn;
        btn.click();
        const pop = document.querySelector('.cal-pop');
        const out = {
          hayPop: !!pop,
          zPop: pop ? +getComputedStyle(pop).zIndex : 0,
          zModal: +getComputedStyle(document.getElementById('note-edit-overlay')).zIndex,
          zMaxOverlay: Math.max(...['clima-overlay','notif-overlay','photo-viewer-overlay','confirm-overlay']
            .map(id => +getComputedStyle(document.getElementById(id)).zIndex || 0)),
        };
        if (pop) { pop.querySelector('.cal-day[data-iso="2026-08-20"]').click(); }
        out.tras = document.getElementById('agc-edit-fecha').value;
        calSaveNoteEdit();
        out.guardada = getNotes()[0].fecha;
        return out;
      `));
      check('Se abre el calendario propio desde el modal', r.hayPop);
      check('…por encima del modal y del resto de los overlays',
        r.zPop > r.zModal && r.zPop > r.zMaxOverlay,
        'pop=' + r.zPop + ' modal=' + r.zModal + ' overlays=' + r.zMaxOverlay);
      check('Elegir un día del calendario mueve la nota a esa fecha',
        r.tras === '2026-08-20' && r.guardada === '2026-08-20', r.tras + ' / ' + r.guardada);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
