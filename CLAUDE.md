# Presupuestos AR — Guía del proyecto (para Claude Code)

> App PWA para generar **presupuestos de poda y extracción de árboles** (Argentina).
> Esta guía es el mapa y las reglas. **El detalle de cada módulo** —el porqué de cada
> decisión y los casos reales que la motivaron— está en **`docs/modulos/<archivo>.md`**:
> leé el del archivo que vas a tocar antes de tocarlo.

## Qué es
- PWA instalable, **offline-first**, sin login, pensada para que cualquier colega podador la use desde el celular.
- Los datos viven en **`localStorage`** del dispositivo (no hay backend); las fotos en **IndexedDB**. Backup opcional a **Google Drive**.
- Se publica en **Cloudflare** → `https://presupuesto-ar.juliobarribolbo.workers.dev`.

## Arquitectura (importante)
- **Sin build, sin frameworks: JavaScript vanilla.** Markup en `index.html`, CSS en `css/*.css`, JS en `js/*.js`; cada archivo se publica tal cual. Es deliberado (simplicidad, offline trivial). No usar bundlers ni frameworks.
- Los `js/*.js` son **scripts clásicos, no módulos**: comparten el ámbito global y se cargan en el orden de los `<script src>` de `index.html`; las funciones se llaman entre sí y desde `onclick="..."`. **No convertir a módulos ES.** Tres reglas que `npm run lint` verifica (`scripts/lint-app.cjs` lintea la app como UN programa): (1) lo que corre **al cargar** un archivo (inicializadores, IIFE, llamadas sueltas y lo que ellas usan) no puede usar algo de un archivo **posterior**; dentro de funciones que corren después, sí; (2) cada nombre global es único en toda la app (la segunda declaración pisa a la primera sin error); (3) cada archivo arranca con `'use strict';`.
- **Cada js/css se pide con `?v=<versión>`** y `sw.js` los lista igual en `APP_CODIGO`: la navegación va primero a la red y el resto primero a la caché, así que sin la marca el HTML nuevo cargaría el JS viejo. **Archivo nuevo de js/css: sumarlo a `index.html` y a `APP_CODIGO`** (el lint avisa si no coinciden). El SW instala `APP_CODIGO` **todo o nada**.

## Archivos
- `index.html` — markup, los `<link>`/`<script src>` y un `<script>` chico que pone el tema antes de pintar.
- `js/*.js`, `css/*.css` — el código (mapa abajo). CSS en este orden, la cascada depende de él: `base`, `components`, `print`, `riesgo`, `documento` (temas y elementos del PDF), `mapa`, `movil` (bloque CELULAR, último a propósito). El documento tiene estilos de impresión (`@media print`, `#doc-a4`) y de vista previa (`.doc-preview-host .doc-a4-screen`): si tocás el layout del PDF, revisá los dos.
- `sw.js` — Service Worker. **`CACHE_VERSION` actual: `presupuesto-v261`**.
- `manifest.webmanifest`, `*.png` — PWA.
- `push-worker/` — Worker de las notificaciones con la app cerrada. **No se publica al mergear**: `npx wrangler deploy --config ./wrangler.toml` desde `push-worker/` (sin `--config` publica la APP). Ver `docs/push-setup.md` y `docs/modulos/push.md`.
- `package.json`, `eslint.config.mjs`, `scripts/` (`test.cjs`, `lint-app.cjs`, `subir-version.cjs`), `.github/workflows/ci.yml` — solo herramientas de desarrollo; `.assetsignore` las deja fuera de lo publicado (igual que `docs/` y los `.md`).

