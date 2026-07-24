# Auditoría integral — Presupuestos AR

**Fecha:** 24 de julio de 2026
**Alcance:** `index.html` (13.724 líneas), `sw.js` (v135), `push-worker/`, `vendor/`, `manifest.webmanifest`, `wrangler.jsonc`
**Método:** lectura por secciones (`// ===== js/… =====`), reproducción con navegador headless (`chrome-headless-shell` + `puppeteer-core`), verificación contra producción.
**Tipo:** solo lectura. No se tocó código de la app.

---

## 1. Resumen ejecutivo

La app está en buen estado general: la disciplina de centavos, las fechas locales,
el escapado con `esc()` de todo lo que es **texto**, la migración de fotos a IndexedDB
y la estrategia del Service Worker están bien resueltas y bien comentadas. El test
`node test/pwa.test.cjs` pasa los 4 checks.

Los problemas serios se concentran en **un solo punto ciego: los datos que entran
desde afuera** (un backup `.json` de un colega, la copia de Google Drive, un archivo
editado a mano). Ese camino no valida absolutamente nada, y de ahí salen los tres
hallazgos críticos.

Lo más importante, en orden:

1. **Crítico — XSS ejecutable al restaurar un backup ajeno** (3 vectores confirmados con
   reproducción; uno de ellos **sin que el usuario toque nada**, solo abriendo la Agenda).
2. **Crítico — el total de un presupuesto ESTIMATIVO se guarda mal en el historial**:
   ignora la cantidad de los servicios. Medido: PDF $710.000 vs. historial $470.000.
   Ese número es el que pre-carga el monto de la factura y suma al tope de monotributo.
3. **Crítico — un JSON con la forma equivocada rompe la app de forma permanente**:
   Historial y Agenda quedan muertos en cada arranque y no hay salida desde la app.
4. **Alto — la configuración de seguimiento (con las 3 plantillas de WhatsApp) no entra
   en el backup**: se pierde al cambiar de teléfono.
5. **Alto — los fallos del backup automático a Drive son silenciosos**: se puede estar
   meses creyendo que hay copia cuando no la hay.

---

## 2. Tabla de hallazgos

| ID | Sev. | Área | Título | Evidencia |
|----|------|------|--------|-----------|
| C1 | Crítico | Seguridad | XSS ejecutable desde un backup / historial importado o restaurado desde Drive | `index.html:13173`, `:13189`, `:13190`, `:10136–10152`, `:11328` |
| C2 | Crítico | Cálculos | El total del presupuesto estimativo guardado en el historial ignora la cantidad de los servicios | `index.html:8069` |
| C3 | Crítico | Integridad | Un JSON con `history` que no es un array deja la app rota de forma persistente | `index.html:10549`, `:10564`, `:8045` |
| A1 | Alto | Integridad | La config de seguimiento (`pq_followup`) no entra en el backup | `index.html:10344–10383` vs `:4659` |
| A2 | Alto | Integridad | `applyBackupObject()` puede fallar a la mitad y dejar el estado mezclado | `index.html:10557–10621` |
| A3 | Alto | Robustez | Los fallos del backup automático a Drive son totalmente silenciosos | `index.html:10836`, `:13591` |
| A4 | Alto | Integridad | "Combinar historial" descarta silenciosamente presupuestos distintos con el mismo número | `index.html:10503–10534` |
| A5 | Alto | Seguridad | `push-worker`: `GET /test` y `POST /subscribe` sin autenticación, CORS `*` | `push-worker/index.js:125`, `:146`, `:110` |
| M1 | Medio | Integridad | Las fotos nunca se borran de IndexedDB: crecen para siempre | `index.html:5016–5295` |
| M2 | Medio | Rendimiento | Todas las fotos se cargan a RAM al arrancar y viajan enteras en cada subida a Drive | `index.html:5062`, `:10364`, `:10829` |
| M3 | Medio | Rendimiento | Búsqueda del historial sin debounce + re-parseo completo 3–5 veces por acción | `index.html:3407`, `:8045`, `:12916` |
| M4 | Medio | Integridad | Dos dispositivos con la misma cuenta de Drive se pisan sin aviso | `index.html:10745–10765`, `:10883` |
| M5 | Medio | Seguridad | Los nombres de clientes salen del dispositivo al KV de Cloudflare al activar push | `index.html:4883–4890` |
| M6 | Medio | Fechas | `factRender()` filtra facturas con `new Date(f.fecha)` (UTC) mezclado con `now` local | `index.html:12009` |
| M7 | Medio | Robustez | `safeSetLS()` devuelve `false` y casi ningún llamador lo mira | `index.html:4413`, `:8052`, `:12874` |
| B1 | Bajo | Calidad | `LS.PDF_THEME` declarada y nunca usada (clave muerta) | `index.html:3792` |
| B2 | Bajo | Calidad | 8 escrituras directas a `localStorage` fuera de `safeSetLS()`; una sin `try/catch` | `index.html:4853` y otras 7 |
| B3 | Bajo | Seguridad | `vendor/` sin versión registrada ni `package.json`/lockfile | `vendor/html2pdf.bundle.min.js` |
| B4 | Bajo | PWA | `start_url` apunta a `./index.html`, que en producción responde 307 | `manifest.webmanifest:9` |
| B5 | Bajo | Calidad | Tres implementaciones distintas del total del estimativo | `index.html:4591`, `:8069`, `:11669` |

---

## 3. Detalle por hallazgo

### C1 · Crítico — XSS ejecutable desde un backup importado o restaurado desde Drive

