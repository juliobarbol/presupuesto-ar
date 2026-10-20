'use strict';

// ═══════════════════════════════════════════════════════════
// SEGUIMIENTO COMERCIAL (follow-up de presupuestos)
// ═══════════════════════════════════════════════════════════
// Config GLOBAL (no por presupuesto). Vive en su propia clave de
// localStorage para no ensuciar cada snapshot ni los backups.
const FOLLOWUP_DEF = {
  enabled: true,        // sistema de seguimiento on/off
  days: 10,             // días tras el envío para recordar (editable)
  expiryEnabled: true,  // avisar cuando un presupuesto enviado se vence
  estados: ['enviado'], // qué estados disparan recordatorio
  // Avisos al teléfono con la app cerrada (además de seguimiento/vencimiento):
  pushAgenda: true,     // trabajos y visitas: la noche anterior y a la mañana
  pushHora: true,       // visitas y recordatorios con hora: 1 h antes
  // v239 — horarios a medida y avisos nuevos (ver _buildPushAvisos):
  pushHoraResumen: '07:30', // resumen del día (Agenda + seguimientos + vencidos)
  pushHoraNoche: '19:00',   // "Mañana tenés…" la noche anterior
  pushAntesMin: 60,         // visitas/recordatorios con hora: cuánto antes
  pushSilencio: [],         // días sin resúmenes (0 = domingo … 6 = sábado)
  pushClima: true,          // la noche anterior, si llueve o hay viento fuerte
  pushSemana: true,         // los lunes: la semana + tope de facturación
  // Plantilla del mensaje de SEGUIMIENTO. Variables: {cliente} {numero} {empresa}
  waTemplate: 'Hola {cliente}, ¿cómo andás? Te escribo por el presupuesto que te pasé. No es para apurarte, sino para saber si te quedó alguna duda o si querés que repasemos algo del trabajo.',
  // Plantilla del mensaje de ENVÍO (botón "Enviar por WhatsApp"). Mismas variables.
  waSendTemplate: 'Hola {cliente}, ¿cómo estás? Te paso el presupuesto N° {numero}. Cualquier duda quedo a disposición.\n\nSaludos,\n{empresa}',
  // Plantilla del mensaje de RECONTACTO: el cliente aceptó pero quedaron en
  // coordinar la fecha del trabajo más adelante. Mismas variables.
  waRecontactoTemplate: 'Hola {cliente}! ¿Cómo andás? Te escribo para coordinar la fecha del trabajo que habíamos hablado. ¿Cómo venís de tiempos?',
  // Plantilla del mensaje de COBRO: sale del toast que aparece al marcar el
  // trabajo como realizado, con el trabajo recién terminado y el cliente
  // todavía en el lugar.
  //
  // El formato imita el de una factura, que es como se pasan los datos de una
  // transferencia acá: bloque etiquetado (titular · CUIT · banco · CBU ·
  // alias) + importe + a qué corresponde. No es adorno — al transferir, el
  // banco le muestra al cliente a quién le está por pagar, y sin el titular no
  // tiene con qué verificarlo. {datos_pago} arma ese bloque con lo que esté
  // cargado, y las líneas cuya variable quede vacía se caen solas.
  waCobroTemplate: 'Hola {cliente}, ya terminamos el trabajo. Te paso los datos para la transferencia:\n\n{datos_pago}\n\nImporte: {importe}\nPresupuesto: {numero}\n\nCuando la hagas avisame así te confirmo la recepción. ¡Gracias!\n{empresa}',
  // Plantilla del mensaje de PRESUPUESTO ACTUALIZADO: el presupuesto venció,
  // el cliente volvió a escribir y se le pasa la segunda versión con los
  // precios de hoy (ver nuevaVersionQuote). Es el reemplazo de la plantilla de
  // envío cuando lo que sale es una versión, no un presupuesto nuevo: el
  // cliente ya conoce el trabajo, lo que cambió es el precio.
  waActualizacionTemplate: 'Hola {cliente}, ¿cómo andás? Te paso el presupuesto actualizado con los valores al día de hoy para que lo puedas revisar.\n\nCualquier duda quedo a disposición.\n\nSaludos,\n{empresa}',
};

