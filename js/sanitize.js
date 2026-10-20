'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// SANITIZE.JS — Validación de todo lo que entra DESDE AFUERA.
//
// Un backup .json, la copia de Google Drive o una clave de localStorage
// manipulada son INPUT NO CONFIABLE: los backups se intercambian entre colegas
// y un archivo ajeno puede venir con cualquier cosa adentro. Dos problemas
// concretos que este módulo cierra:
//
//   1. XSS. Los ids y los enums se interpolan dentro de atributos HTML
//      (onclick="fn('ID')", class="pdoc-theme-X"). Un id con comillas rompía el
//      atributo y ejecutaba código ajeno con solo abrir la Agenda o la
//      campanita — sin tocar nada más. El texto del usuario nunca fue el
//      problema: ese siempre pasó por esc().
//   2. App rota de forma permanente. Un `history` que no fuera un array quedaba
//      guardado igual y a partir de ahí la app tiraba "h is not iterable" en
//      CADA arranque: Historial y Agenda muertos, sin forma de recuperarse
//      desde la app.
//
// REGLA: nada entra al estado ni a localStorage sin pasar por acá.
//
// Criterio general: NO se descartan datos del usuario si se pueden arreglar.
// Un id inválido se reemplaza por uno nuevo, un enum desconocido cae al
// default, un campo de más se conserva (compatibilidad hacia adelante). Solo se
// descarta lo que no se puede mostrar de ninguna manera (una nota sin fecha).
// Perder un presupuesto siempre es peor que tener un id raro.
// ═══════════════════════════════════════════════════════════════════════════

// Ids seguros para interpolar: letras, números, guion y guion bajo. Cubre los
// que genera la app ('n_lx3k2a', 'p_...', '1721847...') y rechaza cualquier
// cosa con comillas, < > o espacios.
const SAN_ID_RE = /^[\w-]{1,40}$/;
// Listas blancas de los enums que van a parar a un atributo HTML.
const PDF_THEMES = ['clasico','profesional','calido','minimalista','lateral','tecnico','elegante'];
const PDF_FONTS  = ['auto','dm','plex','lora-inter','inter'];
// Monograma del encabezado (v244): forma que se dibuja con las iniciales del
// negocio cuando no hay logo. Se interpola en una clase y en el SVG.
const PDF_MONOS  = ['ninguno','circulo','escudo','hoja','rombo','sello'];
// Elementos del documento (v245). Todos se interpolan en clases de la tabla.
const PDF_ENCABEZADOS = ['auto','centrado','banda'];
const PDF_TITULOS     = ['auto','subrayado','pildora','numerado','costado','versalitas'];
const PDF_TABLAS      = ['auto','lineas','cebra','grilla'];
const PDF_TOTALES     = ['auto','banda','grande'];
const PDF_PIES        = ['auto','franja','eslogan'];
// Fondo (v246): 'auto' = liso. 'marca' = marca de agua con el monograma;
// 'logo' = marca de agua con el logo cargado (v248).
const PDF_FONDOS      = ['auto','hojas','curvas','veta','marca','logo'];
// Color de detalle: '' (= igual al principal) o un hex. Nunca el fallback de
// safeColor: un valor basura tiene que volver a "sin color de detalle", no
// pintar los detalles de verde.
function sanColor2(c) { return (typeof c === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) ? c : ''; }
// Vistas del editor (S.vistaEditor). Va a un atributo del DOM
// (#panel-editor[data-vista]), así que no puede entrar sin lista blanca.
const EDITOR_VIEWS = ['clasica','fichas','consola'];
// Rubro del presupuesto (v241): QUÉ se cotiza. Es ortogonal al modo (normal /
// estimativo / riesgo, que dice CÓMO): un cerco también se cotiza por foto.
// Lista blanca porque decide el título del documento y qué secciones salen.
const RUBROS = ['arbolado','jardineria'];
// Cómo se cobra un trabajo (tarjeta del ítem, v241). Sin unidad ('') es el
// precio cerrado "a ojo" de siempre; con unidad, el precio es POR unidad y el
// total es precio × cantidad. Se lee siempre con itemUnidad(), que filtra.
const ITEM_UNIDADES = ['m','m2','jornada'];
const NOTE_TIPOS = ['visita'];   // sin tipo = nota común
// Unidades de las tarifas propias (ver "Mis servicios" en js/clients.js). La
// unidad decide el texto de la cantidad en el diálogo y en la factura, así que
// no puede entrar cualquier cosa desde un backup ajeno.
const MISSVC_UNIDADES = ['jornada','hora','trabajo'];
// Tipos de trabajo registrado a mano (ver js/history.js). Decide si la plata
// de la entrada suma a las ventas del negocio, así que no puede entrar un
// valor cualquiera desde un backup ajeno.
// El orden es el del segmentado del diálogo: primero el más frecuente.
const TRABAJO_TIPOS = ['directo','colab'];
// Los `kind` que guarda la bitácora. Estaban solo los cuatro tonos genéricos,
// así que sanEnum convertía en 'info' los conceptos reales que escribe
// logNotif (estado, recontacto, visita, clima, vencimiento, seguimiento) —
// callado, y para siempre, porque migrateSanitizeStored corre al arrancar.
// Hoy el panel no pinta por kind, pero es el dato que dice de qué era el
// aviso: perderlo en el backup es perder la bitácora que la campanita existe
// para conservar.
const NOTIF_KINDS = ['info','ok','warn','err',
  'estado','recontacto','visita','clima','vencimiento','seguimiento','nota','trabajo'];

