'use strict';

// ═══════════════════════════════════════
// FACTURACION.JS — Tab de facturación / control de tope Monotributo
// ═══════════════════════════════════════

const FACT_KEY = 'pq_facturas';
const TOPE_KEY = 'pq_tope_anual';
const RECIBO_SEQ_KEY = 'pq_recibo_seq'; // último número de recibo emitido (correlativo propio, sin validez fiscal)
const TOPE_DEF = 15058447.71; // vigente desde febrero 2026
const TOPE_DEF_VIGENTE_DESDE = '2026-02-01';

function getFacturas() {
  try {
    const a = JSON.parse(localStorage.getItem(FACT_KEY)||'[]');
    if (Array.isArray(a)) return a;
    const fixed = sanitizeFacturas(a);
    try { safeSetLS(FACT_KEY, JSON.stringify(fixed)); } catch(_){}
    return fixed;
  } catch(e){ return []; }
}
function setFacturas(arr) { safeSetLS(FACT_KEY, JSON.stringify(arr)); }
// Facturado en los últimos 12 meses (lo que se compara contra el tope). Lo usan
// la pantalla de Facturación y el resumen de los lunes de las notificaciones.
function factTotalAnual(now, facturas) {
  const hace12 = new Date(now); hace12.setFullYear(hace12.getFullYear()-1);
  const ultimas = (facturas || getFacturas()).filter(f=>{ const d=new Date(f.fecha); return d>=hace12 && d<=now; });
  return centsToMoney(ultimas.reduce((s,f)=>s+moneyToCents(f.monto), 0));
}
function getTope() { const v=roundMoney(localStorage.getItem(TOPE_KEY)); return v>0? v : TOPE_DEF; }
function setTope(v) { safeSetLS(TOPE_KEY, String(v)); }

