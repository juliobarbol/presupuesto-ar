// test/visual-snap.cjs — Capturas de referencia para verificar que un cambio
// de CSS NO altera la apariencia.
//
// Nació para la Fase 0a del rediseño del editor (tokenizar el CSS sin cambiar
// ningún valor): su criterio de aceptación es "la app se ve EXACTAMENTE igual",
// y eso hay que poder demostrarlo, no afirmarlo.
//
// Uso:
//   node test/visual-snap.cjs base     → guarda las capturas de referencia
//   node test/visual-snap.cjs check    → recaptura y compara contra la referencia
//
// Las capturas van a un directorio temporal (no al repo). Compara píxel a píxel
// y reporta cuántos difieren por escena.
//
// Requisitos (los deja el hook .claude/hooks/session-start.sh):
//   - $PUPPETEER_EXECUTABLE_PATH → binario chrome-headless-shell
//   - $NODE_PATH → node_modules con puppeteer-core

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SNAP_DIR ||
  path.join(process.env.TMPDIR || '/tmp', 'presupuesto-visual-snap');
const PORT = 8700 + (process.pid % 200);

// Instante fijo para todas las corridas: mediodía del 15/07/2026 en Argentina
// (UTC-3). Mediodía y no medianoche para que ningún cálculo de fecha local
// quede pegado a un borde de día.
const FAKE_NOW = Date.parse('2026-07-15T15:00:00Z');

const MODE = (process.argv[2] || 'base').toLowerCase();
if (!['base', 'check'].includes(MODE)) {
  console.error('Uso: node test/visual-snap.cjs [base|check]');
  process.exit(2);
}

// ─── Servidor estático mínimo ──────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('no');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ─── Escenas ───────────────────────────────────────────────────────
// Cada escena: un tema + una pestaña + un estado del editor. El objetivo es
// cubrir la mayor superficie de CSS posible con pocas capturas.
const SCENES = [
  { id: 'editor-normal',  theme: 'light', setup: s => s.mode('normal') },
  { id: 'editor-est',     theme: 'light', setup: s => s.mode('estimativo') },
  { id: 'editor-riesgo',  theme: 'light', setup: s => s.mode('riesgo') },
  { id: 'empresa',        theme: 'light', setup: s => s.tab('empresa') },
  // Sub-pestaña "Estilo": es donde vive la configuración de apariencia (tema,
  // vista del editor, color, diseño y tipografía del PDF). Los .subpanel sin
  // .active van en display:none, así que la escena `empresa` NO la cubre.
  { id: 'estilo',         theme: 'light', setup: s => { s.tab('empresa'); s.subtab('estilo'); } },
  { id: 'estilo-d',       theme: 'dark',  setup: s => { s.tab('empresa'); s.subtab('estilo'); } },
  { id: 'historial',      theme: 'light', setup: s => s.tab('historial') },
  { id: 'agenda',         theme: 'light', setup: s => s.tab('agenda') },
  { id: 'facturacion',    theme: 'light', setup: s => s.tab('facturacion') },
  { id: 'editor-normal-d', theme: 'dark', setup: s => s.mode('normal') },
  { id: 'editor-riesgo-d', theme: 'dark', setup: s => s.mode('riesgo') },
  { id: 'empresa-d',       theme: 'dark', setup: s => s.tab('empresa') },
  { id: 'historial-d',     theme: 'dark', setup: s => s.tab('historial') },
  { id: 'agenda-d',        theme: 'dark', setup: s => s.tab('agenda') },
];

