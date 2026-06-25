# Spec — Compartir fotos a la app (Web Share Target)

> **Estado: IMPLEMENTADO** (sw.js + manifest + index.html). Este documento
> describe el objetivo, la UX y el enfoque técnico que se siguió.
>
> Decisiones tomadas al implementar:
> - La bandeja es un **modal nuevo** (`#share-overlay`), no se integra al Editor.
> - Por cada foto, un `<select>` elige destino: **crear árbol nuevo** (default),
>   asignar a un ítem existente, o descartar. El usuario confirma con un botón.
> - Las fotos viven en los **ítems normales** (`S.items`), que son los que
>   llevan `item.photo` y aparecen en el "Registro Fotográfico" del PDF. Por eso
>   al aplicar se fuerza **modo normal**; el usuario puede pasar a estimativo a
>   mano después.
> - Tope de `MAX_SHARED_PHOTOS = 12` fotos por compartición.

## Objetivo (user story)

Estando en la galería o la cámara del teléfono, el usuario selecciona **una o
varias fotos** de los árboles, toca **Compartir** y elige **"Presupuestos"**.
La app se abre con esas fotos y el usuario **decide qué foto va en qué árbol**
(ítem) del presupuesto.

Encaja con el **modo estimativo** (presupuesto con fotos), donde cada ítem
puede llevar una foto.

## UX deseada

1. Compartir N fotos → la app abre en una **"bandeja de fotos compartidas"**.
2. La bandeja muestra las miniaturas de todas las fotos recibidas.
3. Por cada foto, el usuario elige el destino:
   - asignarla a un **árbol/ítem existente**, o
   - **crear un árbol nuevo** y asignarla.
4. Al confirmar, cada foto queda guardada (IDB) y referenciada en su ítem.

Decisión a tomar al implementar: ¿la bandeja es un modal/pantalla nueva, o se
auto-crean ítems estimativos y se reordenan? (Ver "Decisiones abiertas".)

## Enfoque técnico

### 1. `manifest.webmanifest` — declarar el share target
```json
"share_target": {
  "action": "./share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "files": [
      { "name": "photos", "accept": ["image/*"] }
    ]
  }
}
```
`multiple` se logra recibiendo varios archivos en el campo `photos` (Android
manda todos los seleccionados). El `accept` filtra a imágenes.

### 2. `sw.js` — interceptar el POST del share
Hoy el SW ignora todo lo que no sea GET (`if (req.method !== 'GET') return;`).
Hay que agregar **antes** de esa línea un handler para el POST a `./share-target`:
- `event.respondWith(...)` que haga `const form = await req.formData();`
- `const files = form.getAll('photos');` (array de `File`/`Blob`)
- **Guardar los blobs en un store temporal** (IndexedDB, ej. `pq_share_inbox`)
  porque el redirect pierde el body.
- Responder con `Response.redirect('./index.html?share=1', 303);`

Ojo: el SW debe estar activo. La acción `./share-target` no es un archivo
real; la resuelve el SW. (No agregar a `APP_SHELL`.)

### 3. `index.html` — al abrir con `?share=1`
En el init (mismo lugar donde ya leemos `?go=…`, al final del
`DOMContentLoaded`):
- Detectar `?share=1`, limpiar la URL con `replaceState`.
- Leer los blobs del store temporal (`pq_share_inbox`) y **vaciarlo**.
- Para cada blob: `compressImage(blob, 1000, 0.7)` → `savePhoto(dataUrl)` →
  obtener ref `p_...`.
- Mostrar la **bandeja de asignación** (UI nueva) con las miniaturas
  (`getPhotoData(ref)` + `safeImgSrc()`).
- Al asignar: `setItemField(idx,'photo',ref)` sobre el ítem elegido (o crear
  uno con `addEstItem()` y luego asignar). `renderEstItems()` + `sched()`.

## Anclas de código a reusar (buscar por nombre, no por línea)

| Función / sección | Para qué |
|---|---|
| `compressImage(file, maxSide, quality)` | Redimensiona/compacta la imagen a JPEG (ya se usa al adjuntar fotos). |
| `savePhoto(dataUrl)` → ref `p_...` | Guarda en IndexedDB (`pq_photos`) y devuelve el ID. |
| `getPhotoData(ref)` / `safeImgSrc(s)` | Resolver y validar la imagen para mostrar miniatura. |
| `setItemField(idx, 'photo', ref)` | Asigna la foto a un ítem. |
| `addEstItem()` / `renderEstItems()` | Crear/renderizar ítems del modo estimativo. |
| sección `js/photos.js` (en `index.html`) | Todo el almacén de fotos en IDB; ahí va el store temporal `pq_share_inbox`. |
| handler `?go=…` al final del `DOMContentLoaded` | Patrón a copiar para leer `?share=1`. |

## Flujo de despliegue (recordatorio)
- **Subir `CACHE_VERSION`** en `sw.js` (cambia el SW → hay que invalidar caché).
- **Regenerar el APK** con PWABuilder reusando la firma (ver `apk-twa.md`): los
  `share_target`, igual que los `shortcuts`, **se hornean al generar el APK**;
  no se releen del manifest en vivo.

## Gotchas / límites
- **Solo Android (Chrome / TWA).** Web Share Target Level 2 no existe en
  iOS/Safari. Para el caso de uso (APK Android) está bien.
- El **redirect pierde el body** del POST → por eso hay que stashear los blobs
  en IDB antes de redirigir.
- Cuidar la **cuota**: comprimir antes de guardar (ya lo hace `compressImage`).
- **Mantener el patrón global** (sin módulos ES) y **escapar con `esc()`**
  cualquier dato de usuario en la UI de la bandeja.

## Decisiones abiertas (definir al retomar)
1. ¿La bandeja es un modal nuevo o se integra en la pestaña Editor?
2. ¿Auto-crear un ítem por foto y dejar reasignar, o empezar con la bandeja
   vacía y que el usuario asigne cada una?
3. ¿Aplica solo al **modo estimativo** o también al normal?
4. ¿Tope de fotos por compartir? (rendimiento / cuota).
5. ¿Qué pasa si comparte fotos sin tener un presupuesto abierto? (¿crear uno
   estimativo nuevo automáticamente?).
