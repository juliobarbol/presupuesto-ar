# Rediseño del Editor — plan de trabajo

> Documento de trabajo para adoptar en el **editor de presupuestos** el lenguaje
> visual definido en Claude Design.
> El código vive en `index.html` (archivo único). Estado: **planificado, sin código escrito**.
>
> Este documento reemplaza al borrador original (`REDISENOEDITOR.md`), que fue
> escrito sin conocer la estructura real del repo y describía archivos que acá no
> existen. La sección [Mapa de traducción](#0-mapa-de-traducción) explica la
> equivalencia.

---

## 0. Mapa de traducción

El borrador original asumía un proyecto modular (`presupuesto/` con `css/base.css`,
`css/components.css`, `js/config.js` y un `build.py` que ensambla). **Nada de eso
existe.** Esta app es un `index.html` de ~18.000 líneas, sin build, sin framework
— y es una decisión deliberada (ver `CLAUDE.md`).

| El borrador decía | Acá es |
|---|---|
| `css/base.css` | el bloque `:root` del `<style>` (~líneas 1620–1700) |
| `css/components.css` | el resto del `<style>` (~líneas 16–1711) |
| **`css/print.css` — no se toca** | los dos bloques `@media print` (líneas ~1897 y ~2409), los estilos `.pdoc`/`.pdoc-theme-*` y la sección `// ===== js/pdf.js =====` |
| `js/ui.js`, `js/items.js`, `js/state.js` | las secciones homónimas dentro del `<script>`, marcadas con `// ===== js/<nombre>.js =====` |
| `js/config.js` | la pestaña **Empresa → sub-pestaña "Estilo"** (`#subpanel-estilo`, ~línea 3586) |
| `build.py` + revisar `PRESUPUESTO_build.html` | `node --check` sobre el script inline + `node test/pwa.test.cjs` + subir `CACHE_VERSION` en `sw.js` |
| "entregar archivos completos, no diffs" | **no aplica**: el archivo pesa 939 KB. Se trabaja con edits quirúrgicos, verificados por test. |
| `[data-tema="oscuro"]` | `:root[data-theme="dark"]` (nombre real del atributo) |

Para ubicarse en el archivo, buscar los marcadores de sección — son anclas
estables, los números de línea no:

```bash
grep -na "===== js/" index.html
```

**Buena noticia sobre el PDF:** los estilos del documento viven en su propio
namespace (`--c-divider`, `--fs-h2`, todo bajo `.pdoc`). Tocar los tokens del
editor **no alcanza al PDF**. La restricción "no tocar print" es real pero barata.

---

## 1. La invariante central: aditivo y reversible

Todo este rediseño existe para dar **opciones de vista al editor**. La regla que
manda sobre cualquier otra: **elegir una vista no puede romper, degradar ni
bloquear nada de lo que la app ya hace.**

Eso se traduce en seis invariantes concretas. Cada fase se cierra verificándolas.

### I1 — El markup interno no se toca

Campos, `label`, `input`, `id`, `onclick`: quedan **exactamente** como están.
Se agrega un contenedor por sección y un shell que las coordina. Nada más.

`restoreUI()`, `syncFromUI()`, `renderItems()`, `applyMode()` y los ~200
`getElementById` del archivo tienen que seguir funcionando **sin una sola línea
modificada**. Si el shell obliga a tocar el interior de una sección, el shell está
mal planteado: parar y replantear.

> Verificado: no hay selectores CSS de hermanos (`+`/`~`) sobre `.st`, `.fg`, `.r2`
> ni `.r4`, y los 7 usos de `parentNode`/`parentElement` del archivo apuntan al
> padre inmediato de un control (dropdown, datepicker, autocompletar de cliente),
> nunca a una sección. **Envolver secciones es seguro.**

### I2 — `clasica` es la app de hoy, y es la red de seguridad

`vistaEditor: 'clasica'` tiene que producir la pantalla actual: mismo orden, mismo
scroll, mismos elementos visibles, sin encabezados nuevos, sin barra de progreso.
No es una vista "degradada": es el estado actual, intacto.

Consecuencia práctica: ante cualquier duda o error en runtime, el camino correcto
es **caer a `clasica`**, nunca romper.

### I3 — Cambiar de vista es solo presentación

Cambiar `vistaEditor` no puede:

- alterar el estado `S` del presupuesto,
- alterar lo que se guarda en el historial,
- alterar el PDF generado,
- perder lo que el usuario ya escribió en pantalla.

Regla de implementación: **la vista se aplica con clases CSS y atributos `hidden`,
no reconstruyendo el DOM del editor.** Si se reconstruye, se pierden focos, valores
sin sincronizar y listeners. Aplicar la vista = tocar clases sobre contenedores.

### I4 — `vistaEditor` es configuración, no dato del presupuesto

Va en `DEF` **y** en `CFG_GLOBAL_FIELDS` (`js/state.js`). Es preferencia del
usuario, no del presupuesto: abrir un presupuesto viejo del historial **no** puede
cambiarte la vista del editor. Al estar en `CFG_GLOBAL_FIELDS`, `assignSnapshot()`
ya lo protege de los snapshots, y viaja solo en el backup y en Drive sin código
extra (ver `test/config-global.test.cjs`).

### I5 — Entra por la puerta de sanitize

`vistaEditor` es un enum: se valida con `sanEnum` contra una lista blanca
(`EDITOR_VIEWS = ['fichas','clasica']`), igual que `PDF_THEMES` en
`js/sanitize.js`. Un backup ajeno con `vistaEditor: "<script>"` cae a `'clasica'`.
Nada entra al estado sin pasar por ahí.

### I6 — Los tres modos siguen siendo el eje principal

Normal / Estimativo / Riesgo (`S.isEstimative` / `S.isRisk`) son un eje
**ortogonal** a la vista. Las 6 combinaciones (3 modos × 2 vistas) tienen que
funcionar. El shell se engancha en `applyMode()`, que ya es el único lugar que
decide qué secciones se ven.

Lo mismo vale para los otros ejes que ya existen y no se tocan: tema
claro/oscuro/auto (`S.themeMode`), color de marca (`applyAccent`), escenarios A/B
(`S.scenariosEnabled`).

---

## 2. Qué tomar del diseño y qué no

**Tomar:**

- Tokens de color, en claro y oscuro.
- Escala tipográfica y pareo de familias (display / texto / mono para cifras).
- Radios, sombras, escala de espaciado.
- Aspecto de los componentes: encabezado de sección con estado, barra de progreso,
  chips, toggles, botones segmentados, barra inferior de totales.

**No tomar:**

- La estructura del DOM del prototipo. No conoce la lógica real de la app.
- Los nombres de clase nuevos. Usar los que ya existen (`.st`, `.fg`, `.r2`,
  `.btn`, `.tgl`, `.scol`, `.section-card`…).
- Supuestos de framework: no hay React, ni bundler, ni Tailwind, ni módulos ES
  (romperían los `onclick` globales).
- Los datos de ejemplo. Números, especies y clientes del prototipo son inventados.

---

## 3. Restricciones que no se negocian

1. **El PDF no se toca.** Ni los bloques `@media print`, ni `.pdoc*`, ni
   `js/pdf.js`. Son siete temas de documento y este trabajo no los alcanza.
   Verificar la salida impresa al cerrar cada fase.
2. **Una fase por vez**, en orden. No arrancar la siguiente hasta que la anterior
   esté probada en el teléfono, en producción.
3. **Cada fase funciona en claro y en oscuro**, y en los tres modos, antes de
   cerrarse.
4. **Las fuentes van locales**, nunca desde un CDN (ya lo están: `fonts/` +
   `fonts.css`, servidas por el service worker).
5. **Subir `CACHE_VERSION` en `sw.js`** en cada despliegue. Si se agrega un archivo
   nuevo, sumarlo a `APP_SHELL`.
6. **Destino real: Android, una mano, a la intemperie.** Áreas de toque de 48 px y
   contraste alto son requisito, no pulido.

---

## 4. Paleta y tipografía

> **A completar con lo que devuelva Claude Design.** Hasta que esté, no arranca la
> Fase 0.

### Antes de pegar los tokens: dos cosas que ya existen

**a) El acento NO es un token fijo.** El usuario elige su color de marca (Empresa →
Estilo → "Color del documento") y `applyAccent()` reescribe en runtime `--accent`,
`--accent-rgb`, `--accent-dark`, `--accent-2`, `--accent-fg` y `--accent-tint`.

