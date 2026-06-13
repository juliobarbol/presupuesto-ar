# Generar el APK (TWA) — Presupuestos AR

> La app es una **PWA**. Para empaquetarla como `.apk` usamos una **TWA**
> (Trusted Web Activity): una cáscara Android mínima que abre la PWA en
> pantalla completa, **sin tocar el código**. Las actualizaciones siguen
> llegando solas al subir `CACHE_VERSION` (la TWA carga la web en vivo) y el
> **offline funciona igual** que la PWA instalada (mismo service worker).

Dominio de producción: `https://presupuesto-ar.juliobarribolbo.workers.dev`

---

## Paso a paso

### 1. Generar el APK con PWABuilder
1. Entrar a https://www.pwabuilder.com/ y pegar la URL de producción.
2. Esperar el análisis (debería dar verde: manifest, service worker e ícono
   maskable ya están).
3. **Package For Stores → Android → Generate**.
4. Dejar la opción **TWA** (no "WebView"/empaquetado, así el offline y los
   updates funcionan como en la PWA).
5. Elegir el **Package ID** (queda fijo para siempre). Sugerido:
   `dev.workers.juliobarribolbo.presupuesto_ar`
   (los guiones no se permiten en package names → usar guion bajo).
6. Descargar el `.zip`. Trae: el `.apk` (para probar/sideload), el `.aab`
   (para Play Store), la clave de firma (`signing.keystore` + contraseñas) y
   un `assetlinks.json` **ya generado con el fingerprint real**.

> ⚠️ **Guardá la clave de firma y sus contraseñas en un lugar seguro.** Sin
> ella no podés volver a actualizar la app en Play Store nunca más.

### 2. Publicar `assetlinks.json` (vincula dominio ↔ APK)
PWABuilder te da el `assetlinks.json` correcto dentro del zip. Copiá su
contenido a `/.well-known/assetlinks.json` de este repo (reemplazando los
placeholders) y desplegá. Tiene que quedar accesible en:

`https://presupuesto-ar.juliobarribolbo.workers.dev/.well-known/assetlinks.json`

Necesitás dos datos (ambos vienen del zip / de PWABuilder):
- **`package_name`**: el Package ID que elegiste en el paso 1.
- **`sha256_cert_fingerprints`**: el SHA-256 de la clave de firma. Si no lo
  ves en el zip, sacalo con:
  ```bash
  keytool -list -v -keystore signing.keystore -alias <alias> | grep SHA256
  ```
  Va con el formato `AA:BB:CC:...` (mayúsculas, separado por `:`).

Esto es lo único que toca el repo. Sin este archivo bien publicado, la TWA
abre con una barra de URL arriba (modo navegador) en vez de pantalla completa.

### 3. Instalar / distribuir
- **Probar ya**: pasá el `.apk` al teléfono (WhatsApp/USB) e instalalo
  habilitando "instalar de orígenes desconocidos".
- **Play Store**: subí el `.aab` (necesitás cuenta de desarrollador, USD 25
  una sola vez, + política de privacidad publicada).

---

## Notas para el mantenimiento
- **Actualizar la app**: igual que siempre → cambiás el código y subís
  `CACHE_VERSION` en `sw.js`. La TWA carga la versión nueva sola, **no hace
  falta regenerar ni reinstalar el APK**.
- **Solo regenerás el APK** si cambiás el ícono/nombre del manifest, el
  dominio, el package id, o los **accesos directos** (`shortcuts`) — ver la
  sección de abajo.
- **Offline**: la app funciona sin datos una vez abierta con conexión al
  menos una vez (para que el SW cachee el shell). Los datos viven en
  localStorage + IndexedDB del teléfono; el backup a Drive se encola y sube
  solo al volver la señal.
- **Primer arranque sin señal**: si justo el primer arranque es sin datos,
  Android no puede verificar el dominio y abre con barra de URL, pero
  **igual funciona**; se corrige la próxima vez que abras con conexión.

---

## Accesos directos (shortcuts) en el APK

El manifest define `shortcuts` (long-press en el ícono → "Nuevo presupuesto"
y "Historial"). En la **PWA instalada** ("agregar a inicio") aparecen solos.
En el **APK (TWA)** NO: la TWA **hornea los shortcuts al generar el APK** y no
los relee del manifest en vivo. Por eso, cada vez que cambian los `shortcuts`
hay que **regenerar el APK**.

Cómo funcionan internamente: cada shortcut abre la app con un parámetro
`?go=…` (`?go=nuevo`, `?go=historial`); el init de la app lo lee al arrancar,
dispara la acción (`newQuote()` / `switchTab('historial')`) y limpia la URL
con `replaceState` para que un reload no la repita.

### Regenerar el APK manteniendo la actualización (no app nueva)

> ⚠️ **Clave:** hay que **reusar la misma clave de firma** (`signing.keystore`
> del paquete original). Si firmás con otra clave, Android lo trata como una
> app distinta (no se actualiza sobre la instalada) y además cambiaría el
> fingerprint → habría que rehacer `assetlinks.json`.

1. En https://www.pwabuilder.com/, pegar la URL de producción y generar de
   nuevo el paquete Android (TWA).
2. En las opciones, **usar la firma existente**: subir el `signing.keystore`
   con su contraseña y alias (están en `signing-key-info.txt` del zip
   original). Mantener el **mismo Package ID**
   (`dev.workers.juliobarribolbo.presupuesto_ar.twa`).
3. **Subir el `versionCode`** (App version code) a un número mayor que el
   instalado (ej. de 1 a 2). Android exige `versionCode` mayor para instalar
   encima como actualización.
4. Descargar el `.apk`/`.aab` nuevo e instalarlo encima del existente.

Como el package id y la clave de firma no cambian, **el fingerprint sigue
siendo el mismo** → `assetlinks.json` NO se toca y la verificación del dominio
se mantiene. Los accesos directos ya quedan disponibles con long-press.
