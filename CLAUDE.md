# Presupuestos AR — Guía del proyecto (para Claude Code)

> App PWA para generar **presupuestos de poda y extracción de árboles** (Argentina).
> Esta guía es el mapa del proyecto: leela primero para no escanear las ~8.000 líneas del `index.html`.

## Qué es
- PWA instalable, **offline-first**, sin login, pensada para que cualquier colega podador la use desde el celular.
- Los datos viven en **`localStorage`** del dispositivo (no hay backend). Backup opcional a **Google Drive**.
- Se publica en **Cloudflare** → `https://presupuesto-ar.juliobarribolbo.workers.dev`.

## Arquitectura (importante)
- **Sin build, sin frameworks: JavaScript vanilla.** Todo el HTML + CSS + JS está en **un único `index.html`**.
- Es una decisión deliberada (simplicidad, deploy de un archivo, offline trivial). No usar bundlers ni frameworks.
- El JS está todo en **un solo `<script>` con ámbito global**: las funciones se llaman entre sí y se usan en `onclick="..."`. **No convertir a módulos ES** sin refactorizar los handlers.

## Estructura de archivos
- `index.html` — **toda la app** (markup + `<style>` + `<script>`).
- `sw.js` — Service Worker (offline + actualizaciones). **`CACHE_VERSION` actual: `presupuesto-v130`**.
- `manifest.webmanifest`, `*.png` — PWA (instalación, iconos).
- `push-worker/` — Cloudflare Worker **opcional** para notificaciones push de seguimiento (avisos con la app cerrada). No es parte del PWA shell; se despliega aparte. Ver `docs/push-setup.md`. La app es inerte a esto hasta rellenar `PUSH_WORKER_URL` / `PUSH_VAPID_KEY` en `index.html`.

## Mapa del código dentro de `index.html`
El JS está organizado por secciones marcadas con comentarios `// ===== js/<nombre>.js =====`.
**Buscá esos marcadores** (son anclas estables) en vez de fiarte de números de línea.

Comando rápido para listarlos todos con número de línea:
```bash
grep -n "===== js/" index.html
```

| Sección | De qué se ocupa |
|---|---|
| `js/state.js` | Estado global `S`, defaults `DEF`, claves `LS`, helpers (fechas, dinero, `esc`), `saveLS`/`loadLS`, `safeSetLS`, toasts, totales |
| `js/photos.js` | Almacén de fotos en **IndexedDB** (`pq_photos`). `item.photo` guarda un ID `p_...`; el binario vive en IDB. `savePhoto`/`getPhotoData`/`hydratePhotoCache`/`migrateInlinePhotosToIDB`/`restorePhotosFromBackup` |
| `js/clients.js` | DBs de clientes, especies y servicios (autocompletar) |
| `js/phrases.js` | Biblioteca de frases reusables |
| `js/items.js` | Ítems del presupuesto (árbol/servicio/nota), recargo, escenarios A/B |
| `js/ui.js` | restoreUI/syncFromUI, pestañas, modos, fechas, numeración, vista previa |
| `js/history.js` | Historial de presupuestos, seguimiento, WhatsApp |
| `js/exportimport.js` | Export/import JSON, `buildBackupObject`/`applyBackupObject`, **módulo GDRIVE (Google Drive)** |
| `js/pdf.js` | `buildDoc`/`buildEstDoc`/`buildRiskDoc` (documento para imprimir/PDF), `printDoc` |
| `js/facturacion.js` | Registro de facturas + tope anual |
| `js/mapa.js` | Mapa de presupuestos (ubicación, "Sin ubicar", zonas) |
| `js/calendar.js` | Pestaña **Agenda**: dos vistas (`_calView` `mes`/`agenda`) que superponen trabajos, recontactos, vencimientos y seguimientos (derivados del historial) + notas/recordatorios manuales (`getNotes`/`setNotes`, `LS.NOTES`, incluidas en el backup). Colores por concepto vía tokens `--c-*` (unificados con los chips/badges del historial); `renderCal` (grilla mes) / `renderCalList` (lista cronológica con sección "Atrasado") / `_calEvHTML` (tarjeta de evento compartida) |
| `js/core.js` | Inicialización (`DOMContentLoaded`) + setup de la PWA |

El CSS vive en el `<style>` (líneas ~16–1711). Hay dos bloques de estilos del documento: uno `@media print` (`#doc-a4`) y otro de pantalla para la vista previa (`.doc-preview-host .doc-a4-screen`).

## Convenciones importantes
- **Estado:** objeto global `S` (presupuesto actual + config). `DEF` son los valores por defecto.
- **localStorage:** claves centralizadas en el objeto `LS`. Las DBs tienen sus propias constantes (`SPECIES_KEY`, `SERVICES_KEY`, `CLIENT_KEY`, `PHRASE_KEYS`…). Escribir SIEMPRE vía `safeSetLS()` (maneja cuota llena y dispara el backup a Drive).
- **Dinero en centavos:** usar `moneyToCents` / `centsToMoney` / `fmtM` (evita errores de punto flotante). No operar con floats de pesos directo.
- **Fechas en LOCAL, no UTC:** usar `today()` / `toLocalISODate()` / `calcExpiry()`. Nunca `toISOString().slice(0,10)` para fechas de calendario (corre el día en Argentina).
- **Fotos en IndexedDB, no en localStorage:** `item.photo` guarda un ID `p_...`; el dataURL vive en IDB (`pq_photos`). Para mostrar una foto resolvé con `getPhotoData(item.photo)` y validá con `safeImgSrc()`. Para guardar una foto nueva usá `savePhoto(dataUrl)` (devuelve el ID, o el dataURL embebido si IDB falla). El caché en memoria se hidrata al iniciar con `hydratePhotoCache()` (antes del primer render). Las fotos viejas embebidas (`data:image/...`) siguen funcionando y se migran a IDB con `migrateInlinePhotosToIDB()` al cargar. El backup completo incluye las fotos referenciadas (`photos`) para sobrevivir un cambio de dispositivo.
- **XSS:** escapar SIEMPRE los datos del usuario con `esc()` antes de meterlos en `innerHTML`.
- **3 modos de presupuesto:** Normal, Estimativo (fotos) y Riesgo (informe ISA). `buildDoc()` deriva a `buildEstDoc()`/`buildRiskDoc()` según `S.isEstimative`/`S.isRisk`.
- **Temas del PDF (`S.pdfTheme`):** `clasico`, `profesional`, `calido`, `minimalista`, `lateral`, `tecnico`, `elegante` (clase `pdoc-theme-X` sobre `<table class="pdoc">`). `S.pdfCompact` es un modificador ortogonal de densidad (clase `pdoc-compact`). Para agregar uno nuevo está la skill **`nuevo-tema-pdf`** (`.claude/skills/`), que documenta la receta exacta (CSS, encabezado, UI, verificación, despliegue).

