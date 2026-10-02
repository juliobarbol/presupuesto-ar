// test/uso-tanda2.test.cjs — Facilidad de uso, tanda 2.
//
// Lo que se protege:
//
//   1. Identificación plegada en una línea (identResSync): número, fechas y
//      moneda casi nunca se cambian y ocupaban ~250 px arriba del cliente.
//   2. "Duplicar" en el Historial (duplicarQuote): número nuevo, fecha de hoy,
//      sin vínculos de versión ni fotos, el original intacto, con "Deshacer".
//   3. La Agenda: los botones de cada evento llevan texto.
//   4. Los avisos que la app dispara sola salen de a uno (colaAviso), y no
//      encima del aviso del día.
//
// El selector de modo compacto y la barra de progreso los cubre
// test/editor-shell.test.cjs.
//
// Uso:  node test/uso-tanda2.test.cjs

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
  await page.setViewport({ width: 360, height: 740 });
  page.on('pageerror', (e) => { allOk = false; console.log('PAGEERROR', e.message); });
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__pre')) return;
      sessionStorage.setItem('__pre', '1');
      localStorage.clear();
      localStorage.setItem('pq_onboarded', '1');
      localStorage.setItem('pq_last_backup', '2099-01-01');
    } catch (_) {}
  });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => {
    document.querySelectorAll('.open').forEach(o => { if (/overlay/.test(o.id)) o.classList.remove('open'); });
    document.querySelectorAll('#toast-container .toast').forEach(t => t.remove());
  });
  return page;
}