## Mapa del código (`js/`, en orden de carga)
| Archivo | De qué se ocupa |
|---|---|
| `state.js` | Estado `S`, defaults `DEF`, `CFG_GLOBAL_FIELDS`/`DATOS_PRESUPUESTO`, claves `LS`, helpers (fechas, dinero, `esc`), `saveLS`/`loadLS`/`safeSetLS`, toasts, `colaAviso`, `confirmDlg`, totales, barra fija |
| `riesgo.js` | Nivel de riesgo (`riskEval`, matrices ISA) |
| `dropdown.js` · `datepicker.js` | `<select>` y fecha propios con el tema de la app |
| `seguimiento.js` | Config del seguimiento, pendientes y vencidos, plantillas de WhatsApp |
| `push.js` | Avisos con la app cerrada (`_buildPushAvisos`, `initPush`) |
| `net.js` | Salud de la conexión: `netFetch`, cortacircuitos, `netPuedeAuto` |
| `sanitize.js` | Validación de todo lo que entra de afuera; `migrateSanitizeStored` al arrancar |
| `photos.js` | Fotos en IndexedDB (`pq_photos`) |
| `clients.js` | Autocompletar (clientes, especies, servicios) y "Mis servicios" |
| `phrases.js` | Biblioteca de frases, `[especie]` y huecos de plantilla |
| `items.js` | Ítems (árbol/servicio/nota), recargo, escenarios A/B, rubro y cobro por unidad, tarjeta del servicio |
| `ui.js` | `restoreUI`/`syncFromUI`, pestañas, modos, vista previa, shell del editor, avisos de backup, espacio |
| `history.js` | Historial, estados, versiones, trabajos sin presupuesto, autoguardado |
| `exportimport.js` · `gdrive.js` · `gcal.js` | Backup a archivo; copia en Google Drive; Agenda → Google Calendar |
| `pdf.js` | Documentos (`buildDoc`/`buildEstDoc`/`buildRiskDoc`/`buildReciboDoc`) y estilo propio del PDF |
| `facturacion.js` | Facturas y tope anual |
| `mapa.js` | Mapa de presupuestos (pins, zonas, rutas) |
| `clima.js` | Pronóstico (Open-Meteo), avisos y panel de clima |
| `calendar.js` | Pestaña Agenda, notas y visitas, `.ics` (`calEvTexto`) |
| `notifs.js` | Campanita: pendientes y "Deshacer" |
| `ayuda.js` | Configuración → Ayuda: artículos, glosario, buscador y "Llevame ahí" |
| `nav.js` | Botón "Atrás", teclado, gestos |
| `core.js` | Arranque (`DOMContentLoaded`) e `irDestino` |

Detalle: `docs/modulos/<archivo>.md` (más `pdf-estilo.md` para temas, elementos, fondos y "Mis estilos").

## Convenciones (no negociables)
El porqué de cada una (casos reales, auditorías, tests) está en `docs/modulos/convenciones.md`.

- **Configuración vs. presupuesto.** `S` tiene las dos cosas. Todo campo de `DEF` va en **una** lista: `CFG_GLOBAL_FIELDS` (del negocio: empresa, diseño, textos del PDF, numeración) o `DATOS_PRESUPUESTO`. La pregunta: *¿tendría sentido que valga distinto en dos presupuestos del mismo día?* El test `config-global` falla si queda alguno sin clasificar. Un snapshot del historial guarda solo el presupuesto (`snapshotSinConfig`) y se vuelca a `S` **solo** con `assignSnapshot(S, snap)`, nunca con `Object.assign(S, snapshot)` (el lint lo prohíbe).
- **Identidad de una entrada del historial.** Re-guardar reemplaza solo el contenido y `savedAt`; el `id` y todo lo demás se conserva: de ese id cuelgan Google Calendar, los push, la campanita y el "Deshacer".
- **localStorage.** Claves en el objeto `LS` (las DBs en sus constantes). **Nunca cambiar el valor de una clave** (se pierden datos). Escribir con `safeSetLS()`; los caches con `{ backup:false }`. Clave nueva: decidir si va al backup (criterio en `buildBackupObject()`). Tope ~5 MiB de caracteres: lo muestra Configuración → Datos.
- **Dinero en centavos** (`moneyToCents`/`centsToMoney`/`fmtM`). En pantalla y en el documento, sin centavos; solo el recibo los muestra si existen. Total del estimativo: siempre `calcEstTotals()`.
- **Fechas en local**: `today()`/`toLocalISODate()`/`calcExpiry()`. Nunca `toISOString().slice(0,10)` (el lint lo prohíbe).
- **Fotos en IndexedDB**: `item.photo` guarda un id `p_...`; mostrar con `getPhotoData()` + `safeImgSrc()`, guardar con `savePhoto()`.
- **Red**: nada sale a internet sin `netFetch()` (el lint lo prohíbe); lo que el usuario no pidió, solo si `netPuedeAuto()` (o `netPuedeAutoImportante()` para sus datos).
- **XSS e importados**: `esc()` todo dato del usuario que vaya a `innerHTML`. Lo que llega de un archivo, de Drive o de `localStorage` pasa por `js/sanitize.js` antes de tocar el estado. Un id que va dentro de un atributo (`onclick="fn(ID)"`) se valida, o se usa `data-*` + listener delegado.
- **Tres modos**: Normal, Estimativo y Riesgo; `buildDoc()` deriva según `S.isEstimative`/`S.isRisk`. El informe de riesgo dice "basada en la metodología de la ISA" y **nunca "TRAQ"**.
- **Google (Drive y Calendar)**: **nunca pedir token al abrir la app con UI** (solo silencioso; lo interactivo, desde un botón). No volver a tragar errores de sync con `.catch(() => {})`: un backup que falla en silencio es el peor escenario de una app sin backend. Ver `docs/modulos/gdrive.md` y `gcal.md` antes de tocar el login.
- **Overlay nuevo**: sumarlo a `NAV_OVERLAYS` (`nav.js`) o el botón "Atrás" no lo cierra.
- **Tema nuevo del PDF**: skill `nuevo-tema-pdf`. **Feature nueva**: skill `nueva-feature`.