function sanStr(v, max) { return typeof v === 'string' ? v.slice(0, max || 2000) : ''; }
function sanBool(v) { return !!v; }
function sanNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function sanEnum(v, allowed, def) { return allowed.indexOf(v) >= 0 ? v : def; }
function sanISODate(v) { return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : ''; }
// Hora del día 'HH:MM' (24 h). Vacío = sin hora (evento de día completo): una
// hora inválida no puede quedar guardada porque se manda tal cual a Google.
function sanHoraHM(v) { return (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ? v : ''; }
// Timestamp ISO completo (savedAt, enviadoEn…). Se conserva si parsea.
function sanTS(v) { return (typeof v === 'string' && !isNaN(new Date(v).getTime())) ? v : ''; }
// Id de texto: el original si es seguro, si no uno nuevo (no se pierde el dato).
function sanTextId(v, prefix) {
  if (typeof v === 'string' && SAN_ID_RE.test(v)) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return (prefix || 'x_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Id NUMÉRICO (entradas del historial). Devolver siempre un número deja probado
// que `onclick="fn(${e.id})"` no puede inyectar nada, sin tener que tocar los
// ~20 sitios que lo interpolan.
let _sanIdSeq = 0;
function sanNumId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d{1,20}$/.test(v)) return parseInt(v, 10);
  return Date.now() + (++_sanIdSeq);   // nuevo, único dentro de la misma pasada
}

// Lo que debería ser una lista pero no lo es. Si viene como objeto con las
// entradas adentro ({"0":{…}} — típico de un JSON armado a mano o por otra
// herramienta) se rescatan los valores antes de rendirse: son datos del
// usuario. Cualquier otra cosa da lista vacía.
function _sanToArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.keys(raw).map(k => raw[k]);
  return [];
}

// ─── HISTORIAL ───────────────────────────────────────────────
// Conserva los campos desconocidos (una versión más nueva puede haber agregado
// alguno) y solo normaliza lo estructural y lo que se interpola.
function sanitizeHistory(raw) {
  const out = [];
  _sanToArray(raw).forEach(e => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return;
    const s = Object.assign({}, e);
    s.id          = sanNumId(e.id);
    s.estado      = sanEnum(e.estado, ESTADOS, 'borrador');
    s.quoteNumber = sanStr(e.quoteNumber, 60);
    s.clientName  = sanStr(e.clientName, 200);
    s.currency    = sanEnum(e.currency, ['ARS','USD','EUR'], 'ARS');
    s.total       = sanNum(e.total);
    s.itemCount   = sanNum(e.itemCount);
    s.isEstimative = sanBool(e.isEstimative);
    // Sin la configuración del negocio (ver snapshotSinConfig). Va acá y no
    // solo al guardar porque sanitizeStateObj repone algunos de esos campos con
    // su default; y así, además, la pasada del arranque (migrateSanitizeStored)
    // aliviana una única vez lo que ya estaba guardado y lo que llegue de un backup.
    s.snapshot    = (e.snapshot && typeof e.snapshot === 'object' && !Array.isArray(e.snapshot))
      ? snapshotSinConfig(sanitizeStateObj(e.snapshot)) : {};
    // Fechas del ciclo comercial: se limpian las que no parsean para que no
    // envenenen los cálculos de días (daysSince y compañía).
    ['savedAt','enviadoEn','seguimientoHechoEn','vencimientoVistoEn'].forEach(k => {
      if (e[k] != null) { const t = sanTS(e[k]); if (t) s[k] = t; else delete s[k]; }
    });
    ['fechaTrabajo','recontactoEn'].forEach(k => {
      if (e[k] != null) { const f = sanISODate(e[k]); if (f) s[k] = f; else delete s[k]; }
    });
    if (Array.isArray(e.fechasTrabajo)) {
      s.fechasTrabajo = e.fechasTrabajo.map(sanISODate).filter(Boolean);
    } else { delete s.fechasTrabajo; }
    // Cadena de versiones: ids de OTRAS entradas del historial. Se interpolan
    // en onclick igual que `id`, así que tienen que ser números; pero acá no
    // sirve el sanNumId de siempre —inventar un id nuevo apuntaría a una
    // entrada inexistente—, así que lo que no parsea se descarta y el
    // presupuesto vuelve a ser original / no reemplazado.
    ['versionDe','reemplazadoPor'].forEach(k => {
      const v = e[k];
      if (typeof v === 'number' && Number.isFinite(v)) s[k] = v;
      else if (typeof v === 'string' && /^\d{1,20}$/.test(v)) s[k] = parseInt(v, 10);
      else delete s[k];
    });
    if (e.versionN != null) s.versionN = Math.max(0, Math.round(sanNum(e.versionN)) || 0);
    // Colaboración (trabajo propio para un colega). La bandera decide si la
    // entrada suma o no a las estadísticas de presupuestos, así que no puede
    // quedar como un string cualquiera; y `colab` guarda lo que hace falta
    // para reabrir el diálogo y para describir la factura.
    if (e.esTrabajoPropio) s.esTrabajoPropio = true; else delete s.esTrabajoPropio;
    // El tipo decide si la plata de la entrada suma a las ventas: no puede
    // entrar cualquier valor. Sin bandera no hay tipo que guardar, y lo que no
    // esté en la lista cae a 'colab' (lo que eran todas antes del trabajo
    // directo, y el criterio conservador: no suma de más).
    if (s.esTrabajoPropio) s.tipoTrabajo = sanEnum(e.tipoTrabajo, TRABAJO_TIPOS, 'colab');
    else delete s.tipoTrabajo;
    if (e.colab && typeof e.colab === 'object' && !Array.isArray(e.colab)) {
      s.colab = {
        nombre:   sanStr(e.colab.nombre, 120),
        precio:   Math.max(0, sanNum(e.colab.precio)),
        cantidad: Math.max(0, sanNum(e.colab.cantidad)) || 1,
        unidad:   sanEnum(e.colab.unidad, MISSVC_UNIDADES, 'jornada'),
      };
    } else { delete s.colab; }
    if (e.recontactoNota != null) s.recontactoNota = sanStr(e.recontactoNota, 500);
    if (e.diasEstimados != null)  s.diasEstimados  = Math.max(1, Math.round(sanNum(e.diasEstimados)) || 1);
    out.push(s);
  });
  return out;
}

