// An album's fields in the admin (Fotos): the agenda event it covers, which fills in its name,
// date and place, and its photos. Photos come in many at once; each is resized here (the photo,
// 1080 px wide at most, and a small copy for the album's rows) and goes to the bucket while
// the editor fills in the rest (src/admin/uploads.js). Each shows how it's doing: up, going
// up, waiting, or failed with a retry. Dragging reorders them (the arrows too, on phones);
// a tap picks the cover or takes a photo out.

import { PHOTOS } from '../config.js';
import { slugify, parseDate, weekday, WEEKDAYS_SHORT, isUpcoming, todayISO } from '../util.js';
import { h, add, clear, toast, dialog, formatBytes } from './dom.js';
import { processPhoto, extFor, ACCEPT } from './images.js';
import * as store from './store.js';
import * as uploads from './uploads.js';
import { net } from './net.js';
import { hasKey } from './r2.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dm = (iso) => {
  const p = parseDate(iso);
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}` : '';
};

/* ---------- the event ---------- */

// The event's line: "Sáb 21/11 · Sance's Casa de Eventos · Festa".
const eventLine = (ev) => [ev.date && `${WEEKDAYS_SHORT[weekday(ev.date)]} ${dm(ev.date)}`, ev.venue, ev.category].filter(Boolean).join(' · ');

export function eventField(field, get, set, ctx) {
  const box = h('div', { class: 'evf' });
  const events = () => [...store.state.working.agenda].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  // Another field of the album, as the editor sees it: picking an event writes into them (only
  // into those still empty, or still showing the previous event's value).
  const fill = (key, value, previous) => {
    const input = box.closest('.form')?.querySelector(`.field[data-path="${key}"] input`);
    const now = ctx.model[key] || '';
    if (!value || (now && now !== (previous || ''))) return;
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      ctx.model[key] = value;
    }
  };
  const pick = (ev) => {
    const prev = store.state.working.agenda.find((e) => e.id === get());
    set(ev.id);
    for (const key of ['title', 'date', 'venue', 'category']) fill(key, ev[key], prev && prev[key]);
    render();
  };
  const choose = () => {
    const search = h('input', { type: 'search', placeholder: 'Buscar na agenda…', 'aria-label': 'Buscar na agenda' });
    const list = h('div', { class: 'evp-list' });
    const taken = new Map(store.state.working.fotos.filter((a) => a.event).map((a) => [a.event, a]));
    let close = () => {};
    const draw = () => {
      const q = norm(search.value);
      const today = todayISO();
      const rows = events().filter((ev) => !q || norm([ev.title, ev.venue, ev.category, ev.date, dm(ev.date)].join(' ')).includes(q)).slice(0, 60);
      clear(list);
      if (!rows.length) list.append(h('p', { class: 'muted' }, 'Nenhum evento encontrado.'));
      for (const ev of rows) {
        const p = parseDate(ev.date) || { d: '?' };
        const other = taken.get(ev.id);
        list.append(h('button', { type: 'button', class: `evp-row${ev.id === get() ? ' on' : ''}`, onclick: () => { close(); pick(ev); } },
          h('b', null, String(p.d).padStart(2, '0')),
          h('span', null, h('strong', null, ev.title), h('small', null, [eventLine(ev), isUpcoming(ev, today) ? 'ainda vai rolar' : '', other && other.id !== ctx.model.id ? 'já tem álbum' : ''].filter(Boolean).join(' · ')))));
      }
    };
    search.addEventListener('input', draw);
    draw();
    ({ close } = dialog({ title: 'Qual rolê?', body: h('div', { class: 'evp-pick' }, search, list), actions: (c) => [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => c() }, 'Cancelar')] }));
    setTimeout(() => search.focus(), 50);
  };
  function render() {
    clear(box);
    const ev = get() && store.state.working.agenda.find((e) => e.id === get());
    if (!ev) {
      add(box, h('button', { type: 'button', class: 'btn btn-ghost evf-pick', onclick: choose }, '＋ Escolher na agenda'),
        get() ? h('p', { class: 'warn' }, 'O evento escolhido saiu da agenda. Escolha outro ou deixe em branco.') : null);
      return;
    }
    const p = parseDate(ev.date) || { d: '?' };
    add(box, h('div', { class: 'evp' },
      h('b', null, String(p.d).padStart(2, '0')),
      h('div', null, h('h3', null, ev.title), h('p', null, eventLine(ev))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: choose }, 'Trocar'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Tirar o evento', title: 'Tirar o evento', onclick: () => { set(''); render(); } }, '×'))));
  }
  render();
  return box;
}

/* ---------- the photos ---------- */

const rand = (n = 6) => Array.from({ length: n }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('');
const isImage = (f) => /^image\//.test(f.type) || /\.(heic|heif|avif|jpe?g|png|webp|gif)$/i.test(f.name);

// How a photo is doing: both its files (the photo and its small copy) count.
function photoState(p) {
  const jobs = [uploads.status(p.src), uploads.status(p.thumb)];
  if (jobs.every((j) => !j)) return { state: store.state.staged.has(p.src) ? 'wait' : 'done', progress: 1 };
  if (jobs.some((j) => j && j.state === 'err')) return { state: 'err', progress: 0, access: jobs.some((j) => j && j.error === 'access') };
  if (jobs.every((j) => !j || j.state === 'done')) return { state: 'done', progress: 1 };
  const sizes = [p.src, p.thumb].map((k) => (store.state.staged.get(k) || {}).bytes || 1);
  const done = jobs.reduce((n, j, i) => n + (j ? (j.state === 'done' ? 1 : j.progress || 0) : 1) * sizes[i], 0);
  return { state: jobs.some((j) => j && j.state === 'up') ? 'up' : 'wait', progress: done / (sizes[0] + sizes[1]) };
}

export function photosField(field, get, set, ctx) {
  const max = field.max || PHOTOS.max;
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true });
  const count = h('span', { class: 'count' });
  const bar = h('div', { class: 'mp-up', role: 'status', hidden: true });
  const grid = h('div', { class: 'mp-grid' });
  const drop = h('button', { type: 'button', class: 'drop mp-add', onclick: () => input.click() },
    h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
    h('span', null, h('b', null, 'Adicionar fotos'), h('small', null, `Escolha várias de uma vez, até ${max} por álbum. Cada uma é diminuída para 1080 px e sobe direto para o site.`)));
  const el = h('div', { class: 'field f-photos', dataset: { path: 'photos' } },
    h('div', { class: 'lbl-row' }, h('span', { class: 'lbl' }, field.label, field.required ? h('span', { class: 'req', title: 'Obrigatório' }, ' *') : null), count),
    h('div', { class: 'mp' }, input, drop, bar, grid),
    field.hint ? h('p', { class: 'hint' }, field.hint) : null,
    h('p', { class: 'err', hidden: true }));

  const photos = () => get() || [];
  const cover = () => ctx.model.cover || (photos()[0] && photos()[0].src) || '';
  const setCover = (src) => {
    ctx.model.cover = src;
    ctx.changed();
  };
  let selected = -1;
  const preparing = [];
  let working = false;
  const failed = [];
  // the editor saves only once every photo chosen is ready (app.js asks)
  ctx.busy = () => preparing.length > 0;

  // new photos: in the order of their file names (a camera's order), after the ones there
  const take = (files) => {
    const list = [...files].filter(isImage).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    if (!list.length) {
      if (files.length) toast('Esses arquivos não são fotos.', 'error');
      return;
    }
    const room = max - photos().length - preparing.length;
    if (room <= 0) {
      toast(`O álbum já tem ${max} fotos, o máximo.`, 'error');
      return;
    }
    if (list.length > room) toast(`Até ${max} fotos por álbum: entraram ${room} das ${list.length}.`);
    preparing.push(...list.slice(0, room));
    draw();
    run();
  };
  const run = async () => {
    if (working) return;
    working = true;
    while (preparing.length) {
      // the form was left (cancelled, another page): the rest isn't prepared
      if (!el.isConnected && el.dataset.shown) {
        preparing.length = 0;
        break;
      }
      const file = preparing[0];
      try {
        const { full, mini } = await processPhoto(file);
        const taken = new Set([...store.state.staged.keys(), ...photos().flatMap((p) => [p.src, p.thumb])]);
        let base;
        do base = `${ctx.imageDir}/${slugify(ctx.titleHint() || 'foto', 40) || 'foto'}-${rand()}`; while (taken.has(`${base}.${extFor(full.type)}`));
        const src = `${base}.${extFor(full.type)}`;
        const thumb = `${base}-mini.${extFor(mini.type)}`;
        await store.stageImage(src, full);
        await store.stageImage(thumb, mini);
        preparing.shift();
        set([...photos(), { src, thumb, w: full.w, h: full.h }]);
        if (!ctx.model.cover) setCover(src);
      } catch (error) {
        preparing.shift();
        failed.push(file.name);
      }
      draw();
    }
    working = false;
    if (failed.length) {
      toast(`${failed.length > 1 ? `${failed.length} arquivos não abriram` : `“${failed[0]}” não abriu`}: use JPG, PNG ou WebP.`, 'error');
      failed.length = 0;
    }
  };
  input.addEventListener('change', () => {
    take(input.files);
    input.value = '';
  });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    take(e.dataTransfer.files);
  });

  const move = (from, to) => {
    const list = [...photos()];
    if (to < 0 || to >= list.length || from === to) return;
    const [p] = list.splice(from, 1);
    list.splice(to, 0, p);
    selected = selected === from ? to : selected;
    set(list);
    draw();
  };
  const remove = (i) => {
    const list = [...photos()];
    const [p] = list.splice(i, 1);
    set(list);
    if (p && ctx.model.cover === p.src) setCover(list[0] ? list[0].src : '');
    selected = -1;
    draw();
  };

  // How one photo's square says it's doing (its classes and badges), redrawn when that changes.
  const paint = (t, p, i) => {
    const st = photoState(p);
    const key = `${st.state}:${Math.round(st.progress * 20)}:${p.src === cover()}:${i === selected}`;
    if (t.dataset.key === key) return;
    t.dataset.key = key;
    t.className = ['mp-t', st.state === 'done' ? '' : st.state, p.src === cover() ? 'cover' : '', i === selected ? 'sel' : ''].filter(Boolean).join(' ');
    t.setAttribute('aria-label', `Foto ${i + 1}${p.src === cover() ? ', capa' : ''}${st.state === 'done' ? '' : st.state === 'err' ? ', não subiu' : ', subindo'}`);
    for (const old of [...t.querySelectorAll(':scope > .ok, :scope > .ring, :scope > .st, :scope > .cap, :scope > .mp-tools')]) old.remove();
    if (st.state === 'done') t.append(h('span', { class: 'ok', title: 'No site' }, '✓'));
    else if (st.state === 'up') t.append(h('span', { class: 'ring', style: { '--p': String(Math.round(st.progress * 100)) } }), h('span', { class: 'st' }, 'Subindo'));
    else if (st.state === 'err') t.append(h('span', { class: 'st' }, st.access ? 'Sem acesso' : 'Não subiu', h('u', { onclick: (e) => { e.stopPropagation(); uploads.retry([p.src, p.thumb]); } }, 'Tentar de novo')));
    else t.append(h('span', { class: 'st' }, 'Na fila'));
    if (p.src === cover()) t.append(h('span', { class: 'cap' }, 'Capa'));
    if (i === selected) {
      t.append(h('div', { class: 'mp-tools' },
        h('button', { type: 'button', title: 'Usar como capa', 'aria-label': 'Usar como capa', onclick: (e) => { e.stopPropagation(); setCover(p.src); draw(); } }, '★'),
        h('button', { type: 'button', title: 'Para trás', 'aria-label': 'Para trás', disabled: i === 0, onclick: (e) => { e.stopPropagation(); move(i, i - 1); } }, '←'),
        h('button', { type: 'button', title: 'Para a frente', 'aria-label': 'Para a frente', disabled: i === photos().length - 1, onclick: (e) => { e.stopPropagation(); move(i, i + 1); } }, '→'),
        h('button', { type: 'button', class: 'x', title: 'Tirar do álbum', 'aria-label': 'Tirar do álbum', onclick: (e) => { e.stopPropagation(); remove(i); } }, '×')));
    }
  };

  // one photo's square: its number, how it's doing, the cover badge, and its tools when tapped
  const tile = (p, i) => {
    const t = h('div', { tabindex: '0', draggable: 'true', dataset: { i: String(i), src: p.src } },
      h('img', { src: store.assetUrl(p.thumb) || '', alt: '', draggable: 'false', loading: 'lazy' }),
      h('span', { class: 'no' }, String(i + 1).padStart(2, '0')));
    paint(t, p, i);
    const toggle = () => {
      selected = selected === i ? -1 : i;
      draw();
      grid.querySelector(`[data-i="${i}"]`)?.focus();
    };
    t.addEventListener('click', toggle);
    t.addEventListener('keydown', (e) => {
      if (e.target !== t) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Delete' || e.key === 'Backspace') remove(i);
    });
    // dragging, on computers: the photo goes where it's dropped
    t.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-photo', String(i));
      t.classList.add('drag');
    });
    t.addEventListener('dragend', () => t.classList.remove('drag'));
    t.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-photo')) return;
      e.preventDefault();
      t.classList.add('over');
    });
    t.addEventListener('dragleave', () => t.classList.remove('over'));
    t.addEventListener('drop', (e) => {
      const from = Number(e.dataTransfer.getData('text/x-photo'));
      t.classList.remove('over');
      if (Number.isNaN(from)) return;
      e.preventDefault();
      move(from, i);
    });
    return t;
  };

  // The trip to the site of every photo of the album, at the top.
  const summary = () => {
    const list = photos().filter((p) => store.state.staged.has(p.src) || store.state.staged.has(p.thumb));
    const states = list.map(photoState);
    const left = states.filter((s) => s.state !== 'done');
    clear(bar);
    if (!list.length || (!left.length && !preparing.length)) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const done = states.length - left.length;
    const bytes = list.reduce((n, p) => n + ((store.state.staged.get(p.src) || {}).bytes || 0) + ((store.state.staged.get(p.thumb) || {}).bytes || 0), 0);
    const sent = list.reduce((n, p, i) => n + (((store.state.staged.get(p.src) || {}).bytes || 0) + ((store.state.staged.get(p.thumb) || {}).bytes || 0)) * states[i].progress, 0);
    const errors = left.filter((s) => s.state === 'err');
    let head;
    let note;
    if (preparing.length) {
      head = h('b', null, `Preparando ${photos().length + 1} de ${photos().length + preparing.length}`, h('span', null, ` · ${done} no site`));
      note = 'Cada foto é diminuída aqui antes de subir. Pode continuar editando.';
    } else if (errors.length) {
      head = h('b', null, `${errors.length} ${errors.length > 1 ? 'fotos não subiram' : 'foto não subiu'}`);
      note = errors.some((s) => s.access) ? 'Seu token não dá acesso às imagens do site. Peça um token novo a quem cuida do site.' : 'Confira a internet e tente de novo.';
    } else {
      head = h('b', null, `Enviando ${Math.min(done + 1, list.length)} de ${list.length}`, h('span', null, ` · ${formatBytes(sent)} de ${formatBytes(bytes)}`));
      note = !net.online ? 'Sem internet: as fotos sobem quando a conexão voltar.'
        : !hasKey() ? 'Esperando o acesso às imagens do site…'
          : uploads.isPaused() ? 'Envio pausado. As que estavam subindo terminam.'
            : 'Pode continuar editando enquanto as fotos sobem. Só não feche esta aba até terminar.';
    }
    const action = errors.length
      ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => uploads.retry(list.flatMap((p) => [p.src, p.thumb])) }, 'Tentar de novo')
      : preparing.length ? null
        : h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => uploads.setPaused(!uploads.isPaused()) }, uploads.isPaused() ? 'Continuar' : 'Pausar');
    add(bar, head, action, h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((bytes ? sent / bytes : 0) * 100)}%` } })), h('p', null, note));
  };

  function draw() {
    if (el.isConnected) el.dataset.shown = '1';
    count.textContent = String(photos().length);
    const nodes = photos().map(tile);
    for (let k = 0; k < preparing.length; k += 1) nodes.push(h('div', { class: 'mp-t prep', 'aria-hidden': 'true' }, h('span', { class: 'ring spin' }), h('span', { class: 'st' }, k ? 'Na fila' : 'Preparando')));
    grid.replaceChildren(...nodes);
    summary();
  }

  // upload news: the squares that changed, and the summary, at most once a frame; it stops
  // once the form is gone
  let frame = 0;
  let shown = false;
  const off = uploads.onUploads(() => {
    if (!el.isConnected) {
      if (shown) off();
      return;
    }
    shown = true;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const tiles = grid.querySelectorAll('.mp-t[data-src]');
      photos().forEach((p, i) => tiles[i] && tiles[i].dataset.src === p.src && paint(tiles[i], p, i));
      summary();
    });
  });

  draw();
  return el;
}
