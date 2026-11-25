// The long texts' editor: the text shows formatted as it's written (bold, subtitles, lists,
// quotes, links, images with their captions), the way the page will show it, and nobody needs
// to know Markdown. Underneath it's still Markdown: the document model and the conversions are
// in richdoc.js, and the field keeps the same Markdown text it always did.
//
// Images come in through the Imagem button, the "+ Imagem" next to an empty line, by dragging a
// file in or by pasting one (a screenshot, a photo copied from WhatsApp). Each one is prepared
// and staged like every other image of the admin (images.js, store.js), so it goes up to the
// bucket right away (uploads.js), and the text only keeps its path. An image pasted from another
// site can't come along: it stays as a box asking for the file.
//
// Built on ProseMirror (src/vendor/prosemirror.js, made by scripts/vendor.mjs), which only the
// admin loads, and only when a form with a long text opens (fields.js).

import {
  EditorState, EditorView, Plugin, PluginKey, Selection, TextSelection, NodeSelection, Slice, Fragment,
  Decoration, DecorationSet, keymap, baseKeymap, toggleMark, setBlockType, wrapIn,
  lift, chainCommands, exitCode, history, undo, redo, undoDepth, redoDepth, wrapInList, splitListItem,
  liftListItem, inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, undoInputRule,
  dropCursor, gapCursor,
} from '../vendor/prosemirror.js';
import { makeSchema, toDoc, toMarkdown, blockMd } from './richdoc.js';
import { slugify } from '../util.js';
import { h, dialog, toast } from './dom.js';
import { processImage, extFor, ACCEPT } from './images.js';
import * as store from './store.js';
import * as uploads from './uploads.js';
import * as r2 from './r2.js';
import { net } from './net.js';

const FULL = makeSchema();
const SHORT = makeSchema({ short: true });

// The toolbar stays in sight under the admin's top bar (sticky at 12px) while a long text scrolls.
function underTopBar() {
  const top = document.querySelector('.top');
  document.documentElement.style.setProperty('--rt-top', `${top ? Math.round(top.getBoundingClientRect().height) + 20 : 12}px`);
}
underTopBar();
addEventListener('resize', () => requestAnimationFrame(underTopBar));

/* ---------- icons ---------- */

const svg = (body) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  quote: svg('<path d="M10 7H5v5h5V7zm0 5c0 3-1.5 4.5-4 5.5M19 7h-5v5h5V7zm0 5c0 3-1.5 4.5-4 5.5"/>'),
  bullets: svg('<path d="M10 6.5h10M10 12h10M10 17.5h10"/><circle cx="5" cy="6.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="17.5" r="1.4" fill="currentColor" stroke="none"/>'),
  numbers: svg('<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4 5l1.5-1v5M3.6 9h3.2" stroke-width="1.6"/><path d="M3.6 14.2c.3-.8 1-1.2 1.8-1.1.9.1 1.4.9 1 1.7L3.6 19h3.2" stroke-width="1.6"/>'),
  link: svg('<path d="M10 14a4.5 4.5 0 0 0 6.4.2l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4-.2l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>'),
  image: svg('<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 15.5l-4.5-4.5L8 19.5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
};
const icon = (name) => h('span', { class: 'rt-i', html: ICONS[name] });

/* ---------- commands ---------- */

const markActive = (state, type) => {
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks || $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
};
// the depth of the nearest node of `type` around the selection, or -1
const depthOf = (state, type) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d -= 1) if ($from.node(d).type === type) return d;
  return -1;
};

function toggleHeading(schema) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type === schema.nodes.heading) return setBlockType(schema.nodes.paragraph)(state, dispatch);
    return setBlockType(schema.nodes.heading, { level: 2 })(state, dispatch);
  };
}

function toggleQuote(schema) {
  return (state, dispatch) => (depthOf(state, schema.nodes.blockquote) >= 0 ? lift(state, dispatch) : wrapIn(schema.nodes.blockquote)(state, dispatch));
}