// ─── ESTADO / SNAPSHOT ───────────────────────────────────────
// Acota SOLO lo que se interpola crudo en el documento (tema, fuente, color) y
// garantiza que los arrays de ítems sean arrays. El resto del estado es texto
// que ya se escapa con esc() al renderizar.
function sanitizeStateObj(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const s = Object.assign({}, raw);
  s.pdfTheme = sanEnum(raw.pdfTheme, PDF_THEMES, 'clasico');
  s.pdfFont  = sanEnum(raw.pdfFont,  PDF_FONTS,  'auto');
  s.pdfMono  = sanEnum(raw.pdfMono,  PDF_MONOS,  'ninguno');
  s.accentColor2 = sanColor2(raw.accentColor2);
  s.pdfEncabezado = sanEnum(raw.pdfEncabezado, PDF_ENCABEZADOS, 'auto');
  s.pdfTitulos    = sanEnum(raw.pdfTitulos,    PDF_TITULOS,     'auto');
  s.pdfTabla      = sanEnum(raw.pdfTabla,      PDF_TABLAS,      'auto');
  s.pdfTotal      = sanEnum(raw.pdfTotal,      PDF_TOTALES,     'auto');
  s.pdfPie        = sanEnum(raw.pdfPie,        PDF_PIES,        'auto');
  s.pdfFondo      = sanEnum(raw.pdfFondo,      PDF_FONDOS,      'auto');
  s.pdfTransl     = raw.pdfTransl === true;
  s.coEslogan     = sanStr(raw.coEslogan, 120);
  s.vistaEditor = sanEnum(raw.vistaEditor, EDITOR_VIEWS, 'clasica');
  s.rubro = sanEnum(raw.rubro, RUBROS, 'arbolado');
  s.accentColor = (typeof safeColor === 'function') ? safeColor(raw.accentColor) : '#064e3b';
  s.currency = sanEnum(raw.currency, ['ARS','USD','EUR'], 'ARS');
  if (!Array.isArray(s.items))     s.items = [];
  if (!Array.isArray(s.itemsB))    s.itemsB = [];
  if (!Array.isArray(s.estItems))  s.estItems = [];
  if (!Array.isArray(s.customColors)) s.customColors = [];
  if (s.logo != null && typeof s.logo !== 'string') s.logo = '';
  // Datos de cobro: texto plano y corto. Se imprimen en el documento del
  // cliente, así que un backup ajeno no puede meter acá un bloque largo ni
  // nada que no sea texto.
  s.coAliasPago    = sanStr(raw.coAliasPago, 100);
  s.coAliasTitular = sanStr(raw.coAliasTitular, 120);
  s.coCbu          = sanStr(raw.coCbu, 40);   // CBU/CVU: 22 dígitos, con aire por si lo pegan con espacios
  s.coBanco        = sanStr(raw.coBanco, 80);
  // Disposición de leña/residuos: el texto se escapa al renderizar, pero las
  // refs de foto terminan en un src y en atributos data-*, así que se filtran
  // a lo que la app genera (id 'p_...' o dataURL de imagen legado).
  s.dispoNota   = sanStr(raw.dispoNota, 1000);
  s.dispoPhotos = sanPhotoRefs(raw.dispoPhotos);
  s.dispoEnDoc  = (raw.dispoEnDoc === undefined) ? true : sanBool(raw.dispoEnDoc);
  // Referencia a la versión anterior: el número se imprime en el documento del
  // cliente (escapado, pero acotado igual) y la fecha alimenta fmtD.
  s.versionN       = Math.max(0, Math.round(sanNum(raw.versionN)) || 0);
  s.versionDeNum   = sanStr(raw.versionDeNum, 60);
  s.versionDeFecha = sanISODate(raw.versionDeFecha);
  s.versionEnDoc   = (raw.versionEnDoc === undefined) ? true : sanBool(raw.versionEnDoc);
  // Informe de riesgo: los defectos llevan refs de foto (terminan en un src) y
  // un defecto que no es objeto rompía la lista entera del editor.
  if (raw.riskData !== undefined) s.riskData = sanitizeRiskData(raw.riskData);
  if (raw.coEvaluador !== undefined)   s.coEvaluador   = sanStr(raw.coEvaluador, 400);
  if (raw.docRiskLimits !== undefined) s.docRiskLimits = sanStr(raw.docRiskLimits, 2000);
  return s;
}