→ La paleta nueva puede proponer un acento **por defecto**, pero no puede
hardcodearlo ni asumir que es constante. **Decisión pendiente:** ¿se mantiene el
color de marca configurable? (Recomendado: sí. Es config guardada de los usuarios.)

**b) Ya hay un sistema de tokens.** La Fase 0 es en gran parte **completar**, no
crear. Ya existen en `:root` (con su bloque `[data-theme="dark"]`):

| Grupo | Tokens que ya existen |
|---|---|
| Fondo/superficie | `--bg`, `--panel`, `--card`, `--surface`, `--surface-2`, `--surface-3`, `--surface-hover`, `--surface-hover2` |
| Texto | `--text`, `--text-2`, `--muted`, `--faint` |
| Borde/estado | `--border`, `--red`, `--red-light`, `--toggle-off` |
| Marca | `--accent` y derivados (runtime, ver arriba) |
| Forma | `--radius-field`, `--radius-box`, `--radius-pill`, `--shadow-card`, `--shadow-card-hover` |
| Concepto (agenda/historial) | `--c-trabajo`, `--c-recontacto`, `--c-seguimiento`, `--c-vence`, `--c-nota`, `--c-visita` (+ `-bg`/`-fg`) |

**Falta** (y es lo que la Fase 0 tiene que aportar): familias tipográficas
(display / texto / mono), escala de 5 tamaños, y escala de espaciado de 6 pasos.

