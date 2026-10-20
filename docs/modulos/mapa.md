# js/mapa.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/mapa.js`

Mapa de presupuestos (ubicación, "Sin ubicar", zonas).

**Fondo (tiles) bajo demanda**: los tiles de OSM son decenas de pedidos por pantalla, así que `_mapaAddTiles` no los pide si `netPuedeAuto()` dice que no — el mapa se abre igual (pins y zonas son locales) con el aviso `#mapa-neti` y "Cargar el fondo igual" (`mapaCargarFondo`). Ese cartel tiene que poder APAGARSE: `.mapa-neti{display:flex}` le gana a la regla `[hidden]` del navegador, y sin `.mapa-neti[hidden]{display:none!important}` quedaba clavado diciendo "sin datos" con el fondo ya cargado atrás (y dibujaba una franja amarilla vacía aun con la red sana). Se apaga por tres caminos: al poner el fondo, al reentrar a la pestaña con `_mapaTiles` ya puesto, y desde `netRenderEstado()` si la red se recupera con el usuario parado en el Mapa. Ver `test/mapa-fondo-aviso.test.cjs`.

**Pins cercanos agrupados** (v231, `_mapaAgruparCercanos` → `mapaZonaMarker`): `mapaRefresh` arma los grupos del MISMO punto en `_mapaPuntos` y `_mapaDibujar` (en cada `zoomend`) junta los que caen a menos de `MAPA_GRUPO_PX` (46 px) en un círculo con la cantidad de trabajos; tocarlo acerca (`mapaAcercarGrupo`). Desde el zoom `MAPA_GRUPO_HASTA_Z + 1` (17) no se agrupa. Grilla propia, sin `Leaflet.markercluster`. El grupo del mismo punto ("N trabajos en este lugar") no cambia. Las stats de zona cuentan cada punto del círculo por su ubicación real (`m._puntos`).

**Vista a pantalla completa**: `#mapa-vista` ocupa el alto de `#main` (con `:has` sobre el `.inner`), filtros plegados detrás de "Filtros" con contador (`mapaFiltrosToggle`/`mapaFiltrosSync`) y atajos de fecha (`MAPA_PERIODOS`, `mapaPeriodo`; después de escribir `.value` hay que llamar `syncCdate`, el datepicker propio dibuja su etiqueta aparte), franja de zona ENCIMA del mapa y atajo "Sin ubicar" en la barra.

**Última vista** (`LS.MAPA_VISTA`, fuera del backup, `_mapaVistaLeer` valida): el mapa abre donde se dejó; la primera vez encuadra el núcleo (`_mapaNucleo`: corta en 4× la distancia mediana, piso 5 km, solo si lo de afuera es ≤ 1/4). Ver `test/mapa-agrupar.test.cjs`.

**Colores de los pins** (v232): paleta PROPIA `MAPA_PIN_COLORS` (`mapaPinColor`), tonos vivos; `ESTADO_COLORS` no se toca (Historial y chips). Antes el pin usaba el color de TEXTO del chip y tres estados oscuros se confundían sobre el verde. Símbolo blanco (`MAPA_PIN_SIMBOLO`): ✓ en realizado, ojo en "Ir a ver".

**Enviado vencido = pin hueco** (`mapaEsVencido`: enviado con `dateExpiry` pasada; "vence hoy" sigue vigente). Es un dato del presupuesto, no un aviso: NO mira `vencimientoVistoEn` ni la config del seguimiento.

**Conversión de zona** (v233, reescrita en v259): dos cifras con nombre propio, en un renglón aparte (`.mapa-zona-conv`). La principal es **Aceptados: N de M enviados** (aceptado + realizado sobre enviado + aceptado + realizado + perdido; borrador, "Ir a ver" y control en sitio no son presupuestos mandados): es la cuenta que el usuario hace de cabeza, y una sola "Conversión: 57%" se leía como "me aceptan 57 de cada 100" cuando el reporte calculaba 26/58 = 45%. Al lado, en gris, **de los respondidos** (la tasa de cierre: sobre aceptado + realizado + perdido + enviados VENCIDOS; se omite si coincide con la principal) y **N esperando respuesta** (enviados vigentes). El vencido cuenta como no ganado porque casi nadie marca "perdido": la v232 lo sacaba y una zona con 20 vencidos y 0 perdidos daba 100%. Con menos de `MAPA_CONV_MIN` (5) casos no se muestra el porcentaje, solo la fracción: "1 de 1" da 100% y se leía como "aceptan todos" (captura del reporte). Para que la cifra de respondidos se apoye en datos y no en la suposición, el banner de vencidos pregunta "¿Qué pasó?", y la franja lleva el atajo "N vencidos sin respuesta ›" a la lista de los vencidos de la zona (v260, ver `docs/modulos/seguimiento.md`). Los chips de la franja llevan el punto del color del pin (son la leyenda) y dicen cuántos enviados están vencidos.

**Tramos de ruta** (`_mapaRutaTramos`/`_mapaRutaUrl`, `MAPA_RUTA_INTERMEDIAS` = 3): Google Maps URLs acepta 3 paradas intermedias en el navegador del celular (9 en el resto) y con más corta la ruta sin avisar. Tramos de hasta 4 paradas; cada uno arranca en la última del anterior. `mapaArmarRuta` ("Cerca mío") los lista en `#mapa-tramos`; `rutaDelDiaMaps` (banner de hoy) los ofrece en un `toastAccion`.

**"Cómo llegar" abre la RUTA** (v234, `mapsDirUrlFor`, `js/history.js`): `comoLlegar` (historial, mapa, banner de hoy) y `calOpenNoteMap` (visitas y notas de la Agenda) abren `maps/dir/?api=1&destination=…` sin `origin`, así Maps sale con el camino cargado desde el teléfono, aunque sea un solo trabajo. Antes abrían la búsqueda del lugar y había que tocar "Cómo llegar" otra vez adentro de Maps. Un link completo de Maps se abre tal cual. `mapsUrlFor` (búsqueda) sigue para "Probar" la ubicación y para compartir. Ver `test/mapa-estados.test.cjs`