// riskData de un estado o snapshot. Solo pasan las claves conocidas; los
// desplegables, por lista blanca (las claves viejas de la matriz v1 incluidas,
// para que un informe entregado se siga viendo igual). `metodo` se conserva
// solo si viene: sin él, riskMetodo() lo deduce de lo cargado.
const _RISK_ENUMS = {
  failureProbability: ['improbable','posible','probable','inminente'],
  impactProbability:  ['muybaja','baja','media','alta'],
  consequences:       ['insignificantes','menores','significativas','severas','catastroficas'],
  windExposure:       ['bajo','moderado','alto'],
  inclination:        ['ninguna','leve','moderada','severa'],
  soilCondition:      ['normal','compactado','saturado','erosionado'],
  vitalidad:          ['buena','regular','pobre','muerto'],
  nivel:              ['1','2','3'],
};
function sanitizeRiskData(raw) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const o = {};
  if (r.metodo === 'isa2' || r.metodo === 'v1') o.metodo = r.metodo;
  ['species','location','priorInterventions','target'].forEach(k => { o[k] = sanStr(r[k], 300); });
  ['height','dap'].forEach(k => { o[k] = sanStr(typeof r[k] === 'number' ? String(r[k]) : r[k], 20); });
  ['mitigationGoals','riskObservations','limitaciones'].forEach(k => { o[k] = sanStr(r[k], 3000); });
  Object.keys(_RISK_ENUMS).forEach(k => { o[k] = sanEnum(r[k], _RISK_ENUMS[k], ''); });
  o.resFailure      = sanEnum(r.resFailure, _RISK_ENUMS.failureProbability, '');
  o.resImpact       = sanEnum(r.resImpact, _RISK_ENUMS.impactProbability, '');
  o.resConsequences = sanEnum(r.resConsequences, _RISK_ENUMS.consequences, '');
  o.plazo  = sanEnum(r.plazo, RISK_PLAZOS, '12');
  o.reinsp = sanEnum(r.reinsp, RISK_REINSP, '');
  const tec = RISK_TECNICAS.map(t => t[0]);
  o.tecnicas = _sanToArray(r.tecnicas).filter((t, i, a) => tec.indexOf(t) >= 0 && a.indexOf(t) === i);
  const tipos = RISK_DEFECT_TYPES.map(t => t[0]), locs = RISK_DEFECT_LOC.map(t => t[0]);
  o.defects = _sanToArray(r.defects).slice(0, 40)
    .filter(d => d && typeof d === 'object' && !Array.isArray(d))
    .map(d => ({
      type:     sanEnum(d.type, tipos, ''),
      location: sanEnum(d.location, locs, ''),
      desc:     sanStr(d.desc, 2000),
      altura:   sanStr(typeof d.altura === 'number' ? String(d.altura) : d.altura, 10),
      orient:   sanEnum(d.orient, RISK_ORIENT, ''),
      photos:   sanPhotoRefs(d.photos),
    }));
  return o;
}

