---
name: nueva-feature
description: Guía para agregar o modificar funcionalidad en Presupuestos AR respetando las convenciones no-negociables del proyecto (dinero en centavos, fechas locales, escapado XSS, fotos en IndexedDB, JS global sin módulos). Usar cuando el usuario pida agregar una feature, un campo, un tipo de ítem, una opción de presupuesto, o tocar el estado/render/PDF de la app.
---

# Agregar una feature a Presupuestos AR

App PWA sin build: markup en `index.html`, CSS en `css/*.css`, JS en `js/*.js`
(scripts clásicos que comparten el ámbito global, en el orden de los `<script src>`
de `index.html`). Sin frameworks, sin módulos ES. Las funciones se llaman entre sí y
desde `onclick="..."`. Esta skill encapsula las reglas que NO se pueden romper al sumar
código.

## 1. Ubicar dónde va el cambio
Cada sección es un archivo de `js/` (el mapa completo está en CLAUDE.md).
Si el código que agregás **corre al cargar** el archivo (un inicializador, una llamada
suelta), no puede usar algo de un archivo posterior: `npm run lint` lo verifica.
Un archivo js/css NUEVO va en `index.html` (con el mismo `?v=`) y en `APP_CODIGO` de `sw.js`.

| Sección | Para qué |
|---|---|
| `js/state.js` | Estado `S`, defaults `DEF`, claves `LS`, helpers (dinero, fechas, `esc`), totales |
| `js/photos.js` | Fotos en IndexedDB (`pq_photos`) |
| `js/clients.js` | DBs de clientes/especies/servicios (autocompletar) |
| `js/phrases.js` | Biblioteca de frases |
| `js/items.js` | Ítems (árbol/servicio/nota), recargo, escenarios A/B |
| `js/ui.js` | restoreUI/syncFromUI, pestañas, modos, fechas, vista previa |
| `js/seguimiento.js` | Config del seguimiento, pendientes, plantillas de WhatsApp |
| `js/history.js` | Historial, versiones, trabajos sin presupuesto |
| `js/exportimport.js` | Export/import JSON, backup (`gdrive.js`/`gcal.js`: Google) |
| `js/pdf.js` | `buildDoc`/`buildEstDoc`/`buildRiskDoc`, `printDoc` |
| `js/facturacion.js` | Facturas + tope anual |
| `js/core.js` | Inicialización `DOMContentLoaded` + setup PWA |

CSS: en `css/` (el del documento, en `print.css` y `documento.css`). Ojo con los dos bloques del documento: `@media print` (`#doc-a4`)
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

## 4. Actualizar la Ayuda
La app tiene una Ayuda (Configuración → Ayuda, `js/ayuda.js`) que explica cada función
y lleva al lugar de la pantalla. Si la feature es nueva o cambia lo que ve el usuario:
1. Sumá o corregí el artículo en `AYUDA` (título, palabras con que se buscaría, texto
   corto en voseo y, si tiene lugar en pantalla, el destino `ir`).
2. Si cambiaste o borraste un id o una clase del HTML, revisá los `ir.sel` que lo usen.
3. `npm test -- ayuda` verifica que todos los destinos y relacionados sigan existiendo.

## 5. Verificar antes de cerrar
```bash
npm run lint    # sintaxis, bugs, convenciones, orden de carga y versión
npm test        # la suite entera en un navegador real (≈1,5 min)
```
Para validar visualmente la vista previa o el PDF, usá la skill `webapp-testing`.

## 6. Para desplegar
Cuando el cambio esté listo, usá la skill `deploy-presupuesto` (sube la versión con
`npm run subir-version`, corre los tests y deja todo listo para mergear).
