// test/especie-frase.test.cjs — El placeholder [especie] se completa solo.
//
// Pedido: "me gustaría que la parte de [especie], cuando selecciono un texto
// predefinido, se rellene con la especie que puse en Especie/s. ¿Es posible
// hacerlo cuando hay varios árboles distintos?".
//
// Sí: la especie se lee de LA TARJETA del ítem, no de un campo global. Cada
// árbol tiene su propio "Especie/s" y su propia frase, así que dos ítems con
// especies distintas quedan cada uno con la suya.
//
// Lo que se protege acá:
//   1. Insertar una frase con [especie] la completa con la especie del ítem.
//   2. Con varios árboles distintos, cada uno recibe la SUYA (no la del primero).
//   3. Sin especie cargada el corchete queda intacto (es el recordatorio) y se
//      completa solo al salir del campo Especie/s.
//   4. Varias especies en un ítem se pegan como "A y B", no "A, B".
//   5. La frase de la BIBLIOTECA no se toca: sigue guardada con [especie] para
//      poder reusarla en el próximo árbol.
//   6. El estado (S.items[i].desc) queda sincronizado con lo que se ve.
//
// Uso:  node test/especie-frase.test.cjs

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

// Dos árboles distintos en el mismo presupuesto: el caso de la pregunta.
const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.items = [
    { id:101, type:'tree', species:'Eucaliptus', price:'400000', desc:'' },
    { id:102, type:'tree', species:'Ciprés',     price:'300000', desc:'' },
  ];
  noSync = true; restoreUI(); noSync = false;
  applyMode('normal'); renderItems();
