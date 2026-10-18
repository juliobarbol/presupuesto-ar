// scripts/lint-app.cjs — Lint de la app como lo que es: UN programa global
// repartido en varios <script src="js/…"> clásicos (no módulos).
//
// ESLint mira cada archivo por separado y no puede saber que `S` vive en
// state.js o que dos archivos declaran la misma función global (la segunda
// pisa a la primera sin error: así murió el swipe entre pestañas). Por eso:
//
//   1. Lint del programa entero: se concatenan los archivos en el orden de
//      index.html y se pasa por ESLint con las reglas de la app
//      (no-redeclare, no-undef, convenciones). Los errores se informan con el
//      archivo y la línea reales.
//   2. Versión: index.html pide cada js/css con ?v=<versión> y sw.js los
//      precachea con la misma marca (APP_CODIGO). Tienen que coincidir los
//      archivos y el número, o el celular mezcla versiones o queda sin un
//      archivo offline.
//   3. Orden de carga: dentro de un solo <script> todas las funciones existen
//      desde el arranque; repartidas, el código que CORRE AL CARGAR un archivo
//      (inicializadores, IIFE, llamadas sueltas, y lo que esas llamadas usan)
//      no puede usar algo declarado en un archivo posterior. Esto lo verifica.
//
// Uso: node scripts/lint-app.cjs   (lo corre `npm run lint`)

const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

const RAIZ = path.resolve(__dirname, '..');

// Los <script src> locales de index.html, en orden (sin el ?v=).
function archivosApp() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="(js\/[^"?]+\.js)(?:\?[^"]*)?"[^>]*><\/script>/g)].map(m => m[1]);
}

const PARSE = { ecmaVersion: 'latest', sourceType: 'script', loc: true };

// Nombres que un patrón de declaración introduce (const {a, b: [c]} = …).
function nombresDe(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => nombresDe(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => nombresDe(e, out));
  else if (p.type === 'RestElement') nombresDe(p.argument, out);
  else if (p.type === 'AssignmentPattern') nombresDe(p.left, out);
  return out;
}

function esFuncion(n) {
  return n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration');
}

// Identificadores leídos dentro de `nodo`. Con `alCargar`, no entra en
// funciones que solo se definen (callbacks, métodos): solo en las IIFE, que
// corren en el momento.
function referencias(nodo, alCargar) {
  const out = [];
  const visitar = (n, padre, clave) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      const esPropiedad = padre && ((padre.type === 'MemberExpression' && clave === 'property' && !padre.computed)
        || (padre.type === 'Property' && clave === 'key' && !padre.computed)
        || (padre.type === 'MethodDefinition' && clave === 'key'));
      if (!esPropiedad) out.push(n);
      return;
    }
    if (alCargar && esFuncion(n)) {
      const esIIFE = padre && (padre.type === 'CallExpression' || padre.type === 'NewExpression') && clave === 'callee';
      if (!esIIFE) return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'range' || k === 'parent') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(x => visitar(x, n, k));
      else if (v && typeof v.type === 'string') visitar(v, n, k);
    }
  };
  visitar(nodo, null, null);
  return out;
}

