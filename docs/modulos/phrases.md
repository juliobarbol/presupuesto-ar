# js/phrases.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/phrases.js`

Biblioteca de frases reusables.

**Placeholder `[especie]`**: las frases de descripción vienen con `[especie]` adentro ("Extracción de [especie] hasta lo más bajo…"); al insertarlas se reemplaza por la especie **de esa tarjeta** (`_speciesOfTargetEl` lee el `.sp-f` del `.icard` del textarea destino), así que con varios árboles distintos cada uno recibe la suya. `speciesForPhrase` pega varias especies como "A, B y C" (pegadas con coma no se leen como frase). Sin especie cargada el corchete **queda intacto** —es el recordatorio de que falta— y se completa al salir del campo Especie/s (`_fillSpeciesInCard`, en `blur` y no en `input`: tipeando "Euc" el reemplazo se comería el corchete a medio escribir). La frase de la biblioteca nunca se modifica: sigue guardada con `[especie]` para el próximo árbol. Ver `test/especie-frase.test.cjs`.

**Huecos que no se pueden completar solos** (`[X]` de altura, `[localidad]`): no hay dato de dónde sacarlos —la altura de corte se acuerda en el momento y la localidad vive dentro de una dirección de texto libre— y adivinar pondría un número equivocado en el PDF, peor que el corchete. Se atacan las dos puntas del olvido: al insertar, el hueco queda **seleccionado** en el campo (`PLACEHOLDER_RE_1` + `setSelectionRange`) para reemplazarlo tipeando encima; y al salir el presupuesto (`printDoc`, `sendCurrentWhatsapp`) `confirmarHuecos()` avisa qué quedó y dónde, sin bloquear ("Imprimir igual"). `huecosPendientes()` mira SOLO lo que imprime el modo activo (el estimativo no saca observaciones ni condiciones de pago: avisar por ellas sería un falso positivo que enseña a ignorar el cartel). Los dos caminos de salida quedaron partidos en `_printDocGo`/`_sendCurrentWhatsappGo`, y el `window.open` de WhatsApp corre en el toque de "Enviar igual" para no perder el permiso de ventana. Ver `test/huecos-plantilla.test.cjs`
