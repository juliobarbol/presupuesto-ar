// test/nota-hora.test.cjs — Hora opcional en notas y visitas de la Agenda.
//
// Pedido: "que se pueda agregar la hora al crear la visita o la nota y que esto
// también aparezca en Google Calendar". La hora es OPCIONAL: sin ella el
// compromiso sigue siendo de día completo, como fue siempre.
//
// Lo que se protege acá:
//   1. El alta (Agenda → "+ Nota" / "+ Visita") guarda la hora elegida, y sin
//      hora la nota queda igual que antes (sin el campo).
//   2. El modal de edición carga la hora, la cambia y "Sin hora" la borra.
//   3. Una hora inválida no entra al estado (sanitizeNotes la descarta).
//   4. Google Calendar: la nota con hora viaja como evento CON HORARIO
//      (start.dateTime + timeZone, 1 h de duración) y la que no tiene hora
//      sigue viajando como día completo con la MISMA clave y hash de siempre
//      (si no, el primer sync después de este cambio reescribiría todo).
//   5. El .ics exporta la hora como fecha-hora local flotante.
//   6. La hora se ve en la Agenda (tarjeta del día y columnas de Semana).
//
// Uso:  node test/nota-hora.test.cjs

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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: alta con y sin hora ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        switchTab('agenda');
        calSetView('mes');            // el alta de nota vive en el detalle del día
        calSelectDay(today());
        // Visita con hora
        document.getElementById('agc-note-input').value = 'Ver el álamo del fondo';
        document.getElementById('agc-note-hora').value = '14:30';
        calSaveNote('visita');
        const conHora = getNotes()[0];
        // El campo de hora se limpia después de guardar (si no, la nota
        // siguiente hereda la hora de la anterior sin que nadie la pida).
        const trasGuardar = document.getElementById('agc-note-hora').value;
        // Nota sin hora
        document.getElementById('agc-note-input').value = 'Comprar cadena';
        calSaveNote();
        const sinHora = getNotes()[1];
        return {
          hora: conHora.hora, tipo: conHora.tipo,
          sinHora: Object.prototype.hasOwnProperty.call(sinHora, 'hora'),
          trasGuardar,
          enDisco: JSON.parse(localStorage.getItem(LS.NOTES))[0].hora,
        };
      `));
      check('El alta guarda la hora elegida', r.hora === '14:30' && r.tipo === 'visita', r.hora);
      check('…y queda escrita en localStorage', r.enDisco === '14:30', r.enDisco);
      check('El campo de hora se limpia tras guardar', r.trasGuardar === '', '"' + r.trasGuardar + '"');
      check('Sin hora la nota no lleva el campo', r.sinHora === false);
      await page.close();
    }

    // ── 2: el modal carga / cambia / borra la hora ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        setNotes([{ id:'n_h1', fecha:'2026-08-20', texto:'Visita Amalia', hecho:false,
                    cliente:'Amalia Papurello', tel:'+5493543513694', tipo:'visita', hora:'09:00' }]);
        renderCal();
        calEditNote('n_h1');
        const out = { alAbrir: document.getElementById('agc-edit-hora').value };
        document.getElementById('agc-edit-hora').value = '16:45';
        calSaveNoteEdit();
        out.cambiada = getNotes()[0].hora;
        // "Sin hora" vuelve al día completo
        calEditNote('n_h1');
        _neHoraClear();
        out.trasClear = document.getElementById('agc-edit-hora').value;
        calSaveNoteEdit();
        out.borrada = Object.prototype.hasOwnProperty.call(getNotes()[0], 'hora');
        out.resto = [getNotes()[0].tipo, getNotes()[0].cliente, getNotes()[0].fecha].join('|');
        return out;
      `));
      check('El modal abre con la hora de la nota', r.alAbrir === '09:00', r.alAbrir);
      check('Cambiar la hora la persiste', r.cambiada === '16:45', r.cambiada);
      check('"Sin hora" vacía el campo…', r.trasClear === '', '"' + r.trasClear + '"');
      check('…y guardar deja la nota de día completo', r.borrada === false);
      check('…sin tocar tipo, contacto ni fecha', r.resto === 'visita|Amalia Papurello|2026-08-20', r.resto);
      await page.close();
    }

    // ── 3: una hora inválida no entra al estado ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        const raw = [
          { id:'n_ok',   fecha:'2026-08-20', texto:'ok',   hora:'07:05' },
          { id:'n_bad1', fecha:'2026-08-20', texto:'bad1', hora:'25:00' },
          { id:'n_bad2', fecha:'2026-08-20', texto:'bad2', hora:'9:5' },
          { id:'n_bad3', fecha:'2026-08-20', texto:'bad3', hora:'<img src=x onerror=alert(1)>' },
          { id:'n_bad4', fecha:'2026-08-20', texto:'bad4', hora:930 },
        ];
        const out = sanitizeNotes(raw);
        return out.map(n => n.hora === undefined ? '—' : n.hora);
      `));
      check('sanitizeNotes conserva la hora válida y descarta el resto',
        r.join(',') === '07:05,—,—,—,—', r.join(','));
      await page.close();
    }

    // ── 4: Google Calendar (evento con horario vs. día completo) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        const hoy = today();
        setNotes([
          { id:'n_t', fecha:hoy, texto:'Visita con hora', hecho:false, tipo:'visita', hora:'14:30' },
          { id:'n_d', fecha:hoy, texto:'Nota de día completo', hecho:false },
        ]);
        const d = _gcalBuildDesired();
        const dstart = hoy.replace(/-/g,'');
        const kT = 'nn_t-' + dstart + '-t1430';
        const kD = 'nn_d-' + dstart;
        return {
          claves: Object.keys(d).sort().join(','),
          timed: d[kT] ? d[kT].body : null,
          allday: d[kD] ? d[kD].body : null,
          // Hash del evento de día completo con la fórmula ANTERIOR al cambio:
          // tiene que seguir dando lo mismo (nada se reescribe al desplegar).
          hashViejo: _gcalHash('Nota: Nota de día completo' + '|' + '' + '|' + '' + '|' + hoy + '|' + _calAddDays(hoy,1)),
          hashAllday: d[kD] ? d[kD].hash : '',
          finEsperado: _calHoraMas(hoy, '14:30', CAL_EV_MINS),
        };
      `));
      check('Las dos notas se mandan a Google', r.timed && r.allday, r.claves);
      check('La nota con hora va como evento CON HORARIO',
        !!(r.timed && r.timed.start.dateTime && r.timed.start.timeZone && !r.timed.start.date),
        JSON.stringify(r.timed && r.timed.start));
      check('…y dura una hora',
        !!(r.timed && r.timed.end.dateTime === r.finEsperado.fecha + 'T' + r.finEsperado.hora + ':00'),
        JSON.stringify(r.timed && r.timed.end));
      check('La nota sin hora sigue siendo de día completo',
        !!(r.allday && r.allday.start.date && !r.allday.start.dateTime),
        JSON.stringify(r.allday && r.allday.start));
      check('…con el mismo hash de siempre (no se reescribe lo ya sincronizado)',
        r.hashAllday === r.hashViejo, r.hashAllday + ' vs ' + r.hashViejo);
      await page.close();
    }

    // ── 5: helpers del .ics ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        return {
          dt: _icsLocalDT('2026-08-20', '14:30'),
          fin: _calHoraMas('2026-08-20', '14:30', 60),
          medianoche: _calHoraMas('2026-08-20', '23:30', 60),
        };
      `));
      check('El .ics escribe la fecha-hora local flotante', r.dt === '20260820T143000', r.dt);
      check('El fin es una hora después', r.fin.hora === '15:30' && r.fin.fecha === '2026-08-20',
        r.fin.fecha + ' ' + r.fin.hora);
      check('…y cruza bien la medianoche',
        r.medianoche.hora === '00:30' && r.medianoche.fecha === '2026-08-21',
        r.medianoche.fecha + ' ' + r.medianoche.hora);
      await page.close();
    }

    // ── 6: la hora se ve en la Agenda ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        const hoy = today();
        setNotes([
          { id:'n_t', fecha:hoy, texto:'Visita con hora', hecho:false, tipo:'visita', hora:'14:30' },
          { id:'n_m', fecha:hoy, texto:'Visita temprano', hecho:false, tipo:'visita', hora:'08:00' },
        ]);
        calSetView('agenda'); calSelectDay(hoy); renderCal();
        const lista = document.getElementById('agc-list').innerHTML;
        calSetView('semana'); renderCal();
        const cols = document.getElementById('agc-grid').innerHTML;
        return {
          enLista: /agc-ev-hora">14:30</.test(lista) && /agc-ev-hora">08:00</.test(lista),
          enCols: /agc-col-ev-h">14:30</.test(cols),
          // Ordenadas por hora dentro del día
          orden: calBuildIndex()[hoy].map(e => e.hora).join(','),
        };
      `));
      check('La hora se ve en la tarjeta del evento', r.enLista);
      check('…y en las columnas de Semana / 3 días', r.enCols);
      check('Los eventos del día quedan ordenados por hora', r.orden === '08:00,14:30', r.orden);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
