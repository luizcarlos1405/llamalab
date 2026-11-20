// Builds an editing form from the field definitions in src/schema.js.
// The form edits a plain object (`model`) in place and calls ctx.changed()
// after every edit.

import { emptyValue } from '../schema.js';
import { slugify } from '../util.js';
import { renderMarkdown } from '../markdown.js';
import { h, add, dialog, toast, formatBytes } from './dom.js';
import { processImage, cropDialog, slotInfo, extFor, ACCEPT } from './images.js';
import * as store from './store.js';

let uid = 0;
const nextId = () => `f${++uid}`;

const getAt = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setAt(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i += 1) o = o[path[i]];
  o[path[path.length - 1]] = value;
}

// ctx: { model, changed(), imageDir, titleHint() }
export function buildForm(fields, ctx) {
  const el = h('div', { class: 'form' });
  add(el, renderFields(fields, [], ctx));
  return {
    el,
    showErrors(problems) {
      el.querySelectorAll('.field.invalid').forEach((f) => {
        f.classList.remove('invalid');
        const err = f.querySelector(':scope > .err');
        if (err) err.hidden = true;
      });
      for (const p of problems) {
        const f = el.querySelector(`.field[data-path="${CSS.escape(p.path)}"]`);
        if (!f) continue;
        f.classList.add('invalid');
        const err = f.querySelector(':scope > .err');
        if (err) {
          err.textContent = p.message;
          err.hidden = false;
        }
      }
      const first = el.querySelector('.field.invalid');
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = first.querySelector('input,textarea');
        if (input) input.focus({ preventScroll: true });
      }
    },
  };
}

function renderFields(fields, base, ctx) {
  const out = [];
  let group = null;
  for (const field of fields) {
    const node = renderField(field, [...base, field.key], ctx);
    if (field.group) {
      if (!group || group.name !== field.group) {
        group = { name: field.group, el: h('fieldset', { class: 'fgroup' }, h('legend', null, field.group), h('div', { class: 'fgroup-row' })) };
        out.push(group.el);
      }
      group.el.lastChild.append(node);
    } else {
      group = null;
      out.push(node);
    }
  }
  return out;
}

function wrap(field, path, control, { id, extra = null } = {}) {
  return h('div', { class: `field f-${field.type}`, dataset: { path: path.join('.') } },
    h('div', { class: 'lbl-row' },
      h('label', { class: 'lbl', for: id }, field.label, field.required ? h('span', { class: 'req', title: 'Obrigatório' }, ' *') : null),
      extra),
    control,
    field.hint ? h('p', { class: 'hint' }, field.hint) : null,
    h('p', { class: 'err', hidden: true }));
}

function counter(field, input) {
  if (!field.maxLength) return null;
  const c = h('span', { class: 'count' });
  const update = () => {
    const n = input.value.length;
    c.textContent = `${n}/${field.maxLength}`;
    c.classList.toggle('over', n > field.maxLength);
    c.classList.toggle('near', n > field.maxLength * 0.85);
  };
  input.addEventListener('input', update);
  update();
  return c;
}