// Un presupuesto cargado en el editor, guardado en el historial.
const SEMBRAR = `
  S.numPrefix = '2026-'; S.numNext = 1;
  S.dateIssue = today(); calcExpiry(); S.quoteNumber = mkQN();
  S.clientName = 'María Gómez'; S.clientContact = '351 5551234';
  S.items = [{ id: 1, type: 'tree', species: 'Eucalipto', desc: 'Extracción', price: '300000', qty: 1,
               photos: ['p_falsa1'] }];
  S.dispoPhotos = ['p_falsa2']; S.dispoNota = 'Leña contra el alambrado';
  noSync = true; restoreUI(); noSync = false;
  renderItems(); applyMode('normal');
  autoSaveToHistory();
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  try {

    // ── 1: Identificación plegada ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        setVistaEditor('clasica');
        const campos = document.getElementById('ident-campos');
        const res = document.getElementById('ident-res');
        const alto = el => Math.round(el.getBoundingClientRect().height);
        const plegado = { oculto: campos.hidden, alto: alto(document.getElementById('esec-ident')),
          resumen: res.textContent.replace(/\\s+/g, ' ').trim() };
        res.click();
        const abierto = { oculto: campos.hidden, aria: res.getAttribute('aria-expanded'),
          alto: alto(document.getElementById('esec-ident')) };
        // El resumen sigue a los datos: cambiar la moneda se ve en la línea.
        S.currency = 'USD'; editorShellSync();
        const conUsd = res.textContent;
        res.click();
        // En fichas la ficha se pliega sola: adentro van los campos directo.
        setVistaEditor('fichas'); editorToggleSection('ident');
        const fichas = { resumenVisible: getComputedStyle(res).display !== 'none',
          camposVisibles: getComputedStyle(campos).display !== 'none' };
        setVistaEditor('clasica');
        return { plegado, abierto, conUsd, fichas, num: S.quoteNumber };
      `));
      check('Identificación arranca plegada en una línea', r.plegado.oculto && r.plegado.alto < 120,
        `alto=${r.plegado.alto}px`);
      check('La línea dice número, fechas y "Cambiar"',
        r.plegado.resumen.includes(r.num) && /emitido \d\d\/\d\d\/\d{4}/.test(r.plegado.resumen)
        && /vence/.test(r.plegado.resumen) && /Cambiar/.test(r.plegado.resumen), r.plegado.resumen);
      check('Tocarla despliega los campos', !r.abierto.oculto && r.abierto.aria === 'true'
        && r.abierto.alto > r.plegado.alto, `alto=${r.abierto.alto}px`);
      check('La línea se actualiza con los datos (moneda)', /USD/.test(r.conUsd), r.conUsd.replace(/\s+/g, ' '));
      check('En fichas no hay resumen: la ficha muestra los campos',
        !r.fichas.resumenVisible && r.fichas.camposVisibles, JSON.stringify(r.fichas));
      await page.close();
    }

    // ── 2: Duplicar ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        // El original es de hace dos meses y quedó aceptado.
        const h = getH(); const d = new Date(); d.setDate(d.getDate() - 60);
        h[0].snapshot.dateIssue = toLocalISODate(d); h[0].estado = 'aceptado'; setH(h);
        const orig = getH()[0];
        // En el editor hay otro presupuesto a medio hacer.
        S.quoteNumber = '2026-0002'; S.numNext = 2; S.clientName = 'Otro cliente';
        S.items = [{ id: 1, type: 'tree', species: 'Pino', desc: 'Poda', price: '90000', qty: 1 }];
        noSync = true; restoreUI(); noSync = false; renderItems();
        switchTab('historial');
        // El original cae en un mes plegado (no genera su HTML): se lo busca.
        document.getElementById('hist-search').value = 'María'; renderHistory();
        const btn = [...document.querySelectorAll('#history-list .hitem[data-id="' + orig.id + '"] button')]
          .find(b => /Duplicar/.test(b.textContent));
        if (!btn) return { sinBoton: true };
        btn.click();
        const dup = { num: S.quoteNumber, fecha: S.dateIssue, cliente: S.clientName,
          items: S.items.length, precio: S.items[0] && S.items[0].price,
          fotosItem: itemPhotoRefs(S.items[0]).length, fotosDispo: (S.dispoPhotos || []).length,
          nota: S.dispoNota, version: S.versionN,
          tab: document.querySelector('.tab-panel.active').id };
        const origDespues = getH().find(e => e.id === orig.id);
        const guardadoElOtro = getH().some(e => e.quoteNumber === '2026-0002' && e.clientName === 'Otro cliente');
        const deshacer = [...document.querySelectorAll('#toast-container .toast-btn')].find(b => b.textContent === 'Deshacer');
        const toastTxt = (document.querySelector('#toast-container .toast-action span') || {}).textContent || '';
        if (deshacer) deshacer.click();
        return { dup, hoy: today(), origNum: orig.quoteNumber,
          origIntacto: origDespues && origDespues.estado === 'aceptado'
            && itemPhotoRefs(origDespues.snapshot.items[0]).length === 1,
          guardadoElOtro, hayDeshacer: !!deshacer, toastTxt,
          vuelta: { num: S.quoteNumber, cliente: S.clientName } };
      `));
      if (r.sinBoton) { check('La tarjeta del historial ofrece "Duplicar"', false); }
      else {
        check('La tarjeta del historial ofrece "Duplicar"', true);
        check('La copia lleva número nuevo y fecha de hoy',
          r.dup.num !== r.origNum && r.dup.num !== '2026-0002' && r.dup.fecha === r.hoy,
          `${r.origNum} → ${r.dup.num} · ${r.dup.fecha}`);
        check('…con el cliente y los trabajos del original',
          r.dup.cliente === 'María Gómez' && r.dup.items === 1 && r.dup.precio === '300000'
          && r.dup.nota === 'Leña contra el alambrado', JSON.stringify(r.dup));
        check('…sin fotos ni vínculo de versión', r.dup.fotosItem === 0 && r.dup.fotosDispo === 0
          && !r.dup.version, JSON.stringify(r.dup));
        check('…y abre en el Editor', r.dup.tab === 'panel-editor');
        check('El original queda intacto (estado y fotos)', r.origIntacto === true);
        check('Lo que estaba en el editor quedó guardado', r.guardadoElOtro === true);
        check('El aviso dice que las fotos no se copian', /fotos no se copian/.test(r.toastTxt), r.toastTxt);
        check('"Deshacer" vuelve al presupuesto que estaba abierto',
          r.hayDeshacer && r.vuelta.num === '2026-0002' && r.vuelta.cliente === 'Otro cliente',
          JSON.stringify(r.vuelta));
      }
      const colab = await page.evaluate(() => {
        setH([]);
        setMisServicios([]); saveMiServicio({ nombre: 'Jornada', precio: 100000, unidad: 'jornada' });
        abrirColaboracion(null, 'colab');
        document.getElementById('colab-nombre').value = 'Jornada';
        document.getElementById('colab-precio').value = '100000';
        document.getElementById('colab-cant').value = '1';
        document.getElementById('colab-fecha').value = today();
        document.getElementById('colab-colega').value = 'Martín';
        colabSync(); colabGuardar();
        renderHistory();
        return [...document.querySelectorAll('#history-list .hitem.is-colab button')].some(b => /Duplicar/.test(b.textContent));
      });
      check('Los trabajos sin presupuesto no ofrecen "Duplicar"', colab === false);
      await page.close();
    }

    // ── 3: Agenda con texto en los botones ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(new Function(`
        ${SEMBRAR}
        const h = getH(); h[0].estado = 'enviado'; setH(h);
        switchTab('agenda');
        if (typeof calSetView === 'function') calSetView('agenda');
        renderCal();
        const ev = document.querySelector('.agc-ev');
        if (!ev) return { sinEvento: true };
        const btns = [...ev.querySelectorAll('.agc-ev-btn')];
        return {
          textos: btns.map(b => b.textContent.trim()),
          sinTexto: btns.filter(b => !b.textContent.trim()).length,
          unaFila: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size === 1,
          debajo: (() => { const a = ev.querySelector('.agc-ev-acts'), t = ev.querySelector('.agc-ev-title');
                           return a.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1; })(),
          tituloUnaLinea: (() => { const t = ev.querySelector('.agc-ev-title');
                           return t.getBoundingClientRect().height < parseFloat(getComputedStyle(t).fontSize) * 1.9; })(),
        };
      `));
      if (r.sinEvento) check('La Agenda muestra el vencimiento', false);
      else {
        check('Todos los botones del evento tienen texto', r.sinTexto === 0 && r.textos.length >= 2,
          r.textos.join(' · '));
        check('El botón del libro dice "Ver"', r.textos.includes('Ver'), r.textos.join(' · '));
        check('Los botones entran en una sola fila a 360 px', r.unaFila === true, r.textos.join(' · '));
        check('Los botones van debajo del evento', r.debajo === true);
        check('El título ya no se parte en dos líneas', r.tituloUnaLinea === true);
      }
      await page.close();
    }

    // ── 4: avisos de a uno ──
    {
      const page = await nuevaPagina(browser);
      const r = await page.evaluate(async () => {
        const espera = ms => new Promise(r => setTimeout(r, ms));
        const vivos = () => [...document.querySelectorAll('#toast-container .toast-action')].map(t => t.querySelector('span').textContent);
        colaAviso(() => toastAccion('Aviso A', [{ label: 'OK', fn: () => {} }], 30000));
        colaAviso(() => toastAccion('Aviso B', [{ label: 'OK', fn: () => {} }], 30000));
        colaAviso(() => null);   // al final no había nada que avisar: no traba la cola
        colaAviso(() => toastAccion('Aviso C', [{ label: 'OK', fn: () => {} }], 30000));
        await espera(100);
        const alPrincipio = vivos();
        document.querySelector('#toast-container .toast-action .toast-btn').click();
        await espera(900);
        const trasCerrarA = vivos();
        document.querySelector('#toast-container .toast-action .toast-btn').click();
        await espera(900);
        const trasCerrarB = vivos();
        document.querySelector('#toast-container .toast-action .toast-btn').click();
        await espera(900);
        // Con el aviso del día abierto, la cola espera.
        document.getElementById('day-alert-overlay').classList.add('open');
        colaAviso(() => toastAccion('Aviso D', [], 30000));
        await espera(300);
        const conAvisoDelDia = vivos();
        document.getElementById('day-alert-overlay').classList.remove('open');
        await espera(1200);
        const trasCerrarloDia = vivos();
        // Lo que responde a un toque no espera: sale aunque haya un aviso.
        toastAccion('Deshacer algo', [{ label: 'Deshacer', fn: () => {} }]);
        const inmediato = vivos();
        return { alPrincipio, trasCerrarA, trasCerrarB, conAvisoDelDia, trasCerrarloDia, inmediato };
      });
      check('Al principio se ve un solo aviso', r.alPrincipio.join() === 'Aviso A', r.alPrincipio.join(' | '));
      check('Al cerrarlo sale el siguiente', r.trasCerrarA.join() === 'Aviso B', r.trasCerrarA.join(' | '));
      check('Un aviso que al final no se arma no traba la cola', r.trasCerrarB.join() === 'Aviso C',
        r.trasCerrarB.join(' | '));
      check('Con el aviso del día abierto, la cola espera', r.conAvisoDelDia.length === 0,
        r.conAvisoDelDia.join(' | '));
      check('…y sale al cerrarlo', r.trasCerrarloDia.join() === 'Aviso D', r.trasCerrarloDia.join(' | '));
      check('Lo que responde a un toque sale ya, sin esperar',
        r.inmediato.includes('Deshacer algo') && r.inmediato.includes('Aviso D'), r.inmediato.join(' | '));
      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log(allOk ? '\n✓ TODOS LOS CHECKS OK' : '\n✗ HUBO FALLOS');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('ERROR', (e && e.stack) || e); process.exit(1); });