// A list of this kind: off when already in one, switched when in the other kind, else on.
function toggleList(schema, type) {
  const other = type === schema.nodes.bullet_list ? schema.nodes.ordered_list : schema.nodes.bullet_list;
  return (state, dispatch) => {
    const here = depthOf(state, type);
    if (here >= 0) return liftListItem(schema.nodes.list_item)(state, dispatch);
    const there = depthOf(state, other);
    if (there >= 0) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(state.selection.$from.before(there), type));
      return true;
    }
    return wrapInList(type)(state, dispatch);
  };
}

function hardBreak(schema) {
  return chainCommands(exitCode, (state, dispatch) => {
    // a subtitle is one line
    if (state.selection.$from.parent.type === schema.nodes.heading) return true;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  });
}

// The stretch of a mark around a position: a link's whole text, say.
function markRange($pos, type) {
  const { parent } = $pos;
  let index = $pos.index();
  let child = parent.maybeChild(index);
  let mark = child && type.isInSet(child.marks);
  if (!mark && index > 0) {
    // just after the link's end
    index -= 1;
    child = parent.child(index);
    mark = type.isInSet(child.marks);
  }
  if (!mark) return null;
  let start = $pos.start();
  for (let i = 0; i < index; i += 1) start += parent.child(i).nodeSize;
  let from = start;
  let to = start + child.nodeSize;
  for (let i = index - 1; i >= 0 && mark.isInSet(parent.child(i).marks); i -= 1) from -= parent.child(i).nodeSize;
  for (let i = index + 1; i < parent.childCount && mark.isInSet(parent.child(i).marks); i += 1) to += parent.child(i).nodeSize;
  return { from, to, mark };
}

// What someone types as an address, as a link can hold it: instagram.com/x → https://…
export function linkUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(v)) return v;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) return `mailto:${v}`;
  if (/^(www\.)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(\/\S*)?$/u.test(v)) return `https://${v}`;
  return '';
}

/* ---------- the editor ---------- */

const pendingKey = new PluginKey('rt-pending');

