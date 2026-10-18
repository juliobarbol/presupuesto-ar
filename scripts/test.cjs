// scripts/test.cjs — Corre los tests de test/*.test.cjs en paralelo.
//
// Cada test es un programa independiente (abre su propio navegador headless),
// así que se pueden correr varios a la vez: en serie tardan ~5 min, en paralelo
// ~1 min. Se muestra una línea por test y, de los que fallan, el log completo.
//
// Uso:
//   npm test                    todos
//   npm test -- mapa nota       solo los que tengan "mapa" o "nota" en el nombre
//   TEST_JOBS=2 npm test        cuántos a la vez (por defecto, uno por núcleo, hasta 8)
//
// Necesita un Chrome: toma $PUPPETEER_EXECUTABLE_PATH o, si no está, el que deja
// el SessionStart hook (.claude/hooks/session-start.sh).

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const DIR = path.join(RAIZ, 'test');
const TIMEOUT_MS = 5 * 60 * 1000;

const filtros = process.argv.slice(2).map(s => s.toLowerCase());
const tests = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.test.cjs'))
  .filter(f => !filtros.length || filtros.some(q => f.toLowerCase().includes(q)))
  .sort();
if (!tests.length) { console.error('Ningún test coincide con: ' + filtros.join(' ')); process.exit(1); }

const env = Object.assign({}, process.env);
if (!env.PUPPETEER_EXECUTABLE_PATH) {
  const delHook = path.join(os.homedir(), '.cache/cc-headless/chrome-headless-shell-linux64/chrome-headless-shell');
  if (fs.existsSync(delHook)) env.PUPPETEER_EXECUTABLE_PATH = delHook;
  else {
    console.error('Falta Chrome: definí PUPPETEER_EXECUTABLE_PATH o corré .claude/hooks/session-start.sh');
    process.exit(2);
  }
}

const jobs = Math.max(1, parseInt(env.TEST_JOBS, 10) || Math.min(os.cpus().length, 8));

function correr(nombre) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let log = '';
    const p = spawn(process.execPath, [path.join(DIR, nombre)], { cwd: RAIZ, env });
    p.stdout.on('data', d => { log += d; });
    p.stderr.on('data', d => { log += d; });
    const corte = setTimeout(() => { log += `\n[corte: más de ${TIMEOUT_MS / 1000} s]`; p.kill('SIGKILL'); }, TIMEOUT_MS);
    p.on('close', code => {
      clearTimeout(corte);
      const ok = code === 0;
      const seg = ((Date.now() - t0) / 1000).toFixed(0).padStart(3);
      console.log(`${ok ? 'ok  ' : 'FALLA'} ${seg}s  ${nombre}`);
      resolve({ nombre, ok, log });
    });
  });
}

(async () => {
  const t0 = Date.now();
  console.log(`${tests.length} test(s), ${jobs} a la vez\n`);
  const cola = tests.slice();
  const resultados = [];
  await Promise.all(Array.from({ length: Math.min(jobs, cola.length) }, async () => {
    while (cola.length) resultados.push(await correr(cola.shift()));
  }));

  const fallas = resultados.filter(r => !r.ok);
  for (const f of fallas) {
    console.log(`\n──── ${f.nombre} ────`);
    console.log(f.log.trimEnd());
  }
  const seg = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} ok en ${seg} s` +
    (fallas.length ? ` · fallaron: ${fallas.map(f => f.nombre).join(', ')}` : ''));
  process.exit(fallas.length ? 1 : 0);
})();
