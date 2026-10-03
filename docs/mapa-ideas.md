# Mapa — análisis e ideas (2026-10-03)

> Estado: **solo análisis**. Nada implementado todavía.
> Base: lectura de `js/mapa.js` (v230) y 5 capturas del uso real.
> Próxima sesión: empezar por los puntos 1, 2 y 3.

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