// Lista de referencias de foto (ver js/photos.js): un id corto 'p_...' o un
// dataURL de imagen embebido (formato legado / respaldo si IndexedDB falla).
// Cualquier otra cosa se descarta: no hay forma de mostrarla y sí de que
// rompa el atributo donde se interpola.
function sanPhotoRefs(raw) {
  return _sanToArray(raw).filter(r => typeof r === 'string' &&
    (SAN_ID_RE.test(r) && r.indexOf('p_') === 0 || /^data:image\//i.test(r)));
}

// ─── NOTAS DE LA AGENDA ──────────────────────────────────────
// Una nota sin fecha válida no se puede ubicar en el calendario: se descarta
// (es lo único que no tiene arreglo posible).
function sanitizeNotes(raw) {
  const out = [];
  _sanToArray(raw).forEach(n => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return;
    const fecha = sanISODate(n.fecha);
    if (!fecha) return;
    const s = {
      id:      sanTextId(n.id, 'n_'),
      fecha:   fecha,
      texto:   sanStr(n.texto, 500),
      hecho:   sanBool(n.hecho),
      cliente: sanStr(n.cliente, 200),
      tel:     sanStr(n.tel, 60),
    };
    const ts = sanTS(n.creadoEn); if (ts) s.creadoEn = ts;
    if (n.ubic != null) s.ubic = sanStr(n.ubic, 500);
    const tipo = sanEnum(n.tipo, NOTE_TIPOS, ''); if (tipo) s.tipo = tipo;
    // Hora opcional: sin ella el recordatorio es de día completo (como siempre).
    const hora = sanHoraHM(n.hora); if (hora) s.hora = hora;
    out.push(s);
  });
  return out;
}

// ─── BITÁCORA DEL CENTRO DE NOTIFICACIONES ───────────────────
// `action` y `undo` son objetos que se ejecutan al tocar el aviso: se valida el
// tipo contra la lista de acciones que notifRunAction/notifUndo saben manejar y
// se descarta cualquier otra cosa.
function sanitizeNotifAction(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const type = sanEnum(a.type, ['entry','tab','clima'], '');
  if (!type) return null;
  const out = { type: type };
  if (a.id != null) out.id = sanNumId(a.id);
  if (type === 'tab')   out.tab = sanEnum(a.tab, ['editor','historial','mapa','agenda','facturacion'], 'historial');
  if (type === 'clima') out.f = sanISODate(a.f);
  return out;
}
function sanitizeNotifUndo(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  // La lista tiene que incluir TODO tipo de deshacer que escriba logNotif: lo
  // que no esté acá se descarta al sanitizar (y migrateSanitizeStored sanea al
  // arrancar), así que el botón "Deshacer" desaparecería de la bitácora sin
  // aviso. Al agregar un undo nuevo, agregarlo también acá.
  const type = sanEnum(u.type, ['estado','recontacto','note','vencVisto','segHecho','prorroga'], '');
  if (!type) return null;
  const out = { type: type };
  if (type === 'note') out.id = sanTextId(u.id, 'n_');
  else {
    // El id apunta a OTRA entrada del historial, como versionDe/reemplazadoPor:
    // acá no sirve el sanNumId de siempre, que ante un valor inválido inventa
    // un id nuevo — el "Deshacer" quedaría apuntando a un presupuesto que no
    // es, y revivir el vencimiento ajeno es peor que perder el botón. Lo que
    // no parsea tira el deshacer entero; la entrada de la bitácora queda, sin
    // botón.
    const v = u.id;
    if (typeof v === 'number' && Number.isFinite(v)) out.id = v;
    else if (typeof v === 'string' && /^\d{1,20}$/.test(v)) out.id = parseInt(v, 10);
    else return null;
  }
  if (type === 'estado')     out.prev = sanEnum(u.prev, ESTADOS, 'borrador');
  if (type === 'prorroga')   out.dateExpiry = sanISODate(u.dateExpiry);
  if (type === 'recontacto') {
    const f = sanISODate(u.recontactoEn); if (f) out.recontactoEn = f;
    if (u.recontactoNota != null) out.recontactoNota = sanStr(u.recontactoNota, 500);
  }
  return out;
}
function sanitizeNotifLog(raw) {
  const out = [];
  _sanToArray(raw).forEach(r => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return;
    if (!r.text) return;
    const s = {
      id:   sanTextId(r.id, 'n_'),
      ts:   sanNum(r.ts) || Date.now(),
      // El icono es un emoji: se acota acá y además se escapa al renderizar.
      icon: sanStr(r.icon, 8) || '🔔',
      text: sanStr(r.text, 300),
      kind: sanEnum(r.kind, NOTIF_KINDS, 'info'),
      action: sanitizeNotifAction(r.action),
      undo:   sanitizeNotifUndo(r.undo),
      dedupeKey: sanStr(r.dedupeKey, 120) || null,
    };
    if (r.undoneAt != null) s.undoneAt = sanNum(r.undoneAt);
    out.push(s);
  });
  return out.slice(0, NOTIF_CAP);
}

