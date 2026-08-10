# Agenda / Calendario — estado y pendientes

> Mapa de la feature **Agenda** (pestaña calendario) para retomar en otra sesión.
> El código vive en `index.html`, sección `// ===== js/calendar.js =====`.
> Colores por concepto: tokens `--c-trabajo/-recontacto/-seguimiento/-vence/-nota`
> en `:root` (claro y oscuro), unificados con los chips/badges del Historial.

## Modelo de datos (ya existe, no hay que crear nada nuevo salvo notas)
Los eventos se **derivan del historial** en `calBuildIndex()`; no se guarda estado
extra por evento:
- **Trabajo** → `e.fechasTrabajo[]` / `e.diasEstimados` (multi-día), vía `agFechas()`.
- **Recontacto** → `e.recontactoEn` (+`e.recontactoNota`), solo si `estado==='aceptado'`.
- **Vencimiento** → `e.snapshot.dateExpiry`, respeta la config de seguimiento.
- **Seguimiento** → `e.enviadoEn` + `cfg.days` (misma lógica que los banners).
- **Nota/recordatorio manual** → único dato nuevo: `getNotes()`/`setNotes()`,
  clave `LS.NOTES` (`pq_agenda_notes`), incluido en el backup completo.

## Hecho
- **Fase 1 — Vista Mes (grilla).** `renderCal()` + detalle del día `renderCalDay()`.
  Puntos por concepto, hoy resaltado, navegación de mes, alta/○/🗑 de notas.
- **Colores unificados Historial↔Calendario** (v127–v128). El color = concepto y
  significa lo mismo en las dos vistas; la urgencia se marca con realce (`.is-due`),
  no cambiando el tono. Nota en rosa (`#ec4899`) para separarla del rojo de vence.
- **Fase 2 — Vista Agenda (lista cronológica)** (v129–v130). Toggle Mes/Agenda
  (`calSetView`, recordado en `LS.CAL_VIEW`), arranca en Agenda por defecto.
  `renderCalList()` agrupa por día (Hoy · Mañana · fecha) con `_calEvHTML()`
  compartido. Sección **"Atrasado"** plegable (`_calOverdueOpen` / `calToggleOverdue`),
  colapsada por defecto para ver primero lo actual. Reglas de "Atrasado":
  vencimientos excluidos (son dato, no tarea); seguimientos solo si ≤30 días;
  recontactos y notas siempre (creados a mano).
- **Fase 2 (completada) — carga del día + export .ics** (v131).
  - **Indicador de carga del día.** `_calJobCount(evs)` cuenta los trabajos del día;
    se muestra solo a partir de 2 (con uno alcanza el punto). En la grilla del mes,
    badge violeta arriba a la derecha de la celda (`.agc-load`); en la vista Agenda,
    chip "N trabajos" en el encabezado del día (`.agc-day-load`).
  - **Export masivo a .ics.** `calExportIcs()` arma UN `Blob` `text/calendar` con los
    trabajos, recontactos y notas pendientes **futuros** (fecha ≥ hoy) y lo descarga
    (`agenda-presupuestos-YYYY-MM-DD.ics`), para suscribir la agenda entera en el
    calendario del teléfono. Botón "Exportar .ics" en la fila `.agc-actions` (visible
    en ambas vistas). Eventos de día completo con `DTEND` **exclusivo** = día siguiente
    (mismo criterio que `agendaGcalUrl`); fechas LOCAL (`YYYYMMDD`), texto escapado
    (`_icsEsc`), líneas plegadas (`_icsFold`) y UID único por evento (guarda anti-colisión).
    Vencimientos/seguimientos quedan afuera (son derivados y ruidosos).
