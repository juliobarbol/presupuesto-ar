# js/push.js + push-worker/ — notificaciones

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/push.js`

Notificaciones push con la app cerrada (`_buildPushAvisos`, `syncPushFollowups`, `initPush`…; ver `push-worker/` en "Estructura de archivos")

## `push-worker/` y los avisos con la app cerrada

Cloudflare Worker para las notificaciones con la app cerrada. No es parte del PWA shell y **no se publica al mergear a `main`** (`npx wrangler deploy --config ./wrangler.toml` desde `push-worker/` — **sin `--config` publica la APP**, porque wrangler encuentra antes el `wrangler.jsonc` de la raíz; o conectarlo a Workers Builds). Ver `docs/push-setup.md`. La app es inerte a esto si `PUSH_WORKER_URL` / `PUSH_VAPID_KEY` están vacíos.

**Avisos con horario (v237):** la app arma texto y hora local de cada aviso (`_buildPushAvisos`: "Mañana" 19 h, "Hoy" 7:30, 1 h antes de visitas/notas con hora; tipos `pushAgenda`/`pushHora` en la config de seguimiento) y el Worker solo los entrega (cron cada 15 min; seguimiento/vencimiento en franjas 9/14/19 h locales). Para un aviso nuevo, sumarlo en `_buildPushAvisos`, sin tocar el Worker. Diagnóstico en Configuración → Textos (`pushEstadoRender`, `LS.PUSH_ESTADO`, botón `pushProbar`: notificación local + `POST /ping`). Re-sync con retardo tras cada cambio (`schedulePushSync`, en `setH`/`setNotes`); suscripción perdida se rehace al abrir (`initPush`). Invitación a activarlos en la campanita (`pushCtaHTML`). Ver `test/push-avisos.test.cjs`.

**Tocar la notificación lleva al lugar exacto** (v238, `irDestino` en `js/core.js`): el `go` del aviso, además de la pestaña, puede ser `agenda:YYYY-MM-DD[:idNota]` (`irAgendaDia`: la Agenda en ese día, en la vista elegida, con la nota resaltada), `hist:<id>` (`goToHistoryEntry`; un solo seguimiento/vencido) o `historial:seg|venc` (`irAvisosHistorial`: avisos desplegados y el banner resaltado; varios a la vez). El Worker valida con `GO_RE`/`goValido` y arma el de seguimiento/vencimiento con `goAvisos`; una app vieja que no entienda el destino abre igual. Ver `test/push-destino.test.cjs`.

**Notificaciones a medida (v239)**: la app arma TODO lo que suena (también seguimientos y vencidos: `followups`/`expiries` viajan vacíos y la lógica de franjas del Worker queda solo para apps viejas). (1)

**Horarios** en la config de seguimiento (`pushHoraResumen`, `pushHoraNoche`, `pushAntesMin` ∈ `PUSH_ANTES_OPC`, `pushSilencio` = días 0–6; `_pushHorarios`; UI con chips `pushAntesSet`/`pushSilToggle`/`pushHorariosRender`). (2)

**Resumen del día** (`hoy:`): Agenda + seguimientos + vencidos en una sola notificación. (3)

**Cadencia**: un seguimiento/vencido entra el día que toca y una vez más a los `PUSH_REPITE_DIAS` (7); lo que cae en un día de silencio pasa al resumen siguiente (`_pushToca`). Antes repetía todos los días. (4)

**Botones** (`acts`, dos como mucho): "Cómo llegar"/"WhatsApp" (`_pushFuente`/`_pushActUtil`) + "Posponer 1 h". El Worker valida las URLs (`actsValidos`, solo Maps y wa.me) y el SW las revalida; "Posponer" hace `POST /posponer {deviceId, k}` y el Worker re-agenda ESE aviso guardado (no acepta texto) en `pospuestos`, que `/subscribe` conserva. `PUSH_WORKER_URL` está repetida en `sw.js` (el test la compara). (5)

**Clima con la app cerrada**: el aviso de la noche lleva `clima: {d, pts}` (coordenadas a 2 decimales) y el Worker consulta Open-Meteo con los umbrales de la app (`climaMotivo`); `soloSiClima` = sale solo si está feo (Agenda apagada o noche en día de silencio). (6)

**Lunes** (`_pushSemanaLineas`): la semana, lo que espera respuesta y el tope (≥ 80 %, `factTotalAnual`). Ver `test/push-v239.test.cjs`.

**Se leen sin abrir la app (v240)**: Android despliega el texto entero, así que cada renglón dice qué, dónde y cuánto (`_pushDetalleEv`: "🌳 García — Eucalipto y Pino · Av. Mitre 1234 · $ 450.000 · día 1 de 2"; especies con `_pushQueTrabajo`, dirección legible con `_pushLugar` —nunca coordenadas, Plus Codes ni links—), los trabajos primero (`PUSH_ORDEN_TIPO`: el primer renglón es lo que se ve sin desplegar), seguimientos y vencidos con número, monto y antigüedad (`_pushLineasPres`), y el recordatorio con hora dice con quién en el título y qué/dónde en el cuerpo (`_pushHoraCuerpo`). El Worker suma el pronóstico **siempre** (`climaLinea`: "☀️ 14–24 °C · sin lluvia — García"; si está feo va primero con ⚠️), también al resumen de la mañana, y junta los trabajos de la misma zona en una consulta. Cuerpo hasta `MAX_BODY` (900) recortado por renglones (`recortarRenglones`/`_pushRecortar`) y `payloadDe` lo achica hasta `MAX_PAYLOAD_BYTES` (el push no admite más de ~4 KB). Ver `test/push-detalle.test.cjs`.
