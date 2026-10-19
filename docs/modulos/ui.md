# js/ui.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/ui.js`

restoreUI/syncFromUI, pestañas, modos, fechas, numeración, vista previa.

**Barra inferior fija** (`#sticky-totals`): única barra de totales del editor (el `#totals-bar` inline se sacó) — dos filas, cifra en mono 28px **peso 600** (IBM Plex Mono no trae 700) + acciones de cierre; cuatro variantes vía `_stickyShowVariant()`. Su alto NO se hardcodea: `reserveStickySpace()` lo mide y publica `--sticky-h`, de donde salen el padding de `#main` y la posición del FAB de "subir".

**Shell del editor** — tres vistas en `S.vistaEditor` (lista blanca `EDITOR_VIEWS` en `js/sanitize.js`, se eligen en Empresa → Estilo): `clasica` (la de siempre), `fichas` (secciones plegables, una abierta) y `consola` (etapas `Datos · Trabajos · Cierre`, + `Informe` solo en riesgo — `EDITOR_ETAPAS`). Cada sección va envuelta en un `.esec` con encabezado propio (número · título · estado) y `editorShellSync()` decide qué se ve, con qué número, qué estado y qué etapa/ficha está activa — solo con clases/`hidden`, **nunca reconstruyendo el DOM** ni escribiendo en `S`. Qué secciones existen se LEE del `display` inline que escribe `applyMode()`, así el shell no puede desincronizarse de los modos. En `clasica` el shell es inerte, salvo tres cambios decididos en la v226 (selector de modo de una fila en las tres vistas, Identificación plegada en una línea con `identResSync`/`identToggle`, y en `fichas` arranca abierta Cliente). La barra de progreso de `fichas`/`consola` no cuenta las secciones que se resuelven solas (`cuenta:false` en `_esecEstado`) y dice qué falta. **`_snapshotAlEditor(snap)`** es el único camino de un snapshot del historial al editor (`loadFromHistory`, `duplicarQuote`) y lo **copia**: `getH()` devuelve el array del cache, así que sin copia editar el presupuesto abierto modificaba la entrada original. Ver `docs/rediseno-editor.md`, `test/editor-shell.test.cjs` y `test/uso-tanda2.test.cjs`
