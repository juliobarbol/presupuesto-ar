'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// NET.JS — Salud de la conexión: no pelear contra una red que no está.
//
// El caso real: el celular se queda sin datos pero sigue "conectado" (la barra
// marca 4G, el saldo se acabó o estás en un hueco de señal). Los pedidos salen,
// nunca vuelven, y todo se siente trabado. `navigator.onLine` NO sirve para
// esto: sigue en true — solo detecta modo avión o wifi caído.
//
// Tres piezas, de menos a más importante:
//
//   1. LEER LO QUE EL NAVEGADOR YA SABE (Network Information API,
//      `navigator.connection`): tipo de red efectivo (2g/3g/4g), ida y vuelta
//      estimada, ancho de banda y si el usuario prendió "Ahorro de datos".
//      Chrome Android la trae; donde no exista se asume red sana y manda (2).
//
//   2. TIMEOUT EN TODO PEDIDO (`netFetch`). Es lo que faltaba: sin timeout, un
//      fetch en red moribunda se queda esperando sin fin, y de paso deja
//      trabado el candado del módulo que lo llamó — `CLIMA._fetching` en true
//      para siempre dejaba el clima muerto por el resto de la sesión.
//
//   3. CORTACIRCUITOS: 2 fallos de red seguidos y la conexión se marca CAÍDA
//      por unos minutos. Mientras dure, lo AUTOMÁTICO (clima, copia a Drive,
//      sync de Calendar, fondo del mapa) ni lo intenta.
//
// Regla de oro: automático ≠ manual. Si el usuario toca un botón se intenta
// igual, aunque la red esté para el demonio — él sabrá si le conviene esperar,
// y un éxito cierra el corte al instante. Lo que no se hace es gastarle los
// pocos kilobytes que le quedan en cosas que no pidió.
//
// La app es offline-first: nada de esto le quita funciones. Presupuestar,
// agendar, ver el historial y generar el PDF no tocan la red.

const NET = {
  TIMEOUT_MS:       12000,          // corte normal de un pedido
  TIMEOUT_LENTA_MS: 25000,          // en red declarada lenta, más aire
  FAILS_ABRE:       2,              // fallos de red seguidos que abren el corte
  CORTE_MS:         3 * 60 * 1000,  // cuánto dura el corte
  RTT_LENTA:        1000,           // ms de ida y vuelta: de acá para arriba, lenta
  DOWN_LENTA:       0.12,           // Mbps: de acá para abajo, lenta
  _fails: 0,
  _corteHasta: 0,
  _avisado: 0,                      // timestamp del último toast (1 por corte)
};

function _netConn() {
  try {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  } catch (_) { return null; }
}

// ¿El navegador declara una conexión mala? `saveData` (Ahorro de datos
// prendido) cuenta como tal: el usuario ya pidió que no se gaste.
function netEsLenta() {
  const c = _netConn();
  if (!c) return false;
  if (c.saveData) return true;
  const et = c.effectiveType || '';
  if (et === 'slow-2g' || et === '2g') return true;
  if (typeof c.rtt === 'number' && c.rtt >= NET.RTT_LENTA) return true;
  if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < NET.DOWN_LENTA) return true;
  return false;
}

// ¿El cortacircuitos está abierto (hubo fallos y todavía no venció)?
function netCortada() { return Date.now() < NET._corteHasta; }

// Estado de la conexión: 'offline' | 'cortada' | 'lenta' | 'ok'.
function netEstado() {
  try { if (navigator.onLine === false) return 'offline'; } catch (_) {}
  if (netCortada()) return 'cortada';
  if (netEsLenta()) return 'lenta';
  return 'ok';
}

// ¿Puede salir a la red algo que el usuario NO pidió? Solo con red sana.
// Este es el gate de lo automático PRESCINDIBLE: clima, fondo del mapa,
// precarga de la librería de Google.
function netPuedeAuto() { return netEstado() === 'ok'; }

// Gate de lo automático IMPORTANTE: la copia a Drive y la sync de Calendar.
// Son datos del usuario en una app sin backend — perderlos es mucho peor que
// gastar unos kilobytes. Por eso a estos NO los frena el "Ahorro de datos"
// (que es una preferencia de consumo, no una red rota): solo los frena una red
// que de verdad no está — sin señal, 2G/rtt por el piso o cortacircuitos
// abierto. Si el backup se frenara solo porque el usuario dejó el Ahorro
// prendido, volveríamos al peor escenario de esta app: la copia fallando en
// silencio mientras la pantalla dice "Conectado ✓".
function netPuedeAutoImportante() {
  const e = netEstado();
  if (e === 'offline' || e === 'cortada') return false;
  const c = _netConn();
  if (!c) return true;
  const et = c.effectiveType || '';
  if (et === 'slow-2g' || et === '2g') return false;
  if (typeof c.rtt === 'number' && c.rtt >= NET.RTT_LENTA) return false;
  if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < NET.DOWN_LENTA) return false;
  return true;
}

// Etiqueta corta para el topbar. '' cuando la red está bien (no molestar).
function netEtiqueta() {
  switch (netEstado()) {
    case 'offline': return 'Sin conexión';
    case 'cortada': return 'Sin datos';
    case 'lenta':   return 'Red lenta';
    default:        return '';
  }
}

function _netOk() {
  const veniaMal = NET._fails > 0 || netCortada();
  NET._fails = 0;
  NET._corteHasta = 0;
  if (veniaMal) netRenderEstado();
}

