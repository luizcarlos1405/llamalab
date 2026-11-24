// Derived data and URL helpers for rendering. Works in Node and in the browser.

import { COLLECTIONS } from '../schema.js';
import { isUpcoming } from '../util.js';

// data: { site, sobre, contrate, agenda[], noticias[], entrevistas[], artistas[] }
// opts: { today, siteUrl, version, preview, assetUrl(path), imageSize(path), buildTime }
export function createContext(data, opts) {
  const today = opts.today;
  const events = [...(data.agenda || [])].sort(COLLECTIONS.agenda.sort);
  const upcoming = events.filter((ev) => isUpcoming(ev, today));
  const past = events.filter((ev) => !isUpcoming(ev, today)).reverse();
  const news = [...(data.noticias || [])].sort(COLLECTIONS.noticias.sort);
  const interviews = [...(data.entrevistas || [])].sort(COLLECTIONS.entrevistas.sort);
  // the catalog in its order (alphabetical); the newest profiles first, for the home page
  const artists = [...(data.artistas || [])].sort(COLLECTIONS.artistas.sort);
  const artistsNew = [...artists].sort((a, b) => String(b.date).localeCompare(String(a.date)) || COLLECTIONS.artistas.sort(a, b));
  const ivNumber = new Map();
  [...interviews].reverse().forEach((it, i) => ivNumber.set(it.id, i + 1));
  return {
    data,
    site: data.site || {},
    today,
    events,
    upcoming,
    past,
    news,
    interviews,
    ivNumber,
    artists,
    artistsNew,
    siteUrl: String(opts.siteUrl || '').replace(/\/+$/, ''),
    version: opts.version || '',
    preview: Boolean(opts.preview),
    assetUrl: opts.assetUrl || null,
    imageSize: opts.imageSize || (() => null),
    buildTime: opts.buildTime || new Date().toISOString(),
  };
}

// Page-level context: links relative to the page's folder depth, so the site
// works both under /llamalab/ on github.io and at the root of a custom domain.
// `path` is the output file, such as "agenda/noite-do-rock/index.html".
export function pageContext(ctx, path) {
  const depth = ctx.preview ? 0 : path.split('/').length - 1;
  const root = depth ? '../'.repeat(depth) : './';
  const P = Object.create(ctx);
  P.path = path;
  P.root = root;
  P.href = (to = '') => (to ? root + to : root);
  P.src = (repoPath) => {
    const p = String(repoPath || '');
    if (/^(https?:|data:|blob:)/.test(p)) return p;
    return (ctx.assetUrl && ctx.assetUrl(p)) || root + p;
  };
  P.url = (p) => {
    // For Markdown: repository paths and site routes become page-relative.
    const s = String(p || '');
    if (/^(https?:|mailto:|tel:|#|data:|blob:)/i.test(s)) return s;
    if (s.startsWith('images/')) return P.src(s);
    return root + s.replace(/^\.?\//, '');
  };
  P.abs = (to = '') => `${ctx.siteUrl}/${to}`;
  P.canonical = P.abs(path.replace(/index\.html$/, ''));
  return P;
}
