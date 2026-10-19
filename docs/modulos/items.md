# js/items.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/items.js`

Ítems del presupuesto (árbol/servicio/nota), recargo, escenarios A/B.

**Tarjeta del árbol** en el orden en que se piensa el trabajo: Especie → Trabajo a realizar → Precio (v227).

**Precio sugerido** (`ultimoPrecioEspecie`/`precioSugSync`): debajo del precio vacío, el último precio cobrado por esa especie (por fecha de emisión, sin tildes ni mayúsculas, precio de base sin recargo; si el presupuesto abierto tiene recargo se le aplica) con botón "Usar".

**Nunca se carga solo**: el precio depende de cada árbol.

**Lista vacía** (`itemsVacioSync`, clase `.is-vacio` en `#section-normal-items`, v228): sin ningún ítem en el escenario activo se ve "+ Árbol / Trabajo" (ancho, 52 px); "+ Servicio", "+ Nota" y los servicios rápidos aparecen con el primer ítem ("sería muy raro que anote un servicio antes de algún árbol"). "Dos opciones en un PDF" se ve siempre (v229, pedido del usuario). Los botones van ANTES de los servicios rápidos. Ver `test/uso-tanda3.test.cjs`.

**Rubro y cobro por unidad** (v241): `S.rubro` (`arbolado`/`jardineria`, lista blanca `RUBROS`) es dato DEL PRESUPUESTO —no está en `CFG_GLOBAL_FIELDS`, viaja en el snapshot, `migrateState` lleva lo viejo a `arbolado` y `resetToNewQuote` arranca en arbolado— y es ortogonal al modo (un cerco también se cotiza por foto). Se elige con los chips de "Cliente y lugar" (`setRubro`/`rubroSync`; NO junto al selector de modo: arriba de todo empujaba "+ Árbol / Trabajo" debajo de la barra en la etapa Trabajos del celular, lo vigila `uso-tanda3`). `esJardineria(st)` es false en riesgo (el informe ISA es de un árbol). En jardinería el documento usa `docTitleJard`/`docTitleEstJard` (config global, Empresa → Textos del PDF; `_docTituloHTML`), saca `plan` y `criteria` (y en el estimativo el plan y los factores), y la columna dice "Planta / Sector"; el encabezado (`coSubtitle`) no cambia. En el editor, `#panel-editor.is-jardineria` esconde lo marcado `.rub-arb` y muestra `.rub-jar`.

**Cobro** del ítem `tree` (`item.unidad` ∈ `ITEM_UNIDADES` = `m`/`m2`/`jornada`, leído SIEMPRE con `itemUnidad()`; sin unidad = precio cerrado "a ojo" como siempre): `itemTotalCents` = precio × `itemCant` (decimales y coma), el PDF desglosa con `_trabajoPrecioCellHTML` ("40 m × $ 3.000"), el sugerido compara solo la misma unidad (`ultimoPrecioEspecie(sp, unidad)`) y el conteo de árboles del banner ignora jardinería y unidades. El selector de cobro aparece en jardinería o si el ítem ya tiene unidad (nunca un multiplicador escondido). Ver `test/jardineria.test.cjs`.

**Tarjeta del servicio** (v257): la fila de cantidad, su texto "3 × $X = $Y" y su cableado salen de `_servicioQtyRowHTML`/`_servicioQtyTxt`/`_wireServicioQty`, compartidas por el presupuesto normal y el estimativo (prefijo de clases `''`/`'est-'`); estaban copiadas y el bug de la cantidad que no se podía borrar estaba dos veces. Ver `test/cantidad-servicio.test.cjs`