function getFollowupCfg() {
  try {
    const raw = localStorage.getItem(LS.FOLLOWUP);
    if (raw) return Object.assign({}, FOLLOWUP_DEF, JSON.parse(raw));
  } catch(e) {}
  return Object.assign({}, FOLLOWUP_DEF);
}

function setFollowupCfg(cfg) {
  const merged = Object.assign({}, FOLLOWUP_DEF, cfg);
  safeSetLS(LS.FOLLOWUP, JSON.stringify(merged));
  return merged;
}

// Días transcurridos entre una fecha ISO y hoy (redondeado hacia abajo).
function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  const ms = Date.now() - then;
  return Math.floor(ms / 86400000);
}

// Devuelve la lista de presupuestos que necesitan seguimiento, según la
// config. Un presupuesto entra si:
//   - el seguimiento está habilitado
//   - su estado está en la lista de estados que disparan
//   - tiene fecha de envío (enviadoEn) → esto EXCLUYE los viejos
//   - pasaron >= los días configurados desde el envío
//   - no se hizo un seguimiento posterior al envío
function getPendingFollowups() {
  const cfg = getFollowupCfg();
  if (!cfg.enabled) return [];
  const h = (typeof getH === 'function') ? getH() : [];
  const out = [];
  for (const e of h) {
    const est = e.estado || 'borrador';
    if (!cfg.estados.includes(est)) continue;
    if (!e.enviadoEn) continue; // viejos sin fecha de envío: nunca recuerdan
    // Reemplazado por una versión nueva: el seguimiento es de la v2, que se
    // acaba de mandar. Seguir reclamando por el viejo es reclamar dos veces
    // por el mismo cliente.
    if (e.reemplazadoPor) continue;
    const d = daysSince(e.enviadoEn);
    if (d === null || d < cfg.days) continue;
    // Si ya se hizo seguimiento DESPUÉS del envío, no recordar de nuevo
    if (e.seguimientoHechoEn) {
      const seg = new Date(e.seguimientoHechoEn).getTime();
      const env = new Date(e.enviadoEn).getTime();
      if (seg >= env) continue;
    }
    out.push({ entry: e, dias: d });
  }
  // Más viejos primero (más urgentes)
  out.sort((a,b) => b.dias - a.dias);
  return out;
}

// Marca que ya se hizo el seguimiento de un presupuesto (deja de recordar).
function marcarSeguimientoHecho(id) {
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e) return;
  const prev = e.seguimientoHechoEn;
  e.seguimientoHechoEn = new Date().toISOString();
  setH(h);
  renderHistory();
  if (typeof renderFollowupBanner === 'function') renderFollowupBanner();
  toast('✓ Seguimiento registrado', 'ok');
  // Bitácora + Deshacer, igual que el ✓ del vencimiento: es el mismo gesto
  // (apagar un aviso que te recuerda un cliente sin respuesta).
  if (!prev && typeof logNotif === 'function') logNotif({
    icon: '📨', kind: 'seguimiento',
    text: `Seguimiento registrado: ${(e.clientName || '').trim() || '(sin nombre)'}${e.quoteNumber ? ` (N° ${e.quoteNumber})` : ''}`,
    action: { type: 'entry', id: e.id },
    undo: { type: 'segHecho', id: e.id },
  });
  // Ya no hay que recordar este: actualizar la lista en el Worker de push.
  if (S.pushEnabled && typeof syncPushFollowups === 'function') syncPushFollowups().catch(() => {});
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}

// Días transcurridos entre una fecha de CALENDARIO (YYYY-MM-DD) y hoy, en
// días locales (tz-safe: compara partes de fecha, no instantes UTC). Positivo
// si la fecha ya pasó. Sirve para vencimientos, que son fechas sin hora.
function daysSinceDate(iso) {
  if (!iso) return null;
  const p = String(iso).split('-');
  if (p.length !== 3) return null;
  const then = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  const t = today().split('-');
  const now = Date.UTC(+t[0], +t[1] - 1, +t[2]);
  if (isNaN(then) || isNaN(now)) return null;
  return Math.round((now - then) / 86400000);
}

