# Mapa — análisis e ideas (2026-10-03)

> Estado: **puntos 1, 2 y 3 implementados (v231, 2026-10-04)**. El resto sigue en análisis.
> Base: lectura de `js/mapa.js` (v230) y 5 capturas del uso real.
> Próxima sesión: ver "Siguientes pasos" al final.

## Qué funciona

- Pins con el color del estado del presupuesto.
- Mismo punto agrupado en "N trabajos en este lugar".
  - Muestra la `-v2`. Oculta el original reemplazado.
- Estadísticas por zona.
- "Cerca mío" (15 km) con ruta de Google Maps.
- Fondo (tiles) no se pide sin señal (`netPuedeAuto()`).
- Botones "Ver" y "Llegar" grandes en el globo del pin.
- Cambio de estado desde el pin.

## Hallazgos del uso real (capturas)

1. **Pins encimados.** En Sierras Chicas, a zoom de provincia, los pins forman una mancha.
   - Un grupo "3" queda tapado por otros pins.
   - Causa: `mapaRefresh` agrupa solo el MISMO punto (`toFixed(5)`). No agrupa pins cercanos.
2. **Abre a zoom de provincia.** El `fitBounds` inicial incluye todos los pins.
   - Los pins lejanos (Jesús María, La Falda, Malagueño) alejan la vista.
   - La zona de trabajo diario queda chica.
3. **Estadísticas de zona invisibles.** Quedan debajo del mapa.
   - Sin scroll no se ven nunca.
4. **Colores oscuros confundibles.** Sobre un mapa verde y al sol se mezclan:
   - realizado `#065f46`
   - por_ver `#155e63`
   - borrador `#475569`
   - Causa: `mapaMarker` usa el color de TEXTO de `ESTADO_COLORS`.
5. **"Enviado" vencido igual a "Enviado" nuevo.** Ejemplo: Felipe, enviado 08/08.
   - La conversión por zona (`mapaUpdateZonaStats`) cuenta `enviado` como decidido.
   - Eso baja la conversión con presupuestos todavía abiertos.
6. **Filtros ocupan un cuarto de pantalla.** Le quitan alto al mapa.

## Lista priorizada

1. **Agrupar pins cercanos según el zoom.**
   - Círculo con la cantidad. Tocar el círculo acerca el zoom.
   - Mantener el grupo actual del mismo punto ("N trabajos en este lugar").
   - Evaluar: grilla propia por píxel vs. `Leaflet.markercluster` (cdnjs, a `VENDOR_LAZY`).
2. **Mapa más grande.**
   - Filtros detrás de un botón "Filtros" (con contador de filtros activos).
   - Atajos de fecha: "Este mes", "Últimos 3 meses", "Este año".
   - Franja de resumen de zona ENCIMA del mapa (no debajo).
3. **Abrir en la última vista.**
   - Recordar centro y zoom (clave nueva en `LS`, fuera del backup, como `LS.CAL_VIEW`).
   - Primera vez: `fitBounds` sin los pins aislados (ej. percentil de distancia).
4. **Enviados vencidos con pin hueco o claro.**
   - Conversión por zona: contar solo presupuestos decididos (aceptado, realizado, perdido).
5. **Colores más distintos + símbolo dentro del pin.**
   - ✓ en realizado. Ojo en "Ir a ver".
   - Borde blanco más grueso.
   - Verificar contraste al sol.
6. **"Ruta de hoy".**
   - Trabajos y visitas de hoy, en orden de hora.
   - Visitas en el mapa (notas de Agenda con `tipo:'visita'`), en azul (`--c-visita`).
7. **"Estoy acá" para ubicar presupuestos "Sin ubicar".**
   - Usa la ubicación del teléfono.
   - Opcional: búsqueda de dirección bajo demanda (con `netFetch`).
8. **Guardar los tiles ya vistos para usar sin señal.**
   - La política de OSM permite guardar tiles vistos.
   - La política de OSM prohíbe la descarga masiva.
   - Caché propia en el SW, con tope de tamaño.
9. **Límite de paradas de Google Maps.**
   - En la web: 9 paradas como máximo (`mapaArmarRuta` no lo controla).
   - Partir la ruta en tramos o avisar.
10. **Carrera de la barra de totales al arrancar.**
    - El init en `js/core.js` muestra `#sticky-totals` sin condición después de los `await`.
    - Si el usuario cambió de pestaña, la barra aparece en otra pestaña.
    - Condicionar al panel activo (Editor).

## Orden propuesto

1. Puntos 1, 2 y 3 juntos: resuelven la mancha, el alto y la vista inicial.
2. Puntos 4 y 5: lectura de estados.
3. Punto 10: arreglo chico, puede ir en cualquier tanda.
4. Puntos 6 a 9: funciones nuevas.

## Funciones de referencia (`js/mapa.js`)

- `mapaRefresh` — arma pins y grupos del mismo punto.
- `mapaMarker` / `mapaClusterMarker` — dibujo del pin y del grupo.
- `mapaUpdateZonaStats` — estadísticas por zona.
- `mapaCercaMio` — radio de 15 km, `PENDIENTES_CAMPO`.
- `mapaArmarRuta` — vecino más cercano, URL de Google Maps con `waypoints`.
- `_mapaAddTiles` / `mapaCargarFondo` — fondo bajo demanda.

