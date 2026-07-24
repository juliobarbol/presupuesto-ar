# Auditoría integral — Presupuestos AR

**Fecha:** 24 de julio de 2026
**Versión auditada:** `sw.js` **v173** · `index.html` 16.928 líneas
**Alcance:** `index.html`, `sw.js`, `push-worker/`, `vendor/`, `manifest.webmanifest`, `wrangler.jsonc`, `.assetsignore`
**Método:** lectura por secciones (`// ===== js/… =====`), reproducción con navegador headless
(`chrome-headless-shell` + `puppeteer-core`), verificación contra producción.
**Tipo:** solo lectura. No se tocó código de la app.

> Nota de método: la auditoría arrancó contra v135 y se **re-verificó entera contra v173**,
> que incorpora tres módulos nuevos (`js/clima.js`, `js/notifs.js` y la sincronización con
> Google Calendar) y ~3.200 líneas más. Todas las reproducciones de abajo se corrieron
> sobre v173. Los módulos nuevos aportaron tres hallazgos propios (A6, M8, M9) y un cuarto
> vector al XSS de C1.

---

## 1. Resumen ejecutivo

La app está en buen estado general y las funcionalidades nuevas (clima, centro de
notificaciones, sync con Calendar) están bien construidas: scope mínimo en Calendar,
diff por hash en vez de recrear eventos, cache de clima con TTL y consciente del offline.
La disciplina de centavos, las fechas locales y el escapado con `esc()` de todo lo que es
**texto** se mantienen sólidas. `node test/pwa.test.cjs` pasa los 4 checks en v173.

Los problemas serios siguen concentrados en **un solo punto ciego: los datos que entran
desde afuera** (un backup `.json` de un colega, la copia de Drive, un archivo editado a
mano). Ese camino no valida nada, y cada módulo nuevo que agrega algo al backup agrega
también una superficie de ataque nueva — el centro de notificaciones es el ejemplo fresco.

Lo más importante, en orden:

1. **Crítico — XSS ejecutable al restaurar un backup ajeno.** 4 vectores confirmados con
   reproducción; **dos de ellos sin que el usuario toque nada** (abrir la Agenda, abrir la
   campanita). Agravado en v173: ahora los tokens de Google viven en `localStorage`.
2. **Crítico — el total de un presupuesto ESTIMATIVO se guarda mal en el historial**:
   ignora la cantidad de los servicios. Medido: PDF $710.000 vs. historial $470.000.
   Ese número pre-carga el monto de la factura y suma al tope de monotributo.
3. **Crítico — un JSON con la forma equivocada rompe la app de forma permanente**:
   Historial y Agenda muertos en cada arranque, sin salida desde la app.
4. **Alto — el cache del clima dispara la subida del backup completo a Drive** (con todas
   las fotos), por pasar por `safeSetLS()`.
5. **Alto — la config de seguimiento (con las 3 plantillas de WhatsApp) sigue sin entrar
   al backup**, y los fallos del backup a Drive y de la sync con Calendar son silenciosos.

---

## 2. Tabla de hallazgos

| ID | Sev. | Área | Título | Evidencia (v173) |
|----|------|------|--------|------------------|
| C1 | Crítico | Seguridad | XSS ejecutable desde un backup importado o restaurado desde Drive (4 vectores) | `index.html:15471`, `:16432`, `:16447`, `:11233`, `:12833` |
| C2 | Crítico | Cálculos | El total del estimativo guardado en el historial ignora la cantidad de los servicios | `index.html:8942` |
| C3 | Crítico | Integridad | Un JSON con `history` que no es array deja la app rota de forma persistente | `index.html:8892`, `:8899`, `:11680` |
| A1 | Alto | Integridad | La config de seguimiento (`pq_followup`) no entra en el backup | `index.html:11436–11484` vs `:5165` |
| A2 | Alto | Integridad | `applyBackupObject()` puede fallar a la mitad y dejar el estado mezclado | `index.html:11657–11730` |
| A3 | Alto | Robustez | Los fallos del backup a Drive **y de la sync con Calendar** son silenciosos | `index.html:12304`, y el auto-backup de Drive |
| A4 | Alto | Integridad | "Combinar historial" descarta presupuestos distintos con el mismo número | `index.html` · `impHistCombine()` |
| A5 | Alto | Seguridad | `push-worker`: `GET /test` y `POST /subscribe` sin autenticación, CORS `*` | `push-worker/index.js:125`, `:146`, `:110` |
| A6 | Alto | Rendimiento | **El cache del clima dispara un backup completo a Drive** (con todas las fotos) | `index.html:14520`, `:14546`, `:4917` |
| M1 | Medio | Integridad | Las fotos nunca se borran de IndexedDB: crecen para siempre | `index.html:5520–5800` |
| M2 | Medio | Rendimiento | Todas las fotos se cargan a RAM al arrancar y viajan enteras en cada subida | `index.html:5566`, `:11456` |
| M3 | Medio | Rendimiento | Búsqueda del historial sin debounce + re-parseo completo 3–5 veces por acción | `index.html:8892`, `calBuildIndex()` |
| M4 | Medio | Integridad | Dos dispositivos con la misma cuenta de Drive se pisan sin aviso | `gdriveUpload()` / `gdriveInitOnLoad()` |
| M5 | Medio | Seguridad | Datos de clientes salen del dispositivo (KV de Cloudflare y Google Calendar) | `index.html:12209–12228`, `push-worker/index.js:154` |
| M6 | Medio | Fechas | Facturación filtra con `new Date(f.fecha)` (UTC) mezclado con `now` local | `index.html` · `factRender()` |
| M7 | Medio | Robustez | `safeSetLS()` devuelve `false` y casi ningún llamador lo mira | `index.html:4917`, `:8899` |
| M8 | Medio | Seguridad | **Los tokens OAuth de Google se persisten en `localStorage`** | `index.html:4280`, `:4285`, `:11767` |
| M9 | Medio | Seguridad | **El clima envía coordenadas con ~11 m de precisión** pese a decir que agrupa a ~1 km | `index.html:14450`, `:14474` |
| B1 | Bajo | Calidad | `LS.PDF_THEME` declarada y nunca usada (clave muerta) | `index.html:4286` |
| B2 | Bajo | Calidad | Escrituras directas a `localStorage` fuera de `safeSetLS()` | varias |
| B3 | Bajo | Seguridad | `vendor/` sin versión registrada ni `package.json`/lockfile | `vendor/html2pdf.bundle.min.js` |
| B4 | Bajo | PWA | `start_url` apunta a `./index.html`, que en producción responde 307 | `manifest.webmanifest` |
| B5 | Bajo | Calidad | Cuatro implementaciones distintas del total del estimativo | `:5095`, `:8914`, `:8942`, `:13164` |

