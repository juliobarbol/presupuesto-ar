// ESLint — red de seguridad para la app (un solo <script> global en index.html),
// el Service Worker, el Worker de push y los tests.
//
// Criterio: reglas que encuentran BUGS, no estilo. Además, algunas convenciones
// de CLAUDE.md pasan de "acordarse" a chequeo automático (no-restricted-syntax).
import js from '@eslint/js';
import html from 'eslint-plugin-html';
import globals from 'globals';

const reglasComunes = {
  ...js.configs.recommended.rules,
  // Los catch vacíos son el patrón de la app para lo que puede fallar sin
  // consecuencias (localStorage en modo privado, APIs que no existen).
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Solo variables locales: las funciones globales se usan desde los onclick
  // del HTML, que ESLint no ve. Los argumentos sin usar son parte de la firma.
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
  // Avisa de valores iniciales que se pisan enseguida: ruido, no bugs.
  'no-useless-assignment': 'off',
};

export default [
  { ignores: ['node_modules/**', 'vendor/**', '.wrangler/**'] },

  // La app. no-redeclare (en recommended) atrapa dos funciones globales con el
  // mismo nombre: la segunda pisa a la primera sin error (así murió el swipe
  // entre pestañas, ver test/gestos.test.cjs).
  {
    files: ['index.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, google: 'readonly' },   // Google Identity Services
    },
    rules: {
      ...reglasComunes,
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.name='fetch']",
          message: 'Nada sale a internet sin netFetch() (timeout + cortacircuitos). Ver js/net.js.' },
        { selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message: 'toISOString() es UTC y corre el día en Argentina: usá today() / toLocalISODate().' },
        { selector: "CallExpression[callee.object.name='Object'][callee.property.name='assign'][arguments.0.name='S'][arguments.1.name=/snap/i]",
          message: 'Un snapshot no se copia a S a pelo: usá assignSnapshot() (respeta CFG_GLOBAL_FIELDS).' },
        { selector: "CallExpression[callee.object.name='Object'][callee.property.name='assign'][arguments.0.name='S'][arguments.1.property.name='snapshot']",
          message: 'Un snapshot no se copia a S a pelo: usá assignSnapshot() (respeta CFG_GLOBAL_FIELDS).' },
      ],
    },
  },

  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.serviceworker } },
    rules: reglasComunes,
  },

  {
    files: ['push-worker/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.serviceworker } },
    rules: reglasComunes,
  },

  {
    files: ['test/**/*.cjs', 'scripts/**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    // El código que va dentro de page.evaluate(() => …) corre EN LA APP y usa
    // sus globales (S, renderItems, document…): no-undef no puede saberlo.
    rules: { ...reglasComunes, 'no-undef': 'off' },
  },

  {
    files: ['eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
];