function fmtARS(n)  { return '$ '+Math.round(roundMoney(n)).toLocaleString('es-AR'); }
// Con centavos. Se usa SOLO en el recibo, y solo cuando el monto realmente los
// tiene (ver buildReciboDoc): un recibo de pago es un comprobante y ahí el
// importe tiene que coincidir exacto con lo cobrado. En el resto de la app el
// dinero va sin centavos (ver fmtM).
function fmtARSd(n) { return '$ '+roundMoney(n).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ─── INIT ────────────────────────────────────
function factInit() {
  const inp = document.getElementById('fact-tope-input');
  if(inp) inp.value = Math.round(getTope());
  const fd = document.getElementById('fact-fecha');
  // Fecha LOCAL, no UTC: toISOString() corre el día en Argentina (UTC-3)
  // después de las 21 hs y la factura quedaría fechada al día siguiente.
  if(fd && !fd.value) fd.value = today();
  if(typeof refreshCustomDates === 'function') refreshCustomDates();
  factRenderReminder();
  factRender();
}

// ─── RECORDATORIO ────────────────────────────
function factRenderReminder() {
  const now   = new Date();
  const month = now.getMonth()+1;
  const year  = now.getFullYear();

  let proxMes, proxAnio;
  if(month < 2)      { proxMes=2; proxAnio=year; }
  else if(month < 8) { proxMes=8; proxAnio=year; }
  else               { proxMes=2; proxAnio=year+1; }

  const nombresMes = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const proxNombre = nombresMes[proxMes-1];

  const msgEl  = document.getElementById('fact-remind-msg');
  const subEl  = document.getElementById('fact-remind-sub');
  const linkEl = document.getElementById('fact-claude-link');

  const proxFecha = new Date(proxAnio, proxMes-1, 1);
  const diffDias  = Math.round((proxFecha - now) / 86400000);
  const cercano   = diffDias <= 30;

  if(subEl){
    subEl.textContent = cercano
      ? `⚠️ Actualización en ${diffDias} días — ${proxNombre} ${proxAnio}`
      : `Próxima actualización: ${proxNombre} ${proxAnio} (en ${diffDias} días)`;
    subEl.style.color = cercano ? '#92400e' : '';
  }

  if(msgEl){
    msgEl.innerHTML = `Tope vigente desde <strong>${fmtD(TOPE_DEF_VIGENTE_DESDE)}</strong>: <strong>${fmtARS(TOPE_DEF)}</strong> anuales (actualización +14,29%).<br>
    Cuando llegue ${proxNombre}, usá el botón de abajo para consultar el nuevo valor y actualizarlo en el campo de tope.`;
  }

  const pregunta = encodeURIComponent('¿Cuál es el tope de facturación anual vigente para la Categoría B del Monotributo en Argentina en ' + proxAnio + ', para locaciones de servicios? Dame el valor exacto en pesos y desde cuándo rige.');
  if(linkEl) linkEl.href = `https://claude.ai/new?q=${pregunta}`;
}

// ─── RENDER PRINCIPAL ────────────────────────
function factRender() {
  const facturas = getFacturas();
  const tope     = getTope();
  const now      = new Date();

  const totalAnual = factTotalAnual(now, facturas);

  // Este mes
  const mesActual = now.getFullYear()+'-'+(String(now.getMonth()+1).padStart(2,'0'));
  const delMes    = facturas.filter(f=>f.fecha && f.fecha.startsWith(mesActual));
  const totalMes  = centsToMoney(delMes.reduce((s,f)=>s+moneyToCents(f.monto), 0));

  const pct        = tope>0 ? Math.min(totalAnual/tope*100, 100) : 0;
  const promMensual = totalAnual / 12;
  const topeRefMes  = tope / 12;
  const disponible  = Math.max(0, tope-totalAnual);

  // Hero
  const heroVal = document.getElementById('fact-anual-val');
  const heroSub = document.getElementById('fact-anual-sub');
  const promVal = document.getElementById('fact-prom-val');
  const promSub = document.getElementById('fact-prom-sub');
  const fill    = document.getElementById('fact-fill');
  const pctLbl  = document.getElementById('fact-pct-label');

  if(heroVal) heroVal.textContent = fmtARS(totalAnual);
  if(heroSub) heroSub.textContent = 'de '+fmtARS(tope)+' — tope anual Cat. B';
  if(promVal) promVal.textContent = fmtARS(promMensual);
  if(promSub) promSub.textContent = 'referencia: '+fmtARS(topeRefMes)+'/mes';
  if(fill){
    fill.style.width = pct+'%';
    fill.className = 'fact-progress-fill'+(pct>=90?' danger':pct>=70?' warn':'');
  }
  if(pctLbl) pctLbl.textContent = pct.toFixed(1)+'% del tope anual';

  // Alerta
  const alertBox = document.getElementById('fact-alert-box');
  if(alertBox){
    if(pct>=100){
      alertBox.className='fact-alert danger'; alertBox.style.display='flex';
      alertBox.textContent='⚠️ Superaste el tope anual. Consultá con tu contador sobre recategorización.';
    } else if(pct>=90){
      alertBox.className='fact-alert danger'; alertBox.style.display='flex';
      alertBox.textContent='Estás al '+pct.toFixed(0)+'% del tope. Cuidado con los próximos trabajos.';
    } else if(pct>=70){
      alertBox.className='fact-alert warn'; alertBox.style.display='flex';
      alertBox.textContent='Llegaste al '+pct.toFixed(0)+'% del tope anual. Empezá a monitorear de cerca.';
    } else {
      alertBox.style.display='none';
    }
  }

  // Tarjetas rápidas
  const fcMes    = document.getElementById('fc-mes');
  const fcMesSub = document.getElementById('fc-mes-sub');
  const fcDisp   = document.getElementById('fc-disp');
  if(fcMes)    fcMes.textContent    = fmtARS(totalMes);
  if(fcMesSub) fcMesSub.textContent = delMes.length+' factura'+(delMes.length!==1?'s':'');
  if(fcDisp)   fcDisp.textContent   = fmtARS(disponible);

  // Count
  const cnt = document.getElementById('fact-count');
  if(cnt) cnt.textContent = facturas.length;

  // Lista de facturas
  const list = document.getElementById('fact-reg-list');
  if(!list) return;
  if(!facturas.length){
    list.innerHTML = '<div class="fact-empty">Ninguna factura registrada aún.<br>Registrá tus facturas para controlar el límite.</div>';
    return;
  }
  const sorted = [...facturas].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  list.innerHTML = sorted.map(f=>`
    <div class="fact-reg-item">
      <div class="fact-reg-info${f.quoteNumber?' is-linked':''}" onclick="factIrAlPresupuesto('${f.id}')" title="${f.quoteNumber?'Ver el presupuesto en el historial':''}">
        <div class="fact-reg-date">${esc(f.fecha)}</div>
        <div class="fact-reg-client">${esc(f.cliente||'—')}</div>
        ${f.desc && f.desc !== 'Presupuesto ' + (f.quoteNumber||'') ? `<div class="fact-reg-meta">${esc(f.desc)}</div>` : ''}
        ${f.quoteNumber?`<div class="fact-reg-meta fact-reg-link">→ Presupuesto ${esc(f.quoteNumber)}</div>`:''}
        ${f.reciboNum?`<div class="fact-reg-meta">🧾 Recibo ${esc(f.reciboNum)}</div>`:''}
      </div>
      <div class="fact-reg-amt">${fmtARS(f.monto)}</div>
      <button class="btn btn-s btn-sm" onclick="factRecibo('${f.id}')" title="Generar recibo de pago (PDF)">🧾</button>
      <button class="btn btn-d btn-sm" onclick="factEliminar('${f.id}')">✕</button>
    </div>`).join('');
}

// ─── ACCIONES ────────────────────────────────
function factRegistrar() {
  const fecha   = (document.getElementById('fact-fecha')  ||{}).value||'';
  const monto   = roundMoney((document.getElementById('fact-monto')||{}).value);
  const cliente = ((document.getElementById('fact-cliente')||{}).value||'').trim();
  const desc    = ((document.getElementById('fact-desc')  ||{}).value||'').trim();
  if(!fecha)    { toast('Ingresá la fecha','err'); return; }
  if(monto<=0)  { toast('Ingresá un monto válido','err'); return; }

  const arr = getFacturas();
  const factura = { id: Date.now().toString(), fecha, monto, cliente, desc };
  // Si venimos del puente "presupuesto realizado → factura", enlazamos la
  // factura con su presupuesto y lo marcamos como facturado (no re-ofrecer).
  if (_pendingFacturaQuote) {
    factura.quoteNumber = _pendingFacturaQuote.quoteNumber || '';
    try {
      const h = getH();
      const e = h.find(x => x.id === _pendingFacturaQuote.id);
      if (e) { e.facturado = true; setH(h); }
    } catch(_) {}
    _pendingFacturaQuote = null;
  }
  arr.push(factura);
  setFacturas(arr);

  // Limpiar form (excepto fecha)
  const mi = document.getElementById('fact-monto');   if(mi) mi.value='';
  const ci = document.getElementById('fact-cliente'); if(ci) ci.value='';
  const di = document.getElementById('fact-desc');    if(di) di.value='';

  factRender();
  toast('Factura registrada','ok');
}

function factEliminar(id) {
  setFacturas(getFacturas().filter(f=>f.id!==id));
  factRender();
  toast('Factura eliminada','info');
}

// Al tocar una factura, saltar al presupuesto del que se generó (reusa
// goToHistoryEntry: limpia filtros, despliega el mes, centra y resalta).
// Solo las facturas que vinieron por el puente "realizado → factura"
// tienen quoteNumber; las cargadas a mano no se pueden enlazar con certeza.
function factIrAlPresupuesto(id) {
  const f = getFacturas().find(x => x.id === id);
  if (!f) return;
  if (!f.quoteNumber) { toast('Esta factura no está enlazada a un presupuesto', 'info'); return; }
  const e = getH().find(x => x.quoteNumber === f.quoteNumber);
  if (!e) { toast('No se encontró el presupuesto ' + f.quoteNumber + ' en el historial', 'err'); return; }
  goToHistoryEntry(e.id);
}

// ─── RECIBO DE PAGO ──────────────────────────
// Genera el PDF del recibo de una factura registrada. El número de recibo es
// correlativo propio (R-0001, R-0002…): se asigna la primera vez y queda
// guardado en la factura, así reimprimir NO consume un número nuevo.

function _nextReciboNum() {
  const seq = (parseInt(localStorage.getItem(RECIBO_SEQ_KEY)||'0', 10) || 0) + 1;
  safeSetLS(RECIBO_SEQ_KEY, String(seq));
  return 'R-' + String(seq).padStart(4, '0');
}

// Monto en pesos a letras, estilo recibo tradicional ("pesos ciento cincuenta
// mil"). Hasta 999.999.999; centavos como "con 50/100". Fuera de rango → ''.
function montoEnLetras(monto) {
  const cents  = moneyToCents(monto);
  const entero = Math.floor(cents/100), cent = cents%100;
  if (entero < 0 || entero > 999999999) return '';
  const U=['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
  const D=['','','','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  const C=['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
  const centena = n => { // 0..999
    if (n === 0)   return '';
    if (n === 100) return 'cien';
    const c = Math.floor(n/100), r = n%100;
    let s = C[c];
    if (r) {
      if (s) s += ' ';
      if (r < 30) s += U[r];
      else { s += D[Math.floor(r/10)]; if (r%10) s += ' y ' + U[r%10]; }
    }
    return s;
  };
  // "uno" → "un" cuando precede a mil/millón ("veintiún mil", "treinta y un millones")
  const apoc = s => s.replace(/veintiuno$/,'veintiún').replace(/ uno$/,' un').replace(/^uno$/,'un');
  const miles = n => { // 0..999999
    const m = Math.floor(n/1000), r = n%1000;
    let s = '';
    if (m === 1) s = 'mil';
    else if (m > 1) s = apoc(centena(m)) + ' mil';
    if (r) s += (s?' ':'') + centena(r);
    return s;
  };
  let s = '';
  const mill = Math.floor(entero/1000000), resto = entero%1000000;
  if (mill === 1) s = 'un millón';
  else if (mill > 1) s = apoc(miles(mill)) + ' millones';
  if (resto) s += (s?' ':'') + miles(resto);
  if (!s) s = 'cero';
  if (cent) s += ' con ' + String(cent).padStart(2,'0') + '/100';
  return s;
}

// Imprime el recibo de la factura `id`. Mismo patrón swap que la vista previa
// del historial: backup de S y #doc-a4 → construir el recibo → window.print()
// → restaurar. Lo que el usuario está editando no se toca.
function factRecibo(id) {
  const arr = getFacturas();
  const f = arr.find(x => x.id === id);
  if (!f) return;

  if (!f.reciboNum) {
    f.reciboNum = _nextReciboNum();
    setFacturas(arr);
    factRender(); // mostrar el número asignado en la lista
  }

  // Detalle del trabajo desde el presupuesto enlazado (si vino por el puente
  // "realizado → factura"). Con escenarios A/B no sabemos cuál se aceptó,
  // así que en ese caso no listamos ítems (el concepto ya identifica el
  // presupuesto).
  const trabajos = [];
  if (f.quoteNumber) {
    try {
      const e = getH().find(x => x.quoteNumber === f.quoteNumber);
      const snap = e && e.snapshot;
      if (snap && Array.isArray(snap.items) && !snap.scenariosEnabled) {
        snap.items.forEach(it => {
          if (it.type === 'tree')         trabajos.push((it.species ? it.species + ': ' : '') + (it.desc || 'trabajo sobre árbol'));
          else if (it.type === 'service') trabajos.push(it.desc || 'servicio');
        });
      }
    } catch(_) {}
  }

  const concepto = f.desc
    || (f.quoteNumber ? 'Trabajo según presupuesto ' + f.quoteNumber : 'Trabajos de poda y/o extracción de árboles');

  const docEl = document.getElementById('doc-a4');
  if (!docEl) return;
  const backup = {
    S: JSON.parse(JSON.stringify(S)),
    docHTML: docEl.innerHTML,
    title: document.title,
  };
  try {
    toast('Generando recibo…', 'info', 1500);
    S.quoteNumber = f.reciboNum; // el header del documento muestra este número
    buildReciboDoc({
      fecha: f.fecha, monto: f.monto, cliente: f.cliente,
      concepto, trabajos, quoteNumber: f.quoteNumber || '',
    });
    // El título es el nombre de archivo del PDF: "Recibo R-0001 - Cliente.pdf"
    document.title = 'Recibo ' + f.reciboNum + (f.cliente ? ' - ' + f.cliente : '');
    setTimeout(() => {
      window.print();
      // En Android window.print() NO bloquea: vuelve al instante con el
      // diálogo aún abierto, y Chrome RE-renderiza el DOM vivo si el
      // usuario cambia el tamaño de papel (Carta→A4). Por eso NO se
      // restaura #doc-a4 acá — quedaría el PDF en blanco. El recibo queda
      // en el DOM: está oculto fuera de impresión y todos los flujos lo
      // reconstruyen antes de usarlo (printDoc tampoco restaura).
      Object.assign(S, backup.S); // el estado sí se restaura ya mismo
      _restoreDocTitleWhenBack(backup.title); // recién al volver del diálogo
    }, 150);
  } catch (err) {
    console.error('Error al generar el recibo', err);
    Object.assign(S, backup.S);
    docEl.innerHTML = backup.docHTML;
    document.title = backup.title;
    toast('No se pudo generar el recibo', 'err');
  }
}

async function factLimpiar() {
  const ok = await confirmDlg('Limpiar facturas','¿Eliminar todas las facturas registradas?','Limpiar','btn-d');
  if(!ok) return;
  setFacturas([]);
  factRender();
  toast('Historial de facturas eliminado','info');
}

function factSaveTope() {
  const v = roundMoney((document.getElementById('fact-tope-input')||{}).value);
  if(v<=0) { toast('Ingresá un tope válido','err'); return; }
  setTope(v);
  factRender();
  toast('Tope actualizado','ok');
}

function factTopeChanged() {
  // live preview — no guardamos hasta que presiona Guardar
}
