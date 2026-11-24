// The admin's data: what's published (base, at commit headSha) and the local
// working copy with every unpublished edit. Edits and staged images are kept
// in IndexedDB until they're published as one commit.
//
// Merging is per item (collections) and per section (singletons): when someone
// else published in the meantime, local edits are replayed on top of their
// version, and only the same item edited on both sides is a conflict.

import { COLLECTIONS, SINGLETONS, normalize, validate } from '../schema.js';
import { REPO } from '../config.js';
import { jsonFile, imageRefs, imageRefsAt, slugify, uniqueSlug } from '../util.js';
import { kv, images as imageStore } from './idb.js';
import { decodeBase64Text, blobToBase64 } from './github.js';

export const TYPES = { ...COLLECTIONS, ...SINGLETONS };
const IMAGE_ROOT = 'images/';
// The only folders this admin ever removes unused images from: its own types' (not images of a
// type added to the site after this copy of the admin was loaded).
const IMAGE_DIRS = [...new Set(Object.values(TYPES).map((t) => t.imageDir).filter(Boolean))].map((d) => `${d}/`);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const state = {
  headSha: null,
  treeSha: null,
  base: null,
  baseText: {},
  remotePaths: new Set(),
  remoteKeep: new Set(),
  working: null,
  staged: new Map(),
  conflicts: [],
  loadedAt: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('llamalab-admin') : null;
export function onOtherTab(fn) {
  if (channel) channel.onmessage = (e) => fn(e.data);
}

/* ---------- data helpers ---------- */

export function normalizeData(raw) {
  const data = {};
  for (const [name, t] of Object.entries(SINGLETONS)) data[name] = normalize(t.fields, raw && raw[name]);
  for (const [name, t] of Object.entries(COLLECTIONS)) {
    const list = raw && Array.isArray(raw[name]) ? raw[name] : [];
    data[name] = list.map((item) => normalize(t.fields, item)).sort(t.sort);
  }
  return data;
}

export function serialize(name, value) {
  const t = TYPES[name];
  return jsonFile(COLLECTIONS[name] ? [...value].sort(t.sort) : value);
}

const byId = (list) => new Map((list || []).map((item) => [item.id, item]));

export function titleOf(type, item) {
  const t = TYPES[type];
  if (!item) return '';
  return (t.titleKey && item[t.titleKey]) || item.name || item.title || t.label;
}

export function find(type, id) {
  return (state.working[type] || []).find((item) => item.id === id) || null;
}

export function findBase(type, id) {
  return (state.base[type] || []).find((item) => item.id === id) || null;
}

/* ---------- loading ---------- */

async function cachedBlob(gh, sha) {
  const key = `blob:${sha}`;
  const hit = await kv.get(key);
  if (typeof hit === 'string') return hit;
  const blob = await gh.blob(sha);
  const text = decodeBase64Text(blob.content);
  await kv.set(key, text);
  return text;
}

export async function loadRemote(gh) {
  const headSha = await gh.head();
  const commit = await gh.commit(headSha);
  const tree = await gh.tree(commit.tree.sha);
  const files = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
  const raw = {};
  const texts = {};
  await Promise.all(Object.entries(TYPES).map(async ([name, t]) => {
    const sha = files.get(t.file);
    if (!sha) {
      texts[t.file] = null;
      raw[name] = COLLECTIONS[name] ? [] : {};
      return;
    }
    const text = await cachedBlob(gh, sha);
    texts[t.file] = text;
    try {
      raw[name] = JSON.parse(text);
    } catch {
      throw new Error(`Não consegui ler o conteúdo de "${t.label}". Avise quem cuida do site.`);
    }
  }));
  // Images that a data file this admin doesn't know points to (a type added to the site after it
  // was loaded) are never taken for unused. On 24/11/2026 an admin from before Artistas removed
  // the artists' photos that way.
  const known = new Set(Object.values(TYPES).map((t) => t.file));
  const keep = new Set();
  await Promise.all([...files].filter(([path]) => /^data\/.+\.json$/.test(path) && !known.has(path)).map(async ([, sha]) => {
    try {
      for (const ref of imageRefs(JSON.parse(await cachedBlob(gh, sha)))) keep.add(ref);
    } catch {
      // not readable as JSON: it points to nothing
    }
  }));
  return { headSha, treeSha: commit.tree.sha, data: normalizeData(raw), texts, paths: new Set(files.keys()), keep };
}

function adopt(remote) {
  state.headSha = remote.headSha;
  state.treeSha = remote.treeSha;
  state.base = remote.data;
  state.baseText = remote.texts;
  state.remotePaths = remote.paths;
  state.remoteKeep = remote.keep || state.remoteKeep;
  state.loadedAt = new Date().toISOString();
}

// Loads what's published and replays the saved drafts on top of it.
export async function init(gh) {
  const remote = await loadRemote(gh);
  const draft = await kv.get('draft');
  adopt(remote);
  state.conflicts = [];
  if (!draft || !draft.working) {
    state.working = clone(remote.data);
  } else if (draft.headSha === remote.headSha) {
    state.working = normalizeData(draft.working);
  } else {
    const { result, conflicts } = merge(normalizeData(draft.base), normalizeData(draft.working), remote.data);
    state.working = result;
    state.conflicts = conflicts;
  }
  await loadStaged();
  await persist(false);
  emit();
}

// Without internet: starts from what this device saved the last time it loaded the site, the
// published version and the drafts on top of it. False when nothing was saved yet.
export async function initOffline() {
  const draft = await kv.get('draft');
  if (!draft || !draft.base || !draft.working || !Array.isArray(draft.paths)) return false;
  adopt({ headSha: draft.headSha, treeSha: draft.treeSha, data: normalizeData(draft.base), texts: {}, paths: new Set(draft.paths) });
  state.loadedAt = draft.loadedAt || draft.savedAt || null;
  state.working = normalizeData(draft.working);
  state.conflicts = [];
  await loadStaged();
  emit();
  return true;
}

// When the connection comes back: loads what's published now and replays the drafts on it,
// like init(), but without reloading the staged images (the forms on screen show them).
// Returns the conflicts found, if someone else changed the same items meanwhile.
export async function refresh(gh) {
  const remote = await loadRemote(gh);
  if (remote.headSha === state.headSha) {
    adopt(remote);
    await persist(false);
    return [];
  }
  const { result, conflicts } = merge(state.base, state.working, remote.data);
  adopt(remote);
  state.working = result;
  // A conflict found again takes the version published now, which "Usar a publicada" puts back,
  // and keeps the rest (where a moved item came from: this merge sees it where it is now). It
  // stays the same object, so a dialog that's already open still resolves it.
  const key = (c) => `${c.type}/${c.id || c.key}`;
  const waiting = new Map(state.conflicts.map((c) => [key(c), c]));
  for (const c of conflicts) {
    if (waiting.has(key(c))) Object.assign(waiting.get(key(c)), { title: c.title, mine: c.mine, theirs: c.theirs });
  }
  state.conflicts = [...state.conflicts, ...conflicts.filter((c) => !waiting.has(key(c)))];
  changed();
  return conflicts;
}

async function loadStaged() {
  for (const url of [...state.staged.values()].map((s) => s.url)) URL.revokeObjectURL(url);
  state.staged.clear();
  for (const path of await imageStore.keys()) {
    const rec = await imageStore.get(path);
    if (rec && rec.blob) state.staged.set(path, { ...rec, url: URL.createObjectURL(rec.blob) });
  }
}

// Re-reads the drafts another tab saved.
export async function reloadDrafts() {
  const draft = await kv.get('draft');
  if (draft && draft.headSha === state.headSha) state.working = normalizeData(draft.working);
  for (const path of await imageStore.keys()) {
    if (!state.staged.has(path)) {
      const rec = await imageStore.get(path);
      if (rec && rec.blob) state.staged.set(path, { ...rec, url: URL.createObjectURL(rec.blob) });
    }
  }
  emit();
}

let persistTimer = null;
export async function persist(broadcast = true) {
  clearTimeout(persistTimer);
  // with what the admin needs to start offline: the published tree and its files
  await kv.set('draft', {
    headSha: state.headSha,
    treeSha: state.treeSha,
    paths: [...state.remotePaths],
    loadedAt: state.loadedAt,
    base: state.base,
    working: state.working,
    savedAt: new Date().toISOString(),
  });
  if (broadcast && channel) channel.postMessage('drafts');
}

function changed() {
  emit();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persist(), 150);
}

