// test/agenda-ics.test.cjs — El .ics y Google Calendar describen igual cada evento.
//
// El texto de un evento (título, descripción, lugar) estaba escrito dos veces:
// una para Google Calendar y otra para "Exportar .ics", y las dos copias ya
// decían cosas distintas. Ahora sale de calEvTexto() para los dos.
//
// Lo que se protege acá:
//   1. El .ics exporta trabajos, recontactos, visitas y notas pendientes, de hoy
//      en adelante; vencimientos, seguimientos, lo hecho y lo pasado quedan afuera.
//   2. Cada evento del .ics tiene el mismo título que en Google Calendar.
//   3. La visita lleva su contacto y su ubicación; el trabajo, su monto.
//
// Uso:  node test/agenda-ics.test.cjs

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

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));

    const r = await page.evaluate(async () => {
      localStorage.clear();
      const hoy = today(), man = _calAddDays(hoy, 1), pas = _calAddDays(hoy, 2), ayer = _calAddDays(hoy, -1);
      setH([
        { id: 1, quoteNumber: '0001', clientName: 'Cliente Trabajo', estado: 'aceptado', total: 100000,
          currency: 'ARS', fechasTrabajo: [man], fechaTrabajo: man,
          snapshot: { clientName: 'Cliente Trabajo', clientContact: '3543 11-2233', workAddress: 'Calle 1' } },
        { id: 2, quoteNumber: '0002', clientName: 'Cliente Recontacto', estado: 'aceptado', total: 50000,
          currency: 'ARS', recontactoEn: man, recontactoNota: 'Después de las fiestas',
          snapshot: { clientName: 'Cliente Recontacto' } },
        { id: 3, quoteNumber: '0003', clientName: 'Cliente Enviado', estado: 'enviado', total: 70000,
          currency: 'ARS', enviadoEn: new Date().toISOString(),
          snapshot: { clientName: 'Cliente Enviado', dateExpiry: pas } },
      ]);
      setNotes([
        { id: 'n_v1', fecha: man, texto: 'Ir a ver el pino', hecho: false, cliente: 'Gastón',
          tel: '3543 99-8877', ubic: 'https://maps.google.com/?q=-31.4,-64.2', tipo: 'visita', hora: '07:00' },
        { id: 'n_v2', fecha: man, texto: 'Visita ya hecha', hecho: true, tipo: 'visita' },
        { id: 'n_v3', fecha: ayer, texto: 'Visita de ayer', hecho: false, tipo: 'visita' },
        { id: 'n_n1', fecha: pas, texto: 'Comprar cadena', hecho: false },
      ]);

      // Capturar el archivo que se descarga
      let blob = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => { blob = b; return 'blob:test'; };
      HTMLAnchorElement.prototype.click = function () {};
      calExportIcs();
      URL.createObjectURL = orig;
      const ics = blob ? await blob.text() : '';

      // Desplegar líneas plegadas y separar los eventos
      const lineas = ics.replace(/\r\n /g, '').split('\r\n');
      const des = (t) => t.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
      const eventos = [];
      let ev = null;
      lineas.forEach(l => {
        if (l === 'BEGIN:VEVENT') ev = {};
        else if (l === 'END:VEVENT') { eventos.push(ev); ev = null; }
        else if (ev) {
          const i = l.indexOf(':');
          ev[l.slice(0, i).split(';')[0]] = des(l.slice(i + 1));
        }
      });
      const google = Object.values(_gcalBuildDesired()).map(d => d.body.summary);
      return { n: eventos.length, eventos, google };
    });

    const titulos = r.eventos.map(e => e.SUMMARY);
    check('Exporta trabajo, recontacto, visita pendiente y nota (4)', r.n === 4, titulos.join(' | '));
    check('Vencimientos, lo hecho y lo pasado quedan afuera',
      !titulos.some(t => /Vence|Seguimiento|ya hecha|de ayer/.test(t)), titulos.join(' | '));
    check('Cada evento del .ics se titula igual que en Google Calendar',
      titulos.length > 0 && titulos.every(t => r.google.includes(t)),
      titulos.filter(t => !r.google.includes(t)).join(' | '));
    const visita = r.eventos.find(e => /Ir a ver el pino/.test(e.SUMMARY)) || {};
    check('La visita lleva contacto, teléfono y ubicación',
      /Gastón/.test(visita.DESCRIPTION || '') && /3543 99-8877/.test(visita.DESCRIPTION || '')
        && /maps\.google/.test(visita.LOCATION || ''), JSON.stringify(visita));
    check('La visita con hora sale con horario', /T070000/.test(visita.DTSTART || ''), visita.DTSTART);
    const trabajo = r.eventos.find(e => /Trabajo: Cliente Trabajo/.test(e.SUMMARY)) || {};
    check('El trabajo lleva monto, contacto y dirección',
      /\$ 100\.000/.test(trabajo.DESCRIPTION || '') && /3543 11-2233/.test(trabajo.DESCRIPTION || '')
        && trabajo.LOCATION === 'Calle 1', JSON.stringify(trabajo));
    check('El teléfono no se repite (Contacto y Tel)',
      ((trabajo.DESCRIPTION || '').match(/3543 11-2233/g) || []).length === 1, trabajo.DESCRIPTION);
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