- **Fase 3 — Vistas Semana y 3 días** (v132; tira de días v133; columnas v134). Toggle
  de 4 vistas (Mes · Semana · 3 días · Agenda). `renderCal()` es dispatcher: Mes →
  `renderCalGrid()` (grilla 7×N), Semana/3-días → `renderCalCols()`, Agenda → `renderCalList()`.
  - **Columnas por día (`renderCalCols`).** Iteración final: el usuario quería ver el
    contenido de cada día **a la vista, sin tocar** (referencia estilo Jobber). Cada día
    es una **columna** (`.agc-col`) con encabezado (día de semana + número + badge de
    carga) y los eventos como **bloques** (`_calColEv` → `.agc-col-ev`: título + sub con
    el texto envolviendo, barra de color por tipo). Tocar un bloque abre el presupuesto
    (`goToHistoryEntry`) o alterna la nota. **Semana** = 7 columnas con **scroll
    horizontal** (no entran 7 legibles en el teléfono); al abrir/navegar auto-scrollea a
    la columna del día elegido (hoy) para no arrancar en días vacíos. **3 días** = 3
    columnas que **llenan el ancho** (`.agc-cols-3`). Debajo, `renderCalDay(true)` deja
    **solo el alta de nota** del día elegido (sin re-listar los eventos: ya están en las
    columnas). Historia previa: v132 fue grilla de columnas con chips cortados; v133 una
    tira de pastillas selector (`renderCalStrip`) que obligaba a tocar para ver el día;
    v134 volvió a columnas pero con el texto completo a la vista.
  - Fecha ancla `_calAnchor` (iso) para las vistas no mensuales; navegación unificada
    `calPrev`/`calNext` (`calStep`) que se mueve ±1 mes / ±7 / ±3 días según la vista.
    `calToday` y `calSelectDay` compartidos; `renderCalDay(noList)` sirve el detalle
    completo (Mes) o solo el alta de nota (Semana/3-días). Vista recordada en
    `LS.CAL_VIEW` (whitelist `CAL_VIEWS`). Toggle scrollable + padding reducido en móvil
    para las 4 pestañas. Helpers nuevos: `_calDateFromISO`, `_calRangeLabel`, `_calColEv`.
    `renderCalGrid` limpia las clases `agc-cols*` al volver a Mes.
  - **Mejora del Mes + fix (v135).** El Mes es un **mapa de trabajo**: los días con poda
    se tintan de fondo (`.agc-cell-work` = `var(--c-trabajo-bg)`) y el trabajo ya NO se
    muestra como punto (el fondo lo representa); recontacto/vence/seguimiento/nota siguen
    como puntos (más grandes). **Hoy** pasa a ser un **círculo relleno** en el número
    (marca inconfundible, distinta del día elegido que es fondo `--accent-light` + borde).
    Celdas un toque más altas. **Fix:** el encabezado Lun…Dom (`#agc-grid-head`) se ocultaba
    con `hidden` pero el `display:grid` del CSS lo pisaba y aparecía una fila fantasma en
    Semana/3-días → ahora se controla con `style.display` (`none` en columnas, `''` en Mes).

- **Visitas (evaluación presencial / ir a presupuestar)** (v165). Sexto concepto:
  una nota con `tipo:'visita'` (mismo storage `LS.NOTES`, retrocompatible — sin
  tipo = nota común). Color propio azul (`--c-visita/-bg/-fg` claro y oscuro),
  prioridad junto al trabajo (`CAL_TIPO_ORD`), tarjeta tintada (`.agc-ev.t-visita`),
  alta con doble botón "+ Nota / + Visita" (`calSaveNote('visita')`), selector de
  tipo en el modal de edición, chip de clima (`climaDeNota`/`_climaLatLngNota`:
  ubicación de la nota o centroide de zona; sus zonas entran en `climaRefresh`),
  visitas de hoy en el banner del día (`getVisitasDeHoy`, con "Cómo llegar" /
  WhatsApp / Hecha) y botón **"Crear presupuesto"** (`calCrearPresupuestoDesdeVisita`:
  precarga cliente/tel/ubicación + texto como nota interna y marca la visita hecha).
  Sale a Google Calendar ("Visita: …") y al `.ics` (pendientes). El selector de
  tipo en el modal de edición es un **segmentado de dos botones** (`.ne-segment`,
  `_neSetTipo`/`_neGetTipo`/`_neSelTipo`), no un `<select>`: dentro del modal
  (`z-index:2000`) el popup del select personalizado (`.csel-pop`) abría detrás
  del overlay (v166). Eso se resolvió de raíz en v199 subiendo `.csel-backdrop`/
  `.csel-pop`/`.cal-pop` a 2400/2401 —arriba de TODOS los overlays, abajo de los
  toasts—, pero el segmentado se queda: es más rápido de tocar que un desplegable. Al guardar una nota/visita con cliente + datos,
  se guarda/enriquece la **ficha del cliente** en la DB (`saveNoteClientToDB`):
  teléfono + ubicación (la `ubic` de la nota → `maplink` del cliente); crea el
  cliente si no existe y completa solo los campos vacíos si ya existe, sin pisar
  lo ya cargado (v167).

- **Mover una nota/visita de día desde su propio modal** (v199). "Editar nota"
  tenía todo menos lo más obvio: la fecha. Para correr un compromiso había que
  borrar la nota y volver a crearla en el día nuevo. Ahora el modal trae el campo
  **Fecha** (datepicker propio) y un aviso debajo que dice de dónde a dónde se
  mueve (`_neFechaSync`). Sin fecha válida no guarda. El disparador fue real:
  alerta de viento el día de una poda agendada. Ver `test/nota-fecha.test.cjs`.
  En v202 se sacaron los atajos relativos que acompañaban al campo
  (− 1 día / + 1 día / + 1 semana / Hoy, `_neFechaMover`): con tocar el
  calendario alcanza y ocupaban media pantalla del modal, que ahora entra
  entero sin scroll.

