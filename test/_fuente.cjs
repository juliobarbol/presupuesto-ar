// test/_fuente.cjs — El código de la app, para los tests que lo leen como texto.
//
// Desde la v256 el JS no vive en index.html sino en js/*.js (scripts clásicos,
// en el orden de los <script src> de index.html). fuenteApp() lo devuelve
// concatenado en ese orden, que es exactamente el programa que corre.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');

function archivosApp() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="(js\/[^"?]+\.js)(?:\?[^"]*)?"[^>]*><\/script>/g)].map(m => m[1]);
}

function fuenteApp() {
  return archivosApp().map(f => fs.readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');
}

module.exports = { RAIZ, archivosApp, fuenteApp };