/* ---------- merging ---------- */

// Items the site moved from one collection to another, keeping their ids: in A here (base),
// gone from A on the site (theirs), and in B there but not here. On 24/11/2026 the 18 artist
// profiles moved from Entrevistas to Artistas that way, and a draft from before that which had
// edited one put it back in Entrevistas, next to the artist. Each move comes with the item as it
// was here (`was`) and as the draft has it (`now`; none if the draft removed it).
function movesOf(base, mine, theirs) {
  const has = (data, name, id) => (data[name] || []).some((item) => item.id === id);
  const names = Object.keys(COLLECTIONS);
  const moves = [];
  for (const from of names) {
    for (const was of base[from] || []) {
      if (has(theirs, from, was.id)) continue;
      const to = names.find((name) => name !== from && has(theirs, name, was.id) && !has(base, name, was.id));
      if (to) moves.push({ from, to, id: was.id, was, now: (mine[from] || []).find((item) => item.id === was.id) });
    }
  }
  return moves;
}

// Fields that hold the same kind of value in two types: the same type and, in groups and
// repeaters, the same fields.
function sameShape(f, g) {
  if (f.type !== g.type) return false;
  if (!f.fields || !g.fields) return !f.fields && !g.fields;
  return f.fields.length === g.fields.length && f.fields.every((sub) => {
    const other = g.fields.find((x) => x.key === sub.key);
    return Boolean(other) && sameShape(sub, other);
  });
}

