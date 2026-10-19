# js/clima.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/clima.js`

Pronóstico (Open-Meteo, sin API key) para los trabajos agendados: cache versionado en `LS.CLIMA` (TTL 3 h, `CLIMA.VER`), fetch por zona (`_climaFetchZonas`/`climaRefresh`/`climaEnsureZona`). Muestra **lluvia + viento fuerte (ráfaga, peligro en altura) + índice UV** en el chip (`climaChipHTML`, color por prioridad lluvia>viento>UV) en Agenda/banners/Historial (`climaChipForEntry`).

**Tira de 7 días** en el diálogo de agendar para elegir buen día (`agendaClimaRender`/`agendaClimaPick`).

**Recomendaciones del día** en el banner de hoy (`climaRecomendaciones`: lluvia/viento/UV/temperatura).

**Aviso** de lluvia/viento hoy/mañana (`_climaAvisar`/`_climaToast`: toast accionable que lleva al presupuesto —o a la Agenda si son varios— y ofrece **reprogramar por WhatsApp** `climaReprogramarWhatsApp`; gate diario en `LS.CLIMA_WARN`).

**Panel de detalle** al tocar cualquier chip o el botón "Clima" del aviso (`climaOpenDetail`/`_climaDetailRender`, overlay `#clima-overlay`): día completo en tarjetas (lluvia/viento/UV/térmica), **hora por hora** de las próximas 72 h (clave `hours` del cache, `forecast_hours=72`), recomendaciones, tira de días para comparar y reprogramar por WhatsApp.

**Refresco manual** (`climaForceRefresh` + botón "Actualizar" en el pie del panel, junto a la edad del dato): todos los caminos automáticos respetan el TTL de 3 h, así que dentro de esa ventana no vuelven a pedir nada y el panel se queda diciendo "hace 2 h" sin salida. `_climaFetchZonas(zonas, { force:true })` es el ÚNICO camino que saltea el TTL y solo lo usa ese botón; refresca todas las zonas próximas de una vez (chips, banner e historial quedan al día) y avisa si no hay señal. Ver `test/clima-refresh.test.cjs`.

**Compartir el pronóstico** con los compañeros de trabajo (`climaResumenLineas` → texto plano; `climaShareTexto`/`climaCompartir` para el botón "Compartir" del pie del panel, y el mismo resumen se suma al `_calShareText` de las tarjetas de la Agenda): el que sube al árbol y el colega que da una mano necesitan saber cómo viene el día. Todo sale del cache (anda sin señal, que es cuando hay que coordinar) y sin dato el botón no se dibuja — mandar "no sé cómo va a estar" no es compartir el clima. El viento y el UV entran con el mismo umbral que el chip (`WIND_CHIP`/`UV_CHIP`): una brisa de 12 km/h y un UV 2 son ruido que enseña a no leer el mensaje. La franja horaria fea (`_climaFranjasTxt`, rangos agrupados "de 11 a 13 y a las 17 h") solo va en el mensaje del panel, que es el único que tiene las `hours`. A diferencia de "Reprogramar" (para el cliente, solo si el día pintó feo), "Compartir" sale también en los días lindos: "el jueves está bueno, dale que vamos" coordina igual que el aviso de lluvia. Ver `test/clima-compartir.test.cjs`. Coordenadas vía `entryLatLng` del mapa, fallback al centroide de la zona
