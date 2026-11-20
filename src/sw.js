// LlamaLab's service worker: keeps the site readable without internet, and the admin usable.
// scripts/build.mjs writes it to _site/sw.js with the BUILD line filled in: the version, the
// assets' ?v= and every file the worker may keep, with a hash of its content.
//
// It keeps files in packs:
//   base   every visitor: CSS, scripts, fonts, the offline page, the home page and the agenda
//   site   the installed app: every page, image and .ics file (site.js asks for it)
//   admin  whoever opens the admin: its page, modules and styles (src/admin/net.js asks for it)
// Pages and images opened along the way are kept too, so what someone saw stays readable.
//
// Pages come from the network first, so whoever is online gets the fresh agenda; the saved
// copy shows when there's no connection, or when the network takes too long.

const BUILD = { version: 'dev', assets: '', files: [] }; // filled in by scripts/build.mjs

const SCOPE = self.registration.scope; // the site's root, ending in "/"
const ROOT = new URL(SCOPE).pathname;
const PRE = `llamalab-pre-${BUILD.version}`; // the packs, one cache per version
const PAGES = 'llamalab-pages'; // pages opened along the way
const IMAGES = 'llamalab-images'; // images seen along the way
const META = 'llamalab-meta'; // which packs this device asked for, and when
const KEEP = { pages: 60, images: 120 };
const DAY = 864e5;
// A pack stays while the app (site) or the admin was opened in the last days: an app removed
// from the phone stops downloading the whole site at each update.
const STAY = { site: 30 * DAY, admin: 90 * DAY };
const WAIT = 3500; // how long a page waits for the network before the saved copy shows

const abs = (u) => new URL(u, SCOPE).href;
const FILES = BUILD.files.map((f) => ({ ...f, key: abs(f.u) }));
const BY_KEY = new Map(FILES.map((f) => [f.key, f]));

/* ---------- life cycle ---------- */

// A new version keeps what didn't change (copied from the previous one) and downloads the rest.
// Without the base pack it doesn't take over: the browser tries again on the next visit.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await fill(new Set(['base']), { strict: true });
    const packs = wanted(await readMeta());
    packs.delete('base');
    if (packs.size) await fill(packs);
    await self.skipWaiting();
  })());
});

// Takes over at once: pages come from the network anyway, and an open page keeps working
// (the radio keeps playing). The admin offers to reload, since its code came from the old one.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    for (const name of await caches.keys()) {
      if (name.startsWith('llamalab-pre-') && name !== PRE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// { type: 'keep', pack: 'site' | 'admin' }: the app or the admin is open; keep (and refresh)
// its pack. { type: 'seen', urls }: the page someone arrived on before this worker ran, and
// its images, to keep like the pages opened later. { type: 'saved', url }: when the saved
// copy of that page was downloaded. Answers go back through the message's port, if any.
let queue = Promise.resolve();
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const reply = (data) => event.ports && event.ports[0] && event.ports[0].postMessage(data);
  if (msg.type === 'keep' && STAY[msg.pack]) {
    const job = () => writeMeta({ [msg.pack]: Date.now() }).then(() => fill(new Set([msg.pack])));
    queue = queue.then(job, job);
    event.waitUntil(queue.then((missing) => reply({ pack: msg.pack, missing: missing.length }), () => reply(null)));
  } else if (msg.type === 'seen' && Array.isArray(msg.urls)) {
    event.waitUntil(Promise.all(msg.urls.slice(0, 60).map((u) => remember(u).catch(() => {}))));
  } else if (msg.type === 'saved') {
    event.waitUntil(savedAt(msg.url).then(reply, () => reply(null)));
  }
});

// Keeps a page or image the browser already has (it was just shown), without downloading it again.
async function remember(u) {
  const url = new URL(u, SCOPE);
  if (!url.href.startsWith(SCOPE)) return;
  const path = url.pathname.slice(ROOT.length);
  const isImage = path.startsWith('images/');
  const key = isImage ? abs(path) : pageKey(path);
  if (key === abs('admin') || (!isImage && /\.(?!html$)[a-z0-9]+$/i.test(path))) return;
  const res = await fetch(url.href, { cache: 'force-cache', credentials: 'same-origin' });
  if (res.ok && res.type === 'basic' && !res.redirected) await keep(isImage ? IMAGES : PAGES, key, res, isImage ? KEEP.images : KEEP.pages);
}

