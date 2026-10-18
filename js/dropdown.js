'use strict';

/*
   Reemplaza el <select> nativo (diálogo oscuro de Chrome) por un dropdown con
   el tema de la app. NO toca la lógica: el <select> real queda oculto como
   fuente de datos y este componente solo escribe su valor y dispara un evento
   'change' que burbujea — el mismo que dispararía el navegador —, así los
   onchange inline y el listener global de syncFromUI() siguen funcionando. */
let _cselOpen = null;        // {sel, btn, pop, backdrop} del dropdown abierto
let _cselScrollHandler = null;

function enhanceSelects(root){
  (root || document).querySelectorAll('select:not([data-csel])').forEach(sel => {
    if (sel.multiple) return;
    sel.setAttribute('data-csel', '1');
    sel.classList.add('csel-native');
    const wrap = document.createElement('span');
    wrap.className = 'csel';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'csel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    const al = sel.getAttribute('aria-label'); if (al) btn.setAttribute('aria-label', al);
    if (sel.title) btn.title = sel.title;
    btn.innerHTML = '<span class="csel-label"></span>';
    wrap.appendChild(btn);
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); _cselToggle(sel, btn); });
    sel.addEventListener('change', () => syncCsel(sel));
    sel._cselBtn = btn;
    syncCsel(sel);
  });
}

// Refleja el valor (y los colores inline, p. ej. el pill de estado) del
// <select> en su botón. Se llama tras cambios programáticos de .value.
function syncCsel(sel){
  const btn = sel._cselBtn; if (!btn) return;
  const o = sel.options[sel.selectedIndex];
  const lbl = btn.querySelector('.csel-label');
  if (lbl) lbl.textContent = o ? o.textContent : '';
  btn.style.color = sel.style.color || '';
  btn.style.backgroundColor = sel.style.backgroundColor || '';
  btn.style.borderColor = sel.style.borderColor || '';
}
function refreshCustomSelects(root){
  (root || document).querySelectorAll('select[data-csel]').forEach(syncCsel);
}

function _cselToggle(sel, btn){
  if (_cselOpen && _cselOpen.sel === sel) { closeCsel(); return; }
  closeCsel();
  _cselOpen_open(sel, btn);
}

function _cselOpen_open(sel, btn){
  const backdrop = document.createElement('div');
  backdrop.className = 'csel-backdrop';
  backdrop.addEventListener('click', closeCsel);
  const pop = document.createElement('div');
  pop.className = 'csel-pop';
  pop.setAttribute('role', 'listbox');
  [...sel.options].forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'csel-opt' + (i === sel.selectedIndex ? ' is-active' : '');
    row.setAttribute('role', 'option');
    row.innerHTML = `<span>${esc(o.textContent)}</span><span class="csel-check">${icon('check')}</span>`;
    row.addEventListener('click', () => {
      if (sel.value !== o.value) {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      closeCsel();
    });
    pop.appendChild(row);
  });
  document.body.appendChild(backdrop);
  document.body.appendChild(pop);
  btn.classList.add('is-open');
  _cselOpen = { sel, btn, pop, backdrop };
  _cselPosition(pop, btn);
  _cselScrollHandler = (e) => { if (_cselOpen && _cselOpen.pop.contains(e.target)) return; closeCsel(); };
  window.addEventListener('scroll', _cselScrollHandler, true);
  window.addEventListener('resize', _cselScrollHandler);
  document.addEventListener('keydown', _cselKey);
  const act = pop.querySelector('.csel-opt.is-active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function _cselPosition(pop, btn){
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  pop.style.minWidth = r.width + 'px';
  pop.style.left = '0px'; pop.style.top = '0px';
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.left;
  if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw);
  let top = r.bottom + 4;
  if (top + ph > vh - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
  pop.style.left = left + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}

function closeCsel(){
  if (!_cselOpen) return;
  const { btn, pop, backdrop } = _cselOpen;
  if (btn) btn.classList.remove('is-open');
  pop.remove(); backdrop.remove();
  window.removeEventListener('scroll', _cselScrollHandler, true);
  window.removeEventListener('resize', _cselScrollHandler);
  document.removeEventListener('keydown', _cselKey);
  _cselOpen = null;
}
function _cselKey(e){ if (e.key === 'Escape') closeCsel(); }