// Devuelve los presupuestos ENVIADOS cuya fecha de vencimiento ya pasó.
// Un presupuesto entra si:
//   - el aviso de vencimiento está habilitado (cfg.expiryEnabled)
//   - su estado está en la lista que dispara seguimiento (cfg.estados)
//   - su snapshot tiene fecha de vencimiento (dateExpiry) ya pasada (< hoy)
//   - no se marcó como visto el vencimiento (vencimientoVistoEn)
//
// NO exige `enviadoEn`. El vencimiento se calcula desde `dateExpiry`, no desde
// cuándo se envió: quien dice que el presupuesto salió es el ESTADO, que lo
// puso el usuario. `enviadoEn` es un sello que solo tienen los marcados
// enviados después de que se agregó (y los que salieron por el botón de
// WhatsApp), así que exigirlo dejaba presupuestos vencidos FUERA del banner
// —sin su ✓ para cerrarlos— mientras la campanita y la Agenda sí los
// mostraban: avisos viejos clavados arriba que el usuario no podía descartar
// por ningún lado. El seguimiento sí lo necesita (cuenta días DESDE el envío)
// y por eso lo sigue pidiendo; el vencimiento no.
function getExpiredQuotes() {
  const cfg = getFollowupCfg();
  if (!cfg.enabled || !cfg.expiryEnabled) return [];
  const h = (typeof getH === 'function') ? getH() : [];
  const out = [];
  for (const e of h) {
    const est = e.estado || 'borrador';
    if (!cfg.estados.includes(est)) continue;
    const exp = e.snapshot && e.snapshot.dateExpiry;
    if (!exp) continue;
    const d = daysSinceDate(exp);
    if (d === null || d < 1) continue; // vence "hoy" todavía es válido
    if (e.vencimientoVistoEn) continue;
    // Ya se armó una versión nueva de este: el pendiente pasó a la v2 y
    // seguir avisando por el viejo es avisar dos veces por el mismo trabajo.
    if (e.reemplazadoPor) continue;
    out.push({ entry: e, dias: d });
  }
  // Más vencidos primero (más urgentes)
  out.sort((a, b) => b.dias - a.dias);
  return out;
}

// Marca que ya se vio el vencimiento de un presupuesto (deja de avisar).
// Único camino para descartar un vencimiento: lo usan el ✓ del banner y el de
// la campanita. Antes el del banner no dejaba rastro, así que el MISMO toque
// era reversible o no según desde dónde se diera.
function marcarVencimientoVisto(id) {
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e || e.vencimientoVistoEn) return;
  e.vencimientoVistoEn = new Date().toISOString();
  setH(h);
  renderHistory();
  if (typeof renderExpiryBanner === 'function') renderExpiryBanner();
  toast('✓ Listo, no te aviso más de este', 'ok');
  // Bitácora + Deshacer: apagar el aviso de un presupuesto no es poca cosa —
  // es el que te recuerda que ese cliente quedó sin respuesta.
  if (typeof logNotif === 'function') logNotif({
    icon: '⏳', kind: 'vencimiento',
    text: `Listo, no te aviso más del vencimiento: ${(e.clientName || '').trim() || '(sin nombre)'}${e.quoteNumber ? ` (N° ${e.quoteNumber})` : ''}`,
    action: { type: 'entry', id: e.id },
    undo: { type: 'vencVisto', id: e.id },
  });
  // Ya no hay que avisar de este: actualizar la lista en el Worker de push.
  if (S.pushEnabled && typeof syncPushFollowups === 'function') syncPushFollowups().catch(() => {});
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}

