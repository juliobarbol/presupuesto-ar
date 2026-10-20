# js/ayuda.js — Configuración → Ayuda

> Detalle del módulo con el porqué de cada decisión. Leelo antes de tocar este código.

## `js/ayuda.js`

**Para qué** (v261): la app se la pasan a colegas que no tienen a quién preguntarle. La ayuda es un índice de lo que hace cada pestaña, con buscador y **"Llevame ahí"**: el artículo te lleva al lugar de la pantalla del que habla y lo hace destellar (`_irFlash`, el mismo destello de la campanita). Vive en la quinta subpestaña de Configuración (`#subpanel-ayuda`, `switchSubtab('ayuda')` → `ayudaRender`).

**Contenido estático en el JS** (`AYUDA`, `AYUDA_GLOSARIO`, `AYUDA_GRUPOS`): anda sin señal y viaja con la versión. El formato de cada artículo está comentado arriba del archivo. El texto se escapa con `esc()` y solo después se convierte `**negrita**`. Los ids van en `onclick`, así que son `[a-z0-9-]` (lo valida el test).

**Buscador** (`ayudaBuscar`): sin tildes ni mayúsculas (`_ayudaNorm`), plural → singular a lo bruto (`_ayudaRaiz`: "enviados" encuentra "enviado"), palabras de relleno fuera (`AYUDA_VACIAS`: "botón", "pestaña", "dónde"…) y sinónimos del día a día (`AYUDA_SINONIMOS`: laburo, mandar, plata, celu…). Pesos por campo: título 6, palabras clave 4, grupo 3, texto 1. El título de un término del glosario pesa 3: quien busca "enviados" quiere el artículo de los estados, y la definición sale igual, debajo. Todas las palabras tienen que aparecer; si así no hay nada, alcanza con alguna y se avisa ("lo más parecido"). El mejor resultado se abre solo.

**"Llevame ahí"** (`ayudaIr`): `ir.sel` es una lista y gana el primero que esté a la vista. El último es el respaldo y tiene que existir siempre. Si ganó otro que no es el primero y hay `ir.nota`, se avisa por qué (otro modo, todavía no hay vencidos). `ir.sec` abre la sección en las vistas Fichas y Etapas (`_ayudaAbrirSeccion`); `ir.cs` despliega una sección plegable de Datos; `ir.avisos` despliega los avisos del Historial. **Nunca cambia el modo del presupuesto ni abre diálogos**: la ayuda muestra, no toca datos. Un `<select>` reemplazado por el desplegable propio queda de 1 px e invisible: destella su botón (`_ayudaLoQueSeVe`).

**`ayudaVer(id)`** abre un artículo desde cualquier lado: hoy lo usan los "Ver también"; sirve para sumar "?" de contexto en cada pantalla.

**Que no quede vieja**: una feature nueva o cambiada actualiza su artículo en el mismo cambio (paso de la skill `nueva-feature`). `test/ayuda.test.cjs` recorre todos los "Llevame ahí" (cada uno tiene que abrir su pestaña y hacer destellar algo) y todos los "Ver también", y prueba búsquedas reales.

**Cinco subpestañas a 360 px**: con el ícono, "Negocio" salía cortado. Debajo de 440 px las subtabs van sin ícono (`components.css`).