---

## 3. Detalle por hallazgo

### C1 · Crítico — XSS ejecutable desde un backup importado o restaurado desde Drive

**Qué pasa.** Todo el **texto** del usuario está correctamente escapado con `esc()` — lo
revisé sitio por sitio y está muy bien hecho. El agujero está en otro lado: los
**identificadores y campos "de sistema"** se interpolan crudos dentro de atributos HTML, y
esos campos vienen sin validar de un archivo importado. Ninguna ruta de entrada valida la
forma de los datos: `applyBackupObject()` hace `if(d.history) setH(d.history)` y
`if (Array.isArray(d.notes)) …` (valida el array, no las notas).

Cuatro sitios confirmados:

```js
// index.html:15471 · _calColEv()  (y su gemelo en _calEvHTML)
act = `onclick="calToggleNote('${ev.noteId}')" title="…"`;

// index.html:16432 y 16447 · notifItemHTML() / notifLogItemHTML()  ← NUEVO en v173
<span class="nt-ico">${r.icon || '🔔'}</span>          // ¡sin esc(), HTML directo!
onclick='notifRunAction(${JSON.stringify(r.action)})'  // JSON crudo en atributo con comilla simple
onclick="…notifUndo('${r.id}')"

// index.html:11233 · renderHistory()
`<button … onclick="loadFromHistory(${e.id})">`

// index.html:12833 (y :12987, :13243, :13371) · buildDoc() y hermanas
`<table class="pdoc pdoc-theme-${theme}…">`   // theme = S.pdfTheme, viene del backup
```

**Reproducción** (`xss3`, `xss-notif`, `xss-hist`, `xss-theme`, los cuatro corridos con
`chrome-headless-shell` **contra v173**):

*Vector 1 — sin ninguna interacción, solo abrir la Agenda:*
```js
applyBackupObject({ _type:'backup_completo', notes:[{
  id: 'x"><img src=noexiste onerror="window.__PWNED=true">',
  fecha: '2026-07-24', texto: 'nota inocente' }] });
switchTab('agenda');
```
```
<img> inyectados en el DOM: 1
código ajeno ejecutado SIN tocar nada (window.__PWNED): true
```

*Vector 2 (nuevo en v173) — sin interacción, solo abrir la campanita:*
```js
applyBackupObject({ _type:'backup_completo', notifLog: [{
  id:'n_1', ts:Date.now(), text:'Aviso inocente',
  icon:'<img src=noexiste onerror="window.__PWNED=true">' }]});
notifRender();
```
```
código ajeno ejecutado al abrir la campanita: true
```

*Vector 3 — al tocar una tarjeta del historial:*
```
atributo generado : onclick="loadFromHistory(0);window.__PWNED=true;//)"
tras tocar la tarjeta: true
```

*Vector 4 — al abrir la vista previa / imprimir el PDF:*
```
markup: <img src="noexiste" onerror="window.__PWNED=true" …><table class="pdoc pdoc-theme-clasico">
código ajeno ejecutado: true
```

**Impacto para el podador.** Los backups se intercambian entre colegas — es un flujo
previsto. Un `.json` preparado (o una copia de Drive de una cuenta comprometida) ejecuta
código con el origen de la app, o sea con acceso a todo: historial con datos de clientes,
base de clientes con teléfonos y direcciones, facturación. **Y en v173 el daño es mayor**:
los tokens de Google ahora viven en `localStorage` (ver M8), así que el payload los lee
directo de `pq_gdrive_tok` / `pq_gcal_tok` y puede leer o pisar la copia de seguridad
entera y el calendario. Dos de los cuatro vectores no requieren que la víctima haga nada
más que abrir una pestaña.

**Nota:** `esc()` **no alcanza** como fix en los `onclick`. `esc()` no escapa la comilla
simple, así que `onclick="fn('${esc(id)}')"` seguiría siendo inyectable. Sí alcanza para
el `nt-ico`.

**Recomendación.**
1. Validar en la frontera: al importar/restaurar, filtrar cada nota, cada entry del
   historial, cada registro del `notifLog` y cada enum. IDs: `/^[\w-]{1,40}$/`.
   `pdfTheme`/`pdfFont`: lista blanca (ya existe conceptualmente en `CLAUDE.md`).
2. Reemplazar los `onclick="fn('${id}')"` y el `onclick='fn(${JSON.stringify(obj)})'` por
   `data-*` + listener delegado — el patrón que ya usa `renderQuickServices()` y que su
   propio comentario justifica. Extenderlo al resto.
3. `esc()` en `nt-ico`, o mejor: validar que `icon` sea uno de los emojis previstos.

---

### C2 · Crítico — El total del presupuesto estimativo se guarda mal en el historial

**Qué pasa.** Hay cuatro cálculos del total del estimativo y no coinciden:

```js
// index.html:5095 · updateTotalsBar() — barra de totales: itemTotal (precio × cantidad) ✅
(S.estItems||[]).forEach(i=>{ if(i.type==='work'||i.type==='service') estTotal+=itemTotal(i); });

// index.html:13164 · buildEstDoc() — el PDF: servicios con cantidad ✅
serviceItems.forEach(i=>{ svcSubtotal += itemTotal(i); });

// index.html:8942 · autoSaveToHistory() — lo que queda GUARDADO: ignora la cantidad ❌
(S.estItems||[]).forEach(i=>{ if((i.type==='work'||i.type==='service')&&i.price) total+=parseFloat(i.price)||0; });

// index.html:8914 · isBlankQuote() — misma fórmula (inocua acá: solo compara con 0)
```

**Reproducción** (`money.test.cjs`, sobre v173) — un trabajo de $350.000 y un servicio
"Volquete" de $120.000 × 3:

```
barra de totales (UI): $ 710.000,00
documento / PDF      : $ 710.000
total en el HISTORIAL: 470000   ← faltan $240.000
```

**Impacto para el podador.** El presupuesto que le mandó al cliente dice $710.000, pero el
historial guarda $470.000. Ese `e.total` no es cosmético: pre-carga el monto al registrar
la factura, suma en los totales del mes y del historial, se muestra en el mapa, y viaja en
el `.ics`, en Google Calendar y en el WhatsApp. O sea: **factura por menos de lo que
cobró** y el control del tope de monotributo queda subestimado. Solo aparece con servicios
de cantidad > 1 en modo estimativo, pero ahí es sistemático.

Además `parseFloat` sobre pesos rompe la convención de centavos (`CLAUDE.md` → "Dinero en
centavos"): con decimales acumula error de punto flotante.

**Recomendación.** Extraer `calcEstTotals(estItems)` en centavos y usarla en los cuatro
lugares. Ojo con la migración: los estimativos ya guardados siguen con el total mal;
conviene recalcular `e.total` de las entradas con `isEstimative` una sola vez al arrancar.

---

### C3 · Crítico — Un JSON con la forma equivocada rompe la app de forma permanente

**Qué pasa.** `setH()` escribe lo que le den y `getH()` solo protege el `JSON.parse`:

```js
// index.html:8892 y 8899
function getH() { try { … return JSON.parse(raw||'[]'); } catch(e){ return []; } }  // parsea OK, puede no ser array
function setH(h) { safeSetLS(LS.HISTORY, JSON.stringify(h)); if (typeof scheduleGcalSync === 'function') scheduleGcalSync(); }
```

**Reproducción** (`brick.test.cjs`, sobre v173) — se restaura un archivo cuyo `history` es
un objeto en vez de un array, y después se recarga la app:

```
quedó guardado en pq_h: {"0":{"id":1,"quoteNumber":"2026-0001"}}
errores al arrancar: [ 'h is not iterable' ]
abrir Historial → h is not iterable
abrir Agenda    → h.forEach is not a function
```

**Impacto para el podador.** La app queda rota **para siempre**, no solo en esa sesión: el
valor inválido está persistido, así que en cada apertura el arranque tira excepción y las
pestañas Historial y Agenda quedan muertas. Desde la app no hay forma de recuperarse (los
botones de import/limpiar viven en pantallas que dependen de ese mismo render). La única
salida es borrar los datos del sitio — perdiendo todo. En el campo, con el celular, es el
peor escenario posible.

**Recomendación.** Un `sanitizeHistory(raw)` en la frontera: descartar lo que no sea array,
filtrar entradas sin `id`/`quoteNumber` válidos, y usarlo tanto en `getH()` (defensa al
leer) como antes de cualquier `setH()` con datos importados. Lo mismo para `getNotes()`,
`getFacturas()` y `getNotifLog()`.

---

### A1 · Alto — La configuración de seguimiento no entra en el backup

**Qué pasa.** `buildBackupObject()` (`index.html:11436–11484`) creció bien: v173 sumó
`gcalId` y `notifLog`. Pero sigue faltando `LS.FOLLOWUP` (`pq_followup`), que guarda:

```js
enabled, days, expiryEnabled, estados,
waTemplate,            // plantilla del mensaje de SEGUIMIENTO
waSendTemplate,        // plantilla del mensaje de ENVÍO
waRecontactoTemplate,  // plantilla del mensaje de RECONTACTO
```

Inventario completo de claves persistidas vs. backup (v173):

| Clave | En el backup |
|---|---|
| `pq_s`, `pq_h`, `pq_clients`, `pq_species`, `pq_services`, `pq_services_pinned`, `pq_frases_*`, `pq_facturas`, `pq_tope_anual`, `pq_recibo_seq`, `pq_agenda_notes`, `pq_gcal_id`, `pq_notif_log`, fotos (IDB) | ✅ |
| **`pq_followup`** | ❌ **← hallazgo** |
| `pq_theme`, `pq_cal_view`, `pq_onboarded`, `pq_last_backup`, `pq_gdrive_*`, `pq_gcal_on/last/email`, `pq_day_alert_seen`, `pq_push_device_id`, `pq_clima`, `pq_clima_warn`, `pq_notif_seen` | ❌ (correcto: preferencias de UI, caches o estado por dispositivo) |
| `pq_gdrive_tok`, `pq_gcal_tok` | ❌ (correcto — pero ver M8) |
| `pq_pdf_theme` | — (declarada y nunca usada, ver B1) |

**Impacto para el podador.** Cambia de teléfono, restaura el backup, y las tres plantillas
de WhatsApp que redactó (el mensaje con el que le habla a sus clientes) vuelven al texto de
fábrica, junto con los días de seguimiento configurados. No pierde presupuestos, pero sí
trabajo propio, y de una forma que va a descubrir tarde: cuando mande un mensaje con el
texto equivocado.

> La rúbrica del prompt clasifica "dato que se persiste y no entra al backup" como Crítico.
> Lo dejo en **Alto** porque lo que se pierde es configuración y no presupuestos; si
> preferís la rúbrica literal, subilo.

**Recomendación.** `followup: getFollowupCfg()` en `buildBackupObject()` y
`if (d.followup) setFollowupCfg(d.followup)` en `applyBackupObject()`. Aprovechar para
dejar en el código la lista canónica de claves con su decisión (va / no va al backup): en
v173 ya se agregaron dos claves nuevas al backup y una se olvidó — el patrón se repite.

---

### A2 · Alto — `applyBackupObject()` puede fallar a la mitad

**Qué pasa.** Toda la restauración vive dentro de un solo `try` (`index.html:11657–11730`)
que hace ~18 escrituras seguidas a `localStorage` y a `S`, sin validación previa ni
rollback: fotos → estado → historial → clientes → especies → servicios → frases →
facturas → tope → recibos → notas → `gcalId` → `notifLog`. Si algo tira a mitad de camino
(cuota llena, un `phrases` raro), el historial y los clientes ya se pisaron pero
facturación y notas no. El usuario ve `'⚠️ El backup no tiene un formato válido.'` y
razonablemente concluye que no pasó nada — cuando ya perdió el historial anterior.

**Impacto para el podador.** Restaura un backup dudoso "para probar", le dice que no sirve,
y sus datos de antes ya no están.

**Recomendación.** Dos fases: validar y normalizar el objeto entero en memoria (se une
naturalmente con el fix de C1 y C3) y, solo si todo pasa, escribir. Como red barata:
guardar el estado actual en `pq_pre_restore` antes de escribir y ofrecer "deshacer la
restauración". El centro de notificaciones ya tiene la plomería de "Deshacer" — se puede
reusar el concepto.

---

### A3 · Alto — Los fallos del backup a Drive y de la sync con Calendar son silenciosos

**Qué pasa.** Los tres caminos automáticos se tragan el error:

```js
// auto-backup de Drive
gdriveUpload().then(gdriveUpdateUI).catch(e => console.warn('auto-backup Drive falló', e));
// al mandar la app a segundo plano
gdriveUpload().catch(() => {});
// index.html:12304 · auto-sync de Calendar (nuevo en v173)
_gWithAuthRetry(gcalInvalidateToken, gcalSync).then(gcalUpdateUI).catch(e => console.warn('auto-sync Calendar falló', e));
```

Ninguno avisa al usuario ni marca la UI. Peor: en el camino de fallo no se llama a
`gdriveUpdateUI()`, así que el cartel sigue diciendo `Conectado ✓ · Última copia: 12/03 09:41`
con la fecha del último éxito. Esa fecha vieja es la **única** señal, y hay que ir a
buscarla a la pestaña Empresa.

En `gcalSync()` es más agudo: un `throw new Error('event insert ' + r.status)` en el primer
insert corta la función antes de la pasada de borrado, así que además de no avisar, la sync
queda a medias (eventos nuevos sin crear y viejos sin borrar).

Causas realistas de fallo permanente: el usuario revocó el permiso desde su cuenta de
Google, se agotó el espacio de Drive, la Calendar API quedó deshabilitada, o el token no se
puede renovar en silencio porque cambió de cuenta en el navegador.

**Impacto para el podador.** El caso que la función existe para prevenir: pierde el
teléfono, va a recuperar de Drive, y la última copia es de hace cuatro meses. Es el fallo
más caro posible en una app sin backend.

**Recomendación.** Contar fallos consecutivos; a partir del segundo, marcar la sección en
rojo con "No se pudo copiar desde el <fecha> — tocá para reconectar" y un toast una vez por
sesión. Nótese que `_gcalErrMsg()` ya traduce los errores a mensajes accionables muy buenos
para el botón de conectar: falta usar esa misma función en el camino automático.

---

### A4 · Alto — "Combinar historial" descarta presupuestos distintos con el mismo número

**Qué pasa.** `impHistCombine()` deduplica por `quoteNumber` y se queda con uno solo:

```js
localList.forEach(e => { if (e.quoteNumber) byNum.set(e.quoteNumber, e); });   // ← sin número: se cae
importedList.forEach(imp => {
  if (!imp.quoteNumber) return;
  const local = byNum.get(imp.quoteNumber);
  if (!local) { byNum.set(imp.quoteNumber, imp); newImported++; return; }
  if (tImp > tLocal) { byNum.set(imp.quoteNumber, imp); conflicts++; }         // ← el otro se pierde
});
const merged = Array.from(byNum.values());
```

Dos problemas: **números repetidos ≠ mismo presupuesto** (la numeración es local a cada
dispositivo, vía `mkQN()` sobre `S.numNext`; dos equipos generan `2026-0042` para clientes
distintos), y **las entradas locales sin `quoteNumber` se pierden** (no entran a `byNum`, y
`merged` sale solo de ahí).

**Impacto para el podador.** Combina el historial de la tablet con el del celular "para
tenerlo todo junto" y termina con menos presupuestos de los que tenía, sin ningún aviso: el
toast informa alegremente `"… · 1 actualizados desde el import"`.

**Recomendación.** Deduplicar por `id` (timestamp, mucho menos colisionable) y usar
`quoteNumber` solo para *marcar* duplicados sospechosos y mostrárselos al usuario. Nunca
descartar en silencio: si hay conflicto real, conservar ambos y renumerar el importado.

---

### A5 · Alto — `push-worker`: endpoints sin autenticación

**Qué pasa.**

```js
// push-worker/index.js:125 — sin ninguna autenticación
if (url.pathname === '/test' && request.method === 'GET') {
  const { keys } = await env.PUSH_KV.list({ prefix: 'sub:' });   // TODOS los dispositivos
  for (const {name} of keys) { … await sendPush(data.subscription, {…}, env); }

// push-worker/index.js:146 — sin autenticación, deviceId elegido por el cliente
const { deviceId, subscription, followups, expiries } = await request.json();
await env.PUSH_KV.put(`sub:${deviceId}`, …);

// push-worker/index.js:110-114
'Access-Control-Allow-Origin': '*',
```

La URL del Worker está en claro en el `index.html` público (`PUSH_WORKER_URL`), así que no
es secreta. Consecuencias: cualquiera que abra `…/test` dispara una notificación a **todos**
los dispositivos suscritos, repetible sin límite; y `POST /subscribe` permite escribir
claves arbitrarias en el KV desde cualquier sitio web (CORS `*`), o pisar el registro de
otro dispositivo si se adivina su `deviceId` (`'pq-' + Date.now() + '-' + Math.random()…`:
el timestamp es acotable y el random no es criptográfico).

**Impacto para el podador.** Hoy es un Worker de uso personal, así que el riesgo real es
acotado; si la app se comparte con colegas —que es la intención— cualquiera de ellos puede
hacerle sonar el teléfono a todos.

**Lo que sí está bien:** la clave privada VAPID no está en el repo (es un `wrangler secret`).
Y el cron `0 12,17,22 * * *` (UTC) cae en 09/14/19 ART, horas en las que la fecha UTC
coincide con la argentina, así que el `new Date().toISOString().slice(0,10)` de
`push-worker/index.js:180` no corre el día. Dejarlo anotado: un cron entre 00:00 y 03:00 UTC
lo desfasaría.

**Recomendación.** Borrar `/test` o protegerlo con un secreto en la query. En `/subscribe`,
exigir un `deviceId` con formato válido y limitar tamaño y tasa. Restringir CORS al origen
de la app.

---

### A6 · Alto — El cache del clima dispara un backup completo a Drive *(nuevo en v173)*

**Qué pasa.** `_climaFetchZonas()` persiste el pronóstico con `safeSetLS()`:

```js
// index.html:14520 y 14546 · js/clima.js
if (cambio) safeSetLS(LS.CLIMA, JSON.stringify(cache));
if (podado) { try { safeSetLS(LS.CLIMA, JSON.stringify(cache)); } catch (_) {} }
```

Y `safeSetLS()` dispara **siempre** la copia a Drive:

```js
// index.html:4917
function safeSetLS(key, value) {
  try {
    localStorage.setItem(key, value);
    // Cualquier escritura de datos dispara (con retardo) la copia a Drive
    if (typeof scheduleGdriveBackup === 'function') scheduleGdriveBackup();
```

**Reproducción** (`clima.test.cjs`, sobre v173):
```
escribir SOLO el cache del clima programó subidas a Drive: 1
tamaño del backup completo que se subiría (app vacía): 6 KB
  → con 200 fotos ese mismo objeto pesa entre 15 y 60 MB (ver M2)
```

Que es exactamente el problema que el propio código de `js/notifs.js` ya identificó y evitó:

```js
// index.html:16249 · setNotifLog()
// Escritura directa (no safeSetLS): el log es chico y NO queremos disparar un
// backup a Drive por cada aviso.
```

El razonamiento no se aplicó al clima, que escribe mucho más y con la misma frecuencia:
el refresco periódico (TTL 3 h), más `climaEnsureZona()` / `climaEnsureNota()` cada vez que
se agenda un trabajo o una visita, más la poda de zonas.

**Impacto para el podador.** Un refresco de pronóstico —que no cambia ningún dato del
usuario— programa la subida del backup entero, con todas las fotos en base64, sobre datos
móviles y en el campo. Es tráfico y batería gastados en re-subir lo mismo, y acelera el
desgaste del punto M2.

**Recomendación.** Escritura directa para el cache del clima (mismo criterio y mismo
comentario que `setNotifLog`). Más de fondo: que `safeSetLS()` acepte un flag
`{ backup: false }`, o que sea al revés —que solo las claves de datos del usuario disparen
el backup—, para que el próximo cache que se agregue no repita el problema.

---

### M1 · Medio — Las fotos nunca se borran de IndexedDB

En todo `js/photos.js` no existe ninguna operación de borrado: hay `put` y lectura, pero
ningún `store.delete` ni recolección de huérfanas. `removeItemPhotoRef()` saca la referencia
del ítem; el binario queda en IDB para siempre. Lo mismo al borrar un presupuesto o limpiar
todo el historial.

**Impacto.** El almacenamiento crece monótonamente (79–311 KB por foto, medido en M2): son
cientos de MB al cabo de un par de años, sin que borrar nada libere espacio. Y hay un tema
de expectativa: el usuario borra una foto y la foto sigue en el disco del teléfono.

**Recomendación.** Un `gcPhotos()` que recorra `S` + historial, arme el set de IDs vivos y
borre lo que no esté. En el arranque, con guarda de frecuencia (una vez por día). Correrlo
**después** de `hydratePhotoCache()` y nunca durante una restauración a medias.

---

### M2 · Medio — Memoria y tráfico por las fotos

`hydratePhotoCache()` carga **todas** las fotos a un `Map` en memoria al arrancar, y
`buildBackupObject()` mete el dataURL de cada foto referenciada en cada subida a Drive
(que ahora también dispara el clima — ver A6).

**Medición** (`photos.test.cjs`, canvas de 1000 px con los mismos parámetros de la app,
`compressImage(file, 1000, 0.7)`):

| Textura | dataURL por foto | 200 fotos |
|---|---|---|
| Imagen suave (cielo, pared) | ~79 KB | ~15 MB |
| Mucho detalle (follaje — el caso típico acá) | ~311 KB | ~61 MB |

**Impacto.** En un celular de gama baja, 15–60 MB de strings base64 en memoria desde el
arranque bastan para que Android mate la pestaña al volver de la cámara. El comentario de
`js/photos.js` dice "son pocos MB": era cierto al escribirlo, deja de serlo con el historial
acumulado.

**Recomendación.** (a) Hidratar el caché de forma perezosa (solo las fotos del presupuesto
abierto). (b) Separar el backup de fotos del de datos en Drive: un archivo de datos (chico,
frecuente) y las fotos como archivos individuales por ID, subidas una sola vez. Eso solo
elimina casi todo el tráfico repetido.

---

### M3 · Medio — Re-render y re-parseo del historial completo

La búsqueda del historial llama al render en cada tecla, sin debounce
(`oninput="_histSearchSync(this); renderHistory()"`), y cada render vuelve a leer y parsear
el historial entero desde `localStorage` varias veces, porque `getH()` no cachea. En el
calendario es peor: `calBuildIndex()` hace un `getH()` completo y se la invoca desde 6
lugares, varios en el mismo render.

**Medición** (`perf.test.cjs`, 250 presupuestos con snapshot completo):
```
historial de 250 presupuestos = 955 KB en localStorage
renderHistory()      : 145 ms  · relecturas+parse del historial completo: 5
abrir pestaña Agenda :  46 ms  · relecturas+parse del historial completo: 4
cambiar a vista Mes  :  39 ms  · relecturas+parse del historial completo: 3
```

**Impacto.** Eso es en escritorio; un celular de gama baja es 4–10× más lento. Buscar un
cliente en un historial de dos años significa ~0,6–1,5 s de bloqueo **por cada letra**: la
escritura se traba y el teclado se siente roto. Es el escenario de uso en el campo.

**Recomendación.** Debounce de ~200 ms en el buscador, y un caché en memoria del historial
parseado invalidado en `setH()` — `getH()` devuelve el caché y el resto del código queda
igual. Mejora los tres números de una sola vez, y también el costo del clima y de la sync
con Calendar, que llaman a `calBuildIndex()`.

---

### M4 · Medio — Dos dispositivos con la misma cuenta de Drive se pisan

`gdriveUpload()` hace `PATCH …?uploadType=media` con el backup local completo: sin merge y
sin comparar `modifiedTime` (que sí se pide en `gdriveFindFile`, pero no se usa). Y
`gdriveInitOnLoad()` solo baja la copia si el dispositivo está vacío.

**Impacto.** Si usa celular y tablet con la misma cuenta, el último que guarde pisa el
trabajo del otro, en silencio. El diseño está pensado —bien— para "cambio de teléfono", no
para dos dispositivos en paralelo; el problema es que nada lo dice ni lo impide.

**Recomendación.** Comparar `modifiedTime` remoto contra `LS.GDRIVE_LAST` antes de subir; si
el remoto es más nuevo, no pisar y avisar. Como mínimo, aclarar la limitación en el texto de
la sección de Drive.

---

### M5 · Medio — Datos de clientes que salen del dispositivo

Dos canales, ambos opt-in pero poco explicados:

- **Push:** `_buildPushFollowups()` manda `{ id, clientName, date, diasDesdeEnvio }` por cada
  presupuesto pendiente, y el Worker los guarda en el KV de Cloudflare en texto plano
  (`push-worker/index.js:154`), sin expiración, y los usa en el título de la notificación.
- **Calendar (v173):** `_gcalEvInfo()` (`index.html:12209–12228`) arma la descripción del
  evento con el teléfono del cliente, el monto del presupuesto y la dirección/ubicación:
  ```js
  if (snap.clientContact) desc.push('Contacto: ' + snap.clientContact);
  if (ev.tel) desc.push('Tel: ' + ev.tel);
  if (ev.mapUrl) { desc.push('Ubicación: ' + ev.mapUrl); … }
  ```

**Impacto.** Son decisiones de diseño legítimas —sin esos datos la notificación y el evento
no sirven— pero contradicen la promesa de "los datos viven en tu dispositivo" que la app
hace en la UI, y el usuario no lo ve explicado. Los nombres y teléfonos de sus clientes
quedan en servicios de terceros indefinidamente.

**Recomendación.** Decirlo en el texto de cada toggle ("para avisarte con la app cerrada se
envía el nombre del cliente y la fecha"; "los eventos incluyen teléfono y dirección"). Poner
TTL a las entradas del KV para que un dispositivo abandonado se limpie solo.

---

### M6 · Medio — Fechas de facturación mezclando UTC y local

```js
const hace12 = new Date(now); hace12.setFullYear(hace12.getFullYear()-1);   // local
const ultimas = facturas.filter(f=>{ const d=new Date(f.fecha); return d>=hace12 && d<=now; });
//                                        ↑ 'YYYY-MM-DD' → medianoche UTC
```

`new Date('2026-07-24')` es medianoche **UTC**, o sea las 21:00 del 23 en Argentina; se
compara contra `now` y `hace12`, que son locales. Es el patrón que `CLAUDE.md` prohíbe y que
el resto del archivo respeta. En los casos normales el resultado no cambia; se descompone en
el borde de la ventana de 12 meses y con facturas de fecha futura (que quedan fuera del total
anual pero sí entran en el del mes, que compara strings).

**Impacto.** Bajo en la práctica, pero es el número del tope de monotributo: conviene que sea
exacto y consistente.

**Recomendación.** Comparar strings `YYYY-MM-DD` (como ya hace `delMes`) o construir el `Date`
con partes locales, igual que `_calDateFromISO()`, que ya lo resuelve bien.

---

### M7 · Medio — `safeSetLS()` devuelve `false` y casi nadie lo mira

`safeSetLS()` está bien hecho: distingue cuota llena, avisa con un toast y devuelve un
booleano. Pero los llamadores lo ignoran (`setH`, `setNotes`, `setFacturas`…). Con el
almacenamiento lleno, la operación sigue su curso: el render muestra el presupuesto
guardado y el toast de éxito aparece igual. Además, cuando la escritura falla tampoco se
dispara `scheduleGdriveBackup()` (está dentro del `try`), así que no queda copia en ningún lado.

**Impacto.** Almacenamiento lleno es realista justo en el perfil de esta app (celular con poco
espacio + historial largo + fotos + logo), y es el momento en que menos se puede permitir un
falso "guardado".

**Recomendación.** Que los `set*` propaguen el booleano y que los flujos importantes no
muestren el toast de éxito si volvió `false`. Ofrecer "Exportar backup ahora" en el mismo toast.

---

### M8 · Medio — Los tokens OAuth de Google se persisten en `localStorage` *(nuevo en v173)*

```js
// index.html:4280, 4285
GDRIVE_TOK: 'pq_gdrive_tok',
GCAL_TOK:   'pq_gcal_tok',
// index.html:11767
function _gTokSave(key, token, exp){
  try { localStorage.setItem(key, JSON.stringify({ t: token, e: exp })); } catch(_){}
}
```

La decisión está razonada y comentada (evitar el ida-y-vuelta con Google al reabrir la PWA),
y los atenuantes son reales: es un access token de vida corta (~1 h), no un refresh token, y
se borra al desconectar. **No lo reporto como un problema en sí**, sino por su interacción
con C1: antes, un XSS tenía que tener la suerte de correr mientras el token estaba en
memoria; ahora lo lee directo de `localStorage`, con hasta una hora de validez, y con él
accede a la copia de seguridad completa (Drive) y al calendario.

**Recomendación.** No hay que revertirlo — hay que arreglar C1, que es lo que lo vuelve
peligroso. Si se quiere reducir la ventana igual: guardar el token en `sessionStorage`
(sobrevive la recarga de la pestaña, que es el caso que motivó el cambio, pero no el cierre)
y acortar el vencimiento cacheado.

---

### M9 · Medio — El clima envía coordenadas con ~11 m de precisión *(nuevo en v173)*

El módulo declara que agrupa las ubicaciones para no exponer direcciones exactas:

```js
// index.html:14348 (comentario de cabecera)
// … las ubicaciones se agrupan redondeando a ~1 km: en la práctica es UNA sola llamada.
// index.html:14385
function _climaKey(ll) { return ll[0].toFixed(2) + ',' + ll[1].toFixed(2); }
```

Pero el redondeo se aplica solo a la **clave** del cache; el **valor** guarda la coordenada
completa y es esa la que viaja:

```js
// index.html:14450 — la clave se redondea, el valor no
const zonas = {}; zonas[_climaKey(ll)] = ll;
// index.html:14474 — 4 decimales ≈ 11 metros
+ `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`
```

**Impacto.** La ubicación exacta de la propiedad del cliente (no la de la ciudad) sale hacia
`api.open-meteo.com` en cada refresco. Es un servicio sin API key y sin cuenta, así que no
queda asociado a una identidad, pero contradice lo que el propio código dice hacer y no
aporta nada: para un pronóstico diario, 2 decimales dan exactamente el mismo resultado.

**Recomendación.** Usar las coordenadas redondeadas de la clave en la URL (una línea:
`const [lat, lng] = k.split(',').map(Number)` en vez de `zonas[k]`). Ganancia inmediata,
sin cambio de comportamiento.

---

### Hallazgos Bajos

**B1 — `LS.PDF_THEME` es una clave muerta.** Declarada en `index.html:4286`
(`PDF_THEME: 'pq_pdf_theme'`) y nunca leída ni escrita: el tema del PDF vive en `S.pdfTheme`.
Borrarla para que no confunda al próximo que audite la lista de claves.

**B2 — Escrituras directas a `localStorage`.** Varios sitios escriben sin pasar por
`safeSetLS()` (`PUSH_DEVICE_ID`, `THEME`, `ONBOARDED`, `DAY_ALERT_SEEN`, `LAST_BACKUP`,
`GDRIVE_*`, `GCAL_*`, `CAL_VIEW`, `CLIMA_WARN`, `NOTIF_LOG`, `NOTIF_SEEN`). En v173 la mayoría
ya está **justificada con un comentario** (el caso de `setNotifLog` es ejemplar), lo cual es
una mejora respecto de v135. Falta hacer lo mismo con las que quedan y darle una forma
explícita al patrón (un `setFlagLS()`), para que no parezca un olvido. `_pushDeviceId()` sigue
siendo el único sin `try/catch`: en modo privado de Safari, lanza.

**B3 — `vendor/` sin procedencia registrada.** `vendor/leaflet.js` se identifica solo
(1.9.4, la última estable de la línea 1.x, sin CVEs conocidas). `vendor/html2pdf.bundle.min.js`
(906 KB) no expone su versión de forma fiable y no hay `package.json` ni lockfile. Sin versión
anotada no hay manera de chequear CVEs. Recomendación: un `docs/vendor.md` con librería,
versión exacta, fecha y URL de origen.

**B4 — `start_url` genera un redirect en cada apertura.** El manifest declara
`"start_url": "./index.html"` pero Cloudflare responde `307 → /`. Verifiqué que **no rompe el
offline**: reproduje el comportamiento exacto de Cloudflare en un servidor local
(`redirect.test.cjs`) y el app-shell carga bien sin red tanto desde `/index.html` como desde
`/`. El único costo es un round-trip extra por apertura con conexión. Apuntar `start_url` y
`shortcuts` a `./` lo elimina. Ojo: `test/pwa.test.cjs` usa `python3 -m http.server`, que no
hace ese redirect, así que este escenario no está cubierto por el test.

**B5 — Cuatro implementaciones del total del estimativo.** Causa raíz de C2: `:5095`, `:8914`,
`:8942` y `:13164` calculan lo mismo de maneras distintas. Al arreglar C2 conviene unificarlas,
no parchear solo `:8942`.

---

## 4. Lo que está bien (conservar)

- **Disciplina de centavos.** `moneyToCents`/`centsToMoney`/`itemTotalCents` están bien
  implementadas, con clamp defensivo de precio y cantidad y manejo de la coma decimal
  argentina. El único desvío real es C2.
- **Fechas locales.** `toLocalISODate()` / `today()` / `calcExpiry()` / `_calDateFromISO()` /
  `fmtDiaCorto()` son correctas y están comentadas con el porqué. Barrí todos los
  `toISOString()`: los que quedan son timestamps de auditoría (`savedAt`, `enviadoEn`,
  `exportedAt`), que es el uso correcto. El único desvío es M6.
- **Escapado de texto.** Revisé los puntos de interpolación en `innerHTML`: **todo el texto del
  usuario** —cliente, dirección, especies, servicios, frases, notas, descripciones— pasa por
  `esc()`, incluso dentro de `title="…"`. Sumado a `safeImgSrc()` y `safeColor()`, es un trabajo
  prolijo y consistente. El agujero de C1 es de otra naturaleza (IDs y enums en atributos).
- **Google Calendar (v173).** Bien hecho: scope mínimo (`calendar.app.created`, solo el
  calendario que la app creó), diff por hash con `pqKey`/`pqHash` en `extendedProperties`
  en vez de recrear eventos, paginación completa al listar, borrado de lo que ya no está,
  `gcalId` en el backup para no duplicar calendarios al cambiar de teléfono, y `_gcalErrMsg()`
  con mensajes de error realmente accionables.
- **Clima (v173).** Fuente sin API key, cache con TTL y versión de formato, poda de zonas sin
  trabajos, `navigator.onLine === false` respetado, y se sirve lo cacheado antes que nada
  (offline-first de verdad). Solo hay que corregir la precisión de las coordenadas (M9) y la
  escritura vía `safeSetLS` (A6).
- **Centro de notificaciones (v173).** El razonamiento de `setNotifLog()` sobre no disparar el
  backup por cada aviso es exactamente el criterio correcto — hay que extenderlo, no cambiarlo.
  El ring buffer capado (`NOTIF_CAP = 50`) evita el crecimiento sin fin.
- **Higiene de secretos y despliegue.** No hay `client_secret` ni clave privada VAPID en el
  repo. El `.assetsignore` está bien pensado y **verifiqué en producción** que `CLAUDE.md`,
  `docs/`, `push-worker/` y `test/` devuelven 404. El scope de Drive es el mínimo
  (`drive.appdata`).
- **Google Drive sin fricción.** El manejo de `login_hint` + `prompt:'none'`, los chequeos de
  `navigator.onLine` y el reintento ante 401 (`_gWithAuthRetry`) están bien resueltos y
  documentados; no se pide token al abrir.
- **Service Worker.** Network-first con timeout para navegaciones + cache-first para el resto,
  sin cachear redirects ni respuestas != 200, limpieza de caches viejas y `skipWaiting` +
  recarga controlada. `APP_SHELL` está **completo** también en v173: crucé las 12 fuentes de
  `fonts.css` contra `sw.js` y el disco, y los íconos y `vendor/leaflet.*` están; los módulos
  nuevos no agregaron archivos. Las dos exclusiones (`html2pdf`, `share-target`) son
  deliberadas y están justificadas en comentarios.
- **`node test/pwa.test.cjs` pasa los 4 checks en v173** (SW controla la página, es `./sw.js`
  real, crea la cache `presupuesto-v173`, y el documento carga offline).
- **Logging limpio.** Los `console.*` son mensajes de error genuinos; ninguno filtra tokens,
  datos de clientes ni contenido de backups.
- **Migraciones y compatibilidad.** `migrateState()`, `normalizeRiskData()`,
  `sanitizeSectionOrder()` y `migrateInlinePhotosToIDB()` manejan versiones viejas con cuidado
  real (incluido el rollback a foto embebida si IDB falla). El `photoMissing()` con placeholder
  "restaurá tu backup" es un buen detalle de UX.
- **Comentarios.** El archivo explica el *porqué* de las decisiones no obvias (`login_hint` vs
  `hint`, el logo fuera del snapshot, el wrapper-table del PDF, por qué `setNotifLog` no usa
  `safeSetLS`). Eso hizo esta auditoría mucho más rápida y hay que sostenerlo.

---

## 5. Plan de remediación sugerido

Tandas chicas, cada una verificable y desplegable por separado.
**Recordá subir `CACHE_VERSION` en `sw.js` en cada deploy** (actual: `presupuesto-v173`).

### Tanda 1 — Blindar la frontera de entrada (C1 + C3 + A2) → `v174`
La más importante, y conviene hacerla junta porque las tres comparten la solución.
1. `sanitizeBackup(d)` / `sanitizeHistory(h)` / `sanitizeNotes(n)` / `sanitizeNotifLog(l)`:
   verificar arrays, descartar entradas inválidas, validar IDs con `/^[\w-]{1,40}$/` y los
   enums (`pdfTheme`, `pdfFont`, `estado`, `tipo`) contra lista blanca.
2. Aplicarlo en `applyBackupObject()` y en todas las rutas de import, y también
   defensivamente en `getH()` / `getNotes()` / `getNotifLog()` / `getFacturas()`.
3. Restauración en dos fases (validar todo en memoria → recién ahí escribir).
4. Reemplazar `onclick="fn('${id}')"` y `onclick='fn(${JSON.stringify(obj)})'` por `data-*` +
   listener delegado en `_calEvHTML`, `_calColEv`, `notifItemHTML`, `notifLogItemHTML`,
   `renderHistory`, `factRender` y el mapa. `esc()` en `nt-ico`.
5. **Verificación:** volver a correr `xss3`, `xss-notif`, `xss-hist`, `xss-theme` y `brick` —
   los cinco tienen que dar negativo. Vale la pena dejarlos como test permanente en `test/`.

### Tanda 2 — Plata correcta (C2 + B5) → `v175`
1. Extraer `calcEstTotals(estItems)` en centavos y usarla en los cuatro lugares.
2. **Verificación:** `money.test.cjs` — los tres números tienen que coincidir.
3. Migración: recalcular `e.total` de las entradas con `isEstimative` una sola vez al arrancar.

### Tanda 3 — Que el backup sea completo y honesto (A1 + A3) → `v176`
1. Agregar `followup` a `buildBackupObject()`/`applyBackupObject()` + comentario con la lista
   canónica de claves y su decisión.
2. Contador de fallos de Drive y de Calendar + estado visible, reusando `_gcalErrMsg()`.
3. Que `gcalSync()` no aborte la pasada de borrado por un insert fallido.

### Tanda 4 — Tráfico y batería (A6 + M9) → `v177`
Las dos son de una línea cada una y de ganancia inmediata:
1. Escritura directa (no `safeSetLS`) para el cache del clima, con el comentario del caso.
   Idealmente, un flag `{ backup: false }` en `safeSetLS()` para que no vuelva a pasar.
2. Mandar a Open-Meteo las coordenadas ya redondeadas de la clave de zona.
3. **Verificación:** `clima.test.cjs` — la escritura del clima no debe programar backups.

### Tanda 5 — Rendimiento en el celular (M3 + M7) → `v178`
1. Caché en memoria de `getH()`, invalidado en `setH()`.
2. Debounce de 200 ms en el buscador del historial.
3. Propagar el booleano de `safeSetLS()` a los flujos de guardado importantes.
4. **Verificación:** `perf.test.cjs` — tiempos y conteo de re-parseos claramente más bajos.

### Tanda 6 — Fotos: espacio y memoria (M1 + M2) → `v179`
1. `gcPhotos()` de huérfanas (con las guardas de orden que menciona M1).
2. Backup de fotos separado del de datos en Drive (subir cada foto una sola vez).
3. Evaluar hidratación perezosa del caché.

### Tanda 7 — Worker de push y cierres (A5 + M4 + M5 + M6 + M8 + B1–B4)
1. Sacar o proteger `/test`; validar `deviceId`; acotar CORS; TTL en el KV.
2. Chequeo de `modifiedTime` antes de subir a Drive.
3. Aclarar en la UI qué datos salen del dispositivo (push y Calendar).
4. Fechas de facturación por string; evaluar `sessionStorage` para los tokens; borrar
   `LS.PDF_THEME`; `try/catch` en `_pushDeviceId()`; `start_url` → `./`; `docs/vendor.md`.

---

*Scripts de reproducción usados (en el scratchpad de la sesión, no versionados):
`xss3.test.cjs`, `xss-notif.test.cjs`, `xss-hist.test.cjs`, `xss-theme.test.cjs`,
`brick.test.cjs`, `money.test.cjs`, `perf.test.cjs`, `photos.test.cjs`, `clima.test.cjs`,
`redirect.test.cjs`. Conviene rescatar a `test/` al menos los cinco de seguridad/integridad
y `money.test.cjs` al hacer los fixes.*
