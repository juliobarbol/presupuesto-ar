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
- **Fase 3 — Vistas Semana y 3 días** (v132, rediseñado en v133). Toggle de 4 vistas
  (Mes · Semana · 3 días · Agenda). `renderCal()` es dispatcher: Mes → `renderCalGrid()`
  (grilla 7×N), Semana/3-días → `renderCalStrip()`, Agenda → `renderCalList()`.
  - **Tira de días (`renderCalStrip`).** En el teléfono una grilla de columnas dejaba
    celdas altas vacías (Semana) y texto cortado (3 días). Por eso Semana y 3 días usan
    una fila de **pastillas** compactas (`.agc-strip-day` = día de semana + número +
    puntos por tipo) que hace de **selector**; el contenido completo del día tocado se
    lee en el detalle de abajo (`renderCalDay`, con chip "N trabajos" cuando ≥2). Semana
    = 7 pastillas Lun→Dom de la semana ancla; 3 días = 3 pastillas desde la ancla.
    Mantiene `_calSel` dentro del rango visible al navegar (clamp a hoy o al primer día).
  - Fecha ancla `_calAnchor` (iso) para las vistas no mensuales; navegación unificada
    `calPrev`/`calNext` (`calStep`) que se mueve ±1 mes / ±7 / ±3 días según la vista.
    `calToday` y `calSelectDay` compartidos; el detalle del día (`renderCalDay`) y el
    alta de notas se reusan bajo las tres vistas de grilla/tira. Vista recordada en
    `LS.CAL_VIEW` (whitelist `CAL_VIEWS`). Toggle scrollable + padding reducido en móvil
    para las 4 pestañas. Helpers nuevos: `_calDateFromISO`, `_calRangeLabel`.

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
