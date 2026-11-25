// The long texts as the visual editor (src/admin/richtext.js) holds them, and the way back to
// the Markdown the site keeps.
//
// The texts stay Markdown, in the small dialect of src/markdown.js: the build, the preview and
// the image checks read them as before, and so does an editor's older cached admin. The editor
// shows a document instead, whose parts are exactly what that dialect can say: paragraphs with
// line breaks, subtitles, quotes, lists, rules and images with a caption; bold, italic,
// strikethrough, code and links. Nothing else can get in, pasted or typed.
//
// A text becomes a document through the site's own renderer (renderMarkdown), so the editor
// reads it the way the page does. A document becomes Markdown through toMarkdown(), which writes
// only what renderMarkdown reads back the same. `npm run check` sends every text in data/ both
// ways. No DOM here, so that check runs in Node.

import { Schema } from '../vendor/prosemirror.js';
import { renderMarkdown } from '../markdown.js';
import { isSafeUrl } from '../util.js';

/* ---------- the documents ---------- */

// `short` (an event's description): no subtitles and no images.
export function makeSchema({ short = false } = {}) {
  const nodes = {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
  };
  if (!short) {
    nodes.heading = {
      group: 'block',
      attrs: { level: { default: 2 } },
      content: 'text*',
      defining: true,
      parseDOM: [
        { tag: 'h1', attrs: { level: 2 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 4 } },
        { tag: 'h5', attrs: { level: 4 } },
        { tag: 'h6', attrs: { level: 4 } },
      ],
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    };
  }
  Object.assign(nodes, {
    blockquote: {
      group: 'block',
      content: 'paragraph+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      parseDOM: [{ tag: 'ol' }],
      toDOM: () => ['ol', 0],
    },
    list_item: {
      content: 'paragraph',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM: () => ['hr'],
    },
  });
  if (!short) {
    // An image with its caption. `src` is the repository path ("images/entrevistas/foo.webp");
    // `ext` is the address of an image pasted from another site, which can't come along (the
    // site's Content-Security-Policy would block it): the editor asks for the file instead, and
    // until then it's left out of the Markdown.
    nodes.figure = {
      group: 'block',
      atom: true,
      draggable: true,
      selectable: true,
      attrs: { src: { default: '' }, alt: { default: '' }, caption: { default: '' }, ext: { default: '' } },
      parseDOM: [
        {
          tag: 'figure',
          getAttrs: (dom) => {
            const img = dom.querySelector('img');
            if (!img) return false;
            const cap = dom.querySelector('figcaption');
            return imageAttrs(img.getAttribute('src'), img.getAttribute('alt'), cap ? cap.textContent : '');
          },
        },
        { tag: 'img[src]', getAttrs: (dom) => imageAttrs(dom.getAttribute('src'), dom.getAttribute('alt'), dom.getAttribute('title')) },
      ],
      toDOM: (node) => ['figure', ['img', { src: node.attrs.src || node.attrs.ext, alt: node.attrs.alt }], ['figcaption', node.attrs.caption]],
    };
  }
  Object.assign(nodes, {
    text: { group: 'inline' },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  });

  const marks = {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [{
        tag: 'a[href]',
        getAttrs: (dom) => {
          const href = (dom.getAttribute('href') || '').trim();
          return href && isSafeUrl(href) && !href.startsWith('#') ? { href } : false;
        },
      }],
      toDOM: (mark) => ['a', { href: mark.attrs.href, rel: 'noopener', title: mark.attrs.href }, 0],
    },
    strong: {
      parseDOM: [
        { tag: 'strong' },
        // Google Docs wraps everything it copies in <b style="font-weight:normal">
        { tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
        { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
        { style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[6-9]\d{2,})$/.test(value) && null },
      ],
      toDOM: () => ['strong', 0],
    },
    em: {
      parseDOM: [
        { tag: 'em' },
        { tag: 'i' },
        { style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' },
        { style: 'font-style=italic' },
      ],
      toDOM: () => ['em', 0],
    },
    del: {
      parseDOM: [
        { tag: 'del' },
        { tag: 's' },
        { tag: 'strike' },
        { style: 'text-decoration', getAttrs: (value) => /line-through/.test(value) && null },
        { style: 'text-decoration-line', getAttrs: (value) => /line-through/.test(value) && null },
      ],
      toDOM: () => ['del', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
  };
  return new Schema({ nodes, marks });
}

// An image from the repository keeps its path; one from anywhere else waits for its file.
function imageAttrs(src, alt, caption) {
  const s = String(src || '').trim();
  const a = String(alt || '').trim();
  const c = String(caption || '').trim();
  if (/^images\//.test(s)) return { src: s, alt: a, caption: c, ext: '' };
  return { src: '', alt: a, caption: c, ext: s || 'imagem' };
}

/* ---------- Markdown → document ---------- */

// The renderer's HTML, read back into a tree. It only ever writes the tags below, closed in
// order, with double-quoted attributes, so a small reader is enough (and works without a DOM).
const VOID = new Set(['br', 'hr', 'img']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k in ENTITIES) return ENTITIES[k];
  if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
  if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
  return m;
});

function readHtml(html) {
  const root = { tag: '', attrs: {}, kids: [] };
  const stack = [root];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.kids.push({ text: decode(m[4]) });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) attrs[a[1].toLowerCase()] = decode(a[2] ?? '');
    const el = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  return root.kids;
}

const textOf = (el) => (el.text !== undefined ? el.text : el.kids.map(textOf).join(''));

// Markdown → document, read the way the site reads it.
export function toDoc(schema, markdown) {
  const html = renderMarkdown(String(markdown || ''), { url: (u) => u });
  const blocks = toBlocks(schema, readHtml(html));
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create());
  return schema.nodes.doc.create(null, blocks);
}

