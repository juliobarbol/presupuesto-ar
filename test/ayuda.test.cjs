// Configuración → Ayuda (v261, js/ayuda.js).
//
// La ayuda es contenido estático que habla de la pantalla, así que el riesgo
// es que quede vieja: un "Llevame ahí" a un botón que ya no existe, o un
// "Ver también" a un artículo borrado. Este test lo vigila, y también que el
// buscador entienda cómo escribe la gente:
//   A) Integridad: ids únicos y seguros para onclick, relacionados y grupos.
//   B) Cada "Llevame ahí" llega a su pestaña y hace destellar algo.
//   C) Buscador: sin tildes, plurales, sinónimos, palabras de relleno.
//   D) La pantalla: buscar, abrir, "Llevame ahí" y "Ver también".
//   E) En las vistas Fichas y Etapas abre la sección; en otro modo avisa.
//   F) Entra en un celular de 360 px (las 5 subtabs sin cortar).

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  || require('os').homedir() + '/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

function isoEnDias(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Un enviado vencido y uno aceptado: así existen el aviso de vencidos, el
// botón de la lista y los selectores de estado de las tarjetas.
function historial() {
  const alta = (id, cli, estado, venc) => ({
    id, quoteNumber: '2026-0' + id, clientName: cli, estado, total: 5000000, currency: 'ARS',
    savedAt: '2026-08-01T12:00:00.000Z', enviadoEn: '2026-08-01T12:00:00.000Z',
    snapshot: { quoteNumber: '2026-0' + id, clientName: cli, dateIssue: isoEnDias(-60),
      dateExpiry: isoEnDias(venc), validityDays: 30, items: [] },
  });
  return [alta(801, 'Cliente vencido', 'enviado', -10), alta(802, 'Cliente vigente', 'aceptado', 20)];
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', (req) => { if (req.url().startsWith('file://')) req.continue(); else req.abort(); });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));

  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.evaluate((h) => {
    localStorage.clear();
    localStorage.setItem('pq_onboarded', '1');
    localStorage.setItem('pq_h', JSON.stringify(h));
  }, historial());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));

  // ── A) Integridad ─────────────────────────────────────────────────────
  const a = await page.evaluate(() => {
    const todos = AYUDA.map(x => x.id).concat(AYUDA_GLOSARIO.map(x => x.id));
    const grupos = AYUDA_GRUPOS.map(g => g.k);
    const rels = AYUDA.concat(AYUDA_GLOSARIO).flatMap(x => (x.rel || []).map(r => [x.id, r]));
    return {
      n: AYUDA.length, nG: AYUDA_GLOSARIO.length,
      repetidos: todos.filter((id, i) => todos.indexOf(id) !== i),
      malos: todos.filter(id => !/^[a-z0-9-]+$/.test(id)),
      relRotos: rels.filter(([, r]) => !todos.includes(r)).map(p => p.join('→')),
      sinGrupo: AYUDA.filter(x => !grupos.includes(x.g) || x.g === 'glosario').map(x => x.id),
      sinTexto: AYUDA.filter(x => !x.t || !x.kw || !(x.txt || []).length).map(x => x.id),
      gruposVacios: grupos.filter(g => g !== 'glosario' && !AYUDA.some(x => x.g === g)),
    };
  });
  check(a.n === 42 && a.nG >= 15, '42 artículos y el glosario', `${a.n} artículos, ${a.nG} términos`);
  check(!a.repetidos.length && !a.malos.length, 'Ids únicos y seguros para onclick', JSON.stringify([a.repetidos, a.malos]));
  check(!a.relRotos.length, 'Todos los "Ver también" apuntan a artículos que existen', a.relRotos.join(', '));
  check(!a.sinGrupo.length && !a.gruposVacios.length, 'Cada artículo en un grupo y ningún grupo vacío', JSON.stringify([a.sinGrupo, a.gruposVacios]));
  check(!a.sinTexto.length, 'Cada artículo tiene título, palabras clave y texto', a.sinTexto.join(', '));

  // ── B) Cada "Llevame ahí" llega ───────────────────────────────────────
  const b = await page.evaluate(async () => {
    const espera = () => new Promise(r => setTimeout(r, 30));
    const malos = [];
    for (const art of AYUDA.filter(x => x.ir)) {
      document.querySelectorAll('.hitem-flash').forEach(el => el.classList.remove('hitem-flash'));
      // La última opción de cada destino es el respaldo: tiene que existir siempre.
      const ultima = art.ir.sel[art.ir.sel.length - 1];
      if (!document.querySelector(ultima)) { malos.push(art.id + ': no existe ' + ultima); continue; }
      ayudaIr(art.id);
      await espera();
      const panel = document.querySelector('.tab-panel.active');
      if (!panel || panel.id !== 'panel-' + art.ir.tab) { malos.push(art.id + ': pestaña ' + (panel && panel.id)); continue; }
      if (art.ir.sub && !document.querySelector('#subpanel-' + art.ir.sub + '.active')) { malos.push(art.id + ': subpestaña'); continue; }
      if (!document.querySelector('.hitem-flash')) malos.push(art.id + ': nada destelló');
    }
    return malos;
  });
  check(!b.length, 'Cada "Llevame ahí" abre su pestaña y hace destellar el lugar', b.join(' | '));

  // ── C) Buscador ───────────────────────────────────────────────────────
  const c = await page.evaluate(() => {
    const primero = (q) => { const r = ayudaBuscar(q); return r.arts.length ? r.arts[0].id : ''; };
    const r = (q) => ayudaBuscar(q);
    return {
      enviados: primero('botón de enviados'),
      historial: r('pestaña historial').arts.slice(0, 3).map(x => x.g),
      config: [r('configuracion').arts.length, r('CONFIGURACIÓN').arts.length],
      laburo: primero('laburo sin presupuesto'),
      mando: primero('cómo mando el PDF'),
      backup: primero('backup'),
      celu: primero('celular nuevo'),
      clima: primero('lluvia viento'),
      conv: primero('porcentaje'),
      nada: r('qwertyzx'),
      vacia: r('el botón de la').vacia,
    };
  });
  check(c.enviados === 'estados', '"botón de enviados" lleva a Estados del presupuesto', c.enviados);
  check(c.historial.length === 3 && c.historial.every(g => g === 'historial'), '"pestaña historial" trae los artículos del Historial', c.historial.join(','));
  check(c.config[0] > 0 && c.config[0] === c.config[1], 'Busca sin tildes ni mayúsculas', c.config.join(' / '));
  check(c.laburo === 'sin-presupuesto', '"laburo sin presupuesto" entiende el sinónimo', c.laburo);
  check(c.mando === 'enviar', '"cómo mando el PDF" lleva al envío', c.mando);
  check(c.backup === 'backup' && c.celu === 'backup', '"backup" y "celular nuevo" llevan a la copia de seguridad', c.backup + ' / ' + c.celu);
  check(c.clima === 'clima' && c.conv === 'conversion', 'Clima y conversión por sus palabras', c.clima + ' / ' + c.conv);
  check(!c.nada.arts.length && !c.nada.vacia && c.vacia, 'Sin resultados no inventa; solo relleno = búsqueda vacía');

  // ── D) La pantalla ────────────────────────────────────────────────────
  await page.evaluate(() => { switchTab('empresa'); switchSubtab('ayuda'); });
  const d0 = await page.evaluate(() => ({
    grupos: document.querySelectorAll('#ayuda-res .ayuda-grupo').length,
    arts: document.querySelectorAll('#ayuda-res .ayuda-art').length,
    chips: document.querySelectorAll('#ayuda-chips .ayuda-chip').length,
  }));
  check(d0.grupos === 8 && d0.arts === 42 + await page.evaluate(() => AYUDA_GLOSARIO.length) && d0.chips === 9,
    'Sin buscar, el índice completo por grupos, con chips', JSON.stringify(d0));

  await page.type('#ayuda-q', 'enviados');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  const d1 = await page.evaluate(() => {
    const abierto = document.querySelector('#ayuda-res .ayuda-art.is-open');
    return { id: abierto && abierto.dataset.ayuda, txt: abierto ? abierto.textContent : '',
      boton: !!(abierto && abierto.querySelector('.ayuda-ir')) };
  });
  check(d1.id === 'estados' && /Ir a ver/.test(d1.txt) && d1.boton, 'Buscar abre solo el mejor resultado, con "Llevame ahí"', d1.id);

  const d2 = await page.evaluate(() => {
    document.querySelectorAll('.hitem-flash').forEach(el => el.classList.remove('hitem-flash'));
    document.querySelector('#ayuda-res .ayuda-art.is-open .ayuda-ir').click();
    const fl = document.querySelector('.hitem-flash');
    return { panel: document.querySelector('.tab-panel.active').id, flash: fl ? fl.className : '' };
  });
  check(d2.panel === 'panel-historial' && /csel-btn/.test(d2.flash), '"Llevame ahí" va al Historial y destella el selector de estado (el botón que se ve)', JSON.stringify(d2));

  const d3 = await page.evaluate(() => {
    ayudaVer('vencidos');
    document.querySelector('#ayuda-res [data-ayuda="vencidos"] .ayuda-rel-a').click();
    const abierto = document.querySelector('#ayuda-res .ayuda-art.is-open');
    return { sub: !!document.querySelector('#subpanel-ayuda.active'), id: abierto && abierto.dataset.ayuda };
  });
  check(d3.sub && d3.id === 'vsr', '"Ver también" abre el artículo relacionado', JSON.stringify(d3));

  await page.evaluate(() => { document.getElementById('ayuda-q').value = 'qwertyzx'; ayudaRender(); });
  const d4 = await page.$eval('#ayuda-res', el => el.textContent);
  check(/No encontré nada/.test(d4), 'Sin resultados lo dice y sugiere palabras', d4.trim().slice(0, 60));

  // ── E) Vistas del editor y modos ──────────────────────────────────────
  const e = await page.evaluate(() => {
    setVistaEditor('fichas');
    ayudaIr('ajustes');
    const fichas = _esecOpen;
    setVistaEditor('consola');
    ayudaIr('ajustes');
    const etapa = _esecEtapa;
    const visible = document.getElementById('esec-adjust').getClientRects().length > 0;
    setVistaEditor('clasica');
    document.querySelectorAll('.hitem-flash').forEach(el => el.classList.remove('hitem-flash'));
    ayudaIr('riesgo');
    const fl = document.querySelector('.hitem-flash');
    const toasts = [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join(' | ');
    return { fichas, etapa, visible, flash: fl ? fl.id : '', toasts };
  });
  check(e.fichas === 'adjust', 'Vista Fichas: abre la ficha de Ajustes', e.fichas);
  check(e.etapa === 'cierre' && e.visible, 'Vista Etapas: pasa a la etapa Cierre', e.etapa);
  check(e.flash === 'mode-btn-riesgo' && /modo Riesgo/.test(e.toasts), 'En otro modo, destella el botón del modo y avisa', JSON.stringify(e));

  // ── F) 360 px ─────────────────────────────────────────────────────────
  await page.evaluate(() => { switchTab('empresa'); ayudaVer('primer-presupuesto'); });
  const f = await page.evaluate(() => ({
    cortadas: [...document.querySelectorAll('.subtab-btn')].filter(b => b.scrollWidth > b.clientWidth).map(b => b.textContent.trim()),
    doc: document.documentElement.scrollWidth,
    art: (() => { const b = document.querySelector('#ayuda-res .ayuda-art.is-open'); return b ? b.scrollWidth <= b.clientWidth : false; })(),
  }));
  check(!f.cortadas.length, 'Las 5 subpestañas entran enteras a 360 px', f.cortadas.join(', '));
  check(f.doc <= 360 && f.art, 'La ayuda no desborda a 360 px', JSON.stringify(f));

  check(!errores.length, 'Sin errores de JS', errores.join(' | '));
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
