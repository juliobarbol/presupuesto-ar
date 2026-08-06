# Red lenta / sin datos — cómo se defiende la app

> Módulo: `js/net.js` (dentro de `index.html`) + los ajustes del Service Worker.
> Test: `test/net-salud.test.cjs`.

## El problema real

El celular se queda sin datos —saldo agotado, hueco de señal, 2G en el campo—
pero **sigue "conectado"**: la barra marca 4G y `navigator.onLine` devuelve
`true`. Los pedidos salen, nunca vuelven, y todo se siente trabado. No es un
problema de esta app sola: es lo que pasa con todas las aplicaciones del
teléfono al mismo tiempo, peleándose por los pocos kilobytes que pasan.

Antes de v201 la app hacía justo lo peor en ese escenario:

- **Ningún `fetch` tenía timeout.** Un pedido colgado se quedaba esperando sin
  fin. Peor: dejaba trabado el candado del módulo que lo llamó — `CLIMA._fetching`
  quedaba en `true` para siempre y el clima no volvía a funcionar en toda la
  sesión, ni automático ni con el botón "Actualizar".
- **Lo automático salía igual**: pronóstico, copia a Drive, sync de Calendar y
  precarga de la librería de Google, todo compitiendo por el mismo caño tapado.
- **El mapa pedía los tiles de OpenStreetMap** — decenas de pedidos por pantalla,
  lo más caro que hace la app.
- **El Service Worker esperaba 3,5 s** en cada apertura antes de resignarse y
  servir de la cache.

## Qué hace ahora

### 1. Leer lo que el navegador ya sabe

`navigator.connection` (Network Information API, presente en Chrome Android)
informa el tipo de red efectivo, la ida y vuelta estimada, el ancho de banda y
si el usuario prendió "Ahorro de datos". `netEsLenta()` la traduce a un
booleano. Donde la API no existe se asume red sana y manda el punto 2.

### 2. Timeout en todo pedido

`netFetch()` es la **única puerta de salida a internet**: `AbortController` con
corte a los 12 s (25 s si la red ya se declara lenta). Aborta de verdad el
pedido, no solo rechaza la promesa — si no, la descarga sigue viva chupando el
ancho de banda que falta para lo demás.

### 3. Cortacircuitos

Dos fallos de red seguidos y la conexión se marca **caída por 3 minutos**
(`netEstado()` → `offline` / `cortada` / `lenta` / `ok`). Un HTTP 404 o 500 **no**
cuenta: el server contestó, la red anda.

## La regla: automático ≠ manual

| | Gate | Con red mala |
|---|---|---|
| Clima (refresco solo) | `netPuedeAuto()` | no sale |
| Fondo del mapa (tiles) | `netPuedeAuto()` | no se cargan; aviso con "Cargar el fondo igual" |
| `preloadGIS()` | `netPuedeAuto()` | no se precarga |
| Copia a Drive | `netPuedeAutoImportante()` | se pospone (queda `_dirty`) |
| Sync de Calendar | `netPuedeAutoImportante()` | se pospone (queda `_dirty`) |
| **Cualquier botón que toque el usuario** | — | **sale igual** |

Si el usuario toca un botón, se intenta aunque la red esté para el demonio: él
sabrá si le conviene esperar, y un éxito cierra el corte al instante.

### Por qué hay dos gates

`netPuedeAutoImportante()` **ignora `saveData`**. El "Ahorro de datos" de Android
es una preferencia sobre el consumo, no una red rota: si frenara la copia a
Drive, un usuario con esa opción prendida se quedaría sin backup en silencio —
el peor escenario documentado de una app sin backend (ver la sección de
sincronización en `CLAUDE.md`). Al backup solo lo frena una red que de verdad no
está: sin señal, 2G, rtt por el piso o cortacircuitos abierto.

## Service Worker

- **Apertura de la app** (navegación, network-first): el timeout baja de 3,5 s a
  **1,2 s** cuando la red se declara lenta. Es la diferencia entre "tarda un
  montón en abrir" y "abre".
- **Resto de recursos**: cache-first de siempre, pero con red mala **no se
  revalida en segundo plano** — nada de gastar pedidos en fuentes e iconos que
  ya están cacheados mientras el usuario espera otra cosa.
- `fetchWithTimeout` ahora **aborta** el pedido al vencer.

## Lo que el usuario ve

En el topbar, pegado al "✓ Guardado", aparece en ámbar **"Sin conexión" /
"Sin datos" / "Red lenta"**. Se toca y explica qué está pasando, con un botón
**"Reintentar ahora"** que borra el corte y retoma lo pendiente. Al abrirse el
corte salta además un toast, una vez, para que se entienda que la app dejó de
intentar **a propósito** y que eso no la deja rota.

Nada de esto le quita funciones: presupuestar, agendar, ver el historial y
generar el PDF nunca tocaron la red.