// "¿Qué pasó?" del banner de vencidos (v259): cerrar el vencido con lo que de
// verdad pasó. El ✓ solo apaga el aviso y el presupuesto sigue contando como
// vencido para siempre; en el uso real había 20 vencidos y 0 perdidos, así
// que la conversión del Mapa se apoyaba en una suposición. Aceptó y Perdido
// pasan por setEstadoHistory (que deja el "Deshacer"); Sigue en pie extiende
// la vigencia y lo vuelve a "esperando respuesta".
const VENC_RESPUESTAS = ['aceptado', 'perdido', 'sigue'];
function vencResponder(id, resp) {
  if (!VENC_RESPUESTAS.includes(resp)) return;
  if (resp === 'sigue') prorrogarVigencia(id);
  else setEstadoHistory(id, resp);
}

// Vigencia nueva desde HOY con los mismos días del presupuesto. Cambia
// snapshot.dateExpiry, que es lo que leen el banner, el pin del Mapa, la
// Agenda y el push; borra el "visto" para que avise de nuevo al vencer otra
// vez. Si el editor tiene abierto este mismo presupuesto, S también: el
// autoguardado pisaría la fecha nueva con la vieja.
function prorrogarVigencia(id) {
  const h = getH();
  const e = h.find(x => x.id === id);
  if (!e || !e.snapshot) return;
  const prev = e.snapshot.dateExpiry || '';
  const dias = parseInt(e.snapshot.validityDays, 10) > 0 ? parseInt(e.snapshot.validityDays, 10) : 30;
  const d = new Date(); d.setDate(d.getDate() + dias);
  const nueva = toLocalISODate(d);
  e.snapshot.dateExpiry = nueva;
  delete e.vencimientoVistoEn;
  setH(h);
  if (S.quoteNumber && S.quoteNumber === e.quoteNumber) {
    S.dateExpiry = nueva;
    sv('date-expiry', nueva);
    const el = document.getElementById('date-expiry');
    if (el && el._cdateBtn) syncCdate(el);
    saveLS();
  }
  renderHistory();
  toast(`Vigencia extendida hasta el ${fmtD(nueva)}`, 'ok');
  if (typeof logNotif === 'function') logNotif({
    icon: '⏳', kind: 'vencimiento',
    text: `Sigue en pie, vigencia hasta el ${fmtD(nueva)}: ${(e.clientName || '').trim() || '(sin nombre)'}${e.quoteNumber ? ` (N° ${e.quoteNumber})` : ''}`,
    action: { type: 'entry', id: e.id },
    undo: { type: 'prorroga', id: e.id, dateExpiry: prev },
  });
  if (S.pushEnabled && typeof syncPushFollowups === 'function') syncPushFollowups().catch(() => {});
  if (typeof updateNotifBadge === 'function') updateNotifBadge();
}

