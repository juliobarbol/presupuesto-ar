# js/seguimiento.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/seguimiento.js`

Seguimiento comercial: config (`FOLLOWUP_DEF`, `getFollowupCfg`), seguimientos y vencidos pendientes, plantillas de WhatsApp (`fillWaTemplate`, `buildWhatsappLink`)

**"¿Qué pasó?" en el banner de vencidos** (v259, `vencResponder`, `VENC_RESPUESTAS`): cada vencido del banner ofrece **Aceptó**, **Lo perdí** y **Sigue en pie**. El ✓ solo apaga el aviso y el presupuesto sigue vencido para siempre: en el uso real había 20 vencidos y 0 perdidos, y la conversión del Mapa se apoyaba en esa suposición. Aceptó y Lo perdí pasan por `setEstadoHistory` (que deja el "Deshacer" para realizado y perdido). Sigue en pie es `prorrogarVigencia`: `snapshot.dateExpiry` = hoy + `validityDays` del presupuesto (30 si no tiene), borra `vencimientoVistoEn` para que avise de nuevo y deja deshacer `prorroga` con la fecha anterior. Se cambia el snapshot porque de esa fecha leen el banner, el pin del Mapa, la Agenda y el push. Si el editor tiene abierto ese mismo presupuesto (mismo `quoteNumber`), también se actualiza `S.dateExpiry`: si no, el autoguardado volvía a poner la fecha vieja. Ver `test/vencido-quepaso.test.cjs`.

**Vencidos sin respuesta** (v260, `#vsr-overlay`, `getVencidosSinRespuesta`/`vsrAbrir`/`vsrRender`/`vsrClose` en `js/history.js`): lista de TODOS los enviados con la vigencia pasada, con el mismo "¿Qué pasó?". Existe porque el banner muestra 5 y esconde los descartados con el ✓, pero esos siguen contando como vencidos en la conversión del Mapa. El criterio es `mapaEsVencido` (no `getExpiredQuotes`): ignora `vencimientoVistoEn` y la config del seguimiento, así el número de la lista es el de la franja del Mapa. Se abre desde el botón al pie del banner (todo el historial) y desde "N vencidos sin respuesta ›" de la franja del Mapa (`vsrAbrir('zona')`, con los ids que deja `mapaUpdateZonaStats` en `_mapaZonaVencIds`). Los recién vencidos van primero. `z-index` 1050, debajo de `#agenda-overlay` (1100), porque "Aceptó" abre el diálogo de agendar encima. Al cerrarla con el Mapa a la vista se llama a `mapaRefresh` (pins huecos y cifras).
