# Mapa — análisis e ideas (2026-10-03)

> Estado: **puntos 1, 2, 3 (v231), 4, 5, 9 y 10 (v232; conversión corregida en v233) implementados**. Quedan 6, 7 y 8.
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

## Hecho en la v232 (puntos 4, 5, 9 y 10)

- **4. Enviados vencidos.**
  - Pin hueco: relleno blanco y anillo del color (`mapaEsVencido`).
  - Criterio: enviado con `dateExpiry` pasada. "Vence hoy" sigue vigente.
  - No mira `vencimientoVistoEn`. Descartar el aviso no vuelve vigente al presupuesto.
  - Conversión por zona (corregida en la v233): aceptado + realizado sobre aceptado + realizado + perdido + enviados vencidos.
    - La v232 dejaba afuera a los vencidos. En el uso real casi nadie marca "perdido": una zona con 20 vencidos y 0 perdidos daba 100%.
    - El enviado vigente sigue afuera: todavía puede aceptarse.
    - La franja muestra la fracción: "Conversión: 55% (12/22)".
  - La franja dice "Enviado 3 · 1 vencido".
- **5. Colores y símbolos.**
  - Paleta propia `MAPA_PIN_COLORS`. `ESTADO_COLORS` quedó igual.
  - ✓ en realizado. Ojo en "Ir a ver".
  - Borde blanco de 3 px y sombra doble.
  - Los chips de la franja llevan el punto del color del pin: son la leyenda.
  - Pendiente: probar al sol con el celular real.
- **9. Límite de paradas.**
  - Verificado en la documentación de Google: 3 paradas intermedias en navegador de celular, 9 en el resto.
  - Tramos de hasta 4 paradas. Cada tramo arranca en la última parada del anterior.
  - "Cerca mío": lista de tramos en el panel.
  - "Ruta del día" del banner: aviso con un botón por tramo. Tenía el mismo problema.
- **10. Barra de totales.** El arranque la muestra solo si el Editor sigue activo.
- Test: `test/mapa-estados.test.cjs` (19 checks). El check de la barra falla sin el arreglo.

## Siguientes pasos (recomendación)

### Tanda 5: ubicar lo que falta (punto 7)

- "Estoy acá" en cada fila de "Sin ubicar".
  - Reusa la geolocalización de `mapaCercaMio`.
  - Guarda `e.geo` con `manual: true`, igual que `mapaOnMapClick`.
- El atajo "Sin ubicar N" de la barra ya hace visible la lista. Sube el valor de este punto.
- Búsqueda de dirección: dejar para después. Necesita un servicio externo (Nominatim) y su política de uso.

### Tanda 6: el día de trabajo (punto 6)

- Los tramos del punto 9 ya están. La ruta del día los reusa.
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

### Ideas nuevas

- **Botón "Ver todo"** sobre el mapa. Con la última vista guardada, el usuario puede quedar lejos de sus pins. Un toque encuadra todos los pins del filtro.
- **Calibrar con el uso real** el radio de 46 px y el corte del zoom 17. Revisar con el historial real del celular.
- **Recordar los filtros** (estado y período) como la vista. Hoy vuelven a "Todo" al recargar.
- **Tramos de 10 paradas en la app de Maps.** Si el link abre siempre en la app de Google Maps del teléfono, el límite es 9 intermedias. Probar en el celular real antes de subir `MAPA_RUTA_INTERMEDIAS`.
