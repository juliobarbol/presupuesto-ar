// scripts/subir-version.cjs — Sube la versión de la app en todos lados a la vez.
//
//   npm run subir-version          v256 → v257
//   npm run subir-version -- 260   a una versión puntual
//
// Toca: CACHE_VERSION en sw.js (sin eso los celulares siguen con la caché
// vieja), la marca ?v= de cada js/css en index.html (cada versión del HTML
// pide SU código) y "versión actual" en CLAUDE.md. `npm run lint` verifica
// que queden iguales.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const escribir = (f, t) => fs.writeFileSync(path.join(RAIZ, f), t);

const sw = leer('sw.js');
const actual = Number((/const CACHE_VERSION = 'presupuesto-v(\d+)'/.exec(sw) || [])[1]);
if (!actual) { console.error('No encuentro CACHE_VERSION en sw.js'); process.exit(1); }
const nueva = Number(process.argv[2]) || actual + 1;
if (nueva <= actual) { console.error(`La versión nueva (${nueva}) tiene que ser mayor que la actual (${actual})`); process.exit(1); }

escribir('sw.js', sw.replace(`'presupuesto-v${actual}'`, `'presupuesto-v${nueva}'`));
const html = leer('index.html');
const html2 = html.replace(/((?:href|src)="(?:css|js)\/[^"?]+)\?v=\d+"/g, `$1?v=${nueva}"`);
escribir('index.html', html2);
const md = leer('CLAUDE.md')
  .replace(`\`presupuesto-v${actual}\``, `\`presupuesto-v${nueva}\``)
  .replace(`Versión actual: v${actual}`, `Versión actual: v${nueva}`);
escribir('CLAUDE.md', md);
console.log(`v${actual} → v${nueva}`);