## Hecho en la v231 (puntos 1, 2 y 3)

- **1. Pins cercanos agrupados.** Grilla propia, sin `Leaflet.markercluster`.
  - `_mapaAgruparCercanos`: junta los pins a menos de 46 px en pantalla.
  - `mapaZonaMarker`: círculo con la cantidad de trabajos y el anillo de estados.
  - Tocar el círculo acerca el mapa (`mapaAcercarGrupo`).
  - Desde el zoom 17 no agrupa.
  - El grupo del mismo punto ("N trabajos en este lugar") no cambió.
  - Las stats de zona cuentan cada punto por su ubicación real.
- **2. Mapa más grande.**
  - El mapa ocupa el alto de la pantalla.
  - Botón "Filtros" con contador. El panel arranca plegado.
  - Atajos de fecha: Todo, Este mes, Últimos 3 meses, Este año.
  - Resumen del filtro activo debajo del botón.
  - Franja de la zona ENCIMA del mapa. Los chips hacen de leyenda.
  - Atajo "Sin ubicar N" en la barra.
- **3. Última vista.**
  - Centro y zoom en `LS.MAPA_VISTA` (`pq_mapa_vista`). Fuera del backup.
  - Primera vez: encuadre del núcleo (`_mapaNucleo`).
  - Corte: 4 × la distancia mediana, piso de 5 km.
  - Solo descarta si lo de afuera es 1 de cada 4 o menos.
- Test: `test/mapa-agrupar.test.cjs` (22 checks).

## Siguientes pasos (recomendación)

### Tanda 4: lectura de estados (puntos 4 y 5)

Hacer los dos juntos. Tocan las mismas funciones: `mapaMarker` y `_mapaAnillo`.

- Crear una paleta propia del mapa (`MAPA_PIN_COLORS`).
  - No cambiar `ESTADO_COLORS`: la usan el Historial y los chips.
  - El anillo de los grupos, los puntos de los filtros y los pins leen la paleta nueva.
- Enviado vencido: pin hueco (relleno blanco, borde del color).
  - Reusar el criterio de `getExpiredQuotes` (`dateExpiry`, no `enviadoEn`).
  - Respetar `vencimientoVistoEn` y `reemplazadoPor`.
- Conversión por zona: `decididos = aceptado + realizado + perdido`.
  - Revisar `test/trabajo-propio.test.cjs`: afirma textos de la franja.
- Símbolo dentro del pin: ✓ en realizado, ojo en "Ir a ver".
- Verificar contraste con captura a pleno sol (brillo alto, fondo verde).

### Arreglos chicos (puntos 10 y 9)

Van en cualquier tanda. Son bugs, no funciones.

- **10.** Condicionar `#sticky-totals` del init al panel Editor activo.
- **9.** Límite de paradas en `mapaArmarRuta`.
  - Verificar el límite real antes de programar.
  - La documentación de Google Maps URLs dice: 3 paradas en navegador del celular, 9 en el resto.
  - "Cerca mío" (15 km) puede juntar más de 3 pendientes con facilidad.
  - Propuesta: partir en tramos ("Tramo 1 de 3") o avisar cuántas quedan afuera.

### Tanda 5: ubicar lo que falta (punto 7)

- "Estoy acá" en cada fila de "Sin ubicar".
  - Reusa la geolocalización de `mapaCercaMio`.
  - Guarda `e.geo` con `manual: true`, igual que `mapaOnMapClick`.
- El atajo "Sin ubicar N" de la barra ya hace visible la lista. Sube el valor de este punto.
- Búsqueda de dirección: dejar para después. Necesita un servicio externo (Nominatim) y su política de uso.

### Tanda 6: el día de trabajo (punto 6)

- Depende del punto 9: la ruta del día usa el mismo armado de URL.
- Visitas en el mapa: notas con `tipo:'visita'` y ubicación.
  - Hoy las notas no tienen coordenadas resueltas. Revisar qué guarda la nota.
- "Ruta de hoy": trabajos (`fechasTrabajo`) y visitas de hoy, por hora.

### Último: fondo sin señal (punto 8)

Es el de más riesgo. Toca el Service Worker.

- Pedir los tiles con `crossOrigin: true` en `L.tileLayer`.
  - Sin eso la respuesta es opaca. Chrome cuenta cada respuesta opaca como ~7 MB de cuota.
- Caché propia (`pq-tiles`), con tope por cantidad (ej. 2.000 tiles) y borrado de los más viejos.
- El `activate` no debe borrarla (igual que `pq-vendor`).
- Nunca descargar por adelantado: solo guardar lo que ya se vio.

### Ideas nuevas que salieron de esta tanda

- **Botón "Ver todo"** sobre el mapa. Con la última vista guardada, el usuario puede quedar lejos de sus pins. Un toque encuadra todos los pins del filtro.
- **Calibrar con el uso real** el radio de 46 px y el corte del zoom 17. Revisar con el historial real del celular.
- **Recordar los filtros** (estado y período) como la vista. Hoy vuelven a "Todo" al recargar.