// ─── FACTURAS ────────────────────────────────────────────────
// El id se interpola en onclick="factRecibo('ID')" y la fecha se muestra tal
// cual; una fecha inválida se deja vacía (visible y editable) en vez de tirar
// la factura, que es plata registrada.
function sanitizeFacturas(raw) {
  const out = [];
  _sanToArray(raw).forEach(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return;
    const s = Object.assign({}, f);
    s.id      = sanTextId(f.id, 'f_');
    s.fecha   = sanISODate(f.fecha);
    s.monto   = sanNum(f.monto);
    s.cliente = sanStr(f.cliente, 200);
    s.desc    = sanStr(f.desc, 500);
    if (f.quoteNumber != null) s.quoteNumber = sanStr(f.quoteNumber, 60);
    if (f.reciboNum != null)   s.reciboNum   = sanStr(f.reciboNum, 60);
    out.push(s);
  });
  return out;
}

// ─── MIS SERVICIOS (tarifas propias) ─────────────────────────
// Las tarifas que el usuario cobra cuando trabaja PARA otro (una jornada de
// trepador para un colega). El id se usa en data-* y la unidad decide el
// texto de la cantidad, así que ambos van acotados; el precio es plata
// registrada y no puede quedar negativo.
function sanitizeMisServicios(raw) {
  const out = [];
  _sanToArray(raw).forEach(t => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return;
    const s = Object.assign({}, t);
    s.id     = sanTextId(t.id, 'ms_');
    s.nombre = sanStr(t.nombre, 120);
    s.precio = Math.max(0, sanNum(t.precio));
    s.unidad = sanEnum(t.unidad, MISSVC_UNIDADES, 'jornada');
    if (!s.nombre) return;   // sin nombre no hay nada que mostrar ni elegir
    out.push(s);
  });
  return out;
}