`;

// Inserta en el ítem con ese id la primera frase de la biblioteca que
// traiga [especie] — el mismo camino que toca el usuario: abrir el modal
// desde la tarjeta y tocar la frase.
const INSERTAR = `
  function insertarEnItem(id) {
    openPhrasesModal('desc', 'desc-' + id);
    const filas = [...document.querySelectorAll('#phrases-modal-list .phrase-text')];
    const fila = filas.find(f => /\\[especie\\]/i.test(f.dataset.text));
    fila.click();
    return fila.dataset.text;
  }
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {

    // ── 1 y 2: cada árbol recibe SU especie ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET} ${INSERTAR}
        const original = insertarEnItem(101);
        insertarEnItem(102);
        return {
          original,
          uno: document.getElementById('desc-101').value,
          dos: document.getElementById('desc-102').value,
          estadoUno: S.items[0].desc,
          estadoDos: S.items[1].desc,
          // La frase guardada NO se modifica: se reusa en el próximo árbol
          biblioteca: getPhrasesDB('desc').some(p => /\\[especie\\]/i.test(p)),
        };
      `));
      check('La frase se inserta con la especie del ítem',
        /Extracción de Eucaliptus hasta/.test(r.uno) && !/\[especie\]/i.test(r.uno), r.uno.slice(0, 46));
      check('Con dos árboles distintos, el segundo recibe la SUYA',
        /Extracción de Ciprés hasta/.test(r.dos) && !/Eucaliptus/.test(r.dos), r.dos.slice(0, 46));
      check('El estado queda sincronizado con lo que se ve',
        r.estadoUno === r.uno && r.estadoDos === r.dos);
      check('La frase de la biblioteca sigue guardada con [especie]', r.biblioteca);
      check('La frase original traía el placeholder', /\[especie\]/i.test(r.original));
      await page.close();
    }

    // ── 3: sin especie el corchete queda, y se completa al salir del campo ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET} ${INSERTAR}
        S.items[0].species = '';
        renderItems();
        insertarEnItem(101);
        const alInsertar = document.getElementById('desc-101').value;
        // Ahora sí carga la especie y sale del campo
        const card = document.getElementById('desc-101').closest('.icard');
        const sp = card.querySelector('.sp-f');
        sp.value = 'Fresno';
        sp.dispatchEvent(new Event('input', {bubbles:true}));
        sp.dispatchEvent(new Event('blur', {bubbles:true}));
        return {
          alInsertar,
          después: document.getElementById('desc-101').value,
          estado: S.items[0].desc,
          especie: S.items[0].species,
        };
      `));
      check('Sin especie cargada el placeholder queda intacto',
        /\[especie\]/i.test(r.alInsertar), r.alInsertar.slice(0, 40));
      check('Al cargar la especie y salir del campo, se completa solo',
        /Extracción de Fresno hasta/.test(r.después) && !/\[especie\]/i.test(r.después),
        r.después.slice(0, 40));
      check('…y el estado acompaña', r.estado === r.después && r.especie === 'Fresno');
      await page.close();
    }

    // ── 4: varias especies en un mismo ítem ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET} ${INSERTAR}
        S.items[0].species = 'Eucaliptus, Ciprés';
        renderItems();
        insertarEnItem(101);
        return {
          texto: document.getElementById('desc-101').value,
          dos:  speciesForPhrase('Eucaliptus, Ciprés'),
          tres: speciesForPhrase('Eucaliptus, Ciprés, Fresno'),
          vacío: speciesForPhrase('  ,  '),
          // No toca lo que no es el placeholder
          intacto: fillSpeciesPlaceholder('Poda de [X] m en [localidad]', 'Fresno'),
        };
      `));
      check('Dos especies se pegan como "A y B"', r.dos === 'Eucaliptus y Ciprés', r.dos);
      check('Tres especies: "A, B y C"', r.tres === 'Eucaliptus, Ciprés y Fresno', r.tres);
      check('Un campo vacío no produce especie', r.vacío === '');
      check('La frase insertada usa la forma legible',
        /Extracción de Eucaliptus y Ciprés hasta/.test(r.texto), r.texto.slice(0, 50));
      check('Otros placeholders quedan como están',
        r.intacto === 'Poda de [X] m en [localidad]', r.intacto);
      await page.close();
    }

    // ── 5: el modal avisa con qué se va a completar ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET}
        openPhrasesModal('desc', 'desc-101');
        const hint = document.getElementById('phrases-modal-hint');
        const conEspecie = { oculto: hint.hidden, txt: hint.textContent, cls: hint.className };
        closePhrasesModal();
        S.items[0].species = '';
        renderItems();
        openPhrasesModal('desc', 'desc-101');
        const sinEspecie = { oculto: hint.hidden, txt: hint.textContent, cls: hint.className };
        closePhrasesModal();
        // Fuera de una tarjeta (observaciones) el aviso no aplica
        openPhrasesModal('obs', 'observations');
        const enObs = hint.hidden;
        closePhrasesModal();
        return { conEspecie, sinEspecie, enObs, alCerrar: hint.hidden };
      `));
      check('El modal dice con qué se reemplaza [especie]',
        !r.conEspecie.oculto && /Eucaliptus/.test(r.conEspecie.txt) && /is-on/.test(r.conEspecie.cls),
        r.conEspecie.txt);
      check('…y avisa si todavía falta cargarla',
        !r.sinEspecie.oculto && /Especie\/s/.test(r.sinEspecie.txt) && /is-off/.test(r.sinEspecie.cls),
        r.sinEspecie.txt);
      check('En Observaciones no se muestra (no hay ítem)', r.enObs);
      check('Se oculta al cerrar el modal', r.alCerrar);
      await page.close();
    }

    // ── 6: el escenario B usa la especie de SU tarjeta ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${RESET} ${INSERTAR}
        S.scenariosEnabled = true;
        S.itemsB = [{ id:201, type:'tree', species:'Álamo', price:'150000', desc:'' }];
        activeScenario = 'B';
        renderItems();
        insertarEnItem(201);
        return { texto: document.getElementById('desc-201').value, estado: S.itemsB[0].desc };
      `));
      check('En el escenario B toma la especie del ítem de B',
        /Extracción de Álamo hasta/.test(r.texto) && r.estado === r.texto, r.texto.slice(0, 40));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
