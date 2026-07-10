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

## Pendiente de Fase 2
1. **Indicador de carga del día ("2 trabajos").** Avisar cuántos trabajos ya hay
   agendados en un día para no sobre-agendar. Dónde: en la celda del mes y/o en el
   encabezado de día de la lista. Fácil: contar `evs.filter(tipo==='trabajo')` en
   `calBuildIndex`/`renderCal`. Decidir si mostrar siempre o solo cuando ≥2.
2. **Exportar toda la agenda (no evento por evento).** Hoy solo existe export por
   evento a Google Calendar (`agendaGcalUrl`/`agendaGcal`, en la sección agenda del
   historial). Falta un **export masivo**: generar un archivo **.ics** con todos los
   trabajos/recontactos futuros y descargarlo (un `Blob` `text/calendar`), para
   suscribir la agenda entera en el calendario del teléfono de una. Sin red, encaja
   con offline-first. Ojo fechas LOCAL (no UTC) — usar el mismo criterio que
   `agendaGcalUrl` (arma `dates` con el día siguiente como fin).

## Ideas Fase 3 (no comprometidas)
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