## Módulo GDRIVE (detalles que no romper)
- `gdriveGetToken({ interactive? })`: por defecto silencioso. Usa **`login_hint`** (NO `hint`, que GIS ignora) con el email guardado para que, aun con varias cuentas abiertas en el navegador, Google renueve sin mostrar el selector. Las llamadas de fondo usan `prompt: 'none'` (nunca abren UI). `{ interactive: true }` solo desde botones que el usuario toca (primera conexión / restaurar): si todavía no hay email recordado pide consentimiento/selector (única vez).
- `gdriveRememberEmail(token)`: llama a `drive/v3/about` y guarda el email en `LS.GDRIVE_EMAIL` (`pq_gdrive_email`). Se llama después de `gdriveConnect` y `gdriveRestore`.
- `scheduleGdriveBackup` y el handler de `visibilitychange` verifican `navigator.onLine` antes de intentar nada — no tocar sin señal.
- El listener `window.addEventListener('online', …)` sube lo pendiente al volver la conexión.
- Al desconectar (`gdriveDisconnect`) se borra también `LS.GDRIVE_EMAIL`.

## Flujo de despliegue (SEGUIR SIEMPRE)

> **Para desplegar cualquier cambio a producción: mergear la rama de trabajo a
> `main`. Cloudflare detecta el push y despliega automáticamente — no hay
> ningún paso manual extra.** Los usuarios con la app instalada reciben la
> versión nueva la próxima vez que abran la app con conexión.

1. Desarrollar en la rama de trabajo (`claude/...`), no en `main`.
2. **Subir `CACHE_VERSION` en `sw.js`** en cada cambio que se despliegue (si no, los dispositivos siguen con la versión vieja en caché). Formato: `presupuesto-vNN`. **Versión actual: v130**.
3. Si agregás un archivo nuevo (ej. otro `.js` o `.css`), **agregarlo a `APP_SHELL` en `sw.js`** o se rompe el offline.
4. **Mergear a `main`** → Cloudflare despliega solo.

> **Instrucción de flujo de trabajo:** Al terminar cada función o cambio,
> **mergear inmediatamente a `main`** sin esperar que el usuario lo pida.
> El usuario prueba la app directamente en producción después de cada merge.

> **AUTORIZACIÓN PERMANENTE (deploy):** El usuario (juliobarribolbo@gmail.com,
> dueño del repo) autoriza de forma permanente y explícita **mergear la rama de
> trabajo (`claude/...`) a `main` y pushear `main`** automáticamente al terminar
> cada cambio ya verificado (sintaxis JS + `test/pwa.test.cjs` OK), **sin volver
> a preguntar**. Esto cubre el deploy a producción vía Cloudflare. (No incluye
> crear Pull Requests: eso sigue requiriendo pedido explícito.)

## Cómo verificar cambios (sin romper)
**Sintaxis JS** — aislar el `<script>` inline y verificar con node:
```bash
python3 - <<'PY'
import re, subprocess, sys
html = open('index.html', encoding='utf-8').read()
js = "\n;\n".join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))
open('/tmp/app_check.js','w',encoding='utf-8').write(js)
sys.exit(subprocess.run(['node','--check','/tmp/app_check.js']).returncode)
PY
```

**Persistencia:** siempre que se toque `localStorage`, confirmar que las claves del objeto `LS` no cambian (riesgo de pérdida de datos de usuario).

**Comportamiento (navegador headless):** en sesiones de Claude Code on the web, el SessionStart hook (`.claude/hooks/session-start.sh`) deja instalado `chrome-headless-shell` + `puppeteer-core`. Hay un test que valida SW real (`./sw.js`), que crea la cache de la versión declarada en `sw.js`, y que el app-shell carga offline:
```bash
node test/pwa.test.cjs
```
Parsea el `CACHE_VERSION` de `sw.js`, así que no hay que tocarlo al subir la versión. _(La network policy del entorno puede bloquear cdnjs/fuentes; por eso el test no depende de recursos externos.)_ Para validar PDF/persistencia con datos, se puede seguir manejando la app cargando `file://.../index.html`, seteando `S` y llamando funciones.

## Cosas que NO romper
- No pasar el JS a módulos ES (rompería los `onclick` globales).
- No olvidar subir `CACHE_VERSION` al desplegar.
- No cambiar los valores de las claves de `localStorage`.
- No volver a usar `toISOString()` para fechas de calendario.
- No incluir el `client_secret` de Google en el repo (solo se usa el `CLIENT_ID`, que es público).
- No pedir token de Google al abrir la app (ver sección GDRIVE arriba).
