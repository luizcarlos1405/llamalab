// Part of `npm run check` (scripts/check.mjs): the admin's visual editor keeps the long texts as
// Markdown (src/admin/richdoc.js). Here every long text in data/ goes into the editor's document
// and back, and must render the same and come back the same a second time; then random
// documents, with every mark, mix of marks and character the renderer treats specially, must
// come back from their Markdown as they were.

import fs from 'node:fs/promises';
import path from 'node:path';
import { COLLECTIONS, SINGLETONS } from '../src/schema.js';
import { renderMarkdown } from '../src/markdown.js';
import { makeSchema, toDoc, toMarkdown } from '../src/admin/richdoc.js';

const squash = (html) => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

export async function checkLongTexts(root, { random = 2000 } = {}) {
  const problems = [];
  let texts = 0;
  const check = (where, field, markdown) => {
    if (!markdown) return;
    texts += 1;
    const schema = makeSchema({ short: Boolean(field.short) });
    const out = toMarkdown(toDoc(schema, markdown));
    if (squash(renderMarkdown(out)) !== squash(renderMarkdown(markdown))) problems.push(`${where}: the visual editor would change how this text shows`);
    else if (toMarkdown(toDoc(schema, out)) !== out) problems.push(`${where}: the visual editor writes this text differently each time`);
  };
  for (const t of Object.values(COLLECTIONS)) {
    let items = [];
    try {
      items = JSON.parse(await fs.readFile(path.join(root, t.file), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const item of items) for (const f of t.fields) if (f.type === 'markdown') check(`${t.label} "${item.id}", ${f.label}`, f, item[f.key]);
  }
  for (const s of Object.values(SINGLETONS)) {
    let value = {};
    try {
      value = JSON.parse(await fs.readFile(path.join(root, s.file), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const f of s.fields) if (f.type === 'markdown') check(`${s.label}, ${f.label}`, f, value[f.key]);
  }

  const schema = makeSchema();
  let failed = 0;
  for (let i = 0; i < random; i += 1) {
    const doc = randomDoc(schema);
    const md = toMarkdown(doc);
    const back = toDoc(schema, md);
    if (canon(back) !== canon(doc) || toMarkdown(back) !== md) {
      failed += 1;
      if (failed <= 3) problems.push(`random document ${i}: its Markdown reads back as another document:\n${md}`);
    }
  }
  if (failed > 3) problems.push(`…and ${failed - 3} more random documents`);
  return { problems, texts, random };
}

/* ---------- random documents ---------- */

let seed = 1;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const WORDS = ['palavra', 'Rock', 'ação', 'MÚSICA', '2026', 'x', 'snake_case', 'a1', 'Dourados', 'É', 'ñ', 'R$50'];
const SIGNS = ['*', '_', '[', ']', '#', '>', '-', '+', '.', '!', '~', '`', '(', ')', '<', '&', '"', "'", '\\', ',', ':', '1.', '2)', '---', '**', '__', '~~', '![x](y)', '|', '»', '—'];
const HREFS = ['https://llamalab.com.br/agenda/', 'https://instagram.com/llama.etc', 'mailto:oi@llamalab.com.br', 'https://meaple.com.br/vibesbar/2609-10-anos'];
const isWord = (ch) => /[\p{L}\p{N}]/u.test(ch || '');

// A line of words and signs, with marks over stretches of it. Italics only where the renderer
// can see them (between words, never inside one): the editor drops the rest on purpose.
function line(schema) {
  const toks = [];
  const n = 1 + Math.floor(rnd() * 7);
  for (let i = 0; i < n; i += 1) {
    const t = rnd() < 0.65 ? pick(WORDS) : pick(SIGNS);
    if (i > 0 && (rnd() < 0.7 || (isWord(toks.at(-1).t.slice(-1)) && isWord(t[0])))) toks.push({ t: ' ', m: new Set() });
    toks.push({ t, m: new Set() });
  }
  for (const name of ['strong', 'em', 'del', 'code', 'link']) {
    if (rnd() < 0.5) continue;
    const a = Math.floor(rnd() * toks.length);
    const b = a + Math.floor(rnd() * (toks.length - a));
    const href = pick(HREFS);
    for (let i = a; i <= b; i += 1) toks[i].m.add(name === 'link' ? `link:${href}` : name);
  }
  const text = toks.map((x) => x.t).join('');
  let pos = 0;
  for (const x of toks) {
    x.from = pos;
    pos += x.t.length;
    x.to = pos;
  }
  for (let i = 0; i < toks.length;) {
    if (!toks[i].m.has('em')) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < toks.length && toks[j + 1].m.has('em')) j += 1;
    if (isWord(text[toks[i].from - 1]) || isWord(text[toks[j].to]) || !text.slice(toks[i].from, toks[j].to).trim()) {
      for (let k = i; k <= j; k += 1) toks[k].m.delete('em');
    }
    i = j + 1;
  }
  return toks.map((x) => {
    if (x.m.has('code') && (x.t.includes('`') || !x.t.trim())) x.m.delete('code');
    let marks = [];
    for (const k of x.m) {
      if (!x.t.trim() && k !== 'code' && !k.startsWith('link:')) continue;
      marks = (k.startsWith('link:') ? schema.marks.link.create({ href: k.slice(5) }) : schema.marks[k].create()).addToSet(marks);
    }
    return schema.text(x.t, marks);
  });
}

function paragraph(schema, lines = 1 + Math.floor(rnd() * 3)) {
  const content = [];
  for (let i = 0; i < lines; i += 1) {
    if (i) content.push(schema.nodes.hard_break.create());
    content.push(...line(schema));
  }
  return schema.nodes.paragraph.create(null, content);
}

function randomDoc(schema) {
  const { nodes } = schema;
  const block = () => {
    const r = rnd();
    if (r < 0.45) return paragraph(schema);
    if (r < 0.55) return nodes.heading.create({ level: pick([2, 3, 4]) }, line(schema));
    if (r < 0.65) return nodes.blockquote.create(null, [paragraph(schema), ...(rnd() < 0.4 ? [paragraph(schema)] : [])]);
    if (r < 0.8) {
      const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => nodes.list_item.create(null, paragraph(schema, 1 + Math.floor(rnd() * 2))));
      return (rnd() < 0.5 ? nodes.bullet_list : nodes.ordered_list).create(null, items);
    }
    if (r < 0.88) return nodes.horizontal_rule.create();
    return nodes.figure.create({
      src: `images/entrevistas/foto-${Math.floor(rnd() * 99)}.webp`,
      alt: rnd() < 0.5 ? `Foto de ${pick(WORDS)}` : '',
      caption: rnd() < 0.5 ? 'Legenda com (parênteses) e “aspas”' : '',
    });
  };
  return nodes.doc.create(null, Array.from({ length: 1 + Math.floor(rnd() * 4) }, block));
}

// A document as text with its marks, character by character, the way the page shows it: runs
// of spaces count as one, spaces at a line's ends don't count, and nor does a space's mark.
// Blocks with nothing in them don't count either (they write nothing).
function canon(node) {
  if (node.isTextblock) {
    const seq = [];
    node.forEach((child) => {
      if (child.type.name === 'hard_break') {
        seq.push('\n');
        return;
      }
      for (const ch of child.text) {
        if (/\s/.test(ch)) seq.push(' ');
        else seq.push(`${ch}{${child.marks.map((m) => m.type.name + (m.attrs.href ? `=${m.attrs.href}` : '')).sort().join(',')}}`);
      }
    });
    const text = seq.join('\u0000')
      .replace(/(\u0000? )+/g, '\u0000 ').replace(/(^|\n)\u0000 /g, '$1').replace(/\u0000 (\u0000?\n|$)/g, '$1')
      .replace(/(\u0000?\n)+/g, '\u0000\n').replace(/^\u0000\n|\u0000\n$/g, '');
    return text ? `${node.type.name}${node.attrs.level || ''}[${text}]` : '';
  }
  const kids = [];
  node.forEach((child) => {
    const c = canon(child);
    if (c) kids.push(c);
  });
  return `${node.type.name}${node.type.name === 'figure' ? JSON.stringify(node.attrs) : ''}(${kids.join('|')})`;
}