// ─── CONFIG DE SEGUIMIENTO ───────────────────────────────────
// Las plantillas son texto que después se mete en una URL de WhatsApp con
// encodeURIComponent (no es HTML), pero se acotan igual: un backup ajeno no
// tiene por qué poder inflar la config.
function sanitizeFollowup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  if (raw.enabled       != null) out.enabled       = sanBool(raw.enabled);
  if (raw.expiryEnabled != null) out.expiryEnabled = sanBool(raw.expiryEnabled);
  if (raw.pushAgenda    != null) out.pushAgenda    = sanBool(raw.pushAgenda);
  if (raw.pushHora      != null) out.pushHora      = sanBool(raw.pushHora);
  if (raw.pushClima     != null) out.pushClima     = sanBool(raw.pushClima);
  if (raw.pushSemana    != null) out.pushSemana    = sanBool(raw.pushSemana);
  ['pushHoraResumen', 'pushHoraNoche'].forEach(k => {
    if (raw[k] != null) { const h = sanHoraHM(raw[k]); if (h) out[k] = h; }
  });
  if (raw.pushAntesMin != null) {
    const m = Math.round(sanNum(raw.pushAntesMin));
    out.pushAntesMin = PUSH_ANTES_OPC.includes(m) ? m : FOLLOWUP_DEF.pushAntesMin;
  }
  if (raw.pushSilencio !== undefined) {
    out.pushSilencio = [...new Set(_sanToArray(raw.pushSilencio).map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  }
  if (raw.days != null) {
    // Entre 1 y 365 días: fuera de ese rango el seguimiento no tiene sentido.
    const d = Math.round(sanNum(raw.days));
    out.days = Math.min(365, Math.max(1, d || FOLLOWUP_DEF.days));
  }
  if (raw.estados !== undefined) {
    const est = _sanToArray(raw.estados).filter(e => ESTADOS.indexOf(e) >= 0);
    // Sin estados no se dispara nunca ningún recordatorio: si el backup vino
    // con una lista vacía o basura, se vuelve al default en vez de dejar el
    // seguimiento mudo sin que el usuario sepa por qué.
    out.estados = est.length ? est : FOLLOWUP_DEF.estados.slice();
  }
  ['waTemplate','waSendTemplate','waRecontactoTemplate','waCobroTemplate',
   'waActualizacionTemplate'].forEach(k => {
    if (raw[k] != null) out[k] = sanStr(raw[k], 1500);
  });
  return Object.keys(out).length ? out : null;
}

// ─── DBs SIMPLES (clientes / especies / servicios / frases) ──
// Son texto que ya se escapa al renderizar: solo hay que garantizar que sean
// arrays y acotar el tamaño para que un backup inflado no llene la cuota.
function sanitizeStrList(raw, max) {
  return _sanToArray(raw).filter(v => typeof v === 'string' && v.trim()).map(v => v.slice(0, max || 300));
}
function sanitizeClients(raw) {
  const out = [];
  _sanToArray(raw).forEach(c => {
    if (typeof c === 'string') { if (c.trim()) out.push({ name: c.slice(0,200), contact:'', address:'', maplink:'' }); return; }
    if (!c || typeof c !== 'object' || Array.isArray(c)) return;
    const name = sanStr(c.name, 200);
    if (!name.trim()) return;
    out.push({
      name: name,
      contact: sanStr(c.contact, 120),
      address: sanStr(c.address, 300),
      maplink: sanStr(c.maplink || c.mapLink, 500),
    });
  });
  return out;
}

// ─── LIMPIEZA DE LO YA GUARDADO ──────────────────────────────
// Un dispositivo puede tener datos inválidos guardados de ANTES de que
// existiera este módulo (un backup ajeno importado en su momento). Validar en
// cada lectura sería carísimo — getH() se llama varias veces por render —, así
// que se hace una sola pasada al arrancar y solo se reescribe lo que realmente
// cambió (si no cambió nada, que es el caso normal, no se toca localStorage ni
// se dispara una copia a Drive).
function migrateSanitizeStored() {
  let arreglados = 0;
  const pasada = (key, sanitizer, write) => {
    let raw;
    try { raw = localStorage.getItem(key); } catch(_) { return; }
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch(_) { parsed = null; }
    const limpio = sanitizer(parsed);
    const nuevo = JSON.stringify(limpio);
    if (nuevo === raw) return;         // ya estaba bien: no tocar nada
    write(nuevo);
    arreglados++;
  };
  pasada(LS.HISTORY,   sanitizeHistory,  v => { try { localStorage.setItem(LS.HISTORY, v); } catch(_){} });
  pasada(LS.NOTES,     sanitizeNotes,    v => { try { localStorage.setItem(LS.NOTES, v); } catch(_){} });
  pasada(LS.NOTIF_LOG, sanitizeNotifLog, v => { try { localStorage.setItem(LS.NOTIF_LOG, v); } catch(_){} });
  pasada(LS.ESTILOS,   sanitizeEstilos,  v => { try { localStorage.setItem(LS.ESTILOS, v); } catch(_){} });
  if (typeof FACT_KEY !== 'undefined') {
    pasada(FACT_KEY,   sanitizeFacturas, v => { try { localStorage.setItem(FACT_KEY, v); } catch(_){} });
  }
  if (typeof MISSVC_KEY !== 'undefined') {
    pasada(MISSVC_KEY, sanitizeMisServicios, v => { try { localStorage.setItem(MISSVC_KEY, v); } catch(_){} });
  }
  // El estado activo: acotar tema/fuente/color, que son los que se interpolan
  // en el documento. S ya está cargado en memoria (loadLS corrió antes).
  const tema = sanEnum(S.pdfTheme, PDF_THEMES, 'clasico');
  const fuente = sanEnum(S.pdfFont, PDF_FONTS, 'auto');
  const color = (typeof safeColor === 'function') ? safeColor(S.accentColor) : S.accentColor;
  // La vista del editor también: va a un atributo del DOM y un valor basura
  // tiene que caer a 'clasica' (la vista conocida-buena).
  const vista = sanEnum(S.vistaEditor, EDITOR_VIEWS, 'clasica');
  const mono = sanEnum(S.pdfMono, PDF_MONOS, 'ninguno');
  const color2 = sanColor2(S.accentColor2);
  // Elementos del documento (v245): cada uno a su lista blanca.
  const elems = { pdfEncabezado: PDF_ENCABEZADOS, pdfTitulos: PDF_TITULOS, pdfTabla: PDF_TABLAS, pdfTotal: PDF_TOTALES, pdfPie: PDF_PIES, pdfFondo: PDF_FONDOS };
  let elemMal = false;
  Object.keys(elems).forEach(k => { const v = sanEnum(S[k], elems[k], 'auto'); if (v !== S[k]) { S[k] = v; elemMal = true; } });
  if (tema !== S.pdfTheme || fuente !== S.pdfFont || color !== S.accentColor || vista !== S.vistaEditor
      || mono !== S.pdfMono || color2 !== S.accentColor2 || elemMal) {
    S.pdfTheme = tema; S.pdfFont = fuente; S.accentColor = color; S.vistaEditor = vista;
    S.pdfMono = mono; S.accentColor2 = color2;
    arreglados++;
    try { localStorage.setItem(LS.STATE, JSON.stringify(S)); } catch(_){}
  }
  if (arreglados) console.warn('Se normalizaron ' + arreglados + ' bloque(s) de datos guardados');
  return arreglados;
}

// ─── BACKUP COMPLETO ─────────────────────────────────────────
// Normaliza el objeto ENTERO en memoria y devuelve una copia limpia, o null si
// no es un backup reconocible. Nada se escribe todavía: esa es justamente la
// idea (ver applyBackupObject, que restaura en dos fases).
// ─── MIS ESTILOS (v247) ──────────────────────────────────────
// Estilos guardados con nombre (Empresa → Estilo → Mis estilos). Viajan en el
// backup, así que un archivo ajeno puede traer cualquier cosa: cada campo pasa
// por su lista blanca, igual que en sanitizeStateObj. `textos` son los del
// juego de textos (TEXTOS_CAMPOS). El id va a un data-id: se valida, no se
// escapa. Hasta ESTILO_MAX_GUARDADOS con nombre + el automático ("El anterior").
const ESTILO_MAX_GUARDADOS = 12;
const ESTILO_ID_RE = /^[a-z0-9_-]{1,24}$/i;
function sanitizeEstiloDatos(d) {
  d = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  const o = {
    pdfTheme:      sanEnum(d.pdfTheme, PDF_THEMES, 'clasico'),
    accentColor:   safeColor(d.accentColor),
    accentColor2:  sanColor2(d.accentColor2),
    pdfFont:       sanEnum(d.pdfFont, PDF_FONTS, 'auto'),
    pdfMono:       sanEnum(d.pdfMono, PDF_MONOS, 'ninguno'),
    pdfEncabezado: sanEnum(d.pdfEncabezado, PDF_ENCABEZADOS, 'auto'),
    pdfTitulos:    sanEnum(d.pdfTitulos, PDF_TITULOS, 'auto'),
    pdfTabla:      sanEnum(d.pdfTabla, PDF_TABLAS, 'auto'),
    pdfTotal:      sanEnum(d.pdfTotal, PDF_TOTALES, 'auto'),
    pdfPie:        sanEnum(d.pdfPie, PDF_PIES, 'auto'),
    pdfFondo:      sanEnum(d.pdfFondo, PDF_FONDOS, 'auto'),
    pdfCompact:    d.pdfCompact === true,
    pdfTransl:     d.pdfTransl === true,
    coEslogan:     sanStr(d.coEslogan, 120),
    textos:        {},
  };
  const t = (d.textos && typeof d.textos === 'object' && !Array.isArray(d.textos)) ? d.textos : {};
  TEXTOS_CAMPOS.forEach(c => { if (typeof t[c] === 'string') o.textos[c] = sanStr(t[c], 3000); });
  return o;
}
function sanitizeEstilos(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [], ids = new Set();
  let manuales = 0, auto = false;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const id = (typeof e.id === 'string' && ESTILO_ID_RE.test(e.id)) ? e.id : '';
    const nombre = sanStr(e.nombre, 40).trim();
    if (!id || ids.has(id) || !nombre) continue;
    const esAuto = e.auto === true;
    if (esAuto ? auto : manuales >= ESTILO_MAX_GUARDADOS) continue;
    if (esAuto) auto = true; else manuales++;
    ids.add(id);
    out.push({ id, nombre, auto: esAuto, creado: sanISODate(e.creado) || '', datos: sanitizeEstiloDatos(e.datos) });
  }
  return out;
}

