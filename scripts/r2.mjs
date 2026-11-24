#!/usr/bin/env node
// Looks after the images in Cloudflare R2 (src/config.js MEDIA), with the same signing the
// admin uses (src/admin/r2.js).
//
//   node scripts/r2.mjs ls [prefix]        list what's in the bucket
//   node scripts/r2.mjs push <path>...     upload files of this checkout under the same key
//                                          (images/agenda/x.webp → images/agenda/x.webp);
//                                          a folder uploads everything in it. Files already
//                                          there with the same size are skipped.
//   node scripts/r2.mjs check              is every image the content points to there?
//   node scripts/r2.mjs orphans            what's there that no content points to any more
//   node scripts/r2.mjs rm <key>...        delete objects
//
// The key: R2_KEY in the environment ({"accessKeyId": …, "secretAccessKey": …}), or else read
// from the private repository with the GitHub CLI (gh), signed in as someone who reaches it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as r2 from '../src/admin/r2.js';
import { MEDIA, mediaUrl } from '../src/config.js';
import { COLLECTIONS, SINGLETONS } from '../src/schema.js';
import { imageRefs } from '../src/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif' };

function key() {
  const raw = process.env.R2_KEY || execFileSync('gh', ['api', `repos/${MEDIA.keys.owner}/${MEDIA.keys.repo}/contents/${MEDIA.keys.file}`, '-H', 'Accept: application/vnd.github.raw+json'], { encoding: 'utf8' });
  r2.setKey(JSON.parse(raw));
}

async function files(rel) {
  const full = path.join(ROOT, rel);
  const stat = await fs.stat(full);
  if (!stat.isDirectory()) return [rel];
  const out = [];
  for (const entry of await fs.readdir(full)) out.push(...await files(`${rel}/${entry}`));
  return out;
}

// Every image path the content points to (all data files, including types this script
// doesn't know).
async function referenced() {
  const refs = new Set();
  const known = new Set(Object.values({ ...COLLECTIONS, ...SINGLETONS }).map((t) => t.file));
  const dataFiles = (await fs.readdir(path.join(ROOT, 'data'))).filter((f) => f.endsWith('.json')).map((f) => `data/${f}`);
  for (const file of new Set([...known, ...dataFiles])) {
    try {
      imageRefs(JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8')), refs);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return refs;
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'ls') {
  key();
  const objects = await r2.list(args[0] || '');
  for (const o of objects) console.log(`${String(o.size).padStart(9)}  ${o.modified.slice(0, 19)}  ${o.key}`);
  console.log(`${objects.length} objects, ${(objects.reduce((n, o) => n + o.size, 0) / 1048576).toFixed(1)} MB`);
} else if (cmd === 'push') {
  if (!args.length) throw new Error('push what? e.g. node scripts/r2.mjs push images');
  key();
  const there = new Map((await r2.list('')).map((o) => [o.key, o.size]));
  const list = (await Promise.all(args.map((a) => files(a.replace(/\/+$/, ''))))).flat();
  let sent = 0;
  await pool(list, 4, async (rel) => {
    const body = await fs.readFile(path.join(ROOT, rel));
    if (there.get(rel) === body.length) return;
    const type = TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream';
    await r2.put(rel, new Blob([body], { type }), { type });
    sent += 1;
    console.log(`sent ${rel} (${(body.length / 1024).toFixed(0)} KB)`);
  });
  console.log(`${sent} sent, ${list.length - sent} already there`);
} else if (cmd === 'check') {
  const refs = [...await referenced()];
  const missing = [];
  await pool(refs, 8, async (ref) => {
    const local = await fs.stat(path.join(ROOT, ref)).then(() => true, () => false);
    if (local) return;
    const res = await fetch(mediaUrl(ref), { method: 'HEAD' });
    if (!res.ok) missing.push(`${ref} (${res.status})`);
  });
  for (const m of missing.sort()) console.log(`missing: ${m}`);
  console.log(`${refs.length} images referenced, ${missing.length} missing`);
  if (missing.length) process.exitCode = 1;
} else if (cmd === 'orphans') {
  key();
  const refs = await referenced();
  const orphans = (await r2.list('images/')).filter((o) => !refs.has(o.key));
  for (const o of orphans) console.log(`${String(o.size).padStart(9)}  ${o.modified.slice(0, 19)}  ${o.key}`);
  console.log(`${orphans.length} objects nothing points to (${(orphans.reduce((n, o) => n + o.size, 0) / 1048576).toFixed(1)} MB). Delete with: node scripts/r2.mjs rm <key>…`);
} else if (cmd === 'rm') {
  key();
  for (const k of args) {
    await r2.del(k);
    console.log(`deleted ${k}`);
  }
} else {
  console.log('usage: node scripts/r2.mjs ls [prefix] | push <path>… | check | orphans | rm <key>…');
  process.exitCode = 1;
}