**Fuentes ya empaquetadas** en `fonts/`: DM Sans, DM Serif Display, Inter, Lora,
IBM Plex Sans, IBM Plex Serif. Si el diseño elige entre estas, no hay que agregar
ningún `.woff2` nuevo ni tocar `APP_SHELL`.

---

## Fase 0 — Tokens

**Dónde:** bloque `:root` y `[data-theme="dark"]` del `<style>`.

1. Completar los tokens faltantes (tipografía y espaciado) de la sección 4.
2. Reemplazar colores y tamaños hardcodeados del CSS de pantalla por tokens.
3. No tocar el CSS del documento (`.pdoc*`, `@media print`).

**Aceptación:** la app se ve **idéntica** a antes. Si algo se ve distinto, es un
error, no una mejora. El color de marca configurable sigue funcionando: cambiar de
preset repinta la app como hoy.

---

## Fase 1 — Shell del editor

**Dónde:** `#panel-editor` (~línea 2968), `js/ui.js`, `js/state.js`, `<style>`.

1. **Envolver** cada sección del editor en un contenedor con encabezado propio:
   número, título y estado a la derecha (`COMPLETO ✓` / `3 ÍTEMS` / vacío).
   Hoy `#section-normal-items`, `#section-risk-analysis`, `#section-est-items`,
   `#section-conditions`, `#section-adjustments` y `#section-est-observations` ya
   son bloques; **"Identificación" y "Cliente y Lugar" no lo son** (son títulos
   `.st` con campos hermanos sueltos) y necesitan contenedor nuevo.
2. **Numeración en runtime** según el modo activo, calculada sobre las secciones
   visibles. Se engancha en `applyMode()`, que ya decide qué se muestra.
3. **Barra de progreso** en el encabezado, sobre las secciones visibles.
4. Estado nuevo `vistaEditor: 'fichas' | 'clasica'` en `DEF` + `CFG_GLOBAL_FIELDS`
   + lista blanca en `js/sanitize.js` (invariantes I4 e I5).
   - `'fichas'` → secciones colapsables, arranca con la primera abierta.
   - `'clasica'` → todas abiertas, sin colapsar, sin barra de progreso.
5. Default: **`'clasica'`** durante el desarrollo; se cambia a `'fichas'` recién al
   cerrar la Fase 4, cuando el usuario pueda elegir desde la UI.

**Decisión pendiente:** la lista y el orden exacto de secciones, y qué cuenta como
"COMPLETO" en cada una.

**Aceptación:** cambiando un solo valor de estado se pasa de una vista a la otra
**sin recargar y sin perder lo escrito**; en `'clasica'` la pantalla es
funcionalmente idéntica a la de hoy; las 6 combinaciones modo × vista funcionan.

---

## Fase 2 — Barra inferior fija

**Dónde:** `<style>`, `js/ui.js`, `#totals-bar` (~línea 3325).

Barra fija abajo con: cantidad de ítems, total, recargo aplicado en letra chica, y
botón primario **Imprimir / PDF** más dos botones de ícono (compartir, vista previa).
Aplica **en las dos vistas**.

- `#totals-bar` ya existe (hoy inline al final del flujo) y ya se actualiza vía
  `updateTotalsBar()`. Se reubica, **no se reescribe su lógica**.
- Tiene dos juegos de columnas (`#tb-normal-cols` / `#tb-est-cols`): el modo
  estimativo muestra otra cosa. Los dos tienen que entrar en el diseño fijo.
- Respetar `env(safe-area-inset-bottom)` y dejar padding inferior en el contenedor.
- **Revisar z-index** contra lo que ya se superpone: topbar, tabs, `#clima-overlay`,
  `#notif-overlay`, modales y toasts.

