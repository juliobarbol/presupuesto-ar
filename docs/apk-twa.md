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
  dominio, o el package id.
- **Offline**: la app funciona sin datos una vez abierta con conexión al
  menos una vez (para que el SW cachee el shell). Los datos viven en
  localStorage + IndexedDB del teléfono; el backup a Drive se encola y sube
  solo al volver la señal.
- **Primer arranque sin señal**: si justo el primer arranque es sin datos,
  Android no puede verificar el dominio y abre con barra de URL, pero
  **igual funciona**; se corrige la próxima vez que abras con conexión.