// Reemplaza las variables de una plantilla de WhatsApp. Único lugar donde se
// define qué variables existen: antes cada vía (el botón del editor y los
// avisos del historial) hacía su propio .replace() y era fácil que una
// ofreciera una variable que la otra no. `cliente`/`numero`/`empresa` los pasa
// el llamador —cada uno tiene su fallback— y los datos de cobro salen de la
// config global, que no depende del presupuesto.
function fillWaTemplate(tpl, vars) {
  const v = vars || {};
  const out = (tpl || '')
    .replace(/\{cliente\}/g,    v.cliente || '')
    .replace(/\{numero\}/g,     v.numero  || '')
    .replace(/\{empresa\}/g,    v.empresa || '')
    .replace(/\{importe\}/g,    v.importe || '')
    .replace(/\{datos_pago\}/g, _datosDePagoTexto())
    .replace(/\{alias\}/g,      (S.coAliasPago || '').trim())
    .replace(/\{cbu\}/g,        (S.coCbu || '').trim())
    .replace(/\{titular\}/g,    (S.coAliasTitular || '').trim())
    .replace(/\{banco\}/g,      (S.coBanco || '').trim())
    .replace(/\{cuit\}/g,       (S.coCuit || '').trim());
  // Una plantilla con etiquetas ("CBU: {cbu}") queda coja si el dato no está
  // cargado: sobra la etiqueta sola. Se cae la línea entera, y de paso los
  // huecos de más que deja al desaparecer.
  return out
    .split('\n')
    .filter(l => !/^\s*[\wÁÉÍÓÚÜÑáéíóúüñ /.()]{1,30}:\s*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Bloque de datos de cobro para los mensajes: una línea por dato cargado, con
// etiqueta. Es el formato con el que se pasan los datos de una transferencia
// en Argentina — el cliente los va leyendo y copiando de arriba a abajo en el
// homebanking. Titular y CUIT no son burocracia: al transferir, el banco le
// muestra a quién le está por pagar y necesita poder verificarlo.
function _datosDePagoTexto() {
  return [
    ['Titular',   (S.coAliasTitular || '').trim()],
    ['CUIT',      (S.coCuit || '').trim()],
    ['Banco',     (S.coBanco || '').trim()],
    ['CBU/CVU',   (S.coCbu || '').trim()],
    ['Alias',     (S.coAliasPago || '').trim()],
  ].filter(([, val]) => val).map(([lbl, val]) => `${lbl}: ${val}`).join('\n');
}

// Construye el enlace wa.me con el mensaje predeterminado para un entry.
// Reemplaza las variables de la plantilla con los datos del presupuesto.
// `tpl` (opcional) permite usar otra plantilla (ej: la de recontacto).
function buildWhatsappLink(entry, tpl) {
  const cfg = getFollowupCfg();
  const cliente = (entry.clientName || '').trim() || 'cliente';
  const numero  = entry.quoteNumber || '';
  const empresa = (S.coName || 'Poda en Altura AR').trim();
  // El importe sale del total YA GUARDADO en la entrada, no de recalcularlo:
  // es el que vio el cliente en el PDF que se le mandó.
  const importe = entry.total > 0 ? fmtM(entry.total, entry.currency || 'ARS') : '';
  let msg = fillWaTemplate(tpl || cfg.waTemplate, { cliente, numero, empresa, importe });
  // El contacto del cliente vive en el snapshot (clientContact).
  const rawPhone = (entry.snapshot && entry.snapshot.clientContact) || '';
  const phone = normalizeArgPhone(rawPhone);
  // wa.me requiere el número con código de país sin + ni espacios.
  // Si no hay teléfono, abrimos WhatsApp con el texto para que elija contacto.
  const base = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(msg)}`;
}

// Normaliza un teléfono argentino al formato que espera WhatsApp:
//   54 + 9 + código de área + número  (sin +, sin espacios, sin guiones)
// Ejemplos que maneja:
//   "+54 9 3543 68-0871"  → "5493543680871"
//   "3543 68-0871"        → "5493543680871"
//   "0351 650-7699"       → "5493516507699"
//   "11 1234-5678"        → "5491112345678"
// Si ya viene con código de país, lo respeta. Un número con prefijo
// internacional explícito de OTRO país ("+34 647 83 83 08", "0034...")
// se devuelve tal cual, sin tocar: anteponerle 549 lo rompería.
// Si no reconoce el formato, devuelve los dígitos tal cual (mejor
// intentar que no hacer nada).
function normalizeArgPhone(raw) {
  raw = (raw + '').trim();
  // "+..." o "00...": el usuario ya escribió el código de país.
  const intl = /^(\+|00)/.test(raw);
  let d = raw.replace(/[^\d]/g, '');
  if (!d) return '';
  // Quitar 00 inicial (prefijo internacional alternativo)
  if (d.startsWith('00')) d = d.slice(2);
  // Ya tiene código de país argentino
  if (d.startsWith('54')) {
    let rest = d.slice(2);
    // Asegurar el 9 de celular tras el 54
    if (!rest.startsWith('9')) rest = '9' + rest;
    return '54' + rest;
  }
  // Código de país extranjero explícito: respetarlo sin heurísticas argentinas
  if (intl) return d;
  // Número local: quitar 0 inicial (larga distancia) y 15 de celular
  if (d.startsWith('0')) d = d.slice(1);
  // Si quedó un "15" después del área es difícil de detectar sin el área;
  // asumimos que el usuario cargó un celular válido. Anteponer 54 9.
  return '549' + d;
}
