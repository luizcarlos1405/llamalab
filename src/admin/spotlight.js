// The form and its live preview point at each other.
//
// The preview marks where each field shows on the page: data-f holds the field's path in the
// form ("title", "hero.text", "qa.2.a"; several, separated by spaces), written by mark() in
// src/render/parts.js, in the preview only. When a field gets the focus, each of its places
// gets a ring, the first one with the field's name, and the preview scrolls to them unless one
// is in sight; in a long text (Markdown) the ring follows the paragraph the caret is in. A
// field with no place on the page gets a note instead, saying why when the schema knows
// (offPage in src/schema.js). The other way round, the pointer on a marked part of the preview
// outlines it with its field's name, and a click takes the form to that field, in a long text
// to the paragraph clicked.
//
// The rings live in the admin's page, over the iframe, so they keep their size however small
// the preview is drawn, and the page in the preview stays as the site has it.

import { SINGLETONS } from '../schema.js';
import { renderMarkdown } from '../markdown.js';
import { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const PAD = 5; // admin pixels between an element and its ring
const NAV = 90; // the site's nav covers the top of the page (CSS px, in the preview)
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Marked parts of the preview take the pointer, the ribbons too: the site lets clicks through them.
const PREVIEW_CSS = '[data-f]{cursor:pointer;pointer-events:auto}';

// Shapes inside an SVG (the ribbons) glow instead of getting a ring: their box is much bigger
// than they are. Chromium doesn't paint CSS filters on SVG shapes, so it's an SVG filter,
// added to the preview's drawing.
function glow(el, on) {
  const root = el.ownerSVGElement;
  if (!on || !root) {
    el.removeAttribute('filter');
    return;
  }
  const doc = el.ownerDocument;
  if (!doc.getElementById('spot-glow')) {
    const filter = doc.createElementNS(SVG, 'filter');
    filter.id = 'spot-glow';
    for (const [k, v] of Object.entries({ x: '-10%', y: '-50%', width: '120%', height: '200%' })) filter.setAttribute(k, v);
    filter.innerHTML = '<feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#ee3c23"/><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#ee3c23"/>';
    const defs = root.querySelector('defs') || root.insertBefore(doc.createElementNS(SVG, 'defs'), root.firstChild);
    defs.append(filter);
  }
  el.setAttribute('filter', 'url(#spot-glow)');
}

const pathsOf = (el) => (el.getAttribute('data-f') || '').split(' ').filter(Boolean);

// The marked elements for a field, the closest mark up its path ("qa.0.q", then "qa.0", "qa").
function marked(doc, path) {
  const parts = path.split('.');
  for (let n = parts.length; n > 0; n -= 1) {
    const found = [...doc.querySelectorAll(`[data-f~="${parts.slice(0, n).join('.')}"]`)];
    if (found.length) return found;
  }
  return [];
}

// The page has a place for it. Hidden by the page's own scrolling still counts (the home's
// stage, once the page covers it); left out of the layout doesn't.
function placed(el) {
  return [...el.getClientRects()].some((r) => r.width || r.height);
}

// How far down the home's stage shows: the page slides up over it from the bottom as it
// scrolls (Infinity on pages without one).
function coverOf(doc) {
  const stageEl = doc.querySelector('[data-f-top]');
  for (let n = stageEl && stageEl.nextElementSibling; n; n = n.nextElementSibling) {
    const r = n.getBoundingClientRect();
    if (r.height) return r.top;
  }
  return Infinity;
}

// Where an SVG shape's name goes: just above the first point of its line in sight, under
// `cover`. The ribbons' box is much bigger than they are, so a name on the box floats away.
function anchorOf(g, cover) {
  const doc = g.ownerDocument;
  const win = doc.defaultView;
  const use = g.querySelector('use');
  const id = use && (use.getAttribute('href') || '').replace(/^#/, '');
  const line = id && doc.getElementById(id);
  const m = line && line.getTotalLength && use.getScreenCTM();
  if (!m) return null;
  const half = ((parseFloat(win.getComputedStyle(use).strokeWidth) || 0) / 2) * Math.hypot(m.a, m.b);
  const total = line.getTotalLength();
  const bottom = Math.min(win.innerHeight, cover);
  for (let i = 0; i <= 80; i += 1) {
    const p = line.getPointAtLength((total * i) / 80).matrixTransform(m);
    if (p.x >= 16 && p.x <= win.innerWidth - 16 && p.y - half > NAV && p.y + half < bottom) return { left: p.x, top: p.y - half, width: 1, height: half * 2 };
  }
  return null;
}

// The site's nav and its menu are fixed: always in sight, no reason to scroll.
function inFixed(el) {
  const win = el.ownerDocument.defaultView;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (win.getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

// stage: the box the iframe is drawn in (it clips the rings); frame: the preview's iframe.
export function spotlight(stage, frame) {
  const rings = h('div', { class: 'spot-rings', 'aria-hidden': 'true' });
  const ghost = h('i', { class: 'spot-hover', 'aria-hidden': 'true', hidden: true });
  const ghostTag = h('span', { class: 'spot-tag ghost', 'aria-hidden': 'true', hidden: true });
  const tag = h('span', { class: 'spot-tag', 'aria-hidden': 'true', hidden: true });
  const note = h('p', { class: 'spot-note', 'aria-hidden': 'true', hidden: true });
  stage.append(rings, ghost, ghostTag, tag, note);

  let want = null; // the lit field: { path, label, block, empty(), note }
  let targets = []; // its places: [{ el, fixed, svg, top }]
  let doc = null; // the preview's document the targets are in
  let hover = null; // the marked part under the pointer: { el, box, svg, text, go(block) | note }
  let resolve = () => null; // a marked part's paths → what the form makes of them (pick())
  let wired = null; // the preview's document the pointer is followed in
  let message = null; // a click's message, for a moment: { label, text }
  let raf = 0;
  let popTimer;
  let messageTimer;

  const run = () => {
    if (!raf) raf = requestAnimationFrame(place);
  };

  const unglow = () => {
    for (const t of targets) if (t.svg && t.el.ownerDocument === frame.contentDocument) glow(t.el, false);
  };

  // A click's message, or why the lit field has no place on the page. No page at all (a new
  // album has none until it has photos) has nothing to say about it.
  const writeNote = () => {
    let label = '';
    let text = '';
    if (message) ({ label, text } = message);
    else if (want && !targets.length && doc && doc.body && doc.body.childElementCount) {
      label = want.label || 'Esse campo';
      text = want.note || (want.empty() ? 'vazio, não aparece na página.' : 'não aparece nesta página.');
    }
    if (text) note.replaceChildren(h('b', null, label), ': ', text);
    note.hidden = !text;
  };
  const say = (label, text) => {
    message = { label, text };
    writeNote();
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = null;
      writeNote();
    }, 3500);
  };

  const scroll = (behavior) => {
    const win = frame.contentWindow;
    const flow = targets.filter((t) => !t.fixed);
    if (!win || !flow.length) return;
    const vh = win.innerHeight;
    // In sight: most of it between the nav and the bottom. The home's stage stays put while
    // the page slides up over it and dims it, so it's whole only at the very top.
    const seen = (t) => {
      if (t.top) return win.scrollY <= 4;
      const r = t.el.getBoundingClientRect();
      return Math.min(r.bottom, vh) - Math.max(r.top, NAV) >= Math.min(r.height, vh - NAV) * 0.6;
    };
    if (flow.some(seen)) return;
    let y = 0;
    if (!flow[0].top) {
      const r = flow[0].el.getBoundingClientRect();
      y = win.scrollY + r.top - (r.height < vh - NAV - 40 ? NAV + (vh - NAV - r.height) / 2 : NAV + 16);
    }
    win.scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'auto' : behavior });
  };

  const locate = ({ fresh = false, moved = false } = {}) => {
    unglow();
    targets = [];
    doc = frame.contentDocument;
    if (!want || !doc || !doc.body) {
      writeNote();
      return;
    }
    let found = marked(doc, want.path);
    // a long text: the paragraph (or heading, list, image) the caret is in
    if (want.block && found.length === 1 && found[0].children[want.block - 1]) found = [found[0].children[want.block - 1]];
    targets = found.filter(placed).map((el) => ({ el, fixed: inFixed(el), svg: el.namespaceURI === SVG, top: Boolean(el.closest('[data-f-top]')) }));
    for (const t of targets) if (t.svg) glow(t.el, true);
    writeNote();
    if (fresh) {
      clearTimeout(popTimer);
      rings.classList.add('pop');
      tag.classList.add('pop');
      popTimer = setTimeout(() => { rings.classList.remove('pop'); tag.classList.remove('pop'); }, 600);
    }
    scroll(fresh || moved ? 'smooth' : 'auto');
    run();
  };

  const put = (el, x, y, w, hgt) => {
    const t = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    if (el.style.transform !== t) el.style.transform = t;
    if (w !== undefined) {
      const ws = `${Math.round(w)}px`;
      const hs = `${Math.round(hgt)}px`;
      if (el.style.width !== ws) el.style.width = ws;
      if (el.style.height !== hs) el.style.height = hs;
    }
  };

  // a name next to a box: above it, or under it when there's no room, inside the stage
  const label = (el, b, text) => {
    if (el.textContent !== text) el.textContent = text;
    el.hidden = false;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let y = b.y - th - 4;
    if (y < 6) y = b.y + b.h + 4;
    if (y + th > H - 6) y = Math.max(6, b.y + 6);
    put(el, Math.max(6, Math.min(b.x, W - tw - 6)), Math.min(y, H - th - 6));
  };

  // Every frame while something shows: the boxes move with the preview's scroll, its
  // animations and its images loading in.
  function place() {
    raf = 0;
    if (!want && !hover) return;
    // the editor was closed
    if (!stage.isConnected) {
      want = null;
      hover = null;
      hide();
      return;
    }
    raf = requestAnimationFrame(place);
    const current = frame.contentDocument;
    const fr = frame.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const s = frame.offsetWidth ? fr.width / frame.offsetWidth : 1;
    const ox = fr.left - sr.left;
    const oy = fr.top - sr.top;
    const box = (r) => ({ x: ox + r.left * s - PAD, y: oy + r.top * s - PAD, w: r.width * s + PAD * 2, h: r.height * s + PAD * 2 });
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const inStage = (b) => b.y + b.h > 0 && b.y < H && b.x + b.w > 0 && b.x < W;

    const cover = current ? coverOf(current) : Infinity;

    // the lit field; while the preview is being redrawn, its rings stay until refresh()
    if (want && doc === current) {
      const boxes = [];
      for (const t of targets) {
        if (t.svg) {
          const a = anchorOf(t.el, t.top ? cover : Infinity);
          if (a) boxes.push({ ...box(a), fixed: t.fixed, svg: true });
          continue;
        }
        let rects = [...t.el.getClientRects()].filter((r) => r.width || r.height);
        if (rects.length > 3) rects = [t.el.getBoundingClientRect()];
        // on the home's stage, only what the page hasn't covered yet
        if (t.top) rects = rects.map((r) => ({ left: r.left, top: r.top, width: r.width, height: Math.min(r.height, cover - r.top) })).filter((r) => r.height > 6);
        for (const r of rects) boxes.push({ ...box(r), fixed: t.fixed, svg: false });
      }
      const ringBoxes = boxes.filter((b) => !b.svg);
      while (rings.children.length < ringBoxes.length) rings.append(h('i'));
      while (rings.children.length > ringBoxes.length) rings.lastChild.remove();
      ringBoxes.forEach((b, i) => put(rings.children[i], b.x, b.y, b.w, b.h));
      // the name goes on the first place in sight, out in the page rather than up in the nav
      const inSight = boxes.filter(inStage);
      const first = inSight.find((b) => !b.fixed) || inSight[0];
      if (first && want.label) label(tag, first, want.label);
      else tag.hidden = true;
    }

    // the part under the pointer, unless it's lit already
    const lit = hover && targets.some((t) => t.el === hover.box || t.el === hover.el);
    if (hover && hover.el.ownerDocument === current && !lit) {
      // an SVG shape's name goes where the pointer is on it
      const b = box(hover.svg && hover.at ? { left: hover.at[0], top: hover.at[1] - 10, width: 1, height: 20 } : hover.box.getBoundingClientRect());
      ghost.hidden = hover.svg;
      if (!hover.svg) put(ghost, b.x, b.y, b.w, b.h);
      if (inStage(b)) label(ghostTag, b, hover.text);
      else ghostTag.hidden = true;
    } else {
      ghost.hidden = true;
      ghostTag.hidden = true;
    }
  }

  const hide = () => {
    unglow();
    targets = [];
    rings.replaceChildren();
    tag.hidden = true;
    writeNote();
    if (!hover) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const setHover = (next) => {
    if (next && hover && next.el === hover.el && next.box === hover.box) {
      hover.at = next.at; // the same part, the pointer elsewhere on it
      return;
    }
    hover = next;
    if (hover) run();
    else {
      ghost.hidden = true;
      ghostTag.hidden = true;
    }
  };

  // Follow the pointer in the preview's page: a new page each time the preview is redrawn.
  const wire = () => {
    const d = frame.contentDocument;
    if (!d || !d.body || d === wired) return;
    wired = d;
    setHover(null);
    const win = d.defaultView;
    const style = d.createElement('style');
    style.textContent = PREVIEW_CSS;
    d.head.append(style);
    let pointer = null;
    // the marked part at the pointer, and in a long text the paragraph
    const under = (target, at = null) => {
      const el = target && target.closest ? target.closest('[data-f]') : null;
      const info = el && resolve(pathsOf(el));
      if (!info) return null;
      const child = info.md ? [...el.children].find((c) => c.contains(target)) : null;
      return { el, box: child || el, block: child ? [...el.children].indexOf(child) + 1 : 0, svg: el.namespaceURI === SVG, at, ...info };
    };
    win.addEventListener('pointermove', (e) => {
      pointer = [e.clientX, e.clientY];
      setHover(under(e.target, pointer));
    }, { passive: true });
    win.addEventListener('pointerout', (e) => {
      if (e.relatedTarget) return;
      pointer = null;
      setHover(null);
    });
    // the page scrolling under a still pointer
    win.addEventListener('scroll', () => {
      if (pointer) setHover(under(d.elementFromPoint(pointer[0], pointer[1]), pointer));
    }, { passive: true });
    // first in line, so the page's own handlers (a photo's viewer, a link) don't run as well
    win.addEventListener('click', (e) => {
      const at = under(e.target);
      if (!at) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (at.go) at.go(at.block);
      else say(at.label, at.note);
    }, true);
  };

  return {
    // spec: { path, label, block, empty(), note }, or null to put the light out
    show(spec) {
      if (!spec) {
        want = null;
        hide();
        return;
      }
      const same = want && want.path === spec.path;
      const moved = same && want.block !== spec.block;
      want = spec;
      // a click's message gives way to the field the editor moves to
      if (!same && message) {
        message = null;
        clearTimeout(messageTimer);
      }
      if (!same) locate({ fresh: true });
      else if (moved) locate({ moved: true });
    },
    // after the preview is redrawn, or drawn at another size
    refresh() {
      wire();
      if (want) locate();
    },
    // fn(paths) → { text, label, md, go(block) } for a field of this form, { text, label, note }
    // for one edited elsewhere, or null
    pick(fn) {
      resolve = fn;
    },
  };
}

/* ---------- the form's side ---------- */

// The schema's fields along a path ("radio.stations.0.name": radio, stations, name), or null
// when the path isn't theirs.
function along(fields, path) {
  const out = [];
  let list = fields;
  for (const key of path.split('.')) {
    if (/^\d+$/.test(key)) continue;
    const f = (list || []).find((x) => x.key === key);
    if (!f) return null;
    out.push(f);
    list = f.fields;
  }
  return out.length ? out : null;
}

// The name of the field, as the form shows it ("Instagram", "Estação 2 · Nome no dial").
function labelOf(at) {
  const field = at.closest('.field');
  const lbl = field && field.querySelector(':scope > .lbl-row .lbl, :scope > .switch .lbl');
  let text = lbl && lbl.firstChild ? lbl.firstChild.textContent.trim() : '';
  if (at.classList.contains('list-row')) text = `${text} ${[...at.parentNode.children].indexOf(at) + 1}`;
  const card = at.closest('.rep-card');
  const head = card && card.querySelector('.rep-head b');
  if (head) text = `${head.textContent} · ${text}`;
  return text;
}

const blocksIn = (text) => {
  const t = document.createElement('template');
  t.innerHTML = renderMarkdown(text);
  return t.content.children.length;
};

// Which block of a Markdown text the caret is in, counting from 1 (0: none yet).
function blockAt(ta) {
  const v = ta.value;
  const end = v.indexOf('\n', ta.selectionEnd);
  return blocksIn(v.slice(0, end < 0 ? v.length : end));
}

// Where block n (from 1) of a Markdown text starts: the first line that makes n blocks.
function blockStart(text, n) {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (blocksIn(lines.slice(0, i + 1).join('\n')) >= n) return offset;
    offset += lines[i].length + 1;
  }
  return text.length;
}

