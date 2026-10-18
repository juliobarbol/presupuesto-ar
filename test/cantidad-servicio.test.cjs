// test/cantidad-servicio.test.cjs — El "1" de la cantidad se puede borrar.
//
// Reporte: "cuando tengo que poner la cantidad de camiones, no me deja borrar
// el 1 de ninguna forma. Tengo que poner un 2 para que quede un 12 y después
// borrar el 1 del principio".
//
// Causa: el handler de `input` reescribía el campo con Math.max(1, …) en cada
// tecla, así que vacío → 1 al instante. Ahora (wireQtyInput) el campo se deja
// vacío mientras se edita, el estado cuenta 1 y se completa recién al salir.
//
// Se cubre en los dos lugares donde existe el campo: presupuesto normal
// (.qty-f) y estimativo (.est-qty-f), con teclas reales.
//
// Uso:  node test/cantidad-servicio.test.cjs

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

const RESET = `
  setH([]);
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, JSON.parse(JSON.stringify(DEF)));
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.items = [{ id:201, type:'service', desc:'Camión - Viaje', price:'100000', qty:1 }];
  S.estItems = [{ id:301, type:'service', desc:'Camión - Viaje', price:'100000', qty:1 }];
  noSync = true; restoreUI(); noSync = false;
`;

async function caso(page, nombre, modo, sel, leerQty) {
  await page.evaluate(new Function(`${RESET}
    applyMode('${modo}'); ${modo === 'estimativo' ? 'renderEstItems()' : 'renderItems()'};`));
  const h = await page.$(sel);
  await h.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await h.focus();
  // Cursor al final y borrar: el caso del reporte
  await h.evaluate(el => { try { el.select(); } catch (_) {} });
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  const vacio = await h.evaluate(el => el.value);
  check(`${nombre}: borrar el 1 deja el campo vacío`, vacio === '', JSON.stringify(vacio));

  await page.keyboard.type('2');
  const r = await page.evaluate(new Function(`
    return { v: document.querySelector('${sel}').value, q: ${leerQty} };`));
  check(`${nombre}: tipear 2 deja "2", no "12"`, r.v === '2' && Number(r.q) === 2, JSON.stringify(r));

  // Al entrar al campo el número queda seleccionado: tipear lo reemplaza
  await page.evaluate(new Function(`document.querySelector('${sel}').blur();`));
  await h.focus();
  await page.keyboard.type('5');
  const rep = await h.evaluate(el => el.value);
  check(`${nombre}: al enfocar, tipear reemplaza el número`, rep === '5', rep);

  // Vacío y salir del campo → vuelve a 1
  await page.keyboard.press('Backspace');
  await page.evaluate(new Function(`document.querySelector('${sel}').blur();`));
  const r2 = await page.evaluate(new Function(`
    return { v: document.querySelector('${sel}').value, q: ${leerQty} };`));
  check(`${nombre}: vacío al salir se completa con 1`, r2.v === '1' && Number(r2.q) === 1, JSON.stringify(r2));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });

    await caso(page, 'Normal', 'normal', '.qty-f', 'S.items[0].qty');
    await caso(page, 'Estimativo', 'estimativo', '.est-qty-f', 'S.estItems[0].qty');
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(allOk ? '\nOK' : '\nFALLÓ');
  process.exit(allOk ? 0 : 1);
})();