**Qué pasa.** Todo el **texto** del usuario está correctamente escapado con `esc()` — eso
está muy bien hecho y lo revisé sitio por sitio. El agujero está en otro lado: los
**identificadores y campos "de sistema"** se interpolan crudos dentro de atributos HTML,
y esos campos vienen sin validar de un archivo importado.

El origen es que ninguna de las rutas de entrada valida la forma de los datos:

```js
// index.html:10564 · applyBackupObject()
if(d.history) setH(d.history);                                    // sin validar
// index.html:10601
if (Array.isArray(d.notes)) safeSetLS(LS.NOTES, JSON.stringify(d.notes));  // valida el array, no las notas
// index.html:10549 · impHistReplace()
setH(d.history||[]);                                              // sin validar
```

Y del otro lado, tres sitios que interpolan crudo:

```js
// index.html:13173 y 13189-13190 · _calColEv() / _calEvHTML()
act = `onclick="calToggleNote('${ev.noteId}')" title="…"`;

// index.html:10136-10152 · renderHistory()
`<div class="hcard" onclick="loadFromHistory(${e.id})">`

// index.html:11328 (y 11487, 11743, 11873) · buildDoc() y hermanas
`<table class="pdoc pdoc-theme-${theme}…">`   // theme = S.pdfTheme, viene del backup
```

**Reproducción** (`scratchpad/xss.test.cjs`, `xss-hist.test.cjs`, `xss-theme.test.cjs`,
los tres corridos con `chrome-headless-shell`):

*Vector 1 — sin ninguna interacción, solo abrir la Agenda:*

```js
applyBackupObject({ _type:'backup_completo', notes:[{
  id: 'x"><img src=noexiste onerror="window.__PWNED=true">',
  fecha: '2026-07-24', texto: 'nota inocente' }] });
switchTab('agenda');
```
```
markup generado : onclick="calToggleNote('x">
<img> inyectados en el DOM: 2
código ajeno ejecutado SIN tocar nada (window.__PWNED): true
```

*Vector 2 — al tocar una tarjeta del historial:*
```
atributo generado : onclick="loadFromHistory(0);window.__PWNED=true;//)"
tras tocar la tarjeta: true
```

*Vector 3 — al abrir la vista previa / imprimir el PDF:*
```
markup generado: <img src="noexiste" onerror="window.__PWNED=true" …><table class="pdoc pdoc-theme-clasico">
código ajeno ejecutado: true
```

**Impacto para el podador.** Los backups se intercambian entre colegas — es un flujo
previsto y documentado. Un `.json` preparado (o una copia de Drive de una cuenta
comprometida) ejecuta código con el origen de la app, o sea con acceso a **todo**:
el historial completo con datos de clientes, la base de clientes con teléfonos y
direcciones, la facturación, y el token de Google Drive que la app tiene en memoria
(`GDRIVE._token`, `index.html:10676`) — con lo cual puede leerse o pisarse la copia
de seguridad entera. No hace falta que el atacante sea sofisticado: el vector 1 no
requiere que la víctima toque nada más que la pestaña Agenda.

**Nota:** `esc()` **no alcanza** como fix acá. `esc()` no escapa la comilla simple, así
que `onclick="calToggleNote('${esc(id)}')"` seguiría siendo inyectable.

**Recomendación.**
1. Validar en la frontera: al importar/restaurar, filtrar cada nota, cada entry del
   historial y cada campo de enum. IDs: `/^[\w-]{1,40}$/`. `pdfTheme`/`pdfFont`:
   comprobar contra la lista blanca que ya existe conceptualmente en `CLAUDE.md`.
2. Reemplazar los `onclick="fn('${id}')"` por `data-id` + un listener delegado
   (el patrón que ya usa `renderQuickServices()` en `index.html:6291` y que el propio
   comentario de ahí explica — extenderlo al resto).

---

### C2 · Crítico — El total del presupuesto estimativo se guarda mal en el historial

**Qué pasa.** Hay tres cálculos distintos del total del estimativo y no coinciden:

```js
// index.html:4591 · updateTotalsBar() — barra de totales: usa itemTotal (precio × cantidad) ✅
(S.estItems||[]).forEach(i=>{ if(i.type==='work'||i.type==='service') estTotal+=itemTotal(i); });

// index.html:11669-11671 · buildEstDoc() — el PDF: separa trabajos y servicios, servicios con qty ✅
workItems.forEach(i=>{ if(i.price) estSubtotal+=parseFloat(i.price)||0; });
serviceItems.forEach(i=>{ svcSubtotal += itemTotal(i); });

// index.html:8069 · autoSaveToHistory() — lo que queda GUARDADO: ignora la cantidad ❌
(S.estItems||[]).forEach(i=>{ if((i.type==='work'||i.type==='service')&&i.price) total+=parseFloat(i.price)||0; });
```

**Reproducción** (`scratchpad/money.test.cjs`) — un trabajo de $350.000 y un servicio
"Volquete" de $120.000 × 3:

```
barra de totales (UI): $ 710.000,00
documento / PDF      : $ 710.000
total en el HISTORIAL: 470000   ← faltan $240.000
```

**Impacto para el podador.** El presupuesto que le mandó al cliente dice $710.000, pero
el historial guarda $470.000. Ese `e.total` no es cosmético: es el que
- pre-carga el monto al registrar la factura (`index.html:8733`),
- suma en el total presupuestado del mes y del historial (`:10112`, `:10197`),
- se muestra en el mapa (`:12611`) y viaja en el `.ics` y en Google Calendar (`:13402`).