/* ---------- requests ---------- */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(SCOPE)) return;
    const path = url.pathname.slice(ROOT.length);
    if (path === 'sw.js' || path === 'version.json' || path.startsWith('data/')) return;
    if (req.mode === 'navigate' || wantsPage(req, path)) event.respondWith(page(event, path));
    else if (path.startsWith('images/')) event.respondWith(image(event, abs(path)));
    else if (path.startsWith('assets/') || path.startsWith('src/')) event.respondWith(asset(event, url, path));
    else if (BY_KEY.has(abs(path))) event.respondWith(file(event, abs(path)));
    return;
  }
  // The admin shows published images from GitHub, pinned to a commit. They're the site's own
  // images, and a path never changes, so they share the site's copies.
  if (url.origin === 'https://raw.githubusercontent.com') {
    const m = /^\/[^/]+\/[^/]+\/[^/]+\/(images\/.+)$/.exec(url.pathname);
    if (m) event.respondWith(image(event, abs(m[1]), url.href));
  }
});

// site.js fetches pages itself to swap them while the radio plays: those count as pages too.
function wantsPage(req, path) {
  return req.destination === '' && /text\/html/.test(req.headers.get('accept') || '') && !/\.(?!html$)[a-z0-9]+$/i.test(path);
}

// One address per page: "agenda/" for agenda/index.html, "admin" for admin.html.
function pageKey(path) {
  const p = path.replace(/(^|\/)index\.html$/, '$1');
  return abs(p === 'admin.html' ? 'admin' : p || './');
}

async function page(event, path) {
  const key = pageKey(path);
  if (key === abs('admin')) return adminPage(event, key);
  const network = fromNetwork(event);
  // keep a copy of what came, without holding the page back while it's saved
  event.waitUntil(network.then((res) => (res.ok && res.type === 'basic' && !res.redirected ? keep(PAGES, key, res.clone(), KEEP.pages) : null)).catch(() => {}));
  return new Promise((resolve) => {
    let answered = false;
    const answer = (res) => {
      if (res && !answered) {
        answered = true;
        resolve(res);
      }
    };
    const saved = () => savedPage(key, path).then((res) => {
      answer(res);
      return res;
    });
    const timer = setTimeout(saved, WAIT);
    network.then((res) => {
      clearTimeout(timer);
      answer(res);
    }, async () => {
      clearTimeout(timer);
      answer((await saved()) || (await offlinePage()));
    });
  });
}

// The admin runs the version this worker saved, every module from the same build; a new
// version comes with the next worker, and the admin then offers to reload.
async function adminPage(event, key) {
  if (event.preloadResponse) event.waitUntil(event.preloadResponse.catch(() => {}));
  const saved = await match(PRE, key);
  if (saved) return saved;
  try {
    return await fromNetwork(event);
  } catch {
    return offlinePage();
  }
}

async function fromNetwork(event) {
  const preloaded = event.preloadResponse && await event.preloadResponse.catch(() => null);
  return preloaded || fetch(event.request);
}

// The newest saved copy of a page (the packs or the pages opened along the way).
async function savedPage(key, path) {
  const res = await newest(key);
  if (res) return res;
  // an address without its final slash, as GitHub Pages would redirect it
  if (!key.endsWith('/') && !/\.[a-z0-9]+$/i.test(path) && await newest(`${key}/`)) return Response.redirect(`${key}/`, 301);
  return null;
}

async function newest(key) {
  const [packed, seen] = await Promise.all([match(PRE, key), match(PAGES, key)]);
  if (!packed || !seen) return packed || seen || null;
  return (seen.headers.get('x-saved') || '') > (packed.headers.get('x-saved') || '') ? seen : packed;
}

