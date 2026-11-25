// Live preview: renders the real public page with the draft data into an
// iframe, at desktop or phone width.

import { renderPreview } from '../render/index.js';
import { SITE } from '../config.js';
import { todayISO } from '../util.js';
import { h, debounce } from './dom.js';
import * as store from './store.js';
import { spotlight } from './spotlight.js';

export function siteUrl() {
  const { hostname } = location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || location.protocol === 'file:') return SITE.defaultUrl;
  return new URL('.', location.href).href.replace(/\/$/, '');
}

export function previewHtml(data, route) {
  return renderPreview(data, {
    today: todayISO(),
    siteUrl: siteUrl(),
    version: '',
    assetUrl: (p) => store.assetUrl(p),
    imageSize: (p) => store.imageSize(p),
  }, route);
}

// getData() returns the data to show, getRoute() the page ("agenda/<id>", "home"…). The form
// and the preview point at each other through spotlight() (src/admin/spotlight.js).
export function previewPane({ getData, getRoute }) {
  let device = 'desktop';
  const frame = h('iframe', { class: 'pv-frame', title: 'Prévia da página', loading: 'eager' });
  const stage = h('div', { class: 'pv-stage' }, frame);
  const spot = spotlight(stage, frame);
  const buttons = ['desktop', 'mobile'].map((d) => h('button', {
    type: 'button',
    class: `chip${d === device ? ' on' : ''}`,
    'aria-pressed': String(d === device),
    onclick: () => {
      device = d;
      buttons.forEach((b) => {
        const on = b.dataset.device === d;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      layout();
    },
    dataset: { device: d },
  }, d === 'desktop' ? 'Computador' : 'Celular'));
  const el = h('div', { class: 'pv' }, h('div', { class: 'pv-bar' }, h('span', { class: 'pv-title' }, h('i', { class: 'live' }), 'Prévia ao vivo'), h('div', { class: 'pv-devices' }, buttons)), stage);

  const layout = () => {
    const width = device === 'desktop' ? 1280 : 390;
    const available = stage.clientWidth || 600;
    const scale = Math.min(1, available / width);
    const height = (stage.clientHeight || 700) / scale;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    stage.classList.toggle('mobile', device === 'mobile');
    requestAnimationFrame(() => spot.refresh());
  };
  new ResizeObserver(layout).observe(stage);

  const update = debounce(() => {
    let html;
    try {
      html = previewHtml(getData(), getRoute());
    } catch (error) {
      html = `<p style="font:16px system-ui;padding:20px">Não consegui montar a prévia: ${String(error.message).replace(/</g, '&lt;')}</p>`;
    }
    if (!html) return;
    let y = 0;
    try {
      y = frame.contentWindow ? frame.contentWindow.scrollY : 0;
    } catch {
      y = 0;
    }
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      frame.contentWindow.scrollTo(0, y);
      doc.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a) e.preventDefault();
      }, true);
      spot.refresh();
    };
    frame.srcdoc = html;
  }, 300);

  layout();
  update.flush();
  return { el, update, spotlight: (spec) => spot.show(spec), pick: (fn) => spot.pick(fn) };
}
