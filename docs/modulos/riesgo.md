# js/riesgo.js — informe de riesgo (ISA)

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/riesgo.js`

Cálculo del nivel de riesgo (`riskEval`, matrices `RISK_MATRIX_ISA`/`RISK_MATRIX`, `riskMetodo`; ver "Informe de riesgo" en Convenciones)

## Informe de riesgo con la metodología de la ISA

**Informe de riesgo con la metodología de la ISA (v243):** el nivel sale de `riskEval(rd)` (único lugar: editor, estado de la ficha y documento) con las matrices 1 y 2 del manual de buenas prácticas de la ISA (`RISK_MATRIX_ISA`: falla × impacto → probabilidad combinada; combinada × consecuencias → nivel). La matriz anterior (`RISK_MATRIX`, con 3 impactos y "catastróficas") **inflaba el riesgo** en 26 de 48 combinaciones y se conserva SOLO para los informes ya entregados: `riskMetodo(rd)` dice `'v1'` si el riskData no tiene `metodo` y ya estaba evaluado, y `normalizeRiskData` lo fija ANTES de mezclar con `DEF` (que trae `'isa2'`). El editor ofrece "Pasar a la metodología ISA" (`riskPasarAIsa`: corre el impacto un escalón, vacía la "Alta" vieja). Las opciones de los desplegables dependen de la matriz (`RISK_OPTS`, `riskOptsSync`, que respeta el valor de `S` si el `<select>` todavía no tiene opciones). Suma: alcance de la inspección (`nivel`, `tecnicas` ∈ `RISK_TECNICAS` —"inspección aérea con trepa" pone Nivel 3—, `plazo`), vitalidad, blancos, defectos con altura/orientación/**fotos** (`riskDefectPhotoRefs`, recorridas por `collectPhotoIds`/`migrateInlinePhotosToIDB`; "Duplicar" no las copia), riesgo residual (`resFailure` obligatorio; impacto y consecuencias vacíos = iguales), reinspección y limitaciones (las de la inspección + el descargo general `S.docRiskLimits`; quién evalúa en `S.coEvaluador`, los dos en `CFG_GLOBAL_FIELDS`). El documento dice "Basada en la metodología… de la ISA" y **nunca "TRAQ"** (es el nombre de la credencial, que el dueño no tiene). Las secciones se numeran al final (`_numerar`), en el orden en que salen. `riskData` pasa por `sanitizeRiskData`. Ver `test/riesgo-isa.test.cjs`.
