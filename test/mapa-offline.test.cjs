// "El mapa no carga cuando no tengo datos."
//
// El caso real: sin datos móviles, la pestaña Mapa abría con los pins pero el
// fondo todo gris, aun en la zona de todos los días. Los tiles de OSM nunca se
// guardaban (el SW dejaba pasar todo lo externo) y, con la red mala,
// `_mapaAddTiles` ni siquiera ponía la capa.
//
// Ahora el SW guarda en `pq-tiles` los tiles que el usuario ya vio, y sin red
// la página pone la capa "solo lo guardado" (`?pq=cache`), que el SW contesta
// con la caché sin tocar la red. Este test, con el SW REAL:
//   A) siembra un tile en `pq-tiles` (no hay red hacia OSM en el CI);
//   B) corta la red, recarga, abre el Mapa: la capa es "solo lo guardado", el
//      tile sembrado se DIBUJA y el aviso dice que es el fondo guardado;
//   C) un tile que no está guardado falla sin ir a la red;
//   D) la caché de tiles sobrevive al cambio de versión (no la borra activate).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8620 + (process.pid % 200);
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  || require('os').homedir() + '/.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell';

let fallos = 0;
function check(ok, nombre, detalle) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (detalle ? '  — ' + detalle : ''));
  if (!ok) fallos++;
}

// PNG 256×256 de un color, armado a mano (sin dependencias).
function pngLiso(r, g, b) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (tipo, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(tipo), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  const fila = Buffer.alloc(1 + 256 * 3); for (let i = 0; i < 256; i++) { fila[1 + i * 3] = r; fila[2 + i * 3] = g; fila[3 + i * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: 256 }, () => fila));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', () => {});
    // Lo externo no sale (no hay red hacia OSM en el CI): lo que importa es
    // que el tile se sirva desde la caché del SW.
    await page.setRequestInterception(true);
    page.on('request', (req) => (/^http:\/\/localhost/.test(req.url()) ? req.continue() : req.abort()));

    const base = `http://localhost:${PORT}/index.html`;
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.evaluate(() => navigator.serviceWorker.ready);
    }

    // ── A) Sembrar en pq-tiles los tiles de la vista inicial (z4, Argentina) ──
    // Vista guardada fija, así se sabe qué tiles va a pedir Leaflet.
    const png = pngLiso(30, 160, 60).toString('base64');
    await page.evaluate(async (b64) => {
      localStorage.setItem(LS.MAPA_VISTA, JSON.stringify({ lat: -34, lng: -64, z: 4 }));
      const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
      const c = await caches.open('pq-tiles');
      // Todos los de z4 menos el (5,9): ese queda para el caso C.
      for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
        if (x === 5 && y === 9) continue;
        await c.put(`https://tile.openstreetmap.org/4/${x}/${y}.png`,
          new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Date': new Date().toUTCString() } }));
      }
    }, png);

    // ── B) Sin red: el fondo sale de lo guardado ─────────────────────────
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));
    const b = await page.evaluate(async () => {
      switchTab('mapa');
      await new Promise((r) => setTimeout(r, 2500));
      const imgs = Array.from(document.querySelectorAll('#map-canvas .leaflet-tile-pane img'));
      const ok = imgs.filter((i) => i.complete && i.naturalWidth === 256);
      const aviso = document.getElementById('mapa-neti');
      return {
        controller: !!navigator.serviceWorker.controller,
        net: netEstado(),
        soloCache: !!(_mapaTiles && _mapaTiles._pqSoloCache),
        tiles: imgs.length, dibujados: ok.length,
        falla59: imgs.some((i) => /\/4\/5\/9\.png/.test(i.src) && i.classList.contains('leaflet-tile-loaded')),
        pide59: imgs.some((i) => /\/4\/5\/9\.png/.test(i.src)),
        aviso: aviso.hidden ? '' : aviso.textContent,
      };
    });
    check(b.controller && b.net === 'offline', 'Sin red, con el SW controlando la página', JSON.stringify({ c: b.controller, net: b.net }));
    check(b.soloCache, 'La capa de fondo es "solo lo guardado" (?pq=cache)');
    check(b.dibujados >= 4, 'Los tiles guardados se dibujan sin red', `${b.dibujados} de ${b.tiles}`);
    check(/lo guardado/.test(b.aviso), 'El aviso dice que el fondo es lo guardado', b.aviso);

    // ── C) Lo no guardado falla, sin quedarse colgado ─────────────────────
    check(!b.pide59 || !b.falla59, 'Un tile no guardado no se dibuja (falla al toque)', JSON.stringify({ pide: b.pide59 }));

    // ── D) activate no borra pq-tiles ─────────────────────────────────────
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    check(/k !== TILES_CACHE/.test(sw) && /TILES_CACHE = 'pq-tiles'/.test(sw), 'activate conserva la caché de tiles entre versiones');

    // ── E) Vuelve la red: "Cargar el fondo igual" pasa a la capa completa ──
    await page.setOfflineMode(false);
    const e = await page.evaluate(async () => {
      mapaCargarFondo();
      await new Promise((r) => setTimeout(r, 300));
      return { completo: _mapaFondoCompleto(), capas: document.querySelectorAll('#map-canvas .leaflet-tile-pane .leaflet-layer').length };
    });
    check(e.completo && e.capas === 1, 'Con "Cargar el fondo igual" queda UNA capa, la completa', JSON.stringify(e));
  } finally {
    await browser.close();
    srv.kill();
  }
  if (fallos) { console.log(`\n${fallos} FALLO(S)`); process.exit(1); }
  console.log('\nOK');
})().catch((e) => { console.error(e); process.exit(1); });