// A moved item as the site has it now (`theirs`), with the changes the draft made to it where it
// was: each field the editor changed takes their value, when the new type has the same field
// (same key, same kind of value). The other changed fields can't go along: `left` lists their
// labels, for the conflicts dialog.
function carryOver(move, theirs) {
  const fields = new Map(COLLECTIONS[move.to].fields.map((f) => [f.key, f]));
  const item = clone(theirs);
  const left = [];
  for (const f of COLLECTIONS[move.from].fields) {
    const b = move.was[f.key];
    const m = move.now[f.key];
    if (eq(b, m)) continue;
    const to = fields.get(f.key);
    if (!to || !sameShape(f, to)) {
      left.push(f.label);
    } else if (f.type === 'image' && b && m && m.src === b.src) {
      // The same photo with a new description, credit or framing: those go on the photo where
      // it is now, since moving it changed its src. A photo the site removed since takes none.
      if (!item[f.key]) continue;
      for (const k of new Set([...Object.keys(b), ...Object.keys(m)])) {
        if (k === 'src' || k === 'w' || k === 'h' || eq(b[k], m[k])) continue;
        if (m[k] === undefined) delete item[f.key][k];
        else item[f.key][k] = m[k];
      }
    } else {
      // the editor's value; a new photo, or none, comes whole
      item[f.key] = clone(m);
    }
  }
  return { item: normalize(COLLECTIONS[move.to].fields, item), left };
}

export function merge(base, mine, theirs) {
  const result = {};
  const conflicts = [];
  const moves = movesOf(base, mine, theirs);
  for (const [name, t] of Object.entries(COLLECTIONS)) {
    const B = byId(base[name]);
    const M = byId(mine[name]);
    const T = byId(theirs[name]);
    const out = [];
    for (const id of new Set([...B.keys(), ...M.keys(), ...T.keys()])) {
      // a moved item never comes back where it was: the draft's edits go along with it
      if (moves.some((x) => x.from === name && x.id === id)) continue;
      const b = B.get(id);
      const m = M.get(id);
      const th = T.get(id);
      // (a draft that has an item of its own under this id here merges it as usual)
      const move = !m && moves.find((x) => x.to === name && x.id === id);
      let pick;
      if (move) {
        // It moved here on the site. A draft that edited it where it was brings the edits, always
        // as a conflict that says where it came from and what can't come along (the dialog
        // explains). A draft that removed it leaves it here as published.
        pick = th;
        if (move.now && !eq(move.was, move.now)) {
          const { item, left } = carryOver(move, th);
          conflicts.push({ type: name, id, title: titleOf(name, item), mine: clone(item), theirs: clone(th), from: move.from, left });
          pick = item;
        }
      } else if (eq(b, m)) pick = th;
      else if (eq(b, th) || eq(m, th)) pick = m;
      else {
        conflicts.push({ type: name, id, title: titleOf(name, m || th || b), mine: clone(m), theirs: clone(th) });
        pick = m;
      }
      if (pick) out.push(pick);
    }
    result[name] = out.sort(t.sort);
  }
  for (const [name, t] of Object.entries(SINGLETONS)) {
    const out = {};
    for (const f of t.fields) {
      const b = base[name][f.key];
      const m = mine[name][f.key];
      const th = theirs[name][f.key];
      if (eq(b, m)) out[f.key] = clone(th);
      else if (eq(b, th) || eq(m, th)) out[f.key] = clone(m);
      else {
        conflicts.push({ type: name, key: f.key, title: `${t.label}: ${f.label}`, mine: clone(m), theirs: clone(th) });
        out[f.key] = clone(m);
      }
    }
    result[name] = out;
  }
  return { result, conflicts };
}