async function offlinePage() {
  const res = await match(PRE, abs('offline.html'));
  if (res) return new Response(res.body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sem internet</title><p style="font:18px/1.5 system-ui;padding:40px">Sem internet. Tente de novo quando a conexão voltar.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function savedAt(url) {
  const u = new URL(url);
  if (!u.href.startsWith(SCOPE)) return null;
  const res = await newest(pageKey(u.pathname.slice(ROOT.length)));
  return res ? res.headers.get('x-saved') : null;
}

// CSS, scripts and fonts: the saved copy when it's this build's. Pages ask for site.css?v=<hash>,
// and a page newer than this worker gets the network's; the admin's modules and the fonts have
// no ?v= and come with the worker's build.
async function asset(event, url, path) {
  const saved = await match(PRE, abs(path));
  const v = url.searchParams.get('v');
  if (saved && (!v || v === BUILD.assets)) return saved;
  try {
    return await fetch(event.request);
  } catch (error) {
    if (saved) return saved;
    throw error;
  }
}

// Images: any saved copy will do. Offline and not saved: a quiet placeholder, not a broken image.
async function image(event, key, remote = null) {
  const saved = (await match(PRE, key)) || (await match(IMAGES, key));
  if (saved) return saved;
  try {
    const res = await (remote ? fetch(remote, { mode: 'cors', credentials: 'omit' }) : fetch(event.request));
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) event.waitUntil(keep(IMAGES, key, res.clone(), KEEP.images));
    return res;
  } catch {
    return new Response(PLACEHOLDER, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
  }
}

const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice"><rect x="-2000" y="-2000" width="4400" height="4400" fill="#161616"/><g fill="none" stroke="#3a3a3a" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><rect x="150" y="160" width="100" height="80" rx="10"/><path d="M158 228l28-28 22 22 14-14 20 20"/><circle cx="222" cy="184" r="8"/></g></svg>';

// Other files of the packs (the events' .ics): the network, or the saved copy offline.
async function file(event, key) {
  try {
    return await fetch(event.request);
  } catch (error) {
    const saved = await match(PRE, key);
    if (saved) return saved;
    throw error;
  }
}

/* ---------- the packs ---------- */

// Puts the files of the given packs into this version's cache. A file already there stays; one
// an older version (or the pages and images seen along the way) has with the same content is
// copied; the rest is downloaded. Downloads skip the browser's own cache (GitHub Pages lets it
// keep files for 10 minutes, and the new version mustn't store the previous deploy's file) and
// are checked against the build's hash. Returns the files it couldn't save.
async function fill(packs, { strict = false } = {}) {
  const cache = await caches.open(PRE);
  const older = (await caches.keys()).filter((name) => name.startsWith('llamalab-pre-') && name !== PRE);
  const sources = await Promise.all([...older, PAGES, IMAGES].map((name) => caches.open(name)));
  const missing = [];
  await pool(FILES.filter((f) => packs.has(f.p)), 6, async (f) => {
    const have = await cache.match(f.key);
    if (have && have.headers.get('x-rev') === f.r) return;
    for (const source of sources) {
      const res = await source.match(f.key);
      if (res && (res.headers.get('x-rev') === f.r || await digest(await res.clone().arrayBuffer()) === f.r)) {
        await cache.put(f.key, await stamped(res, f.r, res.headers.get('x-saved') || undefined));
        return;
      }
    }
    try {
      await cache.put(f.key, await download(f));
    } catch {
      missing.push(f.u);
    }
  });
  if (strict && missing.length) throw new Error(`Not saved: ${missing.join(', ')}`);
  return missing;
}

async function download(f) {
  for (const mode of ['no-cache', 'reload']) {
    const res = await fetch(f.key, { cache: mode, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${f.u}`);
    const body = await res.arrayBuffer();
    // a CDN still serving the previous deploy gets one more try
    if (await digest(body) === f.r) return stamped(res, f.r, undefined, body);
  }
  throw new Error(`Changed since the build: ${f.u}`);
}

// A copy to keep: just the body and a few headers, with the content's hash (x-rev) and when
// it was downloaded (x-saved). It also drops a redirect, which a page can't be answered with.
async function stamped(res, rev = '', saved = new Date().toISOString(), body = null) {
  const headers = new Headers({ 'x-rev': rev, 'x-saved': saved });
  for (const name of ['content-type', 'last-modified']) if (res.headers.has(name)) headers.set(name, res.headers.get(name));
  return new Response(body || await res.arrayBuffer(), { status: 200, headers });
}

async function keep(name, key, res, max) {
  const cache = await caches.open(name);
  await cache.put(key, await stamped(res));
  // the oldest go first (a page or image seen again moves to the end)
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function readMeta() {
  const res = await match(META, abs('__state'));
  return res ? res.json() : {};
}

async function writeMeta(patch) {
  const state = { ...(await readMeta()), ...patch };
  await (await caches.open(META)).put(abs('__state'), new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json' } }));
  return state;
}

function wanted(state) {
  const packs = new Set(['base']);
  for (const [pack, stay] of Object.entries(STAY)) if (state[pack] && Date.now() - state[pack] < stay) packs.add(pack);
  return packs;
}

/* ---------- helpers ---------- */

const match = (name, key) => caches.open(name).then((cache) => cache.match(key));

async function digest(buf) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
