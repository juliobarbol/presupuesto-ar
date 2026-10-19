# js/nav.js

> Detalle del módulo con el porqué de cada decisión, movido textual desde
> CLAUDE.md (que quedó como mapa corto). Leelo antes de tocar este código.

## `js/nav.js`

**Botón "Atrás" del teléfono.** Antes la app no lo escuchaba y en Android cerraba la app entera con una ventana abierta. Regla: con algo abierto encima, "Atrás" lo cierra; en otra pestaña, vuelve al Editor; en el Editor, sale. Cada cosa abierta apila una entrada (`history.pushState`) y una capa en `_navCapas`; `popstate` cierra las de arriba. Las ventanas se detectan solas con un `MutationObserver` (clase `open` de los overlays de `NAV_OVERLAYS` y los `.csel-pop`/`.cal-pop` montados en `<body>`): **al sumar un overlay nuevo, agregarlo a `NAV_OVERLAYS`** con su función de cierre. Cerrar por la UI consume la capa con `history.back()`.

**Solo se apila con gesto** (`navigator.userActivation`): Chrome marca "salteable" la entrada de una página que apila sin gesto, y "Atrás" saltearía la app entera. La pestaña es UNA capa (`_navTab`, llamado desde `switchTab`). Ver `test/navegacion.test.cjs`.

**Teclado** (`navTecladoInit`, solo pantallas táctiles): enfocar un campo de texto pone `body.is-typing`, que en el celular esconde las pestañas de abajo y baja la barra de totales.

**Pestañas abajo en el celular** (v227, bloque "CELULAR" al final del `<style>`, `max-width:600px`): `#tabs` va al pie de `#app` por `order` (sigue en el flujo, no tapa nada) y `--tabbar-h` es su alto; la barra de totales, el FAB de "subir" y `#toast-container` se apoyan encima con ese valor. En la compu siguen arriba. Ese mismo bloque pone el piso de toque (44 px en la barra de arriba, 40 px en `.btn-sm`) y de letra (12,5–13 px) de la UI; el PDF no se toca. Ver `test/uso-tanda3.test.cjs`.

**Gestos y botones del teléfono** (v235): (1)

**Swipe entre pestañas** (`setupTabSwipe` en `js/core.js` → `_swipeTab`/`_swipeVecina` en `js/ui.js`, orden `TAB_ORDER`, nombres `TAB_LABELS`): la pantalla acompaña al dedo, una pastilla (`#tab-swipe-hint`) dice a dónde va y vibra corto al pasar el umbral (`haptic()`). Se escucha en `#main` **y en `#tabs`** (en el Mapa la pantalla entera es el mapa y la barra es la única superficie libre). Estuvo muerto desde la v225: el gesto se llamaba `_navTab(dir)` y la función del botón Atrás `_navTab(name)` lo pisaba (ámbito global, la segunda declaración gana sin error). **`test/gestos.test.cjs` falla si hay dos funciones globales con el mismo nombre.** (2)

**Tecla "Siguiente" del teclado** (`navSiguienteInit`): en Editor y Configuración, Enter en un campo de una línea pasa al próximo campo visible (pone `enterkeyhint` next/done); respeta a quien ya hace `preventDefault`, no toca áreas de texto ni otras pantallas (las notas de la Agenda guardan con Enter). (3)

**Visor de fotos** (`pvGestosInit`, estado `PV`): pellizcar (hasta 5×), doble toque 2,5×, arrastrar con zoom, deslizar arriba/abajo para cerrar; un toque sin zoom cierra como siempre. (4)

**Accesos directos del ícono** (manifest): Nuevo, Historial, Agenda y Mapa (`irDestino`). Los campos de texto **no** bloquean el swipe (v236: en el Editor casi toda la pantalla son campos y el gesto que arrancaba sobre uno no hacía nada); lo corta estar escribiendo (`is-typing` o el campo enfocado) y el `input[type=range]`. **v236:** (5)

**Swipe sobre el calendario** de la Agenda (`calSwipeActivo`/`calSwipeLabel`/`_swipeCal`, modo `'cal'` de `setupTabSwipe`): en Mes y 3 días, deslizar sobre `#agc-grid` pasa de mes / de días (pastilla con el destino); en Semana (columnas que ya se desplazan) y en la lista sigue cambiando de pestaña. (6)

**"Tocá Atrás de nuevo para salir"** (`navSalirInit`, solo táctil): capa `t:'salir'` al FONDO de `_navCapas`, armada en el `pointerup` (antes del click) cuando el Editor está sin nada abierto; al consumirla avisa y no se rearma por `NAV_SALIR_MS`, así el segundo "Atrás" sale. (7)

**Cerrar ventanas deslizando hacia abajo** (`navHojasInit`, lista `NAV_HOJAS`, rayita `.hoja-desliza::before`): cierra con la misma función de `NAV_OVERLAYS`; no arranca sobre campos ni si el contenido está scrolleado. Fuera: confirmación, vista previa y visor de fotos. Ver `test/gestos.test.cjs`