// How far down a textarea the text at `offset` is: the text before it, laid out the same way
// in a hidden copy. The Markdown boxes grow with their text, so the page scrolls, not the box.
const COPIED = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'];
function offsetY(ta, offset) {
  const cs = getComputedStyle(ta);
  const copy = document.createElement('div');
  for (const p of COPIED) copy.style[p] = cs[p];
  Object.assign(copy.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', borderStyle: 'solid', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' });
  const end = document.createElement('span');
  end.textContent = '​';
  copy.append(ta.value.slice(0, offset), end);
  document.body.append(copy);
  const y = end.offsetTop;
  copy.remove();
  return y;
}

// Lights up, in the preview `pv`, the field of `formEl` that has the focus, and takes the form
// to the field of a part clicked in the preview. `model` is the object the form edits, `fields`
// its schema.
export function followFields(formEl, pv, model, fields) {
  let off;
  const nameOf = (at) => labelOf(at) || ((along(fields, at.dataset.path) || []).at(-1) || {}).label || '';
  const spec = (target) => {
    const at = target.closest && target.closest('[data-path]');
    if (!at || !formEl.contains(at)) return null;
    const path = at.dataset.path;
    const empty = () => {
      const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), model);
      return value == null || String(value).trim() === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && 'src' in value && !value.src);
    };
    // what the schema says about the field, or the group it's in, when it isn't on the page
    const note = ((along(fields, path) || []).filter((f) => f.offPage).at(-1) || {}).offPage || '';
    return { path, label: nameOf(at), empty, note, block: target.matches('textarea.md-text') ? blockAt(target) : 0 };
  };
  const show = (e) => {
    clearTimeout(off);
    const s = spec(e.target);
    if (s) pv.spotlight(s);
  };
  formEl.addEventListener('focusin', show);
  // The light stays on while the editor works the preview (Celular, scrolling it, a click in
  // it), and goes out when they go anywhere else.
  const away = () => {
    clearTimeout(off);
    off = setTimeout(() => {
      const at = document.activeElement;
      if (!formEl.contains(at) && !pv.el.contains(at)) pv.spotlight(null);
    }, 150);
  };
  formEl.addEventListener('focusout', away);
  pv.el.addEventListener('focusout', away);
  const press = (e) => {
    if (!formEl.isConnected) {
      document.removeEventListener('pointerdown', press, true);
      return;
    }
    if (!formEl.contains(e.target) && !pv.el.contains(e.target)) pv.spotlight(null);
  };
  document.addEventListener('pointerdown', press, true);
  // the caret moving to another paragraph of a long text
  const caret = (e) => {
    if (e.target.matches && e.target.matches('textarea.md-text') && document.activeElement === e.target) show(e);
  };
  formEl.addEventListener('keyup', caret);
  formEl.addEventListener('pointerup', caret);
  formEl.addEventListener('input', caret);

  // The other way: a part clicked in the preview. Its field, or the first of its fields this
  // form has (a row's "qa.2" is its first field, "qa.2.q").
  const fieldFor = (path) => formEl.querySelector(`[data-path="${path}"]`) || formEl.querySelector(`[data-path^="${path}."]`);
  const go = (at, block) => {
    const controls = [...at.querySelectorAll('textarea, input, select, button')]
      .filter((c) => !c.disabled && c.type !== 'file' && c.type !== 'hidden' && c.getClientRects().length);
    const control = controls.find((c) => c.matches('textarea.md-text')) || controls[0];
    const behavior = reduced() ? 'auto' : 'smooth';
    if (control && block && control.matches('textarea.md-text')) {
      // in a long text, the caret at the start of the paragraph clicked, and that line in view
      const offset = blockStart(control.value, block);
      control.setSelectionRange(offset, offset);
      control.focus({ preventScroll: true });
      show({ target: control });
      const y = control.getBoundingClientRect().top + offsetY(control, offset);
      window.scrollBy({ top: y - innerHeight / 2, behavior });
      return;
    }
    if (control) control.focus({ preventScroll: true });
    at.scrollIntoView({ block: 'center', behavior });
  };
  pv.pick((paths) => {
    for (const path of paths) {
      const at = fieldFor(path);
      if (at) {
        const text = nameOf(at);
        return { text, label: text, md: Boolean(at.querySelector('textarea.md-text')), go: (block) => go(at, block) };
      }
    }
    // the nav and the footer, on every page, come from Capa e contatos
    for (const path of paths) {
      for (const t of Object.values(SINGLETONS)) {
        const chain = t.fields !== fields && along(t.fields, path);
        if (chain) {
          const name = chain.at(-1).label;
          return { text: `${name} · ${t.label}`, label: name, note: `isso se edita em ${t.label}.` };
        }
      }
    }
    return null;
  });
}