// Applies the editor's choice for one conflict: 'mine' keeps the local edit
// (already in the working copy), 'theirs' takes the published version.
export function resolveConflict(conflict, choice) {
  if (choice === 'theirs') {
    if (conflict.key) {
      state.working[conflict.type][conflict.key] = clone(conflict.theirs);
    } else {
      const list = state.working[conflict.type].filter((item) => item.id !== conflict.id);
      if (conflict.theirs) list.push(clone(conflict.theirs));
      state.working[conflict.type] = list.sort(COLLECTIONS[conflict.type].sort);
    }
  }
  state.conflicts = state.conflicts.filter((c) => c !== conflict);
  changed();
}

/* ---------- changes ---------- */

// Every unpublished change, for the dashboard.
export function changes() {
  if (!state.base || !state.working) return [];
  const list = [];
  for (const [name] of Object.entries(COLLECTIONS)) {
    const B = byId(state.base[name]);
    const W = byId(state.working[name]);
    for (const [id, w] of W) {
      const b = B.get(id);
      if (!b) list.push({ kind: 'add', type: name, id, title: titleOf(name, w) });
      else if (!eq(b, w)) list.push({ kind: 'edit', type: name, id, title: titleOf(name, w) });
    }
    for (const [id, b] of B) if (!W.has(id)) list.push({ kind: 'remove', type: name, id, title: titleOf(name, b) });
  }
  for (const [name, t] of Object.entries(SINGLETONS)) {
    const fields = t.fields.filter((f) => !eq(state.base[name][f.key], state.working[name][f.key]));
    if (fields.length) list.push({ kind: 'edit', type: name, title: t.label, fields: fields.map((f) => f.label) });
  }
  return list;
}

export function itemStatus(type, id) {
  const b = findBase(type, id);
  const w = find(type, id);
  if (!b && w) return 'add';
  if (b && !w) return 'remove';
  if (b && w && !eq(b, w)) return 'edit';
  return '';
}

export function singletonChanged(name) {
  return !eq(state.base[name], state.working[name]);
}

export function imageChanges(data = state.working, paths = state.remotePaths, keep = state.remoteKeep) {
  const refs = imageRefs(data);
  const added = [...state.staged.keys()].filter((p) => refs.has(p) && !paths.has(p));
  const removed = [...paths].filter((p) => p.startsWith(IMAGE_ROOT) && IMAGE_DIRS.some((d) => p.startsWith(d)) && !refs.has(p) && !keep.has(p));
  const bytes = added.reduce((sum, p) => sum + (state.staged.get(p).bytes || 0), 0);
  return { added, removed, bytes };
}

// Content that would point to an image the site won't have after publishing: neither in the
// published tree (`paths`) nor staged here, to go out in the same commit. GitHub Actions doesn't
// deploy a version like that (scripts/build.mjs), so publish() doesn't make it. One entry per
// item, with the fields that point to the missing images. What only the data files this admin
// doesn't know point to (state.remoteKeep) is theirs to account for.
export function missingImages(data = state.working, paths = state.remotePaths) {
  const out = [];
  const check = (type, value, id) => {
    const t = TYPES[type];
    const missing = imageRefsAt(value).filter((r) => !paths.has(r.src) && !state.staged.has(r.src));
    if (!missing.length) return;
    const label = (at) => (t.fields.find((f) => f.key === at.split('.')[0]) || { label: at }).label;
    out.push({
      type,
      id,
      title: id ? titleOf(type, value) : t.label,
      fields: [...new Set(missing.map((r) => label(r.at)))],
      images: new Set(missing.map((r) => r.src)).size,
    });
  };
  for (const name of Object.keys(COLLECTIONS)) for (const item of data[name]) check(name, item, item.id);
  for (const name of Object.keys(SINGLETONS)) check(name, data[name], null);
  return out;
}

