# js/state.js — estado, almacenamiento y helpers

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/state.js`

Estado global `S`, defaults `DEF`, claves `LS`, helpers (fechas, dinero, `esc`, `safeImgSrc`/`safeColor`), `saveLS`/`loadLS`, `safeSetLS`, toasts, cola de avisos (`colaAviso`), confirmación (`confirmDlg`), totales y barra fija

## Config global vs. datos del presupuesto

**Config global vs. datos del presupuesto:** `S` mezcla las dos cosas. El snapshot de cada entrada del historial guarda **solo el presupuesto**: `snapshotSinConfig()` le saca `CFG_GLOBAL_FIELDS` al crearlo (autoguardado, trabajo sin presupuesto, exportar e importar uno suelto) y `sanitizeHistory` lo vuelve a sacar en cada pasada, que es lo que alivianó una vez lo ya guardado (v255: ~68 % menos; ver `test/espacio.test.cjs`). Los campos que son configuración del negocio (empresa, diseño, textos del PDF, numeración) están listados en `CFG_GLOBAL_FIELDS` y **nunca** deben restaurarse desde un snapshot: para eso está `assignSnapshot(S, snap)`, que usan `loadFromHistory`, `impIndividual`, `previewFromHistory` y `_buildDocHTMLForEntry`. Nunca hacer `Object.assign(S, snapshot)` a pelo. Al agregar un campo a `DEF`, la pregunta es: *¿tendría sentido que valga distinto en dos presupuestos del mismo día?* Si no, va a `CFG_GLOBAL_FIELDS`; si sí, a **`DATOS_PRESUPUESTO`** (`js/state.js`). Todo campo de `DEF` tiene que estar en exactamente una de las dos listas: `test/config-global.test.cjs` falla si no (antes, uno sin clasificar caía del lado del presupuesto por omisión). Se decidió NO partir `S` en dos objetos (376 referencias a configuración y un cambio de formato en el estado guardado, los backups y Drive): las dos listas + `assignSnapshot` + `snapshotSinConfig` cubren lo que la mezcla rompía.

## Espacio en el dispositivo

**Espacio (v255):** localStorage topa en 5 MiB contando caracteres de claves + valores (medido en Chrome). Configuración → Datos → "Espacio en este dispositivo" lo muestra (`espacioUso`/`espacioRender`) y desde el 80 % (`ESPACIO_ALERTA`) avisa al abrir, una vez por día (`espacioAvisarSiLleno`, `LS.ESPACIO_AVISO`, fuera del backup). Las fotos (IndexedDB) no cuentan.