## Flujo de despliegue (SEGUIR SIEMPRE)
> Desplegar = **mergear la rama de trabajo a `main`**: Cloudflare publica solo. Los
> celulares reciben la versión nueva la próxima vez que abren la app con señal.

1. Desarrollar en la rama de trabajo (`claude/...`), no en `main`.
2. **Subir la versión en cada cambio que se despliegue: `npm run subir-version`** (mueve `CACHE_VERSION` de `sw.js`, la marca `?v=` de `index.html` y esta guía). **Versión actual: v261**.
3. Archivo nuevo: `js/`/`css/` en `index.html` (con `?v=`) **y** en `APP_CODIGO`; ícono o fuente, en `APP_SHELL`. Lo pesado bajo demanda (html2pdf), en `VENDOR_LAZY`.
4. Verificar (abajo) y **mergear a `main`**.

> **Instrucción de flujo de trabajo:** al terminar cada función o cambio,
> **mergear inmediatamente a `main`** sin esperar que el usuario lo pida.
> El usuario prueba la app directamente en producción después de cada merge.

> **AUTORIZACIÓN PERMANENTE (deploy):** El usuario (juliobarribolbo@gmail.com,
> dueño del repo) autoriza de forma permanente y explícita **mergear la rama de
> trabajo (`claude/...`) a `main` y pushear `main`** automáticamente al terminar
> cada cambio ya verificado (`npm run lint` + `npm test` OK), **sin volver
> a preguntar**. Esto cubre el deploy a producción vía Cloudflare. (No incluye
> crear Pull Requests: eso sigue requiriendo pedido explícito.)

## Cómo verificar
```bash
npm run lint            # bugs, convenciones, orden de carga y versión (≈10 s)
npm test                # test/*.test.cjs en paralelo, navegador real (≈1,5 min)
npm test -- mapa nota   # solo los que tengan esas palabras en el nombre
```
Si falta `node_modules`, `npm ci` (el SessionStart hook ya lo hace, y deja Chrome headless + puppeteer-core). Excepción legítima al lint: `// eslint-disable-next-line <regla> -- <por qué>`. El **CI** de GitHub corre los dos en cada push; Cloudflare publica `main` igual, así que el CI avisa, no frena. Para ver la app: cargar `file://.../index.html`, setear `S` y llamar funciones (skill `webapp-testing`).

## Cosas que NO romper
- No pasar el JS a módulos ES (rompería los `onclick` globales).
- No olvidar `npm run subir-version` al desplegar.
- No cambiar los valores de las claves de `localStorage`.
- No usar `toISOString()` para fechas de calendario.
- No incluir el `client_secret` de Google en el repo (solo el `CLIENT_ID`, que es público).
- No pedir token de Google al abrir la app.