export function hasChanges() {
  if (!state.base) return false;
  const img = imageChanges();
  return changes().length > 0 || img.added.length > 0 || img.removed.length > 0;
}

export function revert(change) {
  if (SINGLETONS[change.type]) {
    state.working[change.type] = clone(state.base[change.type]);
  } else {
    const list = state.working[change.type].filter((item) => item.id !== change.id);
    const original = findBase(change.type, change.id);
    if (original && change.kind !== 'add') list.push(clone(original));
    state.working[change.type] = list.sort(COLLECTIONS[change.type].sort);
  }
  changed();
}

export function revertAll() {
  state.working = clone(state.base);
  changed();
}

/* ---------- editing ---------- */

// Saves an item into the working copy. New items get an id from their title.
export function saveItem(type, item, originalId = null) {
  const t = COLLECTIONS[type];
  const { id: ignored, ...fields } = normalize(t.fields, item);
  const list = state.working[type];
  const taken = new Set([...state.base[type], ...list].map((i) => i.id));
  const id = originalId || uniqueSlug(slugify(t.idFrom(fields)), taken);
  const norm = { id, ...fields };
  const next = list.filter((i) => i.id !== norm.id);
  next.push(norm);
  state.working[type] = next.sort(t.sort);
  changed();
  return norm.id;
}

export function removeItem(type, id) {
  state.working[type] = state.working[type].filter((item) => item.id !== id);
  changed();
}

export function saveSingleton(name, value) {
  state.working[name] = normalize(SINGLETONS[name].fields, value);
  changed();
}

/* ---------- images ---------- */

export async function stageImage(path, rec) {
  const old = state.staged.get(path);
  if (old) URL.revokeObjectURL(old.url);
  state.staged.set(path, { ...rec, url: URL.createObjectURL(rec.blob) });
  await imageStore.set(path, { blob: rec.blob, w: rec.w, h: rec.h, bytes: rec.bytes, originalBytes: rec.originalBytes, type: rec.type });
  emit();
}