O sea: **factura por menos de lo que cobró** y el control del tope de monotributo queda
subestimado. Solo aparece con servicios de cantidad > 1 en modo estimativo, pero ahí es
sistemático.

Además, `parseFloat` sobre pesos rompe la convención de centavos del proyecto
(`CLAUDE.md` → "Dinero en centavos"): con decimales acumula error de punto flotante.

**Recomendación.** Que `autoSaveToHistory()` llame a la misma función que el PDF. Lo más
limpio es extraer un `calcEstTotals(estItems)` (en centavos) y usarlo en los tres
lugares: `updateTotalsBar()`, `buildEstDoc()` y `autoSaveToHistory()`.

---

### C3 · Crítico — Un JSON con la forma equivocada rompe la app de forma permanente

**Qué pasa.** `setH()` escribe lo que le den, sin verificar que sea un array, y `getH()`
solo protege el `JSON.parse`:

```js
// index.html:8045-8052
function getH() {
  try { … return JSON.parse(raw||'[]'); } catch(e){ return []; }   // parsea OK, pero puede no ser array
}
function setH(h) { safeSetLS(LS.HISTORY, JSON.stringify(h)); }     // sin validar
```

**Reproducción** (`scratchpad/brick.test.cjs`) — se restaura un archivo cuyo `history`
es un objeto en vez de un array (backup de otra herramienta, versión vieja, o editado
a mano), y después se recarga la app:

```
quedó guardado en pq_h: {"0":{"id":1,"quoteNumber":"2026-0001"}}
errores al arrancar: [ 'h is not iterable' ]
abrir Historial → h is not iterable
abrir Agenda    → h.forEach is not a function
lista de historial: ""
```

**Impacto para el podador.** La app queda rota **para siempre**, no solo en esa sesión:
el valor inválido está persistido, así que cada vez que la abre, el arranque tira
excepción y las pestañas Historial y Agenda quedan muertas. Desde la app no hay forma
de recuperarse (los botones de import/limpiar historial viven en pantallas que dependen
de ese mismo render). La única salida es borrar los datos del sitio — perdiendo todo.
En el campo, con el celular, eso es el peor escenario posible.

**Recomendación.** Una función `sanitizeHistory(raw)` en la frontera: descartar lo que no
sea array, filtrar entradas sin `id`/`quoteNumber` válidos, y usarla tanto en `getH()`
(defensa al leer) como antes de cualquier `setH()` con datos importados. Lo mismo para
`getNotes()`/`getFacturas()`.

---

### A1 · Alto — La configuración de seguimiento no entra en el backup

**Qué pasa.** `buildBackupObject()` (`index.html:10344–10383`) incluye `state`, `history`,
`clients`, `species`, `services`, `servicesPinned`, `phrases`, `facturas`, `tope`,
`reciboSeq`, `notes` y `photos`. Falta `LS.FOLLOWUP` (`pq_followup`), que guarda:

```js
// index.html:4645-4657 · FOLLOWUP_DEF
enabled, days, expiryEnabled, estados,
waTemplate,            // plantilla del mensaje de SEGUIMIENTO
waSendTemplate,        // plantilla del mensaje de ENVÍO
waRecontactoTemplate,  // plantilla del mensaje de RECONTACTO
```

Enumerado completo de claves persistidas vs. backup:

| Clave | En el backup |
|---|---|
| `pq_s` (estado), `pq_h` (historial), `pq_clients`, `pq_species`, `pq_services`, `pq_services_pinned`, `pq_frases_*`, `pq_facturas`, `pq_tope_anual`, `pq_recibo_seq`, `pq_agenda_notes`, fotos (IDB) | ✅ |
| **`pq_followup`** | ❌ **← hallazgo** |
| `pq_theme`, `pq_cal_view`, `pq_onboarded`, `pq_last_backup`, `pq_gdrive_*`, `pq_day_alert_seen`, `pq_push_device_id` | ❌ (correcto: son preferencias de UI o estado por dispositivo) |
| `pq_pdf_theme` | — (declarada pero nunca usada, ver B1) |

**Impacto para el podador.** Cambia de teléfono, restaura el backup, y las tres plantillas
de WhatsApp que se tomó el trabajo de redactar (el mensaje con el que le habla a sus
clientes) vuelven al texto de fábrica, junto con los días de seguimiento configurados.
No pierde presupuestos, pero sí trabajo propio, y de una manera que no es evidente:
lo va a descubrir cuando mande un mensaje con el texto equivocado.

> La rúbrica del prompt de auditoría clasifica "dato que se persiste y no entra al
> backup" como Crítico. Lo dejo en **Alto** porque lo que se pierde es configuración y
> no presupuestos; si preferís la rúbrica literal, subilo.

**Recomendación.** Agregar `followup: getFollowupCfg()` a `buildBackupObject()` y
`if (d.followup) setFollowupCfg(d.followup)` a `applyBackupObject()`. Es simétrico y
de bajo riesgo. Aprovechar para dejar en el código un comentario con la lista canónica
de claves y su decisión (va / no va al backup), para que la próxima clave nueva no
se olvide.

---

### A2 · Alto — `applyBackupObject()` puede fallar a la mitad

**Qué pasa.** Toda la restauración vive dentro de un solo `try` que hace ~15 escrituras
seguidas a `localStorage` y a `S`:

```js
// index.html:10557-10621
function applyBackupObject(d) {
  if (!d || typeof d !== 'object') return false;
  try {
    if (d.photos) restorePhotosFromBackup(d.photos);
    if (d.state)   Object.assign(S, migrateState(d.state));
    if (d.history) setH(d.history);
    if (d.clients) safeSetLS(CLIENT_KEY, …);
    …                                    // ← si algo tira acá, lo de arriba ya se escribió
    return true;
  } catch(e) { console.error('Error al aplicar backup', e); return false; }
}
```

No hay validación previa ni rollback. Si el backup trae, por ejemplo, un `phrases` con
una referencia circular, o si `safeSetLS` tira por cuota a mitad de camino, el historial
y los clientes ya se pisaron pero facturación y notas no. El usuario ve
`'⚠️ El backup no tiene un formato válido.'` (`index.html:10630`) y razonablemente
concluye que no pasó nada — cuando en realidad ya perdió el historial anterior.

**Impacto para el podador.** Restaura un backup dudoso "para probar", le dice que no
sirve, y sus datos de antes ya no están.

**Recomendación.** Dos fases: (1) validar y normalizar el objeto entero en memoria —
esto se une naturalmente con el fix de C1 y C3 —, y solo si todo pasa (2) escribir.
Como red de seguridad barata: antes de escribir nada, guardar el estado actual en una
clave `pq_pre_restore` y ofrecer "deshacer la restauración" si algo sale mal.

---

### A3 · Alto — Los fallos del backup automático a Drive son silenciosos

**Qué pasa.** Los dos caminos por los que sube la copia automática se tragan el error:

```js
// index.html:10836 · scheduleGdriveBackup()
gdriveUpload().then(gdriveUpdateUI).catch(e => console.warn('auto-backup Drive falló', e));

// index.html:13591 · al mandar la app a segundo plano
gdriveUpload().catch(() => {});
```

Ninguno avisa al usuario ni marca la UI como "desincronizado". Peor: en el camino de
fallo no se llama a `gdriveUpdateUI()`, así que el cartel sigue diciendo
`Conectado ✓ · Última copia: 12/03 09:41` (`index.html:10866`) con la fecha del último
éxito. Una fecha vieja es la **única** señal, y hay que ir a buscarla a la pestaña Empresa.

Causas realistas de fallo permanente: el usuario revocó el permiso desde su cuenta de
Google, se agotó el espacio de Drive, o `gdriveGetToken()` no puede renovar en silencio
(`prompt:'none'` rechaza, `index.html:10714`) porque cambió de cuenta en el navegador.

**Impacto para el podador.** El caso que la función existe para prevenir: pierde el
teléfono, va a recuperar de Drive, y la última copia es de hace cuatro meses. Todo el
trabajo de esos meses no está en ningún lado. Es el fallo más caro posible en una app
sin backend.

**Recomendación.** Contar fallos consecutivos; a partir del segundo, marcar la sección
de Drive en rojo con "No se pudo copiar desde el <fecha> — tocá para reconectar" y
mostrar un toast una vez por sesión. Idealmente también reflejar el estado
"pendiente de subir" (`GDRIVE._dirty`) en el badge de guardado.

---

### A4 · Alto — "Combinar historial" descarta presupuestos distintos con el mismo número

**Qué pasa.** La combinación deduplica por `quoteNumber` y se queda con **uno solo**:

```js
// index.html:10508-10529
localList.forEach(e => { if (e.quoteNumber) byNum.set(e.quoteNumber, e); });   // ← sin número: se cae
importedList.forEach(imp => {
  if (!imp.quoteNumber) return;
  const local = byNum.get(imp.quoteNumber);
  if (!local) { byNum.set(imp.quoteNumber, imp); newImported++; return; }
  if (tImp > tLocal) { byNum.set(imp.quoteNumber, imp); conflicts++; }         // ← el otro se pierde
});
const merged = Array.from(byNum.values());
```

Dos problemas:
- **Números repetidos ≠ mismo presupuesto.** La numeración es local a cada dispositivo
  (`mkQN()` sobre `S.numNext`, `index.html:7565`). Si el podador trabajó un tiempo en el
  celular y en la tablet, ambos generaron `2026-0042` para clientes distintos. Al combinar,
  uno de los dos desaparece y el toast informa alegremente
  `"… · 1 actualizados desde el import"`.
- **Las entradas locales sin `quoteNumber` se pierden** (no entran a `byNum` y `merged`
  sale solo de ahí).

**Impacto para el podador.** Combina el historial de la tablet con el del celular "para
tenerlo todo junto" y termina con menos presupuestos de los que tenía, sin ningún aviso
de que se borró algo.

**Recomendación.** Deduplicar por `id` (que es un timestamp, mucho menos colisionable) y
usar `quoteNumber` solo para *marcar* duplicados sospechosos y mostrárselos al usuario
antes de decidir. Nunca descartar en silencio: si hay conflicto real, conservar ambos
y renumerar el importado.

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

Y la URL del Worker está en claro en el `index.html` público
(`index.html:3803`, `PUSH_WORKER_URL`), así que no es secreta.

Consecuencias concretas:
- Cualquiera que abra `…/test` en el navegador dispara una notificación a **todos** los
  dispositivos suscritos. Repetible sin límite → spam de notificaciones y consumo de cuota.
- `POST /subscribe` permite escribir claves arbitrarias en el KV desde cualquier sitio web
  (CORS `*`) → llenado del namespace y costo. También permite pisar el registro de otro
  dispositivo si se adivina su `deviceId`
  (`'pq-' + Date.now() + '-' + Math.random().toString(36).slice(2)`, `index.html:4852`:
  el timestamp es acotable y el random no es criptográfico).

