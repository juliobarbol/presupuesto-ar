# js/sanitize.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/sanitize.js`

**Validación de todo lo que entra desde afuera** (backup `.json` de un colega, copia de Drive, clave de `localStorage` manipulada). `sanitizeBackup`/`sanitizeHistory`/`sanitizeNotes`/`sanitizeNotifLog`/`sanitizeFacturas`/`sanitizeStateObj`/`sanitizeImport` + helpers (`sanStr`/`sanEnum`/`sanISODate`/`sanNumId`/`sanTextId`) y listas blancas (`PDF_THEMES`, `PDF_FONTS`, `NOTE_TIPOS`). `migrateSanitizeStored()` normaliza al arrancar lo que ya estuviera guardado.

**Regla: nada entra al estado ni a `localStorage` sin pasar por acá** — cerró el XSS por backup ajeno y el caso de la app rota por un `history` que no era array. Ver `docs/auditoria-2026-07-24.md` (C1/C3/A2) y `test/security.test.cjs`
