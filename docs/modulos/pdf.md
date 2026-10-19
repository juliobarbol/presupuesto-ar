# js/pdf.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/pdf.js`

`buildDoc`/`buildEstDoc`/`buildRiskDoc` (documento para imprimir/PDF), `printDoc`.

**Piezas comunes** (v257) de los cuatro documentos (con el recibo): `_docEnvoltura(theme, color, cabecera, cuerpo)` (la `<table class="pdoc">` cuyo `<thead>` el navegador repite en cada hoja), `_docContactos()` y `_docRecordarAutocompletar()` (cliente y especies para el autocompletar, una vez en `buildDoc`, con las diferencias de cada modo).

**Sección "Cómo pagar"** (`_buildPagoHTML`): los datos de cobro del titular (`S.coAliasPago`/`S.coCbu`/`S.coAliasTitular`/`S.coBanco`, cargados en Empresa → Mi negocio; el CUIT se reusa de `S.coCuit`). Es config del negocio, no del presupuesto — por eso no se tipea en cada trabajo, a diferencia de `paymentConditions`. Sin alias NI CBU devuelve `''` y no se dibuja — titular y banco solos no sirven para pagar. Está en `DOC_SECTIONS` como `pago` (reordenable, entra después de `payment`) y también se inserta a mano en los modos estimativo y riesgo, que arman su HTML sin el mapa de secciones.

**No va en el recibo**: ahí el pago ya ocurrió.

**Sección "Disposición de leña y residuos"** (`_buildDispoHTML`): dónde se acordó con el cliente dejar la leña y los restos (`S.dispoNota` + `S.dispoPhotos`, sección `esec-dispo` del editor). Es dato del PRESUPUESTO (cambia en cada trabajo, va en `migrateState` para que un snapshot viejo no herede el del presupuesto abierto), a diferencia de "Cómo pagar". Se acuerda señalando en el terreno y el trabajo se hace semanas después, a veces con otro del equipo: por eso la foto. `S.dispoEnDoc` decide si sale en el documento del cliente o queda solo como recordatorio del podador.

**Va DESPUÉS del Registro Fotográfico**, al pie (antes de las firmas / del saludo en estimativo): es el dato menos importante de la hoja y no puede empujar para abajo las fotos de los árboles, que son las que el cliente mira. Por eso NO está en `DOC_SECTIONS` — esas secciones son las del cuerpo y todas caen arriba de las fotos, justo lo contrario de lo que hace falta acá. Se inserta a mano en los tres modos. Ver `test/dispo-lena.test.cjs`