**Impacto para el podador.** Hoy es un Worker de uso personal, así que el riesgo real es
acotado; pero si la app se comparte con colegas —que es la intención— cualquiera de ellos
(o cualquiera que mire el código fuente) puede hacerle sonar el teléfono a todos.

**Lo que sí está bien:** la clave privada VAPID no está en el repo (es un
`wrangler secret`, `docs/push-setup.md:74`), y el cron `0 12,17,22 * * *` (UTC) cae en
09/14/19 ART, todas horas en las que la fecha UTC coincide con la argentina — así que el
`new Date().toISOString().slice(0,10)` de `push-worker/index.js:180` no corre el día.
Vale dejarlo anotado: si algún día se agrega un cron entre las 00:00 y las 03:00 UTC,
ese cálculo se desfasa un día.

**Recomendación.** Borrar `/test` o protegerlo con un secreto en la query. En `/subscribe`,
exigir un `deviceId` con formato válido y firmar el registro (o al menos limitar el tamaño
y la tasa). Restringir CORS al origen de la app en vez de `*`.

---

### M1 · Medio — Las fotos nunca se borran de IndexedDB

**Qué pasa.** En todo `js/photos.js` no existe ninguna operación de borrado: hay
`put` (`index.html:5087`, `:5259`, `:5293`) y lectura, pero ningún `store.delete` ni
recolección de huérfanas. `removeItemPhotoRef()` (`index.html:5135`) saca la referencia
del ítem; el binario queda en IDB para siempre. Lo mismo al borrar un presupuesto
(`delFromHistory`, `index.html:8224`) o al limpiar todo el historial.

**Impacto para el podador.** El almacenamiento del navegador crece monótonamente. Con
uso real (medido más abajo: 79–311 KB por foto) son cientos de MB al cabo de un par de
años, sin que borrar nada libere espacio. Hay además un tema de expectativa: el usuario
borra una foto de un árbol y la foto sigue en el disco del teléfono.

**Recomendación.** Un `gcPhotos()` que recorra `S` + historial, arme el set de IDs vivos
y borre de IDB lo que no esté. Correrlo en el arranque, con guarda de frecuencia
(una vez por día). Cuidado: hay que correrlo **después** de `hydratePhotoCache()` y
nunca durante una restauración a medias, para no borrar fotos que todavía no volvieron.

---

### M2 · Medio — Memoria y tráfico por las fotos

**Qué pasa.** Dos decisiones se multiplican entre sí:

```js
// index.html:5062 · hydratePhotoCache() — carga TODAS las fotos a un Map en memoria al arrancar
// index.html:10364 · buildBackupObject() — mete el dataURL de cada foto referenciada en el backup
const photos = buildPhotoMap.apply(null, [S].concat(history.map(e => e && e.snapshot)));
// index.html:10829 · scheduleGdriveBackup() — sube el backup COMPLETO 45 s después de cada cambio
```

**Medición** (`scratchpad/photos.test.cjs`, canvas de 1000 px comprimido con los mismos
parámetros que usa la app — `compressImage(file, 1000, 0.7)`, `index.html:6810`):

| Textura | dataURL por foto | 200 fotos |
|---|---|---|
| Imagen suave (cielo, pared) | ~79 KB | ~15 MB |
| Imagen con mucho detalle (follaje — el caso típico acá) | ~311 KB | ~61 MB |

**Impacto para el podador.** En un celular de gama baja, esos 15–60 MB de strings base64
en memoria desde el arranque son suficientes para que Android mate la pestaña al volver
de la cámara. Y cada 45 segundos de edición se sube ese mismo volumen entero a Drive —
sobre datos móviles, en el campo. El comentario de `index.html:5031` dice
"son pocos MB": era cierto al escribirlo, deja de serlo con el historial acumulado.

**Recomendación.** No es urgente pero conviene planificarlo: (a) hidratar el caché de
forma perezosa (solo las fotos del presupuesto abierto + las que pida el render, con
`getPhotoData` async o un pre-pase por pantalla); (b) separar el backup de fotos del
backup de datos en Drive — subir un archivo de datos (chico, frecuente) y las fotos como
archivos individuales por ID (una vez cada una, nunca reenviadas). Eso solo ya elimina
casi todo el tráfico repetido.

---

### M3 · Medio — Re-render y re-parseo del historial completo

**Qué pasa.** La búsqueda del historial llama al render en cada tecla, sin debounce:

```html
<!-- index.html:3407 -->
<input class="hsearch" id="hist-search" type="search" oninput="_histSearchSync(this); renderHistory()">
```

Y cada render vuelve a leer y parsear el historial entero desde `localStorage` varias
veces, porque `getH()` (`index.html:8045`) no cachea y lo llaman todos los helpers.
En el calendario es peor: `calBuildIndex()` (`index.html:12916`) hace un `getH()` completo
y se la invoca desde 6 lugares distintos (`:13063`, `:13133`, `:13211`, `:13241`,
`:13373`, `:13458`), varios de ellos en el mismo render.

**Medición** (`scratchpad/perf.test.cjs`, 250 presupuestos con snapshot completo):

```
historial de 250 presupuestos = 955 KB en localStorage

renderHistory()      : 145 ms  · relecturas+parse del historial completo: 5
abrir pestaña Agenda :  46 ms  · relecturas+parse del historial completo: 4
cambiar a vista Mes  :  39 ms  · relecturas+parse del historial completo: 3
```