- **Actualizar el pronóstico a mano** (v200). El cache de clima tiene TTL de 3 h
  y TODOS los caminos automáticos lo respetan (abrir la app, volver del segundo
  plano, agendar, abrir el panel): dentro de esa ventana no se vuelve a pedir
  nada. Bien para no golpear la API, mal para el usuario, que veía "hace 2 h" en
  el pie del panel sin manera de refrescar — justo después de mover un trabajo de
  día, que es cuando más ganas de mirar el pronóstico hay. Ahora el pie trae
  **"Actualizar"** (`climaRefrescarAhora` → `climaForceRefresh`), único camino con
  `{ force:true }`: baja de nuevo TODAS las zonas con trabajos/visitas próximos
  (una sola llamada en la práctica), repinta Agenda + banner + Historial y deja
  el pie en "recién actualizado". Sin señal lo dice y no toca lo cacheado.
  Además, mover una visita de día o de lugar ahora llama a `climaEnsureNota`: el
  día nuevo puede caer fuera de lo bajado, o el lugar nuevo ser otra zona.

- **Hora en notas y visitas** (v202). Hasta acá todo lo manual de la Agenda era
  de día completo: "visita a Amalia el lunes", sin decir a qué hora. Ahora el
  alta (fila de botones **+ Nota / + Visita**) y el modal de edición traen un
  campo **Hora opcional** (`hora:'HH:MM'` en la nota, validado por `sanHoraHM`;
  sin hora se comporta exactamente como antes). La hora se ve en la tarjeta del
  evento (`VISITA · 14:30`), en las columnas de Semana/3-días, en el banner del
  día y en la campanita; ordena los eventos dentro del día; y sale al mundo:
  **Google Calendar** como evento con horario (`start.dateTime` + `timeZone` del
  dispositivo, 1 h de duración por defecto — `CAL_EV_MINS`) y el `.ics` como
  fecha-hora local flotante. La hora forma parte de la **clave** `pqKey` del
  evento de Google, no solo del hash: un PATCH que convierte un evento de día
  completo en uno con horario deja `start.date` y `start.dateTime` conviviendo y
  Google lo rechaza, así que poner/cambiar la hora se resuelve como borrar +
  insertar. Los eventos sin hora conservan clave y hash de siempre: desplegar
  esto no reescribe nada de lo ya sincronizado. Ver `test/nota-hora.test.cjs`.

- **"Las visitas no me quedan en Google Calendar"** (v203). La sync siempre las
  empujó —quedó demostrado con `test/gcal-agenda.test.cjs`, que corre una
  `gcalSync()` entera con la API interceptada y verifica que salgan los cinco
  conceptos—, así que el problema estaba del otro lado: **el calendario puede
  quedar destildado**. Un calendario creado por API entra a la cuenta pero puede
  venir con `selected:false`, y encima la app de Android tiene su propio
  interruptor por dispositivo (☰ → Configuración → la cuenta → "Presupuestos AR"
  → Sincronización) que ninguna API puede activar. Ahora `_gcalEnsureVisible()`
  lo marca visible (una vez por dispositivo, `LS.GCAL_VIS`; "Sincronizar ahora"
  lo fuerza siempre), la sección de config explica el interruptor del teléfono, y
  cada sync anota **cuántos eventos dejó arriba** (`LS.GCAL_N`, visible en el
  estado): sin ese número no hay manera de distinguir "no se mandaron" de "no se
  muestran".

- **La sync parada que decía "Conectado ✓"** (v204). Segunda vuelta del reporte
  anterior: los eventos viejos estaban en Google y los nuevos no. La causa es
  que `gcalInitOnLoad` se tragaba en silencio el fallo del token
  (`.catch(() => {})`): si la sesión de Google deja de renovarse callada,
  `gcalAutoSync()` no corre nunca, el contador de fallos queda en 0 y la sección
  sigue diciendo "Conectado ✓" con la fecha de la última vez que anduvo. La
  agenda puede estar parada días sin que nada lo diga — el mismo escenario que
  ya nos había pasado con Drive. Tres arreglos: (1) ese fallo ahora cuenta como
  fallo de sincronización (al 2º, rojo + "Reconectar"); (2) **"Sincronizar
  ahora" pide el token con la escalera interactiva**, así el botón de reparar
  puede efectivamente reparar una sesión vencida (antes repetía el mismo error,
  porque `gcalSync()` pide el token en modo silencioso); (3) si la última sync
  tiene más de 24 h, el estado lo avisa aunque no haya error registrado.

## Ideas futuras (no comprometidas)
- Botón "Hoy" también en la vista Agenda (scroll al grupo Hoy).
- Umbral de "seguimiento reciente" configurable (hoy fijo en 30 días en `renderCalList`).
- Recordatorio push de una nota/visita con hora (ya hay `push-worker/` para seguimientos).
- Filtro por tipo en la vista Agenda (mostrar solo trabajos, etc.).

## Descartado a propósito (rompen offline / poco valor)
- Clima integrado (necesita API/red).
- Drag-to-reschedule en la grilla (complejo en touch; el diálogo de agenda
  `openAgendaDlg` ya cubre reprogramar).

## Cómo verificar (recordatorio)
- Sintaxis JS: aislar el `<script>` inline y `node --check` (ver `CLAUDE.md`).
- Comportamiento: `node test/pwa.test.cjs` + scripts puppeteer headless que setean
  `localStorage.HISTORY`/`NOTES`, llaman `switchTab('agenda')` y chequean el DOM.
- **Subir `CACHE_VERSION` en `sw.js`** en cada deploy.