// field: the schema's field ({ short } for an event's description); get/set read and write the
// Markdown; ctx: the form's (imageDir, titleHint()).
export function richEditor({ field, id, get, set, ctx }) {
  const short = Boolean(field.short);
  const schema = short ? SHORT : FULL;
  const { nodes, marks } = schema;
  const original = get() || '';
  const start = toDoc(schema, original);
  let written = original;

  const root = h('div', { class: `rt${short ? ' rt-short' : ''}` });
  const picker = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true });
  let picked = null;
  picker.addEventListener('change', () => {
    const files = [...picker.files];
    picker.value = '';
    if (files.length && picked) picked(files);
    picked = null;
  });
  const pick = (fn, multiple = true) => {
    picked = fn;
    picker.multiple = multiple;
    picker.click();
  };

  /* images */

  const isImage = (file) => /^image\//.test(file.type) || /\.(heic|heif|avif|jpe?g|png|webp|gif)$/i.test(file.name);
  const imagePath = (file, type) => `${ctx.imageDir}/${slugify(ctx.titleHint() || file.name.replace(/\.[^.]+$/, ''), 40) || 'imagem'}-${Math.random().toString(36).slice(2, 6)}.${extFor(type)}`;
  const prepare = async (file) => {
    const result = await processImage(file, 'inline');
    const path = imagePath(file, result.type);
    await store.stageImage(path, result);
    return path;
  };

  // Where an image goes: in place of an empty line (the line stays, under it), before a
  // paragraph whose start the caret is at, else after the block the caret is in.
  const anchor = (state, at = null) => {
    const sel = state.selection;
    if (at === null && sel instanceof NodeSelection) return sel.to;
    const $pos = state.doc.resolve(at === null ? sel.from : at);
    if ($pos.depth === 0) return $pos.pos;
    const top = $pos.node(1);
    if (top.isTextblock && top.content.size === 0) return $pos.before(1);
    if (at === null && $pos.depth === 1 && $pos.parentOffset === 0) return $pos.before(1);
    return $pos.after(1);
  };
  // a position between blocks, near pos
  const between = (doc, pos) => {
    const $pos = doc.resolve(Math.min(pos, doc.content.size));
    if ($pos.depth === 0) return $pos.pos;
    return $pos.parentOffset === 0 && $pos.depth === 1 ? $pos.before(1) : $pos.after(1);
  };
  const findPending = (state, key) => {
    const found = pendingKey.getState(state).find(null, null, (spec) => spec.pid === key);
    return found.length ? found[0].from : null;
  };

  let busy = 0;
  const addFiles = async (files, at = null) => {
    const list = [...files].filter(isImage);
    if (!list.length) {
      if (files.length) toast('Esse arquivo não é uma imagem.', 'error');
      return;
    }
    let pos = anchor(view.state, at);
    for (const file of list) {
      const key = {};
      const preview = URL.createObjectURL(file);
      view.dispatch(view.state.tr.setMeta(pendingKey, { add: { key, pos, preview } }));
      busy += 1;
      try {
        const path = await prepare(file);
        const here = findPending(view.state, key);
        if (here === null) continue; // its place was deleted meanwhile
        const where = between(view.state.doc, here);
        const figure = nodes.figure.create({ src: path });
        let tr = view.state.tr.setMeta(pendingKey, { remove: key }).insert(where, figure);
        const after = where + figure.nodeSize;
        // a line to go on writing after it, when it's the last thing
        if (after >= tr.doc.content.size) tr = tr.insert(after, nodes.paragraph.create());
        view.dispatch(tr);
        pos = after;
      } catch (error) {
        view.dispatch(view.state.tr.setMeta(pendingKey, { remove: key }));
        toast(error.message, 'error');
      } finally {
        busy -= 1;
        URL.revokeObjectURL(preview);
      }
    }
  };

  // the box of an image pasted from another site, or a picture being swapped: its file
  const fileFor = (getPos, keep) => pick(async (files) => {
    const file = files[0];
    if (!file || !isImage(file)) return;
    busy += 1;
    try {
      const path = await prepare(file);
      const pos = getPos();
      if (pos == null) return;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type !== nodes.figure) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...keep, src: path, ext: '' }));
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      busy -= 1;
    }
  }, false);

  /* plugins */

  const pending = new Plugin({
    key: pendingKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc);
        const action = tr.getMeta(pendingKey);
        if (action && action.add) {
          const img = h('img', { src: action.add.preview, alt: '' });
          img.addEventListener('error', () => img.remove());
          const dom = h('div', { class: 'rt-wait', contenteditable: 'false' }, img, h('span', null, 'Preparando a imagem…'));
          next = next.add(tr.doc, [Decoration.widget(action.add.pos, dom, { pid: action.add.key, side: -1, ignoreSelection: true })]);
        }
        if (action && action.remove) next = next.remove(next.find(null, null, (spec) => spec.pid === action.remove));
        return next;
      },
    },
    props: { decorations(state) { return this.getState(state); } },
  });

  const placeholder = new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        if (doc.childCount !== 1 || !doc.firstChild.isTextblock || doc.firstChild.content.size) return null;
        const text = short ? 'Escreva aqui.' : 'Escreva aqui. Para pôr uma foto, use o botão Imagem, ou arraste ou cole a foto no texto.';
        return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild.nodeSize, { class: 'rt-empty', 'data-ph': text })]);
      },
    },
  });

  const rules = [
    ...smartQuotes,
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
    wrappingInputRule(/^\s*(\d+)[.)]\s$/, nodes.ordered_list),
  ];
  if (nodes.heading) rules.push(textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (m) => ({ level: Math.max(2, m[1].length) })));

  const keys = {
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    'Mod-b': toggleMark(marks.strong),
    'Mod-B': toggleMark(marks.strong),
    'Mod-i': toggleMark(marks.em),
    'Mod-I': toggleMark(marks.em),
    'Mod-k': () => {
      openLink();
      return true;
    },
    'Shift-Enter': hardBreak(schema),
    'Mod-Enter': hardBreak(schema),
    Enter: chainCommands(splitListItem(nodes.list_item), liftListItem(nodes.list_item)),
    Backspace: undoInputRule,
  };

  // A toolbar button: runs `cmd`; `on` says whether it's pressed; it's off where `cmd` can't run.
  const buttons = [];
  const button = (name, title, cmd, { label = null, on = null, cls = '', content = null } = {}) => {
    const b = h('button', {
      type: 'button',
      class: `rt-b rt-${name}${cls ? ` ${cls}` : ''}`,
      title,
      'aria-label': title,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        cmd(view.state, view.dispatch, view);
        if (name !== 'image' && name !== 'link') view.focus();
      },
    }, content || icon(name), label ? h('span', { class: 'rt-l' }, label) : null);
    buttons.push({ b, cmd, on });
    return b;
  };
  const sep = () => h('span', { class: 'rt-sep', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'rt-bar', role: 'toolbar', 'aria-label': 'Formatação do texto' },
    button('bold', 'Negrito (Ctrl+B)', toggleMark(marks.strong), { content: h('b', { class: 'rt-t' }, 'N'), on: (s) => markActive(s, marks.strong) }),
    button('italic', 'Itálico (Ctrl+I)', toggleMark(marks.em), { content: h('i', { class: 'rt-t' }, 'I'), on: (s) => markActive(s, marks.em) }),
    sep(),
    nodes.heading ? button('heading', 'Subtítulo', toggleHeading(schema), { content: h('span', { class: 'rt-t rt-h' }, 'T'), label: 'Subtítulo', on: (s) => s.selection.$from.parent.type === nodes.heading }) : null,
    button('quote', 'Citação', toggleQuote(schema), { on: (s) => depthOf(s, nodes.blockquote) >= 0 }),
    button('bullets', 'Lista', toggleList(schema, nodes.bullet_list), { on: (s) => depthOf(s, nodes.bullet_list) >= 0 }),
    button('numbers', 'Lista numerada', toggleList(schema, nodes.ordered_list), { on: (s) => depthOf(s, nodes.ordered_list) >= 0 }),
    sep(),
    button('link', 'Link (Ctrl+K)', (state, dispatch) => {
      if (dispatch) openLink();
      return true;
    }, { label: 'Link', on: (s) => markActive(s, marks.link) }),
    nodes.figure ? button('image', 'Pôr uma imagem no texto', (state, dispatch) => {
      if (dispatch) pick((files) => addFiles(files));
      return true;
    }, { label: 'Imagem' }) : null,
    h('span', { class: 'rt-fill' }),
    button('undo', 'Desfazer (Ctrl+Z)', undo),
    button('redo', 'Refazer (Ctrl+Shift+Z)', redo));
  for (const entry of buttons) if (entry.cmd === undo || entry.cmd === redo) entry.depth = entry.cmd === undo ? undoDepth : redoDepth;

  const refresh = (state) => {
    for (const { b, cmd, on, depth } of buttons) {
      const can = depth ? depth(state) > 0 : cmd(state);
      b.disabled = !can;
      if (on) {
        const pressed = Boolean(on(state));
        b.classList.toggle('on', pressed);
        b.setAttribute('aria-pressed', String(pressed));
      }
    }
  };

  // "+ Imagem" beside an empty line, where the caret is
  const chip = nodes.figure ? h('button', {
    type: 'button',
    class: 'rt-chip',
    hidden: true,
    title: 'Pôr uma imagem aqui',
    onmousedown: (e) => e.preventDefault(),
    onclick: () => pick((files) => addFiles(files)),
  }, icon('image'), h('span', null, 'Imagem')) : null;
  const placeChip = () => {
    if (!chip) return;
    const { state } = view;
    const { $from, empty } = state.selection;
    const show = view.hasFocus() && empty && $from.depth === 1 && $from.parent.type === nodes.paragraph && !$from.parent.content.size;
    chip.hidden = !show;
    if (!show) return;
    const at = view.coordsAtPos($from.pos);
    const box = root.getBoundingClientRect();
    chip.style.top = `${Math.round((at.top + at.bottom) / 2 - box.top)}px`;
  };

  const ui = new Plugin({
    view: () => ({
      update: (v) => {
        refresh(v.state);
        placeChip();
      },
    }),
  });

  /* pasting and dropping */

  const pasteNote = (slice) => {
    let outside = 0;
    slice.content.descendants((node) => {
      if (node.type.name === 'figure' && node.attrs.ext) outside += 1;
    });
    if (outside) toast(outside === 1 ? 'A imagem colada veio de outro site: envie o arquivo dela no quadro que ficou no lugar.' : `${outside} imagens coladas vieram de outro site: envie os arquivos delas nos quadros que ficaram no lugar.`);
  };

  const imageFiles = (list) => [...(list || [])].filter(isImage);

  const view = new EditorView(null, {
    state: EditorState.create({
      doc: start,
      plugins: [
        inputRules({ rules }),
        keymap(keys),
        keymap(baseKeymap),
        history(),
        dropCursor({ color: '#ee3c23', width: 3 }),
        gapCursor(),
        pending,
        placeholder,
        ui,
      ],
    }),
    attributes: { id, class: 'rt-doc', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true', lang: 'pt-BR', autocapitalize: 'sentences' },
    nodeViews: nodes.figure ? { figure: (node, v, getPos) => new FigureView(node, v, getPos, { fileFor }) } : {},
    handlePaste(v, event) {
      // only an image alone: a text copied from Word or a site may come with a picture of itself
      const data = event.clipboardData;
      const files = imageFiles(data && data.files);
      if (!files.length || (data.getData('text/plain') || '').trim()) return false;
      if (!nodes.figure) {
        toast('Imagens não vão na descrição do evento: use o campo Flyer.', 'error');
        return true;
      }
      event.preventDefault();
      addFiles(files);
      return true;
    },
    handleDrop(v, event, slice, moved) {
      if (moved) return false;
      const files = imageFiles(event.dataTransfer && event.dataTransfer.files);
      if (!files.length) return false;
      event.preventDefault();
      if (!nodes.figure) {
        toast('Imagens não vão na descrição do evento: use o campo Flyer.', 'error');
        return true;
      }
      const at = v.posAtCoords({ left: event.clientX, top: event.clientY });
      addFiles(files, at ? at.pos : null);
      return true;
    },
    transformPasted(slice) {
      pasteNote(slice);
      return tidySlice(slice);
    },
    // Plain text is read as the site reads a text, so pasted Markdown comes formatted and an
    // address becomes a link. With Ctrl+Shift+V, as it is: paragraphs and line breaks only.
    clipboardTextParser(text, $context, plain) {
      if (plain) {
        const paragraphs = String(text).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
          const content = [];
          p.split('\n').forEach((line, i) => {
            if (i) content.push(nodes.hard_break.create());
            if (line) content.push(schema.text(line));
          });
          return nodes.paragraph.create(null, content);
        });
        return Slice.maxOpen(Fragment.from(paragraphs));
      }
      const doc = toDoc(schema, text);
      const slice = Slice.maxOpen(doc.content);
      pasteNote(slice);
      return slice;
    },
    dispatchTransaction(tr) {
      const state = view.state.apply(tr);
      view.updateState(state);
      if (tr.docChanged) {
        // back where it started (undone): the text as it was, so the form isn't changed
        const md = state.doc.eq(start) ? original : toMarkdown(state.doc);
        if (md !== written) {
          written = md;
          set(md);
        }
      }
      if (tr.docChanged || tr.selectionSet) root.dispatchEvent(new CustomEvent('rt-caret', { bubbles: true }));
    },
  });
  view.dom.addEventListener('focus', placeChip);
  view.dom.addEventListener('blur', () => setTimeout(placeChip, 0));
  root.append(bar, view.dom, picker);
  if (chip) root.append(chip);
  refresh(view.state);

  /* links */

  function openLink() {
    const { state } = view;
    const { from, to, empty, $from } = state.selection;
    const type = marks.link;
    let range = empty ? markRange($from, type) : { from, to };
    let current = '';
    if (empty && range) current = range.mark.attrs.href;
    if (!empty) {
      state.doc.nodesBetween(from, to, (node) => {
        const mark = node.isText && type.isInSet(node.marks);
        if (mark && !current) current = mark.attrs.href;
      });
    }
    if (empty && !range) range = null;
    const url = h('input', { type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', value: current, placeholder: 'instagram.com/… ou https://…' });
    const label = !range ? h('input', { type: 'text', placeholder: 'O texto que aparece' }) : null;
    const err = h('p', { class: 'err', hidden: true });
    const apply = (close) => {
      const href = linkUrl(url.value);
      if (!href) {
        err.textContent = 'Esse endereço não parece completo. Exemplo: instagram.com/llama.etc ou https://llamalab.com.br';
        err.hidden = false;
        url.focus();
        return;
      }
      let tr = view.state.tr;
      if (range) {
        tr = tr.removeMark(range.from, range.to, type).addMark(range.from, range.to, type.create({ href }));
      } else {
        const text = (label.value || '').trim() || url.value.trim();
        tr = tr.replaceSelectionWith(schema.text(text, [type.create({ href })]), false);
      }
      view.dispatch(tr.scrollIntoView());
      close();
      view.focus();
    };
    dialog({
      onClose: () => view.focus(),
      title: current ? 'Editar o link' : 'Pôr um link',
      body: h('form', {
        class: 'form',
        onsubmit: (e) => {
          e.preventDefault();
          apply(closeDialog);
        },
      },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Endereço'), url),
      label ? h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Texto'), label) : null,
      err,
      h('button', { type: 'submit', hidden: true })),
      actions: (close) => {
        closeDialog = close;
        return [
          current ? h('button', {
            class: 'btn btn-ghost danger',
            type: 'button',
            onclick: () => {
              view.dispatch(view.state.tr.removeMark(range.from, range.to, type));
              close();
              view.focus();
            },
          }, 'Tirar o link') : null,
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { close(); view.focus(); } }, 'Cancelar'),
          h('button', { class: 'btn btn-k', type: 'button', onclick: () => apply(close) }, current ? 'Salvar' : 'Pôr o link'),
        ];
      },
    });
    setTimeout(() => url.focus(), 50);
  }
  let closeDialog = () => {};

  /* the spotlight (spotlight.js): which block of the page the caret is in, and the way back */

  const renders = (node) => (blockMd(node) ? 1 : 0);
  root.rt = {
    view,
    busy: () => busy > 0,
    focus: () => view.focus(),
    // the block of the page (from 1) the caret, or the image `target` is in; 0 before any
    block(target) {
      const { doc } = view.state;
      let index = view.state.selection.$from.index(0);
      const fig = target && target.closest && target.closest('.rt-fig');
      if (fig) {
        try {
          index = doc.resolve(view.posAtDOM(fig, 0)).index(0);
        } catch { /* not in the document any more */ }
      }
      let n = 0;
      for (let i = 0; i <= index && i < doc.childCount; i += 1) n += renders(doc.child(i));
      return n;
    },
    // the caret at the start of block n, and that line in the middle of the window
    go(n, behavior = 'smooth') {
      const { doc } = view.state;
      let count = 0;
      let at = null;
      doc.forEach((node, offset) => {
        if (at !== null) return;
        count += renders(node);
        if (count >= n && renders(node)) at = { node, offset };
      });
      if (!at) at = { node: doc.lastChild, offset: doc.content.size - doc.lastChild.nodeSize };
      const sel = at.node.isAtom ? NodeSelection.create(doc, at.offset) : Selection.near(doc.resolve(at.offset + 1));
      view.dispatch(view.state.tr.setSelection(sel));
      view.focus();
      const dom = view.nodeDOM(at.offset);
      const box = dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : view.coordsAtPos(sel.from);
      window.scrollBy({ top: box.top - innerHeight / 2 + 40, behavior });
    },
  };
  return root;
}

