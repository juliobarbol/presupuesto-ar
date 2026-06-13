#!/usr/bin/env node
// app-shot.cjs — Captura/inspección de Presupuestos AR en navegador headless.
//
// Sirve el repo por HTTP (necesario para registrar el Service Worker), abre
// index.html, opcionalmente inyecta un setup JS, y saca una captura PNG.
// Usa el chrome-headless-shell + puppeteer-core que deja el SessionStart hook.
//
// Requisitos (los provee .claude/hooks/session-start.sh):
//   $PUPPETEER_EXECUTABLE_PATH  → binario chrome-headless-shell
//   $NODE_PATH                  → node_modules con puppeteer-core
//
// Pensado para usarse como CAJA NEGRA: corré --help y llamalo, no hace falta
// leer este fuente.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function usage() {
  console.log(`
app-shot.cjs — captura/inspección headless de Presupuestos AR

Uso:
  node .claude/skills/webapp-testing/scripts/app-shot.cjs [opciones]

Opciones:
  --out <archivo>     Ruta del PNG de salida           (default /tmp/app-shot.png)
  --url <path>        Página a abrir, relativa al repo  (default index.html)
  --setup <archivo>   Archivo .js a ejecutar EN la página antes de capturar
  --eval "<js>"       Snippet JS a ejecutar en la página (alternativa a --setup)
  --selector <css>    Capturar solo ese elemento (ej: ".doc-a4-screen")
  --full              Captura de página completa (full_page)
  --wait <ms>         Espera extra tras cargar          (default 600)
  --width <px>        Ancho del viewport                (default 420, ~celular)
  --height <px>       Alto del viewport                 (default 900)
  --logs              Imprime console.* y errores de la página
  --port <n>          Puerto del server local           (default auto)
  --help              Esta ayuda

Ejemplos:
  # Captura inicial de toda la app (mirar luego /tmp/app.png con Read)
  node .../app-shot.cjs --out /tmp/app.png --full

  # Documento en modo Riesgo, recortado al papel A4 en pantalla
  node .../app-shot.cjs --setup /tmp/setup-riesgo.js --selector ".doc-a4-screen" --out /tmp/riesgo.png

  # Depurar errores de consola
  node .../app-shot.cjs --logs
`);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { usage(); process.exit(0); }

function arg(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const has = (name) => argv.includes(name);

const OUT = arg('--out', '/tmp/app-shot.png');
const URL_PATH = arg('--url', 'index.html').replace(/^\/+/, '');
const SETUP_FILE = arg('--setup', null);
const EVAL_JS = arg('--eval', null);
const SELECTOR = arg('--selector', null);
const FULL = has('--full');
const WAIT = parseInt(arg('--wait', '600'), 10);
const WIDTH = parseInt(arg('--width', '420'), 10);
const HEIGHT = parseInt(arg('--height', '900'), 10);
const LOGS = has('--logs');
const PORT = parseInt(arg('--port', String(8500 + (process.pid % 300))), 10);

const ROOT = path.resolve(__dirname, '..', '..', '..', '..'); // → raíz del repo
const EXEC = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_HEADLESS_SHELL;

if (!EXEC) {
  console.error('Falta $PUPPETEER_EXECUTABLE_PATH. Corré el SessionStart hook primero\n' +
    '(.claude/hooks/session-start.sh).');
  process.exit(2);
}
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.error('No se encontró puppeteer-core. Seteá $NODE_PATH a su node_modules\n' +
    '(lo hace el SessionStart hook).');
  process.exit(2);
}
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No encuentro index.html en ${ROOT}. ¿Cambió la estructura del repo?`);
  process.exit(2);
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));

  const browser = await puppeteer.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let failed = false;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

    if (LOGS) {
      page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    } else {
      page.on('pageerror', () => {}); // ignorar errores de libs externas bloqueadas
    }

    const base = `http://localhost:${PORT}/${URL_PATH}`;
    await page.goto(base, { waitUntil: 'networkidle2', timeout: 30000 });
    try { await page.evaluate(async () => { await navigator.serviceWorker.ready; }); } catch (_) {}

    if (SETUP_FILE) {
      const code = fs.readFileSync(SETUP_FILE, 'utf8');
      await page.evaluate(code);
    }
    if (EVAL_JS) {
      await page.evaluate(EVAL_JS);
    }
    if (WAIT > 0) await new Promise((r) => setTimeout(r, WAIT));

    if (SELECTOR) {
      const el = await page.$(SELECTOR);
      if (!el) {
        console.error(`No se encontró el selector "${SELECTOR}". ¿Hace falta un --setup que lo renderice?`);
        failed = true;
      } else {
        await el.screenshot({ path: OUT });
      }
    } else {
      await page.screenshot({ path: OUT, fullPage: FULL });
    }

    if (!failed) console.log(`OK → ${OUT}`);
  } catch (e) {
    console.error('ERROR', (e && e.stack) || e);
    failed = true;
  } finally {
    await browser.close();
    srv.kill();
  }
  process.exit(failed ? 1 : 0);
})();
