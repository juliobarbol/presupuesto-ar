// test/huecos-plantilla.test.cjs — Los corchetes de las frases no se escapan
// al documento del cliente.
//
// Las frases de la biblioteca traen huecos de plantilla: [especie] (se completa
// solo, ver especie-frase.test.cjs), [X] de altura y [localidad]. Para esos dos
// últimos NO hay dato de dónde sacarlos: la altura de corte se acuerda en el
// momento y la localidad vive dentro de una dirección de texto libre. Adivinar
// pondría un número equivocado en el PDF, que es peor que el corchete.
//
// Entonces se atacan las dos puntas del olvido:
//   1. Al insertar la frase, el hueco queda SELECCIONADO en el campo: se
//      reemplaza tipeando encima, sin cazarlo con el dedo en el celular.
//   2. Al imprimir o mandar por WhatsApp, si quedó alguno se avisa dónde está.
//      Avisa, no bloquea: el usuario puede seguir igual.
//
// Y el aviso solo mira lo que SALE en la hoja del modo activo — el estimativo
// no imprime observaciones ni condiciones de pago, avisar por ellas sería un
// falso positivo que enseña a ignorar el cartel.
//
// Uso:  node test/huecos-plantilla.test.cjs

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

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'Cliente de prueba';
  S.items = [{ id:101, type:'tree', species:'Fresno', price:'400000', desc:'' }];
  noSync = true; restoreUI(); noSync = false;
  applyMode('normal'); renderItems();
