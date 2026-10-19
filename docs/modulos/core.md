# js/core.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/core.js`

Inicialización (`DOMContentLoaded`) + setup de la PWA. La barra de totales del arranque se muestra **solo si el Editor sigue activo** (v232): el init corre después de varios `await` y, si el usuario ya había tocado otra pestaña, la barra aparecía encima del Mapa. Ver `test/mapa-estados.test.cjs` (E)