// A pasted passage, cleaned: no empty lines between its blocks (Google Docs puts a <br> between
// paragraphs), and a subtitle, list or quote it starts with stays one instead of merging into
// the line it's pasted in.
function tidySlice(slice) {
  const kids = [];
  slice.content.forEach((node) => kids.push(node));
  if (kids.length < 2) return slice;
  const blank = (node) => node.type.name === 'paragraph' && !node.textContent.trim();
  const keep = kids.filter((node, i) => i === 0 || i === kids.length - 1 || !blank(node));
  const openStart = slice.openStart > 0 && keep[0].type.name !== 'paragraph' ? 0 : slice.openStart;
  return new Slice(Fragment.from(keep), openStart, slice.openEnd);
}

/* ---------- an image in the text ---------- */

class FigureView {
  constructor(node, view, getPos, env) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.env = env;
    this.altOpen = false;

    this.img = h('img', { alt: '', draggable: 'false' });
    this.up = h('span', { class: 'rt-up', role: 'status' });
    this.pic = h('div', { class: 'rt-pic', draggable: 'true', title: 'Arraste para mudar a imagem de lugar' }, this.img, this.up);
    const tool = (name, title, onclick, cls = '') => h('button', { type: 'button', class: `rt-ft${cls ? ` ${cls}` : ''}`, title, 'aria-label': title, onclick }, icon(name));
    this.altBtn = h('button', { type: 'button', class: 'rt-ft rt-ft-text', onclick: () => this.openAlt() }, 'Descrição');
    this.tools = h('div', { class: 'rt-ftools' },
      tool('up', 'Subir a imagem', () => this.move(-1)),
      tool('down', 'Descer a imagem', () => this.move(1)),
      this.altBtn,
      h('button', { type: 'button', class: 'rt-ft rt-ft-text', onclick: () => env.fileFor(this.getPos, {}) }, 'Trocar'),
      tool('trash', 'Tirar a imagem do texto', () => this.remove(), 'danger'));
    this.cap = h('input', {
      type: 'text', class: 'rt-cap', placeholder: 'Escreva uma legenda (opcional)', 'aria-label': 'Legenda da imagem', maxlength: '200',
      oninput: () => this.attr({ caption: this.cap.value }),
      onkeydown: (e) => this.keys(e),
    });
    this.alt = h('input', {
      type: 'text', class: 'rt-alt', placeholder: 'O que a imagem mostra, para quem não pode vê-la', 'aria-label': 'Descrição da imagem', maxlength: '200',
      oninput: () => this.attr({ alt: this.alt.value }),
      onkeydown: (e) => this.keys(e),
    });
    this.altRow = h('label', { class: 'rt-alt-row' }, h('span', null, 'Descrição'), this.alt);
    // an image from another site: the box that asks for its file
    this.ask = h('div', { class: 'rt-ask' },
      h('p', null, h('b', null, 'Esta imagem veio de outro site'), ' e não pode ir assim para a página. Envie o arquivo dela, do computador ou do celular.'),
      h('div', { class: 'btns' },
        h('button', { type: 'button', class: 'btn btn-k btn-sm', onclick: () => env.fileFor(this.getPos, {}) }, 'Enviar o arquivo'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => this.remove() }, 'Tirar')));
    this.dom = h('figure', { class: 'rt-fig', contenteditable: 'false' }, this.pic, this.ask, this.tools, this.cap, this.altRow);
    // (the form closing doesn't tell its editor: once gone from the page, it stops listening)
    this.stop = uploads.onUploads((job) => {
      if (this.dom.isConnected) this.seen = true;
      else if (this.seen) {
        this.stop();
        return;
      }
      if (job.path === this.node.attrs.src) this.status();
    });
    this.render();
  }

  render() {
    const { src, alt, caption } = this.node.attrs;
    const missing = !src;
    this.dom.classList.toggle('rt-missing', missing);
    this.pic.hidden = missing;
    this.ask.hidden = !missing;
    this.cap.hidden = missing;
    this.tools.hidden = missing;
    if (src) {
      const url = store.assetUrl(src) || '';
      if (this.img.getAttribute('src') !== url) this.img.setAttribute('src', url);
      this.img.alt = alt;
    }
    if (document.activeElement !== this.cap) this.cap.value = caption;
    if (document.activeElement !== this.alt) this.alt.value = alt;
    this.altRow.hidden = missing || (!alt && !this.altOpen);
    this.altBtn.hidden = !this.altRow.hidden;
    this.status();
  }

  // how its trip to the bucket goes
  status() {
    const { src } = this.node.attrs;
    const job = src ? uploads.status(src) : null;
    let text = '';
    let kind = '';
    if (job && job.state === 'up') text = `Enviando… ${Math.round((job.progress || 0) * 100)}%`;
    else if (job && job.state === 'wait') text = !net.online ? 'Sem internet: vai quando voltar' : r2.hasKey() ? 'Na fila para enviar…' : '';
    else if (job && job.state === 'err') {
      text = 'Não foi enviada.';
      kind = 'err';
    }
    this.up.replaceChildren(text);
    if (kind === 'err') this.up.append(' ', h('button', { type: 'button', onclick: () => uploads.retry([src]) }, 'Tentar de novo'));
    this.up.className = `rt-up${kind ? ` ${kind}` : ''}`;
    this.up.hidden = !text;
  }

  openAlt() {
    this.altOpen = true;
    this.render();
    this.alt.focus();
  }

  attr(change) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, ...change }));
  }

  // Enter in the caption goes back to the text, after the image
  keys(e) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    const pos = this.getPos();
    if (pos == null) return;
    const { state } = this.view;
    const after = pos + this.node.nodeSize;
    let tr = state.tr;
    if (e.key === 'Enter' && (after >= state.doc.content.size || !state.doc.resolve(after).nodeAfter || !state.doc.resolve(after).nodeAfter.isTextblock)) {
      tr = tr.insert(after, state.schema.nodes.paragraph.create());
    }
    tr = tr.setSelection(e.key === 'Enter' ? TextSelection.near(tr.doc.resolve(after + 1)) : NodeSelection.create(tr.doc, pos));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  move(dir) {
    const pos = this.getPos();
    if (pos == null) return;
    const { state } = this.view;
    const $pos = state.doc.resolve(pos);
    const index = $pos.index();
    const parent = $pos.parent;
    if (dir < 0 && index === 0) return;
    if (dir > 0 && index >= parent.childCount - 1) return;
    const node = this.node;
    let tr = state.tr.delete(pos, pos + node.nodeSize);
    const target = dir < 0 ? pos - parent.child(index - 1).nodeSize : pos + parent.child(index + 1).nodeSize;
    tr = tr.insert(target, node);
    tr = tr.setSelection(NodeSelection.create(tr.doc, target));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  remove() {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('sel');
  }

  deselectNode() {
    this.dom.classList.remove('sel');
  }

  // the caption, the description and the buttons are its own; the picture can be dragged
  stopEvent(e) {
    return Boolean(e.target && e.target.closest && e.target.closest('input, button, label, .rt-ask'));
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.stop();
  }
}
