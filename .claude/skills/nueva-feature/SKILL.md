---
name: nueva-feature
description: Guía para agregar o modificar funcionalidad en Presupuestos AR respetando las convenciones no-negociables del proyecto (dinero en centavos, fechas locales, escapado XSS, fotos en IndexedDB, JS global sin módulos). Usar cuando el usuario pida agregar una feature, un campo, un tipo de ítem, una opción de presupuesto, o tocar el estado/render/PDF de la app.
---

# Agregar una feature a Presupuestos AR

App PWA en un **único `index.html`** (~8.000 líneas): markup + `<style>` + un solo
`<script>` global. Sin build, sin frameworks, sin módulos ES. Las funciones se llaman
entre sí y desde `onclick="..."`. Esta skill encapsula las reglas que NO se pueden
romper al sumar código.

## 1. Ubicar dónde va el cambio
El JS está dividido por marcadores estables. Buscalos en vez de fiarte de líneas:

```bash
grep -n "===== js/" index.html
```

| Sección | Para qué |
|---|---|
| `js/state.js` | Estado `S`, defaults `DEF`, claves `LS`, helpers (dinero, fechas, `esc`), totales |
| `js/photos.js` | Fotos en IndexedDB (`pq_photos`) |
| `js/clients.js` | DBs de clientes/especies/servicios (autocompletar) |
| `js/phrases.js` | Biblioteca de frases |
| `js/items.js` | Ítems (árbol/servicio/nota), recargo, escenarios A/B |
| `js/ui.js` | restoreUI/syncFromUI, pestañas, modos, fechas, vista previa |
| `js/history.js` | Historial, seguimiento, WhatsApp |
| `js/exportimport.js` | Export/import JSON, backup, módulo GDRIVE |
| `js/pdf.js` | `buildDoc`/`buildEstDoc`/`buildRiskDoc`, `printDoc` |
| `js/facturacion.js` | Facturas + tope anual |
| `js/core.js` | Inicialización `DOMContentLoaded` + setup PWA |

CSS: en el `<style>`. Ojo con los dos bloques del documento: `@media print` (`#doc-a4`)
y pantalla (`.doc-preview-host .doc-a4-screen`). Si tocás el layout del presupuesto,
revisá **ambos**.

## 2. Convenciones NO-negociables

**Dinero en centavos.** Nunca operar con floats de pesos. Usar `moneyToCents` /
`centsToMoney` / `fmtM`. Guardar y sumar siempre en centavos (enteros).

**Fechas en LOCAL, no UTC.** Usar `today()` / `toLocalISODate()` / `calcExpiry()`.
**Nunca** `new Date().toISOString().slice(0,10)` para fechas de calendario (corre el
día en Argentina).

**XSS.** Todo dato del usuario que entre a `innerHTML` pasa por `esc()` primero.
Para `src` de imágenes usar `safeImgSrc()`.

**Estado y persistencia.** El estado vive en el objeto global `S` (con `DEF` como
defaults). Escribir a localStorage SIEMPRE vía `safeSetLS()` (maneja cuota llena y
dispara el backup a Drive). Las claves van centralizadas en `LS` (o las constantes
`*_KEY`); **no cambiar el valor de una clave existente** (pérdida de datos).

**Fotos en IndexedDB, no en localStorage.** `item.photo` guarda un ID `p_...`; el
dataURL vive en IDB (`pq_photos`). Guardar con `savePhoto(dataUrl)`, leer con
`getPhotoData(item.photo)`. El backup completo incluye las fotos referenciadas.

**Sin módulos ES.** No agregar `import`/`export` ni `type="module"`: rompería los
`onclick` globales. Las funciones nuevas van al ámbito global del `<script>`.

**3 modos de presupuesto.** Normal, Estimativo (fotos) y Riesgo (informe ISA).
`buildDoc()` deriva a `buildEstDoc()`/`buildRiskDoc()` según `S.isEstimative`/`S.isRisk`.
Si tu cambio afecta el documento, decidí en cuál(es) de los 3 modos aplica.

## 3. Si agregás un campo nuevo al presupuesto
1. Sumarlo a `S` y a `DEF` (`js/state.js`).
2. Cargarlo/leerlo de la UI en `restoreUI`/`syncFromUI` (`js/ui.js`).
3. Incluirlo en el documento si corresponde (`js/pdf.js`, los 3 modos).
4. Verificar que entra al backup/export (`buildBackupObject`/`applyBackupObject` en
   `js/exportimport.js`) si debe sobrevivir un cambio de dispositivo.

## 4. Verificar antes de cerrar
```bash
# Sintaxis del JS inline
python3 - <<'PY'
import re, subprocess, sys
html = open('index.html', encoding='utf-8').read()
js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
open('/tmp/app_check.js','w',encoding='utf-8').write(js)
sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
PY

# Comportamiento PWA (SW/cache/offline)
node test/pwa.test.cjs
```
Para validar visualmente la vista previa o el PDF, usá la skill `webapp-testing`.

## 5. Para desplegar
Cuando el cambio esté listo, usá la skill `deploy-presupuesto` (sube `CACHE_VERSION`,
corre los tests y deja todo listo para mergear).
