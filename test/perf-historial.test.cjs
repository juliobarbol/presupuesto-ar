// test/perf-historial.test.cjs — M3 de docs/auditoria-2026-07-24.md.
//
// Síntoma: con un historial de un par de años, escribir en el buscador del
// Historial trababa la app en cada letra (cada tecla disparaba un render
// completo: ~340 ms en escritorio, 4-10x más en un celular de gama baja).
//
// Tres cambios: cache de getH() validado contra el string en disco, debounce en
// el buscador, y no generar el HTML de los meses colapsados (se armaban las 250
// tarjetas siempre y el CSS ocultaba 11 de cada 12 meses).
//
// Este test verifica el COMPORTAMIENTO (que nada se rompa) y deja los tiempos
// como referencia informativa — no falla por velocidad, que depende de la
// máquina.
//
// Uso:  node test/perf-historial.test.cjs

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

// Historial de prueba: 240 presupuestos repartidos en 12 meses.
const SEMBRAR = `
  const h = [];
  for (let i = 0; i < 240; i++) {
    const snap = JSON.parse(JSON.stringify(S));
    snap.items = [{ id:1, type:'tree', species:'Fresno', price:'250000', qty:1 }];
    snap.clientName = 'Cliente ' + i;
    snap.workAddress = 'Calle ' + i;
    snap.dateIssue = '2025-' + String((i % 12) + 1).padStart(2,'0') + '-15';
    h.push({ _type:'presupuesto_individual', id: 1000 + i,
      savedAt: '2025-' + String((i % 12) + 1).padStart(2,'0') + '-15T10:00:00Z',
      quoteNumber: '2025-' + String(i).padStart(4,'0'),
      clientName: 'Cliente ' + i, currency:'ARS', total: 430000, itemCount: 1,
      estado: (i % 3 === 0 ? 'enviado' : 'realizado'), snapshot: snap });
  }
  setH(h);
  switchTab('historial');
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1300));
    await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('pq_onboarded','1'); } catch(_){} });

    // ── Cache de getH() ──
    const cache = await page.evaluate(new Function(`
      ${SEMBRAR}
      const a = getH(), b = getH();
      const mismoObjeto = a === b;
      // Una escritura por setH tiene que verse en la próxima lectura
      const h2 = getH(); h2[0].clientName = 'Renombrado'; setH(h2);
      const trasSetH = getH()[0].clientName;
      // Y una escritura DIRECTA a localStorage también (el cache se valida
      // contra el string en disco, no contra un flag)
      const crudo = JSON.parse(localStorage.getItem('pq_h'));
      crudo[0].clientName = 'Cambiado a mano';
      localStorage.setItem('pq_h', JSON.stringify(crudo));
      const trasDirecto = getH()[0].clientName;
      return { mismoObjeto, trasSetH, trasDirecto, total: getH().length };
    `));
    check('getH() cachea: dos llamadas seguidas devuelven lo mismo', cache.mismoObjeto);
    check('setH() se refleja en la próxima lectura', cache.trasSetH === 'Renombrado', cache.trasSetH);
    check('una escritura directa a localStorage NO deja el cache viejo',
      cache.trasDirecto === 'Cambiado a mano', cache.trasDirecto);
    check('no se pierden entradas', cache.total === 240, 'total=' + cache.total);

    // ── Meses colapsados: no se genera su HTML, pero al abrirlos aparece ──
    const meses = await page.evaluate(() => {
      _userTouchedMonths = false; _expandedMonths.clear();
      document.getElementById('hist-search').value = '';
      renderHistory();
      const secciones = [...document.querySelectorAll('.hmonth')];
      const abiertas = secciones.filter(s => s.classList.contains('is-open'));
      const tarjetas = document.querySelectorAll('#history-list .hitem').length;
      const enCerradas = secciones.filter(s => !s.classList.contains('is-open'))
        .reduce((n, s) => n + s.querySelectorAll('.hitem').length, 0);
      // Abrir un mes cerrado
      const cerrada = secciones.find(s => !s.classList.contains('is-open'));
      const key = cerrada.getAttribute('data-month');
      toggleHistoryMonth(key);
      const sec2 = document.querySelector(`.hmonth[data-month="${key}"]`);
      return { secciones: secciones.length, abiertas: abiertas.length, tarjetas, enCerradas,
               trasAbrir: sec2.querySelectorAll('.hitem').length,
               contadorHeader: parseInt(sec2.querySelector('.hmonth-count').textContent, 10) };
    });
    check('el historial se agrupa en 12 meses', meses.secciones === 12, 'meses=' + meses.secciones);
    check('arranca con un solo mes desplegado', meses.abiertas === 1, 'abiertos=' + meses.abiertas);
    check('los meses colapsados NO generan tarjetas', meses.enCerradas === 0, 'tarjetas ocultas=' + meses.enCerradas);
    check('solo se renderiza el mes abierto', meses.tarjetas === 20, 'tarjetas=' + meses.tarjetas);
    check('al desplegar un mes aparecen sus tarjetas',
      meses.trasAbrir === meses.contadorHeader && meses.trasAbrir === 20,
      meses.trasAbrir + ' vs contador ' + meses.contadorHeader);

    // ── Buscar muestra los resultados desplegados, aunque sean de meses viejos ──
    const busq = await page.evaluate(() => {
      _userTouchedMonths = false; _expandedMonths.clear();
      const inp = document.getElementById('hist-search');
      inp.value = 'Cliente 200';           // está en un mes que NO es el abierto
      _histSearchSync(inp);
      renderHistory();
      const cards = [...document.querySelectorAll('#history-list .hitem')];
      // Con filtros activos el listado se rinde PLANO (sin secciones de mes),
      // así que el resultado siempre queda a la vista aunque sea de un mes viejo.
      const enMes = cards.filter(c => c.closest('.hmonth')).length;
      return { cards: cards.length, enMes,
               texto: (cards[0] || {}).textContent || '' };
    });
    check('buscar encuentra el presupuesto', busq.cards === 1 && /Cliente 200/.test(busq.texto), JSON.stringify(busq));
    check('y lo muestra plano, a la vista (no dentro de un mes colapsable)', busq.enMes === 0);

    // ── El buscador está debounced ──
    const deb = await page.evaluate(async () => {
      const inp = document.getElementById('hist-search');
      inp.value = ''; _histSearchSync(inp); renderHistory();
      let renders = 0;
      const orig = window.renderHistory;
      window.renderHistory = function(){ renders++; return orig.apply(this, arguments); };
      // Simular que se tipea "Cliente 1" letra por letra
      for (const ch of 'Cliente 1') {
        inp.value += ch;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const durante = renders;
      await new Promise(r => setTimeout(r, 400));
      const despues = renders;
      window.renderHistory = orig;
      return { teclas: 'Cliente 1'.length, durante, despues };
    });
    check('escribir 9 letras NO dispara 9 renders', deb.durante === 0, 'renders durante el tecleo=' + deb.durante);
    check('tras la pausa se renderiza una sola vez', deb.despues === 1, 'renders totales=' + deb.despues);

    // ── goToHistoryEntry sigue encontrando y resaltando la tarjeta ──
    const ir = await page.evaluate(async () => {
      _userTouchedMonths = false; _expandedMonths.clear();
      const inp = document.getElementById('hist-search'); inp.value = ''; _histSearchSync(inp);
      renderHistory();
      goToHistoryEntry(1200);                 // un presupuesto de un mes cerrado
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = document.querySelector('.hitem[data-id="1200"]');
      return { existe: !!card, resaltada: !!(card && card.classList.contains('hitem-flash')) };
    });
    check('goToHistoryEntry despliega el mes y encuentra la tarjeta', ir.existe);
    check('…y la resalta', ir.resaltada);

    // ── Tiempos (informativo) ──
    const t = await page.evaluate(() => {
      _userTouchedMonths = false; _expandedMonths.clear();
      document.getElementById('hist-search').value = '';
      const medir = (f) => { const a = performance.now(); f(); return performance.now() - a; };
      renderHistory();
      return { render: medir(() => renderHistory()),
               agenda: medir(() => { switchTab('agenda'); calInit(); }),
               mes: medir(() => calSetView('mes')) };
    });
    console.log(`\nreferencia (240 presupuestos, escritorio):`);
    console.log(`  renderHistory()      ${t.render.toFixed(0)} ms`);
    console.log(`  abrir Agenda         ${t.agenda.toFixed(0)} ms`);
    console.log(`  cambiar a vista Mes  ${t.mes.toFixed(0)} ms`);

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
