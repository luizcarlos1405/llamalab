// "Post da agenda": the agenda's events in a date range, turned into the
// "Agenda cultural" carousel for Instagram (drawn by post-draw.js), ready to
// share or download, plus a caption to paste. Nothing here goes to the site.

import { COLLECTIONS } from '../schema.js';
import { todayISO, addDays, weekday, eventEnd, parseDate } from '../util.js';
import { h, add, clear, toast, debounce } from './dom.js';
import * as store from './store.js';
import { carousel, paint, dateParts, eventTitle, eventBody, blurb, DEFAULT_LINE, W, H } from './post-draw.js';
import { zip } from './zip.js';

const MAX_SLIDES = 20; // the most Instagram takes in one post
const QUALITY = 0.92;
const LINE_KEY = 'llamalab:post-chamada';
const INTRO = 'Se liga nos próximos eventos culturais que acontecem nas próximas semanas em Dourados! 📆✨';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let urls = []; // object URLs of the images on screen, released when the view is built again

const dm = (iso) => {
  const p = parseDate(iso);
  return p ? `${String(p.d).padStart(2, '0')}-${String(p.m).padStart(2, '0')}` : '';
};

function canShareFiles() {
  try {
    return Boolean(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] }));
  } catch {
    return false;
  }
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function postView(view) {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const today = todayISO();
  const presets = [
    ['semana', 'Esta semana', [today, addDays(today, (7 - weekday(today)) % 7)]],
    ['15', '15 dias', [today, addDays(today, 14)]],
    ['30', '30 dias', [today, addDays(today, 29)]],
  ];
  let range = [...presets[1][2]];
  let line = ls.get(LINE_KEY) ?? DEFAULT_LINE;
  const excluded = new Set();
  let slides = [];
  let job = 0;
  let captionEdited = false;

  const from = h('input', { type: 'date', value: range[0], required: true, onchange: () => setRange(from.value, to.value, '') });
  const to = h('input', { type: 'date', value: range[1], required: true, onchange: () => setRange(from.value, to.value, '') });
  const chips = h('div', { class: 'chips' }, presets.map(([key, label, r]) => h('button', {
    type: 'button',
    class: `chip${key === '15' ? ' on' : ''}`,
    dataset: { k: key },
    onclick: () => setRange(r[0], r[1], key),
  }, label)));
  const lineInput = h('input', {
    type: 'text', value: line, maxlength: '60', placeholder: DEFAULT_LINE,
    oninput: () => {
      line = lineInput.value;
      ls.set(LINE_KEY, line);
      draw();
    },
  });
  const count = h('span', { class: 'count' });
  const list = h('ul', { class: 'post-events' });
  const status = h('p', { class: 'post-status', role: 'status', 'aria-live': 'polite' });
  const warn = h('p', { class: 'warn', hidden: true });
  const grid = h('ol', { class: 'post-slides', 'aria-label': 'Imagens do post' });
  const share = h('button', { class: 'btn btn-red', type: 'button', hidden: !canShareFiles(), disabled: true, onclick: shareAll }, 'Compartilhar');
  const download = h('button', { class: `btn ${canShareFiles() ? 'btn-ghost' : 'btn-red'}`, type: 'button', disabled: true, onclick: downloadAll }, 'Baixar as imagens (.zip)');
  const caption = h('textarea', { rows: '9', 'aria-label': 'Legenda do post', oninput: () => { captionEdited = true; } });

  const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input);
  add(clear(view), h('section', { class: 'post' },
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, h('a', { href: '#/agenda' }, 'Agenda'), ' · Instagram'),
      h('h1', null, 'Post da agenda'),
      h('p', { class: 'lead' }, 'Escolha o período e o admin monta o carrossel “Agenda cultural”: a capa e os eventos, três por imagem, no tamanho do Instagram (1080 × 1350). Nada disso vai para o site.')),
    h('div', { class: 'post-grid' },
      h('div', { class: 'post-col' },
        h('fieldset', { class: 'f-group p-period' }, h('legend', null, 'Período'),
          h('div', { class: 'fgroup-row' }, field('De', from), field('Até', to)),
          chips),
        h('label', { class: 'field p-line' }, h('span', { class: 'lbl' }, 'Chamada da capa'), lineInput,
          h('span', { class: 'hint' }, 'Vai na faixa vermelha da capa, antes da data do primeiro dia.')),
        h('fieldset', { class: 'f-group p-events' }, h('legend', null, 'Eventos ', count),
          h('p', { class: 'hint' }, 'Desmarque o que não deve entrar. Cada evento leva a sua Chamada, que se edita no próprio evento.'),
          list)),
      h('div', { class: 'post-col' },
        h('div', { class: 'p-out' }, h('div', { class: 'post-actions' }, share, download, status), warn, grid),
        h('fieldset', { class: 'f-group p-caption' }, h('legend', null, 'Legenda'), caption,
          h('div', { class: 'btns' }, h('button', { class: 'btn btn-k btn-sm', type: 'button', onclick: copyCaption }, 'Copiar legenda')))))));

  function events() {
    const [a, b] = range;
    return store.state.working.agenda.filter((ev) => ev.date && ev.date <= b && eventEnd(ev) >= a).sort(COLLECTIONS.agenda.sort);
  }

  function setRange(a, b, preset) {
    if (!parseDate(a) || !parseDate(b)) return;
    range = a <= b ? [a, b] : [b, a];
    from.value = range[0];
    to.value = range[1];
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.k === preset));
    drawList();
    draw();
  }

  function drawList() {
    const all = events();
    const on = all.filter((ev) => !excluded.has(ev.id)).length;
    count.textContent = all.length ? (on === all.length ? String(all.length) : `${on}/${all.length}`) : '0';
    clear(list);
    if (!all.length) {
      list.append(h('li', { class: 'empty-row' }, 'Nenhum evento nesse período. ', h('a', { href: '#/agenda/novo' }, 'Adicionar um evento →')));
      return;
    }
    for (const ev of all) {
      const id = `pe-${ev.id}`;
      const [when, days] = dateParts(ev);
      const missing = !String(ev.summary || '').trim();
      const draft = store.itemStatus('agenda', ev.id);
      const row = h('li', { class: `post-ev${excluded.has(ev.id) ? ' off' : ''}` },
        h('input', {
          type: 'checkbox', id, checked: !excluded.has(ev.id),
          onchange: (e) => {
            if (e.target.checked) excluded.delete(ev.id);
            else excluded.add(ev.id);
            drawList();
            draw();
          },
        }),
        h('label', { for: id },
          h('b', null, [when, days].filter(Boolean).join(' • ')),
          h('span', null, eventTitle(ev), draft ? h('em', { class: 'badge edit' }, 'Rascunho') : null),
          missing
            ? h('small', { class: 'warn' }, blurb(ev) ? 'Sem chamada: vai o começo da descrição.' : 'Sem chamada: vai só o horário.')
            : h('small', null, eventBody(ev))),
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/agenda/${encodeURIComponent(ev.id)}` }, 'Editar'));
      list.append(row);
    }
  }

  const draw = debounce(async () => {
    const id = ++job;
    const chosen = events().filter((ev) => !excluded.has(ev.id));
    if (!captionEdited) caption.value = captionFor(chosen);
    if (!chosen.length) {
      show([]);
      status.textContent = '';
      return;
    }
    status.textContent = 'Montando as imagens…';
    share.disabled = true;
    download.disabled = true;
    try {
      const made = await carousel(chosen, { from: range[0], line });
      const out = [];
      const canvas = document.createElement('canvas');
      for (const [i, slide] of made.entries()) {
        paint(slide, canvas);
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', QUALITY);
        });
        if (id !== job) return;
        out.push({ alt: slide.alt, blob, name: `agenda-cultural-${dm(range[0])}-${String(i + 1).padStart(2, '0')}.jpg` });
      }
      canvas.width = 0;
      canvas.height = 0;
      show(out);
    } catch (error) {
      if (id !== job) return;
      console.error(error);
      show([]);
      status.textContent = 'Não consegui montar as imagens. Recarregue a página e tente de novo.';
    }
  }, 250);

  function show(out) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    slides = out.map((s) => ({ ...s, url: URL.createObjectURL(s.blob) }));
    urls = slides.map((s) => s.url);
    clear(grid);
    slides.forEach((s, i) => grid.append(h('li', null,
      h('figure', null,
        h('img', { src: s.url, alt: s.alt, width: W, height: H }),
        h('figcaption', null,
          h('span', null, i ? `${i + 1} de ${slides.length}` : 'Capa'),
          h('a', { href: s.url, download: s.name }, 'Baixar'))))));
    const bytes = slides.reduce((n, s) => n + s.blob.size, 0);
    status.textContent = slides.length ? `${slides.length} imagens · ${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : '';
    warn.hidden = slides.length <= MAX_SLIDES;
    warn.textContent = `O Instagram aceita até ${MAX_SLIDES} imagens num post. Escolha um período menor ou desmarque alguns eventos.`;
    share.disabled = !slides.length;
    download.disabled = !slides.length;
  }

  async function shareAll() {
    const files = slides.map((s) => new File([s.blob], s.name, { type: 'image/jpeg' }));
    if (!files.length) return;
    try {
      await navigator.share({ files });
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      toast('Não deu para compartilhar daqui. Baixe as imagens.', 'error');
    }
  }

  async function downloadAll() {
    if (!slides.length) return;
    save(await zip(slides.map((s) => ({ name: s.name, blob: s.blob }))), `agenda-cultural-${dm(range[0])}.zip`);
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption.value);
      toast('Legenda copiada.');
    } catch {
      caption.focus();
      caption.select();
      toast('Selecionei a legenda: é só copiar.');
    }
  }

  drawList();
  draw.flush();
}

// The caption: the team's usual line, then one line per event.
function captionFor(events) {
  if (!events.length) return '';
  return `${INTRO}\n\n${events.map((ev) => `${dateParts(ev)[0]} • ${eventTitle(ev)}`).join('\n')}`;
}