// Datos sembrados: sin ítems ni historial, media app queda vacía y el CSS de
// las tarjetas no se ejercita. Se siembra ANTES de cargar la página.
function seedScript() {
  const snapshot = {
    clientName: 'Consorcio Rivadavia 2210', clientContact: '11 5555 4444',
    workAddress: 'Rivadavia 2210, Ramos Mejía', workDuration: '2 días',
    dateIssue: '2026-07-20', dateExpiry: '2026-08-04', currency: 'ARS',
    discount: 0, surchargePct: 12,
    paymentConditions: '50% al inicio, 50% contra entrega.',
    observations: 'Retiro de restos incluido.',
    items: [
      { id: 1, type: 'tree', species: 'Tipuana', desc: 'Poda de despeje · 14 m · trepa · con retiro', price: '245000', qty: 1 },
      { id: 2, type: 'tree', species: 'Fresno', desc: 'Extracción · 9 m · vereda', price: '190000', qty: 1 },
      { id: 3, type: 'service', desc: 'Retiro de restos', price: '51000', qty: 1 },
    ],
    estItems: [
      { id: 4, type: 'tree', species: 'Fresno', desc: 'Poda estimada por fotos', price: '180000', qty: 1 },
    ],
  };
  // Forma real de una entrada del historial (ver sanitizeHistory): las fechas
  // del ciclo comercial son timestamps y el snapshot es el estado completo.
  const hist = [{
    id: 1721300000000, quoteNumber: 'PRE-0142', clientName: 'Consorcio Rivadavia 2210',
    currency: 'ARS', total: 544320, itemCount: 3, estado: 'enviado',
    savedAt: 1721300000000, enviadoEn: 1721300000000,
    fechasTrabajo: ['2026-08-02'], snapshot,
  }, {
    id: 1720600000000, quoteNumber: 'PRE-0141', clientName: 'Municipalidad de Morón',
    currency: 'ARS', total: 320000, itemCount: 2, estado: 'aceptado',
    savedAt: 1720600000000, recontactoEn: '2026-08-10', snapshot,
  }];
  const notes = [{ id: 1721400000000, fecha: '2026-08-01', texto: 'Visita a Rivadavia', tipo: 'visita', hecho: false }];
  const facturas = [{ id: 1719800000000, fecha: '2026-07-01', numero: 'A-0001', monto: 320000, cliente: 'Municipalidad de Morón' }];
  return { snapshot, hist, notes, facturas };
}