**Impacto para el podador.** Eso es en una máquina de escritorio; un celular de gama baja
es 4–10× más lento. Buscar un cliente en un historial de dos años significa ~0,6–1,5 s de
bloqueo **por cada letra tipeada**: la escritura se traba y el teclado se siente roto.
Es exactamente el escenario de uso en el campo.

**Recomendación.** Dos cambios chicos y de bajo riesgo: (1) debounce de ~200 ms en el
buscador; (2) un caché en memoria del historial parseado, invalidado en `setH()` —
`getH()` pasa a devolver el caché y todo el resto del código queda igual. Esto último
mejora los tres números de arriba de una sola vez.

---

### M4 · Medio — Dos dispositivos con la misma cuenta de Drive se pisan

**Qué pasa.** `gdriveUpload()` (`index.html:10745`) hace `PATCH …?uploadType=media` con el
backup local completo: sin merge, sin comparar `modifiedTime` (que sí se pide en
`gdriveFindFile`, `index.html:10737`, pero no se usa). Y `gdriveInitOnLoad()`
(`index.html:10883`) solo baja la copia **si el dispositivo está vacío**.

**Impacto para el podador.** Si usa celular y tablet con la misma cuenta, el último que
guarde pisa el trabajo del otro, en silencio. El diseño actual está pensado —y bien— para
"cambio de teléfono", no para dos dispositivos en paralelo; el problema es que nada lo
dice ni lo impide.

