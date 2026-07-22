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
  (`z-index:2000`) el popup del select personalizado (`.csel-pop`, `z-index:1201`)
  abría detrás del overlay (v166).

## Ideas futuras (no comprometidas)
- Botón "Hoy" también en la vista Agenda (scroll al grupo Hoy).
- Umbral de "seguimiento reciente" configurable (hoy fijo en 30 días en `renderCalList`).
- Notas con hora / recordatorio push (ya hay `push-worker/` para seguimientos).
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
