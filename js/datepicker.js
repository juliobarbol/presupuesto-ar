'use strict';

/*
   Calendario propio con el tema de la app para los <input type="date">
   EDITABLES (fecha de emisión, fecha de factura). Mismo enfoque que los
   dropdowns: el input nativo queda oculto como fuente de datos y solo
   escribimos su .value y disparamos 'input'+'change' (los mismos eventos del
   navegador), así onDateChange()/factura y syncFromUI() siguen igual.
   FECHAS EN LOCAL: se parsea y construye con año/mes/día; nunca
   new Date('YYYY-MM-DD') (sería UTC) ni toISOString(). */
const CAL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CAL_WD = ['Lu','Ma','Mi','Ju','Vi','Sá','Do']; // la semana empieza el lunes

function enhanceDateInputs(root){
  (root || document).querySelectorAll('input[type="date"]:not([data-cdate])').forEach(inp => {
    // Los readonly (p. ej. el vencimiento, que se calcula solo) se muestran
    // como display estático con el mismo look, pero sin abrir calendario.
    const ro = inp.readOnly || inp.disabled;
    inp.setAttribute('data-cdate', '1');
    inp.classList.add('csel-native');
    const wrap = document.createElement('span');
    wrap.className = 'cdate';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const el = document.createElement(ro ? 'div' : 'button');
    if (!ro) el.type = 'button';
    el.className = 'cdate-btn' + (ro ? ' cdate-ro' : '');
    const al = inp.getAttribute('aria-label'); if (al && !ro) el.setAttribute('aria-label', al);
    el.innerHTML = `<span class="cdate-lbl"></span><span class="cdate-ico">${icon('calendar')}</span>`;
    wrap.appendChild(el);
    if (!ro){
      el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _cdateToggle(inp, el); });
      inp.addEventListener('change', () => syncCdate(inp));
      inp.addEventListener('input', () => syncCdate(inp));
    }
    inp._cdateBtn = el;
    syncCdate(inp);
  });
}

function syncCdate(inp){
  const btn = inp._cdateBtn; if (!btn) return;
  const lbl = btn.querySelector('.cdate-lbl');
  if (!lbl) return;
  lbl.textContent = inp.value ? fmtD(inp.value) : (inp.readOnly ? '—' : 'Elegí una fecha');
  lbl.classList.toggle('is-empty', !inp.value);
}
function refreshCustomDates(root){
  (root || document).querySelectorAll('input[type="date"][data-cdate]').forEach(syncCdate);
}

function _cdateToggle(inp, btn){
  if (_cselOpen && _cselOpen.btn === btn) { closeCsel(); return; }
  closeCsel();
  _calOpen(inp, btn);
}

// YYYY-MM-DD → {y, m (0-11), d}, sin Date() para no correr el día por UTC.
function _parseISODate(v){
  const p = String(v || '').split('-');
  if (p.length === 3 && p[0] && p[1] && p[2]) return { y:+p[0], m:+p[1]-1, d:+p[2] };
  const t = today().split('-'); return { y:+t[0], m:+t[1]-1, d:+t[2] };
}

function _calOpen(inp, btn){
  const start = _parseISODate(inp.value);
  let viewY = start.y, viewM = start.m;
  const tIso = today();
  const pop = document.createElement('div');
  pop.className = 'cal-pop';
  pop.setAttribute('role', 'dialog');

  const isoFor = (y,m,d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

  function pick(iso){
    if (inp.value !== iso){
      inp.value = iso;
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeCsel();
  }

  function render(){
    const firstDow = new Date(viewY, viewM, 1).getDay();   // 0=Dom ... 6=Sáb (local)
    const lead = (firstDow + 6) % 7;                        // semana empieza el lunes
    const dim  = new Date(viewY, viewM + 1, 0).getDate();   // días del mes (local)
    const selIso = inp.value;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<button type="button" class="cal-day is-empty" tabindex="-1"></button>`;
    for (let d = 1; d <= dim; d++){
      const iso = isoFor(viewY, viewM, d);
      const cls = 'cal-day' + (iso === selIso ? ' is-sel' : '') + (iso === tIso ? ' is-today' : '');
      cells += `<button type="button" class="${cls}" data-iso="${iso}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Mes anterior">‹</button>
        <span class="cal-title">${CAL_MONTHS[viewM]} ${viewY}</span>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal-grid">${CAL_WD.map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells}</div>
      <div class="cal-foot"><button type="button" class="btn btn-g btn-sm" data-today="1">Hoy</button></div>`;
    pop.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      viewM += (+b.dataset.nav);
      if (viewM < 0) { viewM = 11; viewY--; } else if (viewM > 11) { viewM = 0; viewY++; }
      render(); _cselPosition(pop, btn);
    }));
    pop.querySelector('[data-today]').addEventListener('click', () => pick(tIso));
    pop.querySelectorAll('.cal-day[data-iso]').forEach(b => b.addEventListener('click', () => pick(b.dataset.iso)));
  }

  render();
  const backdrop = document.createElement('div');
  backdrop.className = 'csel-backdrop';
  backdrop.addEventListener('click', closeCsel);
  document.body.appendChild(backdrop);
  document.body.appendChild(pop);
  btn.classList.add('is-open');
  _cselOpen = { sel: null, btn, pop, backdrop };
  _cselPosition(pop, btn);
  _cselScrollHandler = (e) => { if (_cselOpen && _cselOpen.pop.contains(e.target)) return; closeCsel(); };
  window.addEventListener('scroll', _cselScrollHandler, true);
  window.addEventListener('resize', _cselScrollHandler);
  document.addEventListener('keydown', _cselKey);
}