`;

// La frase de la biblioteca que trae el hueco de altura
const FRASE_X = 'Extracción del árbol hasta la altura de [X] m';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1: el hueco queda seleccionado al insertar ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        openPhrasesModal('desc', 'desc-101');
        const fila = [...document.querySelectorAll('#phrases-modal-list .phrase-text')]
          .find(f => f.dataset.text.indexOf('${FRASE_X}') === 0);
        fila.click();
        const ta = document.getElementById('desc-101');
        const toasts = [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent);
        return {
          texto: ta.value,
          sel: ta.value.slice(ta.selectionStart, ta.selectionEnd),
          enfocado: document.activeElement === ta,
          toast: toasts[toasts.length - 1] || '',
        };
      `));
      check('El [X] queda seleccionado al insertar la frase', r.sel === '[X]', JSON.stringify(r.sel));
      check('…con el campo enfocado (se reemplaza tipeando)', r.enfocado);
      check('El aviso dice qué falta completar', /completá \[X\]/.test(r.toast), r.toast);
      await page.close();
    }

    // ── 2: con texto previo, la selección apunta al hueco correcto ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        S.items[0].desc = 'Poda de saneamiento.';
        renderItems();
        openPhrasesModal('desc', 'desc-101');
        [...document.querySelectorAll('#phrases-modal-list .phrase-text')]
          .find(f => f.dataset.text.indexOf('${FRASE_X}') === 0).click();
        const ta = document.getElementById('desc-101');
        return {
          texto: ta.value,
          sel: ta.value.slice(ta.selectionStart, ta.selectionEnd),
          conservó: ta.value.indexOf('Poda de saneamiento.') === 0,
          estado: S.items[0].desc,
        };
      `));
      check('La frase se agrega abajo sin pisar lo escrito', r.conservó && /\n/.test(r.texto));
      check('La selección corre con el prefijo', r.sel === '[X]', JSON.stringify(r.sel));
      check('El estado acompaña', r.estado === r.texto);
      await page.close();
    }

    // ── 3: qué mira el aviso en cada modo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        const out = {};
        // Normal: ítems + observaciones + condiciones de pago
        S.items = [
          { id:1, type:'tree', species:'Fresno', desc:'Poda de limpieza.', price:'1' },
          { id:2, type:'tree', species:'Álamo',  desc:'Extracción hasta la altura de [X] m.', price:'2' },
        ];
        S.observations = 'Se requiere permiso del municipio de [localidad].';
        S.paymentConditions = 'Totalidad del pago al finalizar.';
        out.normal = huecosPendientes();
        // Un presupuesto sin huecos no molesta a nadie
        S.items[1].desc = 'Extracción hasta la altura de 6 m.';
        S.observations = '';
        out.limpio = huecosPendientes();
        // Escenarios A/B: dice en qué opción está
        S.scenariosEnabled = true;
        S.scenarioLabelB = 'Poda';
        S.itemsB = [{ id:3, type:'tree', desc:'Poda de [especie].', price:'3' }];
        out.conB = huecosPendientes();
        S.scenariosEnabled = false; S.itemsB = [];
        // Estimativo: sus trabajos SÍ, pero no observaciones (no se imprimen)
        S.isEstimative = true;
        S.observations = 'Permiso del municipio de [localidad].';
        S.estItems = [{ id:4, type:'work', desc:'Extracción hasta [X] m.', price:'5' }];
        out.est = huecosPendientes();
        S.isEstimative = false; S.observations = '';
        // Disposición de leña: solo si sale en el documento
        S.dispoNota = 'Dejar la leña en [lugar].';
        S.dispoEnDoc = false; out.dispoOff = huecosPendientes();
        S.dispoEnDoc = true;  out.dispoOn  = huecosPendientes();
        return out;
      `));
      check('Detecta el hueco y en qué ítem está',
        r.normal.length === 2 && r.normal[0].donde === 'Ítem 2' && r.normal[0].ph[0] === '[X]',
        JSON.stringify(r.normal));
      check('…y también en Observaciones',
        r.normal[1].donde === 'Observaciones' && r.normal[1].ph[0] === '[localidad]');
      check('Un presupuesto completo no dispara ningún aviso', r.limpio.length === 0);
      check('Con escenarios dice en qué opción está',
        r.conB.length === 1 && /Poda · ítem 1/.test(r.conB[0].donde), JSON.stringify(r.conB));
      check('En estimativo mira sus trabajos…',
        r.est.length === 1 && r.est[0].donde === 'Trabajo 1', JSON.stringify(r.est));
      check('…y NO las observaciones, que ese modo no imprime',
        !r.est.some(p => p.donde === 'Observaciones'));
      check('La disposición de leña solo cuenta si sale en el documento',
        r.dispoOff.length === 0 && r.dispoOn.length === 1, JSON.stringify(r.dispoOn));
      await page.close();
    }

    // ── 4: imprimir avisa, y respeta la respuesta ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        let impreso = 0;
        window.print = () => { impreso++; };
        const esperar = ms => new Promise(res => setTimeout(res, ms));

        // (a) con un hueco: pregunta y NO imprime hasta que se confirme
        S.items[0].desc = 'Extracción hasta la altura de [X] m.';
        renderItems();
        printDoc();
        await esperar(60);
        const abierto = document.getElementById('confirm-overlay').classList.contains('open');
        const msg = document.getElementById('confirm-msg').textContent;
        const okLabel = document.getElementById('confirm-ok').textContent;
        const antesDeResponder = impreso;

        // (b) "Cancelar" no imprime
        document.getElementById('confirm-cancel').click();
        await esperar(400);
        const trasCancelar = impreso;

        // (c) "Imprimir igual" sí imprime
        printDoc();
        await esperar(60);
        document.getElementById('confirm-ok').click();
        await esperar(500);
        const trasConfirmar = impreso;

        // (d) sin huecos no pregunta nada
        S.items[0].desc = 'Extracción hasta la altura de 6 m.';
        renderItems();
        printDoc();
        await esperar(60);
        const preguntóDeMás = document.getElementById('confirm-overlay').classList.contains('open');
        await esperar(500);
        return { abierto, msg, okLabel, antesDeResponder, trasCancelar, trasConfirmar,
                 preguntóDeMás, totalImpreso: impreso };
      })()`));
      check('Al imprimir con un hueco, avisa antes', r.abierto && r.antesDeResponder === 0);
      check('El aviso dice dónde está y cuál es',
        /Ítem 1/.test(r.msg) && /\[X\]/.test(r.msg), r.msg.replace(/\n/g, ' | '));
      check('El botón ofrece seguir igual', r.okLabel === 'Imprimir igual', r.okLabel);
      check('Cancelar no imprime', r.trasCancelar === 0);
      check('"Imprimir igual" imprime', r.trasConfirmar === 1);
      check('Sin huecos no pregunta nada y imprime derecho',
        !r.preguntóDeMás && r.totalImpreso === 2, 'impresiones: ' + r.totalImpreso);
      await page.close();
    }

    // ── 5: WhatsApp, mismo control (y la ventana se abre igual) ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`return (async () => {
        ${RESET}
        let abiertas = [];
        window.open = (url) => { abiertas.push(url); return null; };
        const esperar = ms => new Promise(res => setTimeout(res, ms));

        S.clientContact = '11 5555 4444';
        S.items[0].desc = 'Extracción hasta la altura de [X] m.';
        renderItems();
        sendCurrentWhatsapp();
        await esperar(60);
        const abierto = document.getElementById('confirm-overlay').classList.contains('open');
        const okLabel = document.getElementById('confirm-ok').textContent;
        const antes = abiertas.length;
        document.getElementById('confirm-ok').click();
        await esperar(200);
        const trasConfirmar = abiertas.length;

        // Sin huecos: derecho a WhatsApp
        S.items[0].desc = 'Extracción hasta la altura de 6 m.';
        renderItems();
        sendCurrentWhatsapp();
        await esperar(60);
        return { abierto, okLabel, antes, trasConfirmar,
                 preguntóDeMás: document.getElementById('confirm-overlay').classList.contains('open'),
                 total: abiertas.length, url: abiertas[0] || '' };
      })()`));
      check('WhatsApp también avisa antes de mandar', r.abierto && r.antes === 0);
      check('El botón dice "Enviar igual"', r.okLabel === 'Enviar igual', r.okLabel);
      check('Al confirmar se abre WhatsApp igual (no se pierde la ventana)',
        r.trasConfirmar === 1 && /wa\.me/.test(r.url), r.url.slice(0, 40));
      check('Sin huecos no pregunta y manda derecho',
        !r.preguntóDeMás && r.total === 2, 'aperturas: ' + r.total);
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