function ordenDeCarga(archivos) {
  const fuentes = archivos.map(f => ({ f, ast: espree.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'), PARSE) }));
  const dondeSeDeclara = new Map();   // nombre → índice de archivo
  const funciones = new Map();        // nombre de función global → su nodo
  fuentes.forEach(({ ast }, i) => ast.body.forEach(st => {
    const nombres = st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration' ? [st.id.name]
      : st.type === 'VariableDeclaration' ? st.declarations.flatMap(d => nombresDe(d.id, [])) : [];
    nombres.forEach(n => { if (!dondeSeDeclara.has(n)) dondeSeDeclara.set(n, i); });
    if (st.type === 'FunctionDeclaration') funciones.set(st.id.name, st);
    if (st.type === 'VariableDeclaration') st.declarations.forEach(d => {
      if (d.id.type === 'Identifier' && esFuncion(d.init)) funciones.set(d.id.name, d.init);
    });
  }));

  const problemas = [];
  fuentes.forEach(({ f, ast }, i) => {
    // Lo que corre al cargar este archivo…
    const pendientes = ast.body.filter(st => st.type !== 'FunctionDeclaration')
      .flatMap(st => referencias(st, true).map(id => ({ id, via: [] })));
    // …y, transitivamente, el cuerpo de las funciones globales que llama.
    const vistas = new Set();
    while (pendientes.length) {
      const { id, via } = pendientes.shift();
      const j = dondeSeDeclara.get(id.name);
      if (j === undefined) continue;          // global del navegador o local
      if (j > i) {
        problemas.push(`${f}:${id.loc.start.line}  al cargar usa "${id.name}" (${archivos[j]})`
          + (via.length ? ` a través de ${via.join(' → ')}` : ''));
        continue;
      }
      const fn = funciones.get(id.name);
      if (fn && !vistas.has(id.name)) {
        vistas.add(id.name);
        referencias(fn.body, false).forEach(r => pendientes.push({ id: r, via: via.concat(id.name) }));
      }
    }
  });
  return problemas;
}

function versionCoherente() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const errores = [];
  const ver = (/const CACHE_VERSION = 'presupuesto-v(\d+)'/.exec(sw) || [])[1];
  if (!ver) return ['sw.js: no encuentro CACHE_VERSION = \'presupuesto-vNN\''];
  const enHtml = [...html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+)(?:\?v=([^"]*))?"/g)];
  enHtml.forEach(([, f, v]) => {
    if (v !== ver) errores.push(`index.html: ${f} se pide con ?v=${v || '(nada)'} y sw.js está en la ${ver} (npm run subir-version)`);
  });
  const bloque = (/const APP_CODIGO = \[([\s\S]*?)\]/.exec(sw) || [])[1] || '';
  const enSw = [...bloque.matchAll(/'((?:css|js)\/[^']+)'/g)].map(m => m[1]);
  const lista = enHtml.map(m => m[1]);
  lista.filter(f => !enSw.includes(f)).forEach(f => errores.push(`sw.js: falta ${f} en APP_CODIGO (sin eso no anda offline)`));
  enSw.filter(f => !lista.includes(f)).forEach(f => errores.push(`sw.js: APP_CODIGO tiene ${f}, que index.html no carga`));
  return errores;
}

async function lintConcatenado(archivos) {
  const { ESLint } = require('eslint');
  const { reglasApp, globalesApp } = await import(path.join(RAIZ, 'eslint.config.mjs'));
  const partes = archivos.map(f => ({ f, txt: fs.readFileSync(path.join(RAIZ, f), 'utf8') }));
  const inicios = [];
  let linea = 1, texto = '';
  partes.forEach(p => {
    inicios.push({ f: p.f, desde: linea });
    const t = p.txt.endsWith('\n') ? p.txt : p.txt + '\n';
    texto += t;
    linea += t.split('\n').length - 1;
  });
  const eslint = new ESLint({
    cwd: RAIZ,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.js'],
      languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: globalesApp },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      rules: reglasApp,
    }],
  });
  const [res] = await eslint.lintText(texto, { filePath: path.join(RAIZ, '__app__.js') });
  return res.messages.map(m => {
    const p = [...inicios].reverse().find(x => x.desde <= m.line) || inicios[0];
    return `${p.f}:${m.line - p.desde + 1}:${m.column}  ${m.message}  ${m.ruleId || ''}`;
  });
}

(async () => {
  const archivos = archivosApp();
  if (!archivos.length) { console.error('index.html no carga ningún js/*.js'); process.exit(1); }
  const faltan = archivos.filter(f => !fs.existsSync(path.join(RAIZ, f)));
  if (faltan.length) { console.error('Faltan archivos: ' + faltan.join(', ')); process.exit(1); }
  const enDisco = fs.readdirSync(path.join(RAIZ, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
  const sueltos = enDisco.filter(f => !archivos.includes(f));

  const errores = [
    ...(await lintConcatenado(archivos)),
    ...ordenDeCarga(archivos),
    ...versionCoherente(),
    ...sueltos.map(f => `${f}  está en js/ pero index.html no lo carga`),
  ];
  if (errores.length) {
    console.error(errores.join('\n'));
    console.error(`\n✖ ${errores.length} problema(s) en la app (${archivos.length} archivos)`);
    process.exit(1);
  }
  console.log(`✓ app: ${archivos.length} archivos, sin problemas de lint ni de orden de carga`);
})().catch(e => { console.error(e); process.exit(1); });