function toBlocks(schema, els) {
  const { nodes } = schema;
  const out = [];
  const paragraphs = (kids) => {
    // a paragraph, split around the images inside it (they stand alone in the editor)
    let run = [];
    const flush = () => {
      const content = tidy(run);
      if (content.length) out.push(nodes.paragraph.create(null, content));
      run = [];
    };
    for (const item of toInline(schema, kids)) {
      if (item.figure) {
        flush();
        if (nodes.figure) out.push(nodes.figure.create(item.figure));
      } else {
        run.push(item);
      }
    }
    flush();
  };
  for (const el of els) {
    if (el.text !== undefined) continue; // the line breaks between blocks
    switch (el.tag) {
      case 'p':
        paragraphs(el.kids);
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Math.min(4, Math.max(2, Number(el.tag[1])));
        const content = tidy(toInline(schema, el.kids).filter((n) => n.isText));
        if (!content.length) break;
        out.push(nodes.heading ? nodes.heading.create({ level }, content) : nodes.paragraph.create(null, content));
        break;
      }
      case 'blockquote': {
        const inner = toBlocks(schema, el.kids).flatMap((b) => flatten(schema, b));
        if (inner.length) out.push(nodes.blockquote.create(null, inner));
        break;
      }
      case 'ul': case 'ol': {
        const items = el.kids.filter((k) => k.tag === 'li').map((li) => {
          const content = tidy(toInline(schema, li.kids).filter((n) => !n.figure));
          return nodes.list_item.create(null, nodes.paragraph.create(null, content));
        });
        if (items.length) out.push((el.tag === 'ul' ? nodes.bullet_list : nodes.ordered_list).create(null, items));
        break;
      }
      case 'hr':
        out.push(nodes.horizontal_rule.create());
        break;
      case 'figure': {
        const img = el.kids.find((k) => k.tag === 'img');
        const cap = el.kids.find((k) => k.tag === 'figcaption');
        if (img && nodes.figure) out.push(nodes.figure.create(imageAttrs(img.attrs.src, img.attrs.alt, cap ? textOf(cap) : '')));
        break;
      }
      default:
        paragraphs(el.kids);
    }
  }
  return out;
}