export function assetUrl(path) {
  const staged = state.staged.get(path);
  if (staged) return staged.url;
  if (/^images\//.test(path) && state.headSha) {
    return `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${state.headSha}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  return null;
}

export function imageSize(path) {
  const staged = state.staged.get(path);
  return staged ? { w: staged.w, h: staged.h } : null;
}

// Drops staged images nothing points to any more (replaced or removed before
// publishing).
export async function pruneStaged() {
  const refs = imageRefs(state.working);
  for (const [path, rec] of [...state.staged]) {
    if (!refs.has(path)) {
      URL.revokeObjectURL(rec.url);
      state.staged.delete(path);
      await imageStore.del(path);
    }
  }
}

/* ---------- validation + publishing ---------- */

export function validateAll(data = state.working) {
  const problems = [];
  for (const [name, t] of Object.entries(COLLECTIONS)) {
    const seen = new Set();
    for (const item of data[name]) {
      if (seen.has(item.id)) problems.push({ type: name, id: item.id, title: titleOf(name, item), message: 'Endereço repetido.' });
      seen.add(item.id);
      for (const p of validate(t.fields, item)) problems.push({ type: name, id: item.id, title: titleOf(name, item), message: p.message });
    }
  }
  for (const [name, t] of Object.entries(SINGLETONS)) {
    for (const p of validate(t.fields, data[name])) problems.push({ type: name, title: t.label, message: p.message });
  }
  return problems;
}

export function commitSummary() {
  const list = changes();
  const img = imageChanges();
  const labels = { agenda: ['evento', 'eventos'], noticias: ['notícia do Radar', 'notícias do Radar'], entrevistas: ['entrevista', 'entrevistas'], artistas: ['artista', 'artistas'] };
  const parts = [];
  for (const [type, [one, many]] of Object.entries(labels)) {
    const of = list.filter((c) => c.type === type);
    if (!of.length) continue;
    const kinds = { add: 'novo', edit: 'editado', remove: 'removido' };
    const counts = ['add', 'edit', 'remove'].map((k) => [k, of.filter((c) => c.kind === k).length]).filter(([, n]) => n);
    const word = of.length === 1 ? one : many;
    parts.push(`${word} (${counts.map(([k, n]) => `${n} ${kinds[k]}${n > 1 ? 's' : ''}`).join(', ')})`);
  }
  for (const c of list.filter((x) => SINGLETONS[x.type])) parts.push(c.title.toLowerCase());
  let title = parts.length ? `Atualiza ${parts.join('; ')}` : img.added.length || img.removed.length ? 'Atualiza imagens' : 'Atualiza o site';
  if (title.length > 72) title = `Atualiza ${list.length} itens do site`;
  const sign = { add: '+', edit: '~', remove: '-' };
  const lines = list.map((c) => `${sign[c.kind]} ${TYPES[c.type].label}: ${c.title}${c.fields ? ` (${c.fields.join(', ')})` : ''}`);
  if (img.added.length) lines.push(`+ ${img.added.length} ${img.added.length > 1 ? 'imagens novas' : 'imagem nova'}`);
  if (img.removed.length) lines.push(`- ${img.removed.length} ${img.removed.length > 1 ? 'imagens sem uso' : 'imagem sem uso'}`);
  return { title, body: lines.join('\n') };
}

// One commit with every change. Returns { commit } on success, { conflicts }
// when someone else changed the same items, { problems } when something is
// invalid, { missing } when the content would point to images the site won't
// have (missingImages), or { nothing: true }.
export async function publish(gh, { message, author, onStep = () => {} }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    onStep('Conferindo a versão publicada…');
    const remote = await loadRemote(gh);
    let final = state.working;
    if (remote.headSha !== state.headSha) {
      const { result, conflicts } = merge(state.base, state.working, remote.data);
      adopt(remote);
      state.working = result;
      if (conflicts.length) {
        state.conflicts = conflicts;
        changed();
        return { conflicts };
      }
      final = result;
      changed();
    }
    const problems = validateAll(final);
    if (problems.length) return { problems };
    // against what's published now: someone may have removed an image the drafts still use
    const missing = missingImages(final, remote.paths);
    if (missing.length) return { missing };

    onStep('Preparando os arquivos…');
    const entries = [];
    const texts = {};
    for (const [name, t] of Object.entries(TYPES)) {
      const text = serialize(name, final[name]);
      texts[t.file] = text;
      if (text !== remote.texts[t.file]) entries.push({ path: t.file, mode: '100644', type: 'blob', content: text });
    }
    const { added, removed } = imageChanges(final, remote.paths, remote.keep);
    for (let i = 0; i < added.length; i += 1) {
      onStep(`Enviando imagem ${i + 1} de ${added.length}…`);
      const blob = await gh.createBlob(await blobToBase64(state.staged.get(added[i]).blob), 'base64');
      entries.push({ path: added[i], mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    if (!entries.length) {
      await pruneStaged();
      return { nothing: true };
    }

    onStep('Gravando a nova versão…');
    const tree = await gh.createTree(remote.treeSha, entries);
    const commit = await gh.createCommit({ message, tree: tree.sha, parents: [remote.headSha], author });
    try {
      await gh.updateRef(commit.sha);
    } catch (error) {
      if (error.status === 409 || error.status === 422) continue;
      throw error;
    }

    const paths = new Set(remote.paths);
    for (const e of entries) {
      if (e.sha === null) paths.delete(e.path);
      else paths.add(e.path);
    }
    adopt({ headSha: commit.sha, treeSha: tree.sha, data: clone(final), texts, paths, keep: remote.keep });
    state.working = clone(final);
    state.conflicts = [];
    for (const [path, rec] of [...state.staged]) {
      URL.revokeObjectURL(rec.url);
      state.staged.delete(path);
      await imageStore.del(path);
    }
    await persist();
    emit();
    return { commit };
  }
  throw new Error('Outras pessoas publicaram ao mesmo tempo várias vezes seguidas. Tente de novo em instantes.');
}
