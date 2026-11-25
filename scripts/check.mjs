#!/usr/bin/env node
// Checks the admin's live preview against the forms, after a change to a page's template or
// to the schema:
//
//   npm run check
//
// Each form's page is drawn as the preview draws it, for an item with every field filled
// in. Every field must have a place there (a mark, mark() in src/render/parts.js) or a note
// saying where it shows instead (offPage in src/schema.js), and every mark must name a field
// that exists. Published pages must carry no marks. It isn't part of the build, so it can
// never stop a deploy.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, SINGLETONS, normalize } from '../src/schema.js';
import { renderSite, renderPreview } from '../src/render/index.js';
import { SITE } from '../src/config.js';
import { todayISO } from '../src/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = { site: 'home', sobre: 'sobre', contrate: 'contrate' };
const ID = 'conferencia';
const EVENT = 'conferencia-evento';

// A value for every field, so that every part of the page that depends on one shows.
function sample(field, n = 0) {
  switch (field.type) {
    case 'boolean': return true;
    case 'date': return '2026-12-05';
    case 'time': return '20:00';
    case 'email': return 'equipe@example.com';
    case 'url':
      if (field.key === 'video') return 'https://youtu.be/dQw4w9WgXcQ';
      if (field.pattern) return 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      return `https://example.com/${field.key}`;
    case 'markdown': return 'Primeiro parágrafo do texto.\n\nSegundo parágrafo.';
    case 'image': return { src: `images/conferencia/${field.key}.webp`, alt: 'Uma foto', w: 1200, h: 800, credit: 'Quem fotografou' };
    case 'strings': return ['Primeira', 'Segunda'];
    case 'photos': return [1, 2, 3].map((i) => ({ src: `images/fotos/conferencia-${i}.webp`, thumb: `images/fotos/conferencia-${i}-p.webp`, w: 1200, h: 800 }));
    case 'event': return EVENT;
    case 'hidden': return '';
    case 'group': return fill(field.fields);
    case 'repeater': return [0, 1].map((i) => fill(field.fields, i));
    default: {
      const special = { whatsapp: '5567999999999', instagram: '@conferencia', tiktok: 'conferencia', cnpj: '00.000.000/0001-00', highlight: 'destaque', quote: 'Uma frase com destaque no meio' }[field.key];
      return special || `${field.label} ${n + 1}`;
    }
  }
}

function fill(fields, n = 0) {
  return Object.fromEntries(fields.map((f) => [f.key, sample(f, n)]));
}

// Every path the form has a box for ("hero.title", "qa", "qa.0.q", "ribbons.top.0"), with the
// note that covers it, if any.
function paths(fields, base = '', note = '') {
  const out = [];
  for (const f of fields) {
    if (f.type === 'hidden') continue;
    const p = base ? `${base}.${f.key}` : f.key;
    const n = f.offPage || note;
    if (f.type === 'group') out.push(...paths(f.fields, p, n));
    else {
      out.push({ path: p, note: n });
      if (f.type === 'repeater') out.push(...paths(f.fields, `${p}.0`, n));
      if (f.type === 'strings') out.push({ path: `${p}.0`, note: n });
    }
  }
  return out;
}

// A path of these fields: keys, with a row number after a list's ("qa.2.q", "ribbons.top.1").
function known(fields, p) {
  let list = fields;
  let field = null;
  for (const key of p.split('.')) {
    if (/^\d+$/.test(key) && field && (field.type === 'repeater' || field.type === 'strings')) continue;
    field = (list || []).find((f) => f.key === key);
    if (!field) return false;
    list = field.fields;
  }
  return true;
}

// The admin's own lookup: the field's mark, or the closest one up its path.
function placed(marks, p) {
  const parts = p.split('.');
  for (let n = parts.length; n > 0; n -= 1) if (marks.has(parts.slice(0, n).join('.'))) return true;
  return false;
}

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

const data = {};
for (const [name, t] of Object.entries(SINGLETONS)) data[name] = normalize(t.fields, fill(t.fields));
for (const [name, t] of Object.entries(COLLECTIONS)) {
  const items = (await readJson(t.file, [])).map((x) => normalize(t.fields, x)).filter((x) => x.id !== ID);
  data[name] = [...items, normalize(t.fields, { ...fill(t.fields), id: ID })].sort(t.sort);
}
// the event the sample album is of
data.agenda.push(normalize(COLLECTIONS.agenda.fields, { ...fill(COLLECTIONS.agenda.fields), id: EVENT, featured: false }));

const opts = { today: todayISO(), siteUrl: SITE.defaultUrl, version: '', assetUrl: () => null, imageSize: () => null };
const problems = [];
let count = 0;
for (const [name, t] of Object.entries({ ...SINGLETONS, ...COLLECTIONS })) {
  const html = renderPreview(data, opts, ROUTES[name] || `${name}/${ID}`) || '';
  const marks = new Set([...html.matchAll(/ data-f="([^"]*)"/g)].flatMap((m) => m[1].split(' ')));
  for (const { path: p, note } of paths(t.fields)) {
    count += 1;
    if (!placed(marks, p) && !note) problems.push(`${t.label}: "${p}" has no place on its page and no note (offPage) saying where it shows`);
  }
  for (const p of marks) {
    if (!known(t.fields, p) && !known(SINGLETONS.site.fields, p)) problems.push(`${t.label}: the page marks "${p}", which isn't a field of this form (nor of Capa e contatos)`);
  }
}

for (const file of renderSite(data, opts)) {
  if (/ data-f(-top)?[=\s>]/.test(file.html)) problems.push(`${file.path}: a published page carries the preview's marks`);
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ All ${count} fields of the ${Object.keys({ ...SINGLETONS, ...COLLECTIONS }).length} forms have a place in their page's preview or a note; published pages carry no marks.`);