// A block inside a quote, as the paragraphs a quote can hold.
function flatten(schema, block) {
  if (block.type === schema.nodes.paragraph) return [block];
  if (block.type === schema.nodes.heading) return [schema.nodes.paragraph.create(null, block.content)];
  if (block.type === schema.nodes.bullet_list || block.type === schema.nodes.ordered_list) {
    const out = [];
    block.forEach((item) => out.push(item.firstChild));
    return out;
  }
  return [];
}

function toInline(schema, kids, marks = [], out = []) {
  const { nodes, marks: m } = schema;
  for (const kid of kids) {
    if (kid.text !== undefined) {
      // the renderer writes "<br>\n": the line break is the <br>
      const text = kid.text.replace(/\n/g, '');
      if (text) out.push(schema.text(text, marks));
      continue;
    }
    switch (kid.tag) {
      case 'br':
        out.push(nodes.hard_break.create());
        break;
      case 'strong': case 'b':
        toInline(schema, kid.kids, m.strong.create().addToSet(marks), out);
        break;
      case 'em': case 'i':
        toInline(schema, kid.kids, m.em.create().addToSet(marks), out);
        break;
      case 'del': case 's':
        toInline(schema, kid.kids, m.del.create().addToSet(marks), out);
        break;
      case 'code':
        toInline(schema, kid.kids, m.code.create().addToSet(marks), out);
        break;
      case 'a':
        toInline(schema, kid.kids, kid.attrs.href ? m.link.create({ href: kid.attrs.href }).addToSet(marks) : marks, out);
        break;
      case 'img':
        out.push({ figure: imageAttrs(kid.attrs.src, kid.attrs.alt, kid.attrs.title) });
        break;
      default:
        toInline(schema, kid.kids, marks, out);
    }
  }
  return out;
}

// Spaces as the page shows them: one at a time, none at the start or end of a line.
function tidy(inline) {
  const out = [];
  for (let i = 0; i < inline.length; i += 1) {
    const node = inline[i];
    if (!node.isText) {
      out.push(node);
      continue;
    }
    let text = node.text.replace(/[ \t\r\f\v]+/g, ' ');
    const prev = out[out.length - 1];
    if (!prev || !prev.isText) text = text.replace(/^ +/, '');
    else if (prev.text.endsWith(' ') && text.startsWith(' ')) text = text.slice(1);
    const next = inline[i + 1];
    if (!next || !next.isText) text = text.replace(/ +$/, '');
    if (text) out.push(node.type.schema.text(text, node.marks));
  }
  while (out.length && !out[out.length - 1].isText) out.pop();
  while (out.length && !out[0].isText) out.shift();
  return out;
}

/* ---------- document → Markdown ---------- */

// Document → Markdown that renderMarkdown reads back as the same document.
export function toMarkdown(doc) {
  const out = [];
  doc.forEach((block) => {
    const md = blockMd(block);
    if (md) out.push(md);
  });
  return out.join('\n\n');
}