function _netFail() {
  NET._fails++;
  if (NET._fails >= NET.FAILS_ABRE && !netCortada()) {
    NET._corteHasta = Date.now() + NET.CORTE_MS;
    netRenderEstado();
    // Un aviso por corte: que se entienda que la app dejó de intentar a
    // propósito, y que eso NO la deja rota.
    if (Date.now() - NET._avisado > NET.CORTE_MS && typeof toast === 'function') {
      NET._avisado = Date.now();
      toast('Parece que no hay datos: la app deja de pedir cosas por unos minutos. Todo lo tuyo sigue funcionando sin conexión.', 'info', 6000);
    }
  }
}

// ÚNICA puerta de salida a internet de la app. `o.timeout` pisa el corte por
// defecto. Un 404 o un 500 NO cuentan como fallo de red (el server contestó:
// la conexión anda); sí cuentan el timeout y el error de transporte.
// `o.sinCorte`: el fallo NO alimenta el cortacircuitos. Es para las
// transferencias grandes (la subida del backup): que 20 MB no terminen de
// subir no prueba que la red esté caída, y abrir el corte frenaría el clima y
// todo lo demás por 3 minutos.
async function netFetch(url, opts, o) {
  const ms = (o && o.timeout) || (netEsLenta() ? NET.TIMEOUT_LENTA_MS : NET.TIMEOUT_MS);
  let ac = null;
  try { ac = new AbortController(); } catch (_) {}
  const t = setTimeout(() => { try { if (ac) ac.abort(); } catch (_) {} }, ms);
  try {
    // eslint-disable-next-line no-restricted-syntax -- esta ES la puerta de salida
    const res = await fetch(url, ac ? Object.assign({}, opts || {}, { signal: ac.signal }) : opts);
    _netOk();
    return res;
  } catch (e) {
    if (!(o && o.sinCorte)) _netFail();
    throw (e && e.name === 'AbortError')
      ? new Error('La conexión tardó demasiado (más de ' + Math.max(1, Math.round(ms / 1000)) + ' s)')
      : e;
  } finally {
    clearTimeout(t);
  }
}

// Borra el corte y vuelve a intentar lo que hubiera quedado pendiente. Lo usan
// el botón del aviso y la vuelta de la conexión.
function netReintentar() {
  NET._fails = 0;
  NET._corteHasta = 0;
  netRenderEstado();
  try { if (typeof climaRefresh === 'function') climaRefresh(); } catch (_) {}
  try {
    if (typeof GDRIVE !== 'undefined' && GDRIVE._dirty &&
        typeof gdriveConfigured === 'function' && gdriveConfigured() && gdriveConnected()) {
      clearTimeout(GDRIVE._timer); gdriveAutoUpload();
    }
  } catch (_) {}
  try {
    if (typeof GCAL !== 'undefined' && GCAL._dirty &&
        typeof gcalConfigured === 'function' && gcalConfigured() && gcalConnected()) {
      clearTimeout(GCAL._timer); gcalAutoSync();
    }
  } catch (_) {}
}

// El estado de la red se muestra pegado al "✓ Guardado" del topbar: es el
// único cartelito permanente que ya existe, y ahí se lee sin robar espacio.
// Guardado y conexión no compiten — guardar es local y siempre funciona.
function netRenderEstado() {
  try { if (typeof _renderSaveStatus === 'function') _renderSaveStatus(); } catch (_) {}
  // Si la red se recuperó mientras el usuario mira el mapa, el fondo entra solo
  // y el aviso se apaga: sin esto, quedarse en la pestaña Mapa dejaba el cartel
  // de "fondo sin cargar" para siempre (solo se reevaluaba al volver a entrar).
  try {
    if (typeof _mapaAddTiles === 'function' && typeof _mapa !== 'undefined' &&
        _mapa && !_mapaTiles && netPuedeAuto() && window.L &&
        document.getElementById('panel-mapa') &&
        document.getElementById('panel-mapa').classList.contains('active')) {
      _mapaAddTiles(window.L);
    }
  } catch (_) {}
}

// Explica el estado y ofrece reintentar. Se abre tocando el cartelito.
async function netExplicar() {
  const est = netEstado();
  if (est === 'ok') { toast('La conexión está bien', 'ok', 2000); return; }
  const txt = {
    offline: 'El teléfono no tiene conexión. La app funciona igual: presupuestos, agenda, historial y PDF no necesitan internet. Lo que quede pendiente (copia a Drive, Calendar) se sube solo cuando vuelva la señal.',
    cortada: 'Los últimos pedidos no llegaron a destino, así que la app dejó de intentar por unos minutos para no trabarse ni gastarte datos. Todo lo tuyo sigue funcionando sin conexión.',
    lenta:   'El teléfono informa una conexión muy lenta (o tenés el Ahorro de datos prendido). La app no va a pedir nada por su cuenta —clima, copia a Drive, fondo del mapa— para no trabarse. Los botones que toques vos igual funcionan.',
  }[est];
  const ok = await confirmDlg(netEtiqueta(), txt, 'Reintentar ahora', 'btn-p');
  if (ok) { netReintentar(); toast('Reintentando…', 'info', 2000); }
}

// Enganches: cambios de tipo de red y de conexión. Cuando el navegador avisa
// que volvió una red buena, se cierra el corte y se retoma lo pendiente.
function netInit() {
  const c = _netConn();
  if (c && typeof c.addEventListener === 'function') {
    c.addEventListener('change', () => {
      if (!netEsLenta() && netCortada()) netReintentar();
      else netRenderEstado();
    });
  }
  window.addEventListener('online',  () => { netReintentar(); });
  window.addEventListener('offline', () => { netRenderEstado(); });
}