function sanitizeBackup(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const b = {};
  if (d.state)   b.state   = sanitizeStateObj(d.state);
  if (d.history !== undefined) b.history = sanitizeHistory(d.history);
  if (d.clients !== undefined) b.clients = sanitizeClients(d.clients);
  if (d.species !== undefined) b.species = sanitizeStrList(d.species, 120);
  if (d.services !== undefined)       b.services       = sanitizeStrList(d.services, 120);
  if (d.servicesPinned !== undefined) b.servicesPinned = sanitizeStrList(d.servicesPinned, 120);
  if (d.misServicios !== undefined)   b.misServicios   = sanitizeMisServicios(d.misServicios);
  if (d.phrases && typeof d.phrases === 'object' && !Array.isArray(d.phrases)) {
    b.phrases = {};
    ['desc','obs','pay'].forEach(k => {
      if (Array.isArray(d.phrases[k])) b.phrases[k] = sanitizeStrList(d.phrases[k], 1000);
    });
  }
  if (d.facturas !== undefined) b.facturas = sanitizeFacturas(d.facturas);
  if (d.tope != null) { const t = sanNum(d.tope); if (t > 0) b.tope = t; }
  if (d.reciboSeq != null) b.reciboSeq = Math.max(0, Math.round(sanNum(d.reciboSeq)));
  if (d.notes !== undefined)    b.notes    = sanitizeNotes(d.notes);
  if (d.notifLog !== undefined) b.notifLog = sanitizeNotifLog(d.notifLog);
  if (d.estilos !== undefined)  b.estilos  = sanitizeEstilos(d.estilos);
  if (d.followup !== undefined) { const f = sanitizeFollowup(d.followup); if (f) b.followup = f; }
  // El id de calendario de Google es un email-like acotado; si no pinta como
  // tal, se ignora (peor caso: se crea un calendario nuevo).
  if (typeof d.gcalId === 'string' && /^[\w.@-]{1,200}$/.test(d.gcalId)) b.gcalId = d.gcalId;
  // Las fotos ya las valida restorePhotosFromBackup (exige dataURL de imagen).
  if (d.photos && typeof d.photos === 'object' && !Array.isArray(d.photos)) b.photos = d.photos;
  return b;
}