function autoGrow(ta) {
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight + 4, 900)}px`;
  };
  ta.addEventListener('input', grow);
  requestAnimationFrame(grow);
}

function renderField(field, path, ctx) {
  const get = () => getAt(ctx.model, path);
  const set = (v) => {
    setAt(ctx.model, path, v);
    ctx.changed();
  };
  if (get() === undefined) setAt(ctx.model, path, emptyValue(field));
  const id = nextId();
  switch (field.type) {
    case 'textarea': {
      const ta = h('textarea', { id, rows: 3, value: get() || '', placeholder: field.placeholder || '', oninput: () => set(ta.value) });
      autoGrow(ta);
      return wrap(field, path, ta, { id, extra: counter(field, ta) });
    }
    case 'markdown':
      return wrap(field, path, markdownEditor(field, id, get, set, ctx), { id });
    case 'boolean': {
      const input = h('input', { id, type: 'checkbox', checked: Boolean(get()), onchange: () => set(input.checked) });
      return h('div', { class: 'field f-boolean', dataset: { path: path.join('.') } },
        h('label', { class: 'switch', for: id }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', { class: 'lbl' }, field.label)),
        field.hint ? h('p', { class: 'hint' }, field.hint) : null,
        h('p', { class: 'err', hidden: true }));
    }
    case 'image':
      return wrap(field, path, imageField(field, get, set, ctx), { id });
    case 'strings':
      return wrap(field, path, stringsField(field, path, get, set, ctx), { id });
    case 'repeater':
      return wrap(field, path, repeaterField(field, path, get, ctx), { id });
    case 'group':
      return h('fieldset', { class: 'field f-group', dataset: { path: path.join('.') } },
        h('legend', null, field.label),
        field.hint ? h('p', { class: 'hint' }, field.hint) : null,
        h('div', { class: 'group-body' }, renderFields(field.fields, path, ctx)));
    default: {
      const type = { date: 'date', time: 'time', url: 'url', email: 'email' }[field.type] || 'text';
      const listId = field.suggestions ? nextId() : null;
      const input = h('input', {
        id, type, value: get() || '', placeholder: field.placeholder || '', list: listId,
        autocomplete: 'off', spellcheck: type === 'text' ? 'true' : 'false',
        oninput: () => set(input.value.trim() === '' ? '' : input.value),
      });
      const control = listId
        ? h('div', null, input, h('datalist', { id: listId }, field.suggestions.map((s) => h('option', { value: s }))))
        : input;
      return wrap(field, path, control, { id, extra: type === 'text' ? counter(field, input) : null });
    }
  }
}

/* ---------- Markdown ---------- */

function markdownEditor(field, id, get, set, ctx) {
  const ta = h('textarea', { id, rows: 10, class: 'md-text', value: get() || '', placeholder: 'Escreva aqui. Deixe uma linha em branco entre os parágrafos.', oninput: () => set(ta.value) });
  autoGrow(ta);
  const preview = h('div', { class: 'md-prev prose', hidden: true });
  const fire = () => ta.dispatchEvent(new Event('input', { bubbles: true }));
  const wrapSel = (before, after = before, placeholder = 'texto') => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e) || placeholder;
    ta.setRangeText(before + sel + after, s, e, 'end');
    ta.focus();
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    fire();
  };
  const prefix = (mark) => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const start = value.lastIndexOf('\n', s - 1) + 1;
    const end = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
    const lines = value.slice(start, end).split('\n').map((line, i) => {
      const m = typeof mark === 'function' ? mark(i) : mark;
      return line.startsWith(m) ? line.slice(m.length) : m + line;
    });
    ta.setRangeText(lines.join('\n'), start, end, 'select');
    ta.focus();
    fire();
  };
  const link = () => {
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const text = value.slice(s, e);
    const url = h('input', { type: 'url', placeholder: 'https://…', value: '' });
    const label = h('input', { type: 'text', value: text, placeholder: 'Texto do link' });
    dialog({
      title: 'Inserir link',
      body: h('div', { class: 'form' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Endereço'), url), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Texto'), label)),
      actions: (close) => [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancelar'),
        h('button', {
          class: 'btn btn-k',
          type: 'button',
          onclick: () => {
            const u = url.value.trim();
            if (!/^(https?:\/\/|mailto:)/i.test(u)) {
              url.focus();
              url.setCustomValidity('Use um endereço completo, começando com https://');
              url.reportValidity();
              return;
            }
            ta.setRangeText(`[${label.value.trim() || u}](${u})`, s, e, 'end');
            close();
            ta.focus();
            fire();
          },
        }, 'Inserir'),
      ],
    });
    setTimeout(() => url.focus(), 50);
  };
  const imageInput = h('input', { type: 'file', accept: ACCEPT, hidden: true });
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (!file) return;
    try {
      toast('Preparando a imagem…');
      const result = await processImage(file, 'inline');
      const path = `${ctx.imageDir}/${slugify(ctx.titleHint() || file.name.replace(/\.[^.]+$/, ''), 40)}-${Math.random().toString(36).slice(2, 6)}.${extFor(result.type)}`;
      await store.stageImage(path, result);
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const insert = `${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}![Descrição da imagem](${path} "Legenda (opcional)")\n\n`;
      ta.setRangeText(insert, pos, pos, 'end');
      const altStart = pos + insert.indexOf('Descrição da imagem');
      ta.focus();
      ta.setSelectionRange(altStart, altStart + 'Descrição da imagem'.length);
      fire();
      toast(`Imagem pronta: ${result.w}×${result.h}, ${formatBytes(result.bytes)} (era ${formatBytes(result.originalBytes)}). Escreva a descrição.`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  const toggle = h('button', { type: 'button', class: 'md-toggle' }, 'Ver como fica');
  toggle.addEventListener('click', () => {
    const showing = !preview.hidden;
    if (!showing) {
      preview.innerHTML = renderMarkdown(ta.value, { url: (u) => (u.startsWith('images/') ? store.assetUrl(u) || u : u), image: (p) => store.imageSize(p) }) || '<p class="muted">Nada escrito ainda.</p>';
    }
    preview.hidden = showing;
    ta.hidden = !showing;
    toggle.textContent = showing ? 'Ver como fica' : 'Voltar a escrever';
  });
  const btn = (label, title, onclick) => h('button', { type: 'button', title, 'aria-label': title, onclick }, label);
  const bar = h('div', { class: 'md-bar' },
    btn(h('b', null, 'N'), 'Negrito', () => wrapSel('**')),
    btn(h('i', null, 'I'), 'Itálico', () => wrapSel('*')),
    btn('Título', 'Subtítulo', () => prefix('## ')),
    btn('“ ”', 'Citação', () => prefix('> ')),
    btn('• Lista', 'Lista', () => prefix('- ')),
    btn('Link', 'Inserir link', link),
    btn('Imagem', 'Inserir imagem no texto', () => imageInput.click()),
    h('span', { class: 'sp' }),
    toggle);
  return h('div', { class: 'md' }, bar, ta, preview, imageInput,
    h('details', { class: 'md-help' }, h('summary', null, 'Como formatar'),
      h('p', null, '**negrito** · *itálico* · ## Subtítulo · > citação · - item de lista · [texto](https://link). Uma linha em branco separa parágrafos.')));
}

/* ---------- images ---------- */

const originals = new WeakMap();

function imageField(field, get, set, ctx) {
  const box = h('div', { class: 'img-field' });
  const input = h('input', { type: 'file', accept: ACCEPT, hidden: true });
  const slot = field.slot;

  const use = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif|avif|jpe?g|png|webp|gif)$/i.test(file.name)) {
      toast('Esse arquivo não é uma imagem.', 'error');
      return;
    }
    try {
      let result;
      if (slot === 'flyer' || slot === 'inline') {
        box.classList.add('busy');
        result = await processImage(file, slot);
      } else {
        const choice = await cropDialog(file, slot);
        if (!choice) return;
        box.classList.add('busy');
        result = await processImage(file, slot, choice.region, choice.source);
      }
      const prev = get();
      const path = `${ctx.imageDir}/${slugify(ctx.titleHint() || file.name.replace(/\.[^.]+$/, ''), 40)}-${Math.random().toString(36).slice(2, 6)}.${extFor(result.type)}`;
      await store.stageImage(path, result);
      originals.set(box, { file, crop: result.crop });
      const next = { src: path, alt: (prev && prev.alt) || ctx.altHint(field) || '', w: result.w, h: result.h };
      if (prev && prev.credit) next.credit = prev.credit;
      set(next);
      render();
      toast(`Imagem pronta: ${result.w}×${result.h}, ${formatBytes(result.bytes)} (era ${formatBytes(result.originalBytes)}).${result.type !== 'image/webp' ? ' Seu navegador não gera WebP; salvei em JPEG.' : ''}`);
    } catch (error) {
      toast(error.message || 'Não consegui processar a imagem.', 'error');
    } finally {
      box.classList.remove('busy');
    }
  };
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    use(file);
  });

  const recrop = async () => {
    const orig = originals.get(box);
    if (!orig) return;
    const choice = await cropDialog(orig.file, slot, orig.crop);
    if (!choice) return;
    box.classList.add('busy');
    try {
      const result = await processImage(orig.file, slot, choice.region, choice.source);
      const prev = get();
      await store.stageImage(prev.src, result);
      originals.set(box, { file: orig.file, crop: result.crop });
      set({ ...prev, w: result.w, h: result.h });
      render();
    } finally {
      box.classList.remove('busy');
    }
  };

  function render() {
    const v = get();
    box.replaceChildren(input);
    if (!v || !v.src) {
      const drop = h('button', { type: 'button', class: 'drop', onclick: () => input.click() },
        h('b', null, 'Escolher imagem'), h('span', null, 'ou arraste uma foto para cá'), h('small', null, slotInfo(slot)));
      for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
      for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        use(e.dataTransfer.files[0]);
      });
      box.append(drop);
      return;
    }
    const staged = store.state.staged.get(v.src);
    const info = staged
      ? `${v.w}×${v.h} px · ${formatBytes(staged.bytes)} · nova (era ${formatBytes(staged.originalBytes)})`
      : `${v.w || '?'}×${v.h || '?'} px · publicada`;
    const alt = h('input', { type: 'text', value: v.alt || '', placeholder: 'Ex.: Banda tocando no palco do Galpão 7', oninput: () => set({ ...get(), alt: alt.value }) });
    const credit = slot === 'noticia' ? h('input', { type: 'text', value: v.credit || '', placeholder: 'Nome de quem fotografou', oninput: () => { const next = { ...get(), credit: credit.value }; if (!credit.value) delete next.credit; set(next); } }) : null;
    box.append(h('div', { class: `img-card ${slot}` },
      h('div', { class: 'img-thumb' }, h('img', { src: store.assetUrl(v.src) || '', alt: '' })),
      h('div', { class: 'img-meta' },
        h('span', { class: 'img-info' }, info),
        h('div', { class: 'img-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => input.click() }, 'Trocar'),
          originals.get(box) && slot !== 'flyer' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: recrop }, 'Ajustar recorte') : null,
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm danger', onclick: () => { set(null); render(); } }, 'Remover')),
        h('label', { class: 'mini' }, h('span', null, 'Descrição da imagem (para quem usa leitor de tela)'), alt),
        credit ? h('label', { class: 'mini' }, h('span', null, 'Crédito da foto'), credit) : null)));
  }
  render();
  return box;
}

/* ---------- lists ---------- */

function stringsField(field, path, get, set, ctx) {
  const list = h('div', { class: 'list' });
  const render = () => {
    const values = get() || [];
    list.replaceChildren();
    values.forEach((value, i) => {
      const input = h('input', { type: 'text', value, placeholder: field.itemLabel || '', oninput: () => { const arr = [...get()]; arr[i] = input.value; set(arr); } });
      list.append(h('div', { class: 'list-row', dataset: { path: `${path.join('.')}.${i}` } }, input, rowTools(i, values.length, (fn) => { const arr = [...get()]; fn(arr); set(arr); render(); })));
    });
    list.append(h('button', { type: 'button', class: 'add-btn', onclick: () => { set([...(get() || []), '']); render(); list.querySelector('.list-row:last-of-type input').focus(); } }, `+ ${field.itemLabel || 'Adicionar'}`));
  };
  render();
  return list;
}

function repeaterField(field, path, get, ctx) {
  const list = h('div', { class: 'repeater' });
  const render = () => {
    const rows = get() || [];
    list.replaceChildren();
    rows.forEach((row, i) => {
      const card = h('div', { class: 'rep-card' },
        h('div', { class: 'rep-head' }, h('b', null, `${field.itemLabel || 'Item'} ${i + 1}`), rowTools(i, rows.length, (fn) => { const arr = get(); fn(arr); ctx.changed(); render(); })),
        renderFields(field.fields, [...path, i], ctx));
      list.append(card);
    });
    list.append(h('button', {
      type: 'button',
      class: 'add-btn',
      onclick: () => {
        const item = {};
        for (const f of field.fields) item[f.key] = emptyValue(f);
        get().push(item);
        ctx.changed();
        render();
        const cards = list.querySelectorAll('.rep-card');
        const last = cards[cards.length - 1];
        if (last) last.querySelector('input,textarea').focus();
      },
    }, `+ ${field.itemLabel || 'Adicionar'}`));
  };
  render();
  return list;
}

function rowTools(i, count, mutate) {
  return h('div', { class: 'row-tools' },
    h('button', { type: 'button', title: 'Subir', 'aria-label': 'Subir', disabled: i === 0, onclick: () => mutate((arr) => arr.splice(i - 1, 0, arr.splice(i, 1)[0])) }, '↑'),
    h('button', { type: 'button', title: 'Descer', 'aria-label': 'Descer', disabled: i === count - 1, onclick: () => mutate((arr) => arr.splice(i + 1, 0, arr.splice(i, 1)[0])) }, '↓'),
    h('button', { type: 'button', title: 'Remover', 'aria-label': 'Remover', class: 'danger', onclick: () => mutate((arr) => arr.splice(i, 1)) }, '×'));
}
