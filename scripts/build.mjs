#!/usr/bin/env node
// Builds the static site into _site/.
//
//   node scripts/build.mjs
//
// Environment:
//   SITE_URL        absolute URL the site is served from (default: SITE.defaultUrl)
//   BUILD_DATE      YYYY-MM-DD to treat as today (default: today in Dourados)
//   GITHUB_SHA      commit being built; written to version.json for the admin
//   GITHUB_ACTIONS  "true" in GitHub Actions, which sets it: there, content that points to
//                   an image missing from the repository fails the build (see
//                   missingImages); locally it's a warning

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderSite } from '../src/render/index.js';
import { COLLECTIONS, SINGLETONS, normalize, validate } from '../src/schema.js';
import { SITE } from '../src/config.js';
import { todayISO, imageRefsAt } from '../src/util.js';
import { JS_FLAG, JS_FLAG_HASH } from '../src/render/layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const COPY = ['assets', 'images', 'data', 'src', 'admin.html'];
// The image formats whose pixel size the build reads (readImageSize).
const MEASURED = /\.(webp|png|jpe?g|gif)$/i;

// A problem in the content that the build already explained: printed without a stack trace.
class BuildError extends Error {}

export async function build({
  siteUrl = process.env.SITE_URL || SITE.defaultUrl,
  today = process.env.BUILD_DATE || todayISO(),
  quiet = false,
  strict = process.env.GITHUB_ACTIONS === 'true',
} = {}) {
  const started = Date.now();
  // The pages' inline script only runs if the Content-Security-Policy lists its hash.
  const flagHash = `'sha256-${crypto.createHash('sha256').update(JS_FLAG).digest('base64')}'`;
  if (flagHash !== JS_FLAG_HASH) throw new Error(`The inline script in src/render/layout.js changed: set JS_FLAG_HASH to ${flagHash}`);
  const warnings = [];
  const data = await loadData(warnings);
  const sizes = await imageSizes(warnings);
  const missing = await missingImages(data, sizes, warnings);
  if (missing.length && strict) {
    if (!quiet) {
      for (const w of warnings) console.warn(`warning: ${w}`);
      await annotate(missing);
    }
    const n = missing.length;
    throw new BuildError(`${n} ${n > 1 ? "references point to images that aren't" : "reference points to an image that isn't"} in the repository (listed above). `
      + `The build stops here, so this version isn't deployed and the site keeps the last good one. README.md, "When a deploy fails", says how to fix it.`);
  }
  for (const m of missing) warnings.push(`${where(m)}: ${m.at} points to ${m.src}, which isn't in the repository`);

  const version = await assetVersion();
  const files = renderSite(data, {
    today,
    siteUrl: siteUrl.replace(/\/+$/, ''),
    version,
    buildTime: new Date().toISOString(),
    imageSize: (p) => sizes.get(String(p).split(/[?#]/)[0]) || null,
  });

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  for (const entry of COPY) {
    await fs.cp(path.join(ROOT, entry), path.join(OUT, entry), { recursive: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  for (const file of files) {
    const target = path.join(OUT, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.html);
  }
  await fs.writeFile(path.join(OUT, '.nojekyll'), '');
  await nameOriginInAdminCsp(siteUrl);
  const admin = await stampAdminVersion();
  await fs.writeFile(path.join(OUT, 'version.json'), `${JSON.stringify({ sha: process.env.GITHUB_SHA || 'local', builtAt: new Date().toISOString(), today, admin }, null, 2)}\n`);
  await writeWorker(version);

  if (!quiet) {
    for (const w of warnings) console.warn(`warning: ${w}`);
    const pages = files.filter((f) => f.path.endsWith('.html')).length;
    console.log(`Built ${pages} pages into _site/ in ${Date.now() - started} ms (today = ${today}, ${siteUrl}).`);
  }
  return { warnings, files };
}

async function readJson(rel, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`${rel}: ${error.message}`);
  }
}

// Reads every data file, fills in missing keys and drops items that can't be
// rendered (no id, duplicate id, or a required field missing), with a warning,
// so one bad entry never takes the whole site down.
async function loadData(warnings) {
  const data = {};
  for (const [name, type] of Object.entries(SINGLETONS)) {
    data[name] = normalize(type.fields, await readJson(type.file, {}));
  }
  for (const [name, type] of Object.entries(COLLECTIONS)) {
    const raw = await readJson(type.file, []);
    if (!Array.isArray(raw)) throw new Error(`${type.file} must be a JSON array`);
    const seen = new Set();
    data[name] = [];
    for (const item of raw) {
      const norm = normalize(type.fields, item);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(norm.id || '') || seen.has(norm.id)) {
        warnings.push(`${type.file}: skipped an item with a missing, invalid or duplicate id (${norm.id || 'none'})`);
        continue;
      }
      const problems = validate(type.fields, norm);
      const fatal = problems.filter((p) => p.field.required || p.field.type === 'date');
      if (fatal.length) {
        warnings.push(`${type.file} ${norm.id}: skipped (${fatal.map((p) => p.message).join(' ')})`);
        continue;
      }
      for (const p of problems) warnings.push(`${type.file} ${norm.id}: ${p.message}`);
      seen.add(norm.id);
      data[name].push(norm);
    }
  }
  return data;
}

// Pixel size of every image under images/, read from the file headers.
async function imageSizes(warnings) {
  const sizes = new Map();
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (MEASURED.test(entry.name)) {
        const handle = await fs.open(path.join(ROOT, rel));
        const { buffer } = await handle.read(Buffer.alloc(65536), 0, 65536, 0);
        await handle.close();
        const size = readImageSize(buffer);
        if (size) sizes.set(rel, size);
        else warnings.push(`could not read the size of ${rel}`);
      }
    }
  };
  await walk('images');
  return sizes;
}

// What the content points to under images/ that isn't in the repository, each with the data
// file, item and field that point to it. In GitHub Actions that fails the build, so the deploy
// doesn't run and the site keeps its last good version: on 24/11/2026 an outdated admin removed
// the 18 artists' photos, and the site went live with every one of them broken. Locally it's a
// warning, so work can go on. An image that is there but whose size the build doesn't know (an
// SVG or AVIF, or a file it can't parse, which imageSizes already warns about) only goes out
// without width and height: a warning anywhere.
async function missingImages(data, sizes, warnings) {
  const present = new Set(await listFiles(ROOT, 'images').catch(() => []));
  const missing = [];
  const unmeasured = new Set();
  const check = (file, item) => {
    for (const { src, at } of imageRefsAt(item)) {
      if (!present.has(src)) missing.push({ file, id: item.id || '', at, src });
      else if (!sizes.has(src) && !MEASURED.test(src)) unmeasured.add(src);
    }
  };
  for (const [name, type] of Object.entries(SINGLETONS)) check(type.file, data[name]);
  for (const [name, type] of Object.entries(COLLECTIONS)) for (const item of data[name]) check(type.file, item);
  for (const src of unmeasured) warnings.push(`no size for ${src}: the build only reads WebP, PNG, JPEG and GIF, so it goes out without width and height`);
  return missing;
}

// "data/artistas.json ana-paula-lopes", or just the file for the pages' settings (no id).
const where = (m) => (m.id ? `${m.file} ${m.id}` : m.file);

// The missing images as error annotations, which GitHub Actions shows on the run's page: one
// per data file (it shows only the first 10 of a step), with every item, field and image, and
// linked to the line of the first one.
async function annotate(missing) {
  const byFile = new Map();
  for (const m of missing) byFile.set(m.file, [...(byFile.get(m.file) || []), m]);
  for (const [file, list] of byFile) {
    const text = await fs.readFile(path.join(ROOT, file), 'utf8').catch(() => '');
    const line = lineOf(text, list[0]);
    const message = [
      list.length > 1 ? `${list.length} references to images that aren't in the repository:` : "A reference to an image that isn't in the repository:",
      ...list.map((m) => `${m.id ? `${m.id}: ` : ''}${m.at} points to ${m.src}`),
    ].join('\n');
    const props = `file=${escapeProperty(file)}${line ? `,line=${line}` : ''},title=${list.length > 1 ? 'Missing images' : 'Missing image'}`;
    console.log(`::error ${props}::${escapeData(message)}`);
  }
}

// The line of a reference in its data file: the first one with the image's path after the
// item's id (the admin writes the files with one key per line).
function lineOf(text, { id, src }) {
  const lines = text.split('\n');
  const from = id ? Math.max(0, lines.findIndex((l) => l.includes(`"id": ${JSON.stringify(id)}`))) : 0;
  const i = lines.findIndex((l, n) => n >= from && l.includes(src));
  return i < 0 ? 0 : i + 1;
}

// Workflow commands take their message and properties with these characters escaped.
const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function readImageSize(buf) {
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    return null;
  }
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// The admin's live preview is an iframe srcdoc, and Firefox (148) blocks the requests from one
// that the service worker answers when the page's Content-Security-Policy allows them only as
// 'self': the preview showed without its stylesheet, scripts and fonts. The site's origin,
// named next to each 'self' in admin.html's policy, matches there. For everything else it
// changes nothing: it's the address 'self' already stands for.
async function nameOriginInAdminCsp(siteUrl) {
  const file = path.join(OUT, 'admin.html');
  const html = await fs.readFile(file, 'utf8');
  const meta = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)/;
  if (!meta.test(html)) throw new Error('admin.html: the Content-Security-Policy meta tag is missing');
  const origin = new URL(siteUrl).origin;
  await fs.writeFile(file, html.replace(meta, (_, start, policy) => start + policy.replaceAll("'self'", `'self' ${origin}`)));
}

