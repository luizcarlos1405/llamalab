// The admin's data: what's published (base, at commit headSha) and the local
// working copy with every unpublished edit. Edits and staged images are kept
// in IndexedDB until they're published as one commit.
//
// Merging is per item (collections) and per section (singletons): when someone
// else published in the meantime, local edits are replayed on top of their
// version, and only the same item edited on both sides is a conflict.

import { COLLECTIONS, SINGLETONS, normalize, validate } from '../schema.js';
import { REPO } from '../config.js';
import { jsonFile, imageRefs, slugify, uniqueSlug } from '../util.js';
import { kv, images as imageStore } from './idb.js';
import { decodeBase64Text, blobToBase64 } from './github.js';

export const TYPES = { ...COLLECTIONS, ...SINGLETONS };
const IMAGE_ROOT = 'images/';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const state = {
  headSha: null,
  treeSha: null,
  base: null,
  baseText: {},
  remotePaths: new Set(),
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
      throw new Error(`O arquivo ${t.file} no GitHub não é um JSON válido. Alguém precisa corrigi-lo antes de editar por aqui.`);
    }
  }));
  return { headSha, treeSha: commit.tree.sha, data: normalizeData(raw), texts, paths: new Set(files.keys()) };
}

function adopt(remote) {
  state.headSha = remote.headSha;
  state.treeSha = remote.treeSha;
  state.base = remote.data;
  state.baseText = remote.texts;
  state.remotePaths = remote.paths;
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
  for (const url of [...state.staged.values()].map((s) => s.url)) URL.revokeObjectURL(url);
  state.staged.clear();
  for (const path of await imageStore.keys()) {
    const rec = await imageStore.get(path);
    if (rec && rec.blob) state.staged.set(path, { ...rec, url: URL.createObjectURL(rec.blob) });
  }
  await persist(false);
  emit();
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
  await kv.set('draft', { headSha: state.headSha, base: state.base, working: state.working, savedAt: new Date().toISOString() });
  if (broadcast && channel) channel.postMessage('drafts');
}

function changed() {
  emit();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persist(), 150);
}

/* ---------- merging ---------- */

export function merge(base, mine, theirs) {
  const result = {};
  const conflicts = [];
  for (const [name, t] of Object.entries(COLLECTIONS)) {
    const B = byId(base[name]);
    const M = byId(mine[name]);
    const T = byId(theirs[name]);
    const out = [];
    for (const id of new Set([...B.keys(), ...M.keys(), ...T.keys()])) {
      const b = B.get(id);
      const m = M.get(id);
      const th = T.get(id);
      let pick;
      if (eq(b, m)) pick = th;
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

export function imageChanges(data = state.working, paths = state.remotePaths) {
  const refs = imageRefs(data);
  const added = [...state.staged.keys()].filter((p) => refs.has(p) && !paths.has(p));
  const removed = [...paths].filter((p) => p.startsWith(IMAGE_ROOT) && !refs.has(p));
  const bytes = added.reduce((sum, p) => sum + (state.staged.get(p).bytes || 0), 0);
  return { added, removed, bytes };
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
  const labels = { agenda: ['evento', 'eventos'], noticias: ['notícia', 'notícias'], entrevistas: ['entrevista', 'entrevistas'] };
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
// invalid, or { nothing: true }.
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

    onStep('Preparando os arquivos…');
    const entries = [];
    const texts = {};
    for (const [name, t] of Object.entries(TYPES)) {
      const text = serialize(name, final[name]);
      texts[t.file] = text;
      if (text !== remote.texts[t.file]) entries.push({ path: t.file, mode: '100644', type: 'blob', content: text });
    }
    const { added, removed } = imageChanges(final, remote.paths);
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
    adopt({ headSha: commit.sha, treeSha: tree.sha, data: clone(final), texts, paths });
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