**Recomendación.** Antes de subir, comparar `modifiedTime` remoto contra el propio
`LS.GDRIVE_LAST`; si el remoto es más nuevo, no pisar y avisar ("hay cambios hechos en
otro dispositivo"). Como mínimo, aclarar la limitación en el texto de la sección de Drive.

---

### M5 · Medio — Los nombres de clientes salen del dispositivo al activar push

**Qué pasa.** `_buildPushFollowups()` / `_buildPushExpiries()` (`index.html:4868–4913`)
mandan al Worker `{ id, clientName, date, diasDesdeEnvio }` por cada presupuesto
pendiente, y el Worker los guarda en el KV de Cloudflare en texto plano
(`push-worker/index.js:154`) y los usa en el título de la notificación
(`Seguimiento: ${due[0].clientName}`, `:197`).

**Impacto para el podador.** Es una decisión de diseño legítima —sin el nombre la
notificación no sirve— pero contradice la promesa de "los datos viven en tu dispositivo"
que la app hace en la UI, y el usuario no la ve explicada en ningún lado. También implica
que los nombres de sus clientes quedan en un servicio de terceros indefinidamente
(no hay expiración de las claves del KV).

**Recomendación.** Decirlo en el texto del toggle de notificaciones ("para avisarte con la
app cerrada, se envía el nombre del cliente y la fecha al servidor de avisos"). Y ponerle
TTL a las entradas del KV, para que un dispositivo que deja de usarse se limpie solo.

---

### M6 · Medio — Fechas de facturación mezclando UTC y local

**Qué pasa.**

```js
// index.html:12008-12010
const hace12 = new Date(now); hace12.setFullYear(hace12.getFullYear()-1);   // local
const ultimas = facturas.filter(f=>{ const d=new Date(f.fecha); return d>=hace12 && d<=now; });
//                                        ↑ 'YYYY-MM-DD' → medianoche UTC
const totalAnual = centsToMoney(ultimas.reduce((s,f)=>s+moneyToCents(f.monto), 0));
```

`new Date('2026-07-24')` es medianoche **UTC**, o sea las 21:00 del 23 en Argentina; se
compara contra `now` y `hace12`, que son locales. Es exactamente el patrón que
`CLAUDE.md` prohíbe ("Fechas en LOCAL, no UTC") y que el resto del archivo respeta
(el comentario de `index.html:11955` lo dice explícitamente para el campo de fecha).

En los casos normales el resultado no cambia; se descompone en el borde de la ventana de
12 meses y con facturas cargadas con fecha futura (que quedan fuera del total anual pero
sí entran en el total del mes, que compara strings — `index.html:12014`).

**Impacto para el podador.** Bajo en la práctica, pero es el número del tope de
monotributo: conviene que sea exacto y consistente con el resto de la app.

**Recomendación.** Comparar strings `YYYY-MM-DD` (como ya hace `delMes`) o construir el
`Date` con partes locales, igual que `_calDateFromISO()` (`index.html:12900`), que ya
resuelve esto bien.

---

### M7 · Medio — `safeSetLS()` devuelve `false` y casi nadie lo mira

**Qué pasa.** `safeSetLS()` (`index.html:4413`) está bien hecho: distingue cuota llena,
avisa con un toast y devuelve `true`/`false`. Pero los llamadores ignoran el resultado:

```js
function setH(h) { safeSetLS(LS.HISTORY, JSON.stringify(h)); }            // :8052
function setNotes(a) { safeSetLS(LS.NOTES, JSON.stringify(a || [])); }    // :12874
function setFacturas(arr) { safeSetLS(FACT_KEY, JSON.stringify(arr)); }   // :11943
```

Con el almacenamiento lleno, la operación sigue su curso: el render muestra el
presupuesto guardado, el toast de éxito aparece igual, y solo el toast de error (que se
va en 6 segundos y compite con el otro) delata que en disco no quedó nada. Además,
cuando la escritura falla tampoco se dispara `scheduleGdriveBackup()` (está dentro del
`try`, `index.html:4418`), así que no queda copia en Drive tampoco.

**Impacto para el podador.** Almacenamiento lleno es un escenario realista precisamente
en el perfil de esta app (celular con poco espacio + historial largo + fotos + logo).
Y es el momento en que menos se puede permitir un falso "guardado".

**Recomendación.** Que los `set*` propaguen el booleano y que los flujos importantes
(guardar presupuesto, registrar factura, guardar nota) no muestren el toast de éxito si
volvió `false`. Bloquear la acción y ofrecer "Exportar backup ahora" en el mismo toast.

---

### Hallazgos Bajos

**B1 — `LS.PDF_THEME` es una clave muerta.** Declarada en `index.html:3792`
(`PDF_THEME: 'pq_pdf_theme'`) y nunca leída ni escrita: el tema del PDF vive en
`S.pdfTheme` dentro del estado. Borrarla para que no confunda al próximo que audite
la lista de claves.

**B2 — Escrituras directas a `localStorage`.** Ocho sitios escriben sin pasar por
`safeSetLS()`: `:4853` (`PUSH_DEVICE_ID`), `:7637` (`THEME`), `:7971` (`ONBOARDED`),
`:9661` (`DAY_ALERT_SEEN`), `:10391` (`LAST_BACKUP`), `:10731` (`GDRIVE_EMAIL`),
`:10764` (`GDRIVE_LAST` + `LAST_BACKUP`), `:10784` (`GDRIVE_ON`), `:13021` (`CAL_VIEW`).
Es defendible —son flags de pocos bytes y no conviene que disparen un backup a Drive—
pero conviene dejarlo explícito en `CLAUDE.md` o con un helper `setFlagLS()`, porque hoy
parece un olvido. De todos, **`:4853` es el único sin `try/catch`**: en modo privado de
Safari o con el almacenamiento bloqueado, `_pushDeviceId()` lanza.

**B3 — `vendor/` sin procedencia registrada.** `vendor/leaflet.js` se identifica solo
(1.9.4, la última estable de la línea 1.x, sin CVEs conocidas). `vendor/html2pdf.bundle.min.js`
(906 KB) no expone su versión de forma fiable —solo se ven `3.0.0` y `3.2.4` sueltos de
dependencias internas— y no hay `package.json` ni lockfile en el repo. Sin versión anotada
no hay manera de chequear CVEs en el futuro. Recomendación: un `docs/vendor.md` (o un
comentario al inicio de cada archivo) con librería, versión exacta, fecha y URL de origen.

**B4 — `start_url` genera un redirect en cada apertura.** El manifest declara
`"start_url": "./index.html"` pero Cloudflare responde 307 hacia `/`:

```
$ curl -I https://presupuesto-ar.juliobarribolbo.workers.dev/index.html
HTTP/2 307
location: /
```

Verifiqué que **no rompe el offline**: reproduje el comportamiento exacto de Cloudflare
en un servidor local (`scratchpad/redirect.test.cjs`) y el app-shell carga bien sin red
tanto desde `/index.html` como desde `/`. El único costo es un round-trip extra en cada
apertura con conexión. Apuntar `start_url` y `shortcuts` a `./` lo elimina. Ojo: el test
`test/pwa.test.cjs` usa `python3 -m http.server`, que **no** hace ese redirect, así que
este escenario no está cubierto por el test.

**B5 — Tres implementaciones del total del estimativo.** Es la causa raíz de C2:
`updateTotalsBar()` (`:4591`), `autoSaveToHistory()` (`:8069`) y `buildEstDoc()` (`:11669`)
calculan lo mismo de tres maneras distintas. Al arreglar C2 conviene unificarlas en una
sola función, no parchear la de `:8069`.

---

## 4. Lo que está bien (conservar)

- **Disciplina de centavos.** `moneyToCents`/`centsToMoney`/`itemTotalCents`
  (`index.html:4270`, `:6213`) están bien implementadas, con clamp defensivo de precio y
  cantidad, y el manejo de la coma decimal argentina. El único desvío real es C2.
- **Fechas locales.** `toLocalISODate()` / `today()` / `calcExpiry()` /
  `_calDateFromISO()` / `fmtDiaCorto()` son correctas y están comentadas con el porqué.
  Barrí todos los `toISOString()` del archivo: los 11 restantes son timestamps de
  auditoría (`savedAt`, `enviadoEn`, `exportedAt`), que es el uso correcto. El único
  desvío es M6.
- **Escapado de texto.** Revisé los ~700 puntos de interpolación en `innerHTML`: **todo
  el texto del usuario** —cliente, dirección, especies, servicios, frases, notas,
  descripciones— pasa por `esc()`, incluso dentro de `title="…"`. Sumado a `safeImgSrc()`
  y `safeColor()`, es un trabajo prolijo y consistente. El agujero de C1 es de otra
  naturaleza (IDs y enums en atributos), no una falla de esta disciplina.
- **Higiene de secretos y despliegue.** No hay `client_secret` ni clave privada VAPID en
  el repo. El `.assetsignore` está bien pensado y **verifiqué en producción** que
  `CLAUDE.md`, `docs/`, `push-worker/` y `test/` devuelven 404. El scope de Drive es el
  mínimo (`drive.appdata`).
- **Google Drive sin fricción.** El manejo de `login_hint` + `prompt:'none'` y los chequeos
  de `navigator.onLine` están bien resueltos y bien documentados; no se pide token al abrir.
- **Service Worker.** Network-first con timeout para navegaciones + cache-first para el
  resto, sin cachear redirects ni respuestas != 200, limpieza de caches viejas y
  `skipWaiting` + recarga controlada. `APP_SHELL` está **completo**: crucé las 12 fuentes
  de `fonts.css` una por una contra `sw.js` y el disco, y los íconos y `vendor/leaflet.*`
  también están. Las dos exclusiones (`html2pdf`, `share-target`) son deliberadas y están
  justificadas en comentarios.
- **`node test/pwa.test.cjs` pasa los 4 checks** (SW controla la página, es `./sw.js` real,
  crea la cache `presupuesto-v135`, y el documento carga offline).
- **Logging limpio.** Los 20 `console.*` son mensajes de error genuinos; ninguno filtra
  tokens, datos de clientes ni contenido de backups.
- **Migraciones y compatibilidad.** `migrateState()`, `normalizeRiskData()`,
  `sanitizeSectionOrder()` y `migrateInlinePhotosToIDB()` manejan versiones viejas con
  cuidado real (incluido el rollback a foto embebida si IDB falla). El patrón de
  `photoMissing()` con placeholder "restaurá tu backup" es un buen detalle de UX.
- **Comentarios.** El archivo explica el *porqué* de las decisiones no obvias
  (`login_hint` vs `hint`, el logo fuera del snapshot, el wrapper-table del PDF). Eso hizo
  esta auditoría mucho más rápida y hay que sostenerlo.

---

## 5. Plan de remediación sugerido

Tandas chicas, cada una verificable y desplegable por separado.
**Recordá subir `CACHE_VERSION` en `sw.js` en cada deploy** (actual: `presupuesto-v135`).

### Tanda 1 — Blindar la frontera de entrada (C1 + C3 + A2) → `v136`
La más importante y la que más se beneficia de hacerse junta, porque las tres comparten
la misma solución: un validador.
1. `sanitizeBackup(d)` / `sanitizeHistory(h)` / `sanitizeNotes(n)`: verificar arrays,
   descartar entradas inválidas, validar IDs con `/^[\w-]{1,40}$/` y los enums
   (`pdfTheme`, `pdfFont`, `estado`) contra lista blanca.
2. Aplicarlo en `applyBackupObject()`, `impHistReplace()`, `impHistCombine()`,
   `impToHistory()`, `impIndividual()` y también defensivamente en `getH()`/`getNotes()`.
3. Restauración en dos fases (validar todo en memoria → recién ahí escribir).
4. Reemplazar `onclick="fn('${id}')"` por `data-id` + listener delegado en
   `_calEvHTML`, `_calColEv`, `renderHistory`, `factRender` y el mapa.
5. **Verificación:** volver a correr `scratchpad/xss.test.cjs`, `xss-hist.test.cjs`,
   `xss-theme.test.cjs` y `brick.test.cjs` — los cuatro tienen que dar negativo.
   Vale la pena dejarlos como test permanente en `test/`.

### Tanda 2 — Plata correcta (C2 + B5) → `v137`
1. Extraer `calcEstTotals(estItems)` en centavos.
2. Usarla en `updateTotalsBar()`, `autoSaveToHistory()` y `buildEstDoc()`.
3. **Verificación:** `scratchpad/money.test.cjs` — los tres números tienen que coincidir.
4. Nota de migración: los presupuestos estimativos ya guardados con el total mal siguen
   mal. Conviene recalcular `e.total` de las entradas con `isEstimative` al arrancar, una
   sola vez, o al menos avisarlo.

### Tanda 3 — Que el backup sea completo y honesto (A1 + A3) → `v138`
1. Agregar `followup` a `buildBackupObject()`/`applyBackupObject()`.
2. Contador de fallos de Drive + estado visible "no se pudo copiar desde el <fecha>".
3. Comentario en el código con la lista canónica de claves y su decisión (va / no va).

### Tanda 4 — Rendimiento en el celular (M3 + M7) → `v139`
1. Caché en memoria de `getH()`, invalidado en `setH()`.
2. Debounce de 200 ms en el buscador del historial.
3. Propagar el booleano de `safeSetLS()` a los flujos de guardado importantes.
4. **Verificación:** `scratchpad/perf.test.cjs` — los tiempos y el conteo de re-parseos
   tienen que bajar claramente.

### Tanda 5 — Fotos: espacio y memoria (M1 + M2) → `v140`
1. `gcPhotos()` de huérfanas (con las guardas de orden que menciona M1).
2. Backup de fotos separado del de datos en Drive (subir cada foto una sola vez).
3. Evaluar hidratación perezosa del caché.

### Tanda 6 — Worker de push y cierres (A5 + M4 + M5 + M6 + B1–B4)
1. Sacar o proteger `/test`; validar `deviceId`; acotar CORS; TTL en el KV.
2. Chequeo de `modifiedTime` antes de subir a Drive.
3. Fechas de facturación por string; borrar `LS.PDF_THEME`; `try/catch` en
   `_pushDeviceId()`; `start_url` → `./`; `docs/vendor.md` con las versiones.

---

*Scripts de reproducción usados en esta auditoría (en el scratchpad de la sesión, no
versionados): `xss.test.cjs`, `xss-hist.test.cjs`, `xss-theme.test.cjs`, `brick.test.cjs`,
`money.test.cjs`, `perf.test.cjs`, `photos.test.cjs`, `redirect.test.cjs`. Conviene
rescatar al menos los cuatro primeros y `money.test.cjs` a `test/` al hacer los fixes.*