**Aceptación:** el total es visible sin scrollear desde cualquier punto del editor,
en ambas vistas y en los tres modos; no tapa ningún campo; ningún overlay queda por
debajo de la barra.

---

## Fase 3 — Pantalla "Cargar trabajo" (APARTADA)

**Estado: fuera del alcance de este plan.** Se decide por separado, después de la 4.

El borrador la proponía como una fase más, pero **rompe la invariante I1 y cambia
el modelo de datos**:

- Propone tipos **Poda / Extracción / Destoconado / Servicio**. En la app
  `item.type` solo tiene `tree` / `service` / `note`; "poda" y "extracción" son hoy
  texto libre en `desc`.
- Propone chips **Trepa / Con retiro / Hidro / Altura**, que **no existen como dato**
  en ningún lado. Serían un campo nuevo por ítem.
- Reemplazar la carga inline se lleva puesto lo que hoy cuelga de la tarjeta de
  ítem: autocompletar de especies, foto por ítem (IndexedDB), nota interna,
  cantidad, reordenamiento por arrastre, escenarios A/B y los chips de servicios
  rápidos.
- Los ítems ya guardados en el historial no tienen esos campos: hay que definir el
  fallback antes de escribir nada.

No es imposible ni una mala idea — es **otro proyecto**, con su propia decisión de
modelo de datos y su propia migración. Las fases 0, 1, 2 y 4 ya entregan el grueso
del cambio visual sin tocar cómo se guarda un ítem.

---

## Fase 4 — Selector visible

**Dónde:** `#subpanel-estilo` (Empresa → Estilo, ~línea 3586).

Agregar el selector debajo de "Apariencia de la app", con el mismo patrón visual
que el segmentado Auto / Claro / Oscuro (`.theme-mode` / `.theme-mode-btn`):

- **Fichas** — secciones plegables con progreso.
- **Clásica** — todo desplegado en una sola lista.

Es un eje independiente del tema claro/oscuro. Al cerrar la fase, recién ahí, el
default pasa a `'fichas'`.

Persistencia: por I4 ya está resuelta (`CFG_GLOBAL_FIELDS` → backup y Drive).
Escribir siempre vía `safeSetLS()`.

**Aceptación:** el selector persiste al cerrar la app, viaja en el export y en el
backup de Drive, y restaurar un backup de otro dispositivo lo trae.

---

## Checklist de cierre de fase

```bash
# 1. Sintaxis del script inline
python3 - <<'PY'
import re, subprocess, sys
html = open('index.html', encoding='utf-8').read()
js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
open('/tmp/app_check.js','w',encoding='utf-8').write(js)
sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
PY

# 2. PWA / offline / service worker
node test/pwa.test.cjs

# 3. Config global (que vistaEditor no se restaure de un snapshot)
node test/config-global.test.cjs

# 4. Sanitización (que vistaEditor basura caiga a un valor válido)
node test/security.test.cjs
```

Y a mano, en el teléfono:

- [ ] Las 6 combinaciones: {normal, estimativo, riesgo} × {fichas, clásica}.
- [ ] Claro y oscuro.
- [ ] Imprimir / PDF: idéntico a antes (los 7 temas si la fase tocó tokens).
- [ ] Guardar en historial y reabrir: los datos vuelven, la vista **no** cambia.
- [ ] Cambiar el color de marca: la app repinta bien.
- [ ] Subir `CACHE_VERSION` en `sw.js` antes de mergear a `main`.

---

## Antes de escribir código

Preguntar en vez de asumir. En particular:

- Si un token del diseño no tiene equivalente claro en el `:root` actual.
- Si una sección del editor no encaja en el shell sin modificarla por dentro (I1).
- Si algo del diseño implica cambiar cómo se guarda o se calcula un dato (eso es
  Fase 3 y está apartado).

Una pregunta cuesta un mensaje. Un supuesto equivocado cuesta la fase entera.

---

## Decisiones pendientes

1. **Color de marca configurable:** ¿se mantiene? (Recomendado: sí.)
2. **Lista y orden de las secciones del editor** para la Fase 1, y criterio de
   "COMPLETO" por sección.
3. **Confirmar** que la Fase 3 queda apartada.
4. **Los tokens de Claude Design** para completar la sección 4 — es lo único que
   bloquea el arranque de la Fase 0.

---

## Nota sobre la vista clásica

El borrador la planteaba como red de seguridad temporal, a sacar si en un mes nadie
la usa. **Acá no:** por la invariante I2, `clasica` es el estado conocido-bueno de
la app y el destino del fallback ante cualquier error. Se queda.