export function blockMd(node) {
  const { name } = node.type;
  if (name === 'paragraph') return inlineMd(node);
  if (name === 'heading') {
    let text = inlineMd(node, { breaks: false });
    if (!text) return '';
    // the renderer drops a heading's closing #s: a "#" of its own needs one after it
    if (text.endsWith('#')) text += ' #';
    return `${'#'.repeat(node.attrs.level)} ${text}`;
  }
  if (name === 'blockquote') {
    const inner = [];
    node.forEach((p) => {
      const md = inlineMd(p);
      if (md) inner.push(md);
    });
    return inner.join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  }
  if (name === 'bullet_list' || name === 'ordered_list') {
    const lines = [];
    let n = 0;
    node.forEach((item) => {
      // one line per item: a line break inside one continues it, indented
      const md = inlineMd(item.firstChild);
      if (!md) return;
      n += 1;
      const marker = name === 'bullet_list' ? '- ' : `${n}. `;
      lines.push(marker + md.split('\n').join(`\n${' '.repeat(marker.length)}`));
    });
    return lines.join('\n');
  }
  if (name === 'horizontal_rule') return '---';
  if (name === 'figure') {
    const { src, alt, caption } = node.attrs;
    if (!src) return '';
    const a = String(alt).replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
    // a caption can't hold a straight quote ("): it gets the typographic ones
    const c = String(caption).replace(/\s+/g, ' ').trim().replace(/(^|[\s([{“‘])"/g, '$1“').replace(/"/g, '”');
    return `![${a}](${src}${c ? ` "${c}"` : ''})`;
  }
  return '';
}

// The renderer's patterns (src/markdown.js): what would start a block, or an image of its own.
const BLOCK_START = /^(#{1,6}(\s|$)|>|[-*+](\s|$)|\d+[.)](\s|$)|([-*_])(\s*\5){2,}\s*$)/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"»”]$/;
const WORD = /[\p{L}\p{N}]/u;

// A paragraph's text with its marks. Every mark opens and closes where the renderer's patterns
// see it: right against the words (spaces go outside), and italics only between words, never
// inside one. Italics are *x* unless the paragraph has bold, then _x_, so the two never touch.
// `breaks: false` (a heading) turns line breaks into spaces. Two line breaks in a row would end
// the paragraph, so they count as one.
function inlineMd(node, { breaks = true } = {}) {
  const runs = [];
  node.forEach((child) => {
    if (child.isText) runs.push({ text: child.text, marks: child.marks });
    else if (child.type.name === 'hard_break') runs.push(breaks ? { br: true } : { text: ' ', marks: [] });
  });
  const italic = runs.some((r) => r.marks && r.marks.some((mk) => mk.type.name === 'strong')) ? '_' : '*';
  return writeRuns(groupLinks(runs), italic).split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

// Consecutive runs inside the same link become one item: the marks the whole link has stay
// outside it, the rest go inside its label.
function groupLinks(runs) {
  const items = [];
  for (const run of runs) {
    const link = run.marks && run.marks.find((mk) => mk.type.name === 'link');
    const last = items[items.length - 1];
    if (link && last && last.link && last.link.eq(link)) last.runs.push(run);
    else if (link) items.push({ link, runs: [run] });
    else items.push(run);
  }
  for (const item of items) {
    if (!item.link) continue;
    // (code stays inside: `x` goes in the label; spaces at its edges don't count, they go outside)
    const words = item.runs.filter((r) => r.text.trim());
    const of = words.length ? words : item.runs;
    const shared = of[0].marks.filter((mk) => ORDER.includes(mk.type.name) && of.every((r) => mk.isInSet(r.marks)));
    item.marks = shared;
    item.text = item.runs.map((r) => r.text).join('');
    item.inner = item.runs.map((r) => ({ text: r.text, marks: r.marks.filter((mk) => mk.type.name !== 'link' && !mk.isInSet(shared)) }));
  }
  return items;
}

const DELIMS = { strong: '**', del: '~~' };
const ORDER = ['strong', 'em', 'del'];
const SPACE = /[ \t\u00a0]/;

// Writes runs and links, opening and closing marks as they change.
function writeRuns(items, italic, inLabel = false) {
  let out = '';
  const stack = []; // open marks: { name, delim, pending, dropped }
  const names = (item) => (item.br ? [] : (item.marks || []).map((mk) => mk.type.name).filter((n) => ORDER.includes(n)));
  // how many items from i on carry mark `name`, with no line break in between
  const reach = (i, name) => {
    let n = 0;
    while (i + n < items.length && !items[i + n].br && names(items[i + n]).includes(name)) n += 1;
    return n;
  };
  const close = (entry) => {
    if (entry.pending || entry.dropped) return;
    const ws = /[ \t\u00a0]+$/.exec(out);
    if (ws) out = out.slice(0, ws.index);
    out += entry.delim + (ws ? ws[0] : '');
  };
  const flush = () => {
    for (const entry of stack) {
      if (entry.pending && !entry.dropped) out += entry.delim;
      entry.pending = false;
    }
  };

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.br) {
      while (stack.length) close(stack.pop());
      out += '\n';
      continue;
    }
    const want = names(item);
    let keep = 0;
    while (keep < stack.length && want.includes(stack[keep].name)) keep += 1;
    while (stack.length > keep) close(stack.pop());
    // what opens here: the longest-lasting outermost
    const opening = want.filter((n) => !stack.some((e) => e.name === n))
      .sort((a, b) => reach(i, b) - reach(i, a) || ORDER.indexOf(a) - ORDER.indexOf(b));
    for (const name of opening) {
      const entry = { name, delim: name === 'em' ? italic : DELIMS[name], pending: true, dropped: false };
      if (name === 'em') {
        // italics can't start or end inside a word: the renderer would show the * or _
        const last = items[i + reach(i, 'em') - 1];
        const next = items[i + reach(i, 'em')];
        const before = SPACE.test(item.text[0] || '') ? ' ' : out.slice(-1);
        const after = SPACE.test(last.text.slice(-1)) ? ' ' : !next || next.br ? '' : next.link ? '[' : next.text[0] || '';
        if (WORD.test(before) || WORD.test(after)) entry.dropped = true;
      }
      stack.push(entry);
    }

    const lead = /^[ \t\u00a0]*/.exec(item.text)[0];
    const trail = item.link ? /[ \t\u00a0]*$/.exec(item.text.slice(lead.length))[0] : '';
    const rest = item.text.slice(lead.length, item.text.length - trail.length);
    out += lead;
    if (!rest) {
      out += trail;
      continue;
    }
    if (item.link) {
      // bare only where the renderer finds an address on its own: after a space or a "(",
      // with no mark around it
      const prev = out.slice(-1);
      const bareOk = !stack.some((e) => !e.dropped) && (!prev || /[\s(]/.test(prev));
      flush();
      out = linkMd(item, rest, italic, out, bareOk);
      out += trail;
      continue;
    }
    flush();
    const lineStart = !inLabel && /(^|\n)$/.test(out.replace(/[ \t]+$/, ''));
    // in code, a backslash would escape what follows it (the renderer reads escapes first)
    if (item.marks.some((mk) => mk.type.name === 'code') && !rest.includes('`')) out += `\`${rest.replace(/[\u0001\u0002]/g, '').replace(/\\/g, '\\\\')}\``;
    else out += escapeText(rest, lineStart, italic);
  }
  while (stack.length) close(stack.pop());
  return out;
}

// A link, after `out`: bare when its text is its address and the renderer would find it on its
// own (`bareOk`), else [label](address).
function linkMd(item, text, italic, out, bareOk) {
  const href = String(item.link.attrs.href || '').trim();
  const plain = item.inner.every((r) => !r.marks.length);
  if (bareOk && plain && (text === href || `https://${text}` === href) && BARE_URL.test(text)) return out + text;
  const inner = item.inner.map((r) => ({ text: r.text.replace(/\n/g, ' '), marks: r.marks }));
  const label = writeRuns(inner, italic, true).replace(/\n/g, ' ').trim() || escapeText(href, false, italic);
  const url = href.replace(/[\s()<>]/g, (ch) => encodeURIComponent(ch));
  // a "!" right before would make it an image
  const head = /(^|[^\\])!$/.test(out) ? `${out.slice(0, -1)}\\!` : out;
  return `${head}[${label}](${url})`;
}

// Text the renderer shows as it is: its marks' characters escaped, and, at the start of a line,
// whatever would start a block there. A lone _ inside a word (snake_case) can't start italics,
// so it stays as it is, unless italics are written _x_ here: then one inside them would end them.
function escapeText(text, lineStart, italic = '*') {
  let s = text
    .replace(/[\u0001\u0002]/g, '')
    .replace(/[\\`*[\]~]/g, '\\$&')
    .replace(/_/g, (m, i, all) => (italic !== '_' && WORD.test(all[i - 1] || '') && WORD.test(all[i + 1] || '') ? m : '\\_'));
  if (lineStart && BLOCK_START.test(s)) {
    s = /^\d/.test(s) ? s.replace(/^(\d+)([.)])/, '$1\\$2') : `\\${s}`;
  }
  return s;
}
