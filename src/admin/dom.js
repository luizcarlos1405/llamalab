// Tiny DOM helpers for the admin.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'html') el.innerHTML = value; // trusted markup only (logo SVGs)
      else if (key === 'value') el.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'open' || key === 'selected') el[key] = Boolean(value);
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  add(el, kids);
  return el;
}

export function add(el, ...kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  el.replaceChildren();
  return el;
}

/* ---------- toast ---------- */

let toastEl;
let toastTimer;
export function toast(text, kind = '') {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  toastEl.className = `toast on ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = `toast ${kind}`;
  }, kind === 'error' ? 6000 : 3200);
}

/* ---------- dialogs ---------- */

export function dialog({ title, body, actions, wide = false, onClose }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' wide' : ''}` });
  const close = (value) => {
    dlg.close();
    dlg.remove();
    if (onClose) onClose(value);
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(undefined);
  });
  add(dlg, [
    h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'x', type: 'button', 'aria-label': 'Fechar', onclick: () => close(undefined) }, '×')),
    h('div', { class: 'dlg-body' }, body),
    actions ? h('div', { class: 'dlg-actions' }, actions(close)) : null,
  ]);
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function confirm({ title, text, ok = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    dialog({
      title,
      body: h('p', null, text),
      onClose: (v) => resolve(Boolean(v)),
      actions: (close) => [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(false) }, cancel),
        h('button', { class: `btn ${danger ? 'btn-red' : 'btn-k'}`, type: 'button', onclick: () => close(true) }, ok),
      ],
    });
  });
}

/* ---------- formatting ---------- */

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function timeAgo(date) {
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'agora mesmo';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `há ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
  return new Date(date).toLocaleDateString('pt-BR');
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}