async function run() {
  const puppeteer = require('puppeteer-core');
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!exe) { console.error('Falta $PUPPETEER_EXECUTABLE_PATH'); process.exit(2); }

  fs.mkdirSync(OUT, { recursive: true });
  const dir = path.join(OUT, MODE === 'base' ? 'base' : 'check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });

  const seed = seedScript();
  let failed = 0, total = 0;

  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });

    // Sembrar localStorage y fijar el tema ANTES de que corra el script inline.
    await page.evaluateOnNewDocument((seed, theme, FAKE_NOW) => {
      // Congelar el reloj. Sin esto, cualquier campo con la fecha de hoy
      // (el datepicker de Facturas, los banners) cambia al cruzar la
      // medianoche y la comparación da un falso positivo: pasó, y perdí un
      // rato buscando una regresión de CSS que era el 29 volviéndose 30.
      const RealDate = Date;
      class FrozenDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [FAKE_NOW])); }
        static now() { return FAKE_NOW; }
      }
      // eslint-disable-next-line no-global-assign
      Date = FrozenDate;
      try {
        // Claves reales del objeto LS (pq_s / pq_h, no las *_LEGACY).
        localStorage.setItem('pq_theme', theme);
        localStorage.setItem('pq_s', JSON.stringify(seed.snapshot));
        localStorage.setItem('pq_h', JSON.stringify(seed.hist));
        localStorage.setItem('pq_agenda_notes', JSON.stringify(seed.notes));
        localStorage.setItem('pq_facturas', JSON.stringify(seed.facturas));
        localStorage.setItem('pq_onboarded', '1');
        localStorage.setItem('pq_day_alert_seen', '2999-01-01');
      } catch (e) {}
    }, seed, scene.theme, FAKE_NOW);

    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    // El SW de una corrida anterior puede servir HTML viejo: no lo dejamos actuar.
    await page.evaluate(async () => {
      if (navigator.serviceWorker) {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map(r => r.unregister()));
      }
    });

    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));

    // Llevar la app a la escena pedida.
    const target = { mode: null, tab: null, subtab: null };
    scene.setup({
      mode: m => (target.mode = m),
      tab: t => (target.tab = t),
      subtab: s => (target.subtab = s),
    });
    await page.evaluate(t => {
      if (t.mode && typeof setMode === 'function') setMode(t.mode);
      if (t.tab && typeof switchTab === 'function') switchTab(t.tab);
      if (t.subtab && typeof switchSubtab === 'function') switchSubtab(t.subtab);
    }, target);

    // Congelar todo lo que se mueve o depende del reloj: sin esto la
    // comparación píxel a píxel da falsos positivos.
    //
    // Y abrir el scroll: #app es height:100dvh;overflow:hidden y #main es el
    // que scrollea, así que una captura fullPage normal devuelve solo el alto
    // del viewport (el tope de la pestaña). Soltando los dos, el documento
    // crece y fullPage agarra el panel entero. Se aplica igual en base y en
    // check, así que la comparación sigue siendo válida.
    await page.addStyleTag({ content: `
      *,*::before,*::after{transition:none!important;animation:none!important;
        caret-color:transparent!important;scroll-behavior:auto!important}
      #toast-wrap,.toast,#clima-overlay,#notif-overlay{display:none!important}
      /* El indicador de guardado alterna entre "Guardando…" y "✓ Guardado"
         según si había un save en vuelo al disparar la captura. Se oculta
         con visibility para no mover el layout. */
      #save-status{visibility:hidden!important}
      #app{height:auto!important;overflow:visible!important}
      /* padding-bottom lo escribe reserveStickySpace() midiendo la barra de
         totales; esa medición varía unos px según cuándo corra y metía falsos
         positivos. Se fija acá (!important gana sobre el style inline). */
      #main{overflow:visible!important;flex:none!important;padding-bottom:20px!important}
    ` });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    const file = path.join(dir, scene.id + '.png');
    await page.screenshot({ path: file, fullPage: true });
    await page.close();

    total++;
    if (MODE === 'check') {
      const ref = path.join(OUT, 'base', scene.id + '.png');
      if (!fs.existsSync(ref)) { console.log(`  ? ${scene.id} — sin referencia`); continue; }
      const d = diffPng(ref, file);
      if (d.equal) console.log(`  ✓ ${scene.id} — idéntica (${d.w}×${d.h})`);
      else { failed++; console.log(`  ✗ ${scene.id} — ${d.reason}`); }
    } else {
      console.log(`  · ${scene.id} guardada`);
    }
  }

  await browser.close();
  srv.close();

  if (MODE === 'base') {
    console.log(`\nReferencia guardada en ${path.join(OUT, 'base')} (${total} escenas).`);
  } else if (failed) {
    console.log(`\n✗ ${failed}/${total} escenas cambiaron. La Fase 0a exige 0.`);
    process.exit(1);
  } else {
    console.log(`\n✓ Las ${total} escenas son idénticas píxel a píxel.`);
  }
}

// ─── Comparación PNG sin dependencias ──────────────────────────────
// Decodifica el PNG a mano (solo lo que produce Chrome: color type 6, bit
// depth 8, sin entrelazado) y compara los bytes de píxel.
function decodePng(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('PNG no soportado');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= channels) ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

function diffPng(fileA, fileB) {
  const a = decodePng(fileA), b = decodePng(fileB);
  if (a.w !== b.w || a.h !== b.h) {
    return { equal: false, reason: `tamaño ${a.w}×${a.h} → ${b.w}×${b.h}`, w: a.w, h: a.h };
  }
  let bad = 0, firstY = -1, firstX = -1;
  const ch = a.channels;
  for (let i = 0; i < a.data.length; i += ch) {
    let same = true;
    for (let k = 0; k < ch; k++) if (a.data[i + k] !== b.data[i + k]) { same = false; break; }
    if (!same) {
      bad++;
      if (firstY < 0) { const px = i / ch; firstY = Math.floor(px / a.w); firstX = px % a.w; }
    }
  }
  if (!bad) return { equal: true, w: a.w, h: a.h };
  const pct = (bad / (a.w * a.h) * 100).toFixed(3);
  return { equal: false, reason: `${bad} px distintos (${pct}%), primero en (${firstX},${firstY})`, w: a.w, h: a.h };
}

run().catch(e => { console.error(e); process.exit(1); });