// The admin's own version: a hash of what it runs, its page, modules, styles and fonts (the
// worker's "admin" pack). The admin page carries it, and version.json says which one is on the
// site, so an admin older than the site's can tell before it publishes (publishFlow in
// src/admin/app.js). A deploy that only changes content keeps it.
async function stampAdminVersion() {
  const hash = crypto.createHash('sha256');
  for (const file of await listFiles(OUT)) {
    const runs = file === 'admin.html' || (file.startsWith('src/') && file.endsWith('.js') && file !== 'src/sw.js') || ADMIN.includes(file);
    if (runs) hash.update(file).update(await fs.readFile(path.join(OUT, file)));
  }
  const version = hash.digest('hex').slice(0, 12);
  const file = path.join(OUT, 'admin.html');
  const html = await fs.readFile(file, 'utf8');
  if (!html.includes('<meta charset="utf-8">')) throw new Error('admin.html: the charset meta tag is missing');
  await fs.writeFile(file, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="admin-version" content="${version}">`));
  return version;
}

// The service worker (src/sw.js) with the files it may keep for offline use, by pack, each
// with a hash of its content: a new version only downloads what changed.
//   base   every visitor: the CSS, scripts and fonts, the offline page, the home page, the agenda
//   site   the installed app: every other page, the events' .ics files, every image
//   admin  editors: the admin's page, modules, styles and fonts
const BASE = ['assets/site.css', 'assets/site.js', 'assets/radio.js', 'assets/favicon.svg', 'assets/fonts/anton-400.woff2', 'assets/fonts/outfit-300-800.woff2'];
const ADMIN = ['assets/admin.css', 'assets/fonts.css', 'assets/fonts/bagel-fat-one-400.woff2', 'assets/icons/site-192.png'];

async function writeWorker(assets) {
  await fs.rm(path.join(OUT, 'src/sw.js'), { force: true });
  const entries = [];
  const add = async (u, file, p) => {
    const content = await fs.readFile(path.join(OUT, file));
    entries.push({ u, r: crypto.createHash('sha256').update(content).digest('hex').slice(0, 12), p });
  };
  for (const file of await listFiles(OUT)) {
    if (file === 'index.html') await add('./', file, 'base');
    else if (file === 'agenda/index.html') await add('agenda/', file, 'base');
    else if (file === 'offline.html' || BASE.includes(file)) await add(file, file, 'base');
    else if (file.endsWith('/index.html')) await add(file.slice(0, -'index.html'.length), file, 'site');
    else if (/^agenda\/[^/]+\/evento\.ics$/.test(file) || /^images\/.+\.(webp|png|jpe?g|gif)$/i.test(file)) await add(file, file, 'site');
    else if (file === 'admin.html') await add('admin', file, 'admin');
    else if ((file.startsWith('src/') && file.endsWith('.js')) || ADMIN.includes(file)) await add(file, file, 'admin');
  }
  const template = await fs.readFile(path.join(ROOT, 'src/sw.js'), 'utf8');
  const versionOf = crypto.createHash('sha256').update(template).update(JSON.stringify(entries)).digest('hex').slice(0, 10);
  const line = `const BUILD = ${JSON.stringify({ version: versionOf, assets, files: entries })};`;
  const worker = template.replace(/^const BUILD = .*$/m, () => line);
  if (worker === template) throw new Error('src/sw.js: the "const BUILD = …" line is missing');
  await fs.writeFile(path.join(OUT, 'sw.js'), worker);
}

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

// Short hash of the CSS/JS so browsers fetch new versions after a deploy.
async function assetVersion() {
  const hash = crypto.createHash('sha1');
  for (const rel of ['assets/site.css', 'assets/site.js', 'assets/radio.js', 'assets/fonts.css', 'assets/admin.css']) {
    hash.update(await fs.readFile(path.join(ROOT, rel)).catch(() => ''));
  }
  return hash.digest('hex').slice(0, 8);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((error) => {
    console.error(error instanceof BuildError ? `error: ${error.message}` : error);
    process.exit(1);
  });
}
