// The admin and the network: the service worker that keeps the admin usable without internet
// (src/sw.js, its "admin" pack), whether the connection is up, a new version of the admin
// taking over, and the browser's offer to install it as an app.

export const net = {
  online: navigator.onLine !== false,
  updated: false, // a newer admin took over: its code shows after a reload
  installPrompt: null, // Chrome's install prompt, when the browser offers to install
};

const listeners = new Set();
export function onNet(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => {
  for (const fn of listeners) fn(net);
};

// The browser's online/offline events, and what requests to GitHub find out: a request that
// never arrived (status 0) means no internet, even when the phone says it's connected.
export function setOnline(online) {
  if (net.online === online) return;
  net.online = online;
  emit();
}

// The site says it has a newer admin than the one this page runs (version.json, see
// adminOutdated() in app.js), even if the worker hasn't noticed yet.
export function markUpdated() {
  if (net.updated) return;
  net.updated = true;
  emit();
}

export function startNet() {
  addEventListener('online', () => setOnline(true));
  addEventListener('offline', () => setOnline(false));
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    net.installPrompt = e;
    emit();
  });
  addEventListener('appinstalled', () => {
    net.installPrompt = null;
    emit();
  });
  startWorker();
}

// ?sw=off on the site's pages turns the worker off in this browser (assets/site.js).
function startWorker() {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  try {
    if (localStorage.getItem('llamalab:sw') === 'off') return;
  } catch { /* storage blocked: keep the worker */ }
  // The admin this page runs is the one its worker saved. When a newer worker takes over with
  // other admin files (a deploy that changed the admin, not just the content), say so.
  let loaded = null;
  const adminVersion = () => new Promise((resolve) => {
    if (!sw.controller) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve((e.data && e.data.admin) || null);
    };
    sw.controller.postMessage({ type: 'version' }, [channel.port2]);
  });
  adminVersion().then((v) => {
    loaded = v;
  });
  sw.addEventListener('controllerchange', async () => {
    const now = await adminVersion();
    if (loaded && now && now !== loaded) {
      net.updated = true;
      emit();
    }
    if (!loaded) loaded = now;
  });
  sw.register('sw.js')
    .then(() => sw.ready)
    .then((reg) => reg.active && reg.active.postMessage({ type: 'keep', pack: 'admin' }))
    .catch(() => { /* the admin still works online */ });
}

// Asks the browser not to clear this site's data when the device runs low on space: the
// drafts live there until they're published.
export async function keepData() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* the browser decides */ }
}
