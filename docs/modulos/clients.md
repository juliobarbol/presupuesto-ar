# js/clients.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/clients.js`

DBs de clientes, especies y servicios (autocompletar).

**Mis servicios** (`MISSVC_KEY`, `pq_mis_servicios`): las tarifas PROPIAS —lo que el usuario cobra cuando un colega lo llama a trabajar (jornada de trepador, hora de motosierra)—, con `precio` y `unidad` (`MISSVC_UNIDADES`). No confundir con la DB de servicios, que son costos de terceros DENTRO de un presupuesto (camión, volquete). Se cargan en Empresa → Mis servicios y alimentan el alta de trabajos sin presupuesto (colaboraciones y trabajos directos)
