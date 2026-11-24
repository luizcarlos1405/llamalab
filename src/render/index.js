// Renders the whole site (build) or a single page (admin preview).

import { esc, excerpt, stripMarkdown, isUpcoming, eventEnd, eventStop } from '../util.js';
import { SITE } from '../config.js';
import { createContext, pageContext } from './context.js';
import {
  homePage, agendaPage, eventPage, newsListPage, newsPage, interviewsPage, interviewPage, sobrePage, contratePage, notFoundPage, offlinePage,
} from './pages.js';

// Every page as { path, html }, plus the sitemap, feed and calendar files.
export function renderSite(data, opts) {
  const ctx = createContext(data, opts);
  const files = [];
  const page = (path, render) => files.push({ path, html: render(pageContext(ctx, path)) });

  page('index.html', homePage);
  page('agenda/index.html', agendaPage);
  for (const ev of ctx.events) {
    page(`agenda/${ev.id}/index.html`, (P) => eventPage(P, ev));
    files.push({ path: `agenda/${ev.id}/evento.ics`, html: ics(ctx, ev) });
  }
  page('noticias/index.html', newsListPage);
  for (const n of ctx.news) page(`noticias/${n.id}/index.html`, (P) => newsPage(P, n));
  page('entrevistas/index.html', interviewsPage);
  for (const it of ctx.interviews) page(`entrevistas/${it.id}/index.html`, (P) => interviewPage(P, it));
  page('sobre/index.html', sobrePage);
  page('contrate/index.html', contratePage);

  // GitHub Pages serves 404.html at whatever URL was asked for, and the service worker
  // does the same with offline.html, so their links must be absolute paths.
  const base = new URL(`${ctx.siteUrl}/`).pathname;
  const anywhere = (path) => {
    const P = pageContext(ctx, path);
    P.root = base;
    P.href = (to = '') => base + to;
    P.src = (p) => base + p;
    return P;
  };
  files.push({ path: '404.html', html: notFoundPage(anywhere('404.html')) });
  files.push({ path: 'offline.html', html: offlinePage(anywhere('offline.html')) });

  files.push({ path: 'sitemap.xml', html: sitemap(ctx, files) });
  files.push({ path: 'feed.xml', html: feed(ctx) });
  files.push({ path: 'robots.txt', html: `User-agent: *\nDisallow: /admin\nSitemap: ${ctx.siteUrl}/sitemap.xml\n` });
  files.push(...manifests(ctx));
  return files;
}

// What makes the site installable. One app, with the admin inside it (editors open it with
// the Admin button): a second app whose pages sit inside this one's (/admin) can't be
// installed on Android, where the installed site claims every address under its scope.
// Browsers read the id from the domain's root, so it's the site's path: /llamalab/ on
// github.io, / on its own domain.
function manifests(ctx) {
  const root = new URL(`${ctx.siteUrl}/`).pathname;
  const icon = (size, purpose = 'any') => ({ src: `assets/icons/site-${purpose === 'maskable' ? 'maskable-' : ''}${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose });
  const shortcut = (name, url) => ({ name, url, icons: [{ src: 'assets/icons/site-192.png', sizes: '192x192', type: 'image/png' }] });
  const site = {
    id: root,
    name: SITE.name,
    short_name: SITE.name,
    description: (ctx.site.seo || {}).description || 'O zine da cena cultural de Dourados.',
    start_url: './',
    scope: './',
    lang: 'pt-BR',
    dir: 'ltr',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    categories: ['entertainment', 'music', 'news'],
    icons: [icon(192), icon(512), icon(512, 'maskable')],
    shortcuts: [shortcut('Agenda', 'agenda/'), shortcut('Entrevistas', 'entrevistas/')],
  };
  return [{ path: 'manifest.webmanifest', html: `${JSON.stringify(site, null, 2)}\n` }];
}

// One page for the admin's live preview. `route` is "home", "agenda",
// "agenda/<id>", "noticias", "noticias/<id>", "entrevistas",
// "entrevistas/<id>", "sobre" or "contrate". Returns null for unknown ids.
export function renderPreview(data, opts, route) {
  const ctx = createContext(data, { ...opts, preview: true });
  const [type, id] = String(route || 'home').split('/');
  const P = pageContext(ctx, 'index.html');
  switch (type) {
    case 'home': case 'site': case '': return homePage(P);
    case 'agenda': {
      if (!id) return agendaPage(P);
      const ev = ctx.events.find((e) => e.id === id);
      return ev ? eventPage(P, ev) : null;
    }
    case 'noticias': {
      if (!id) return newsListPage(P);
      const n = ctx.news.find((x) => x.id === id);
      return n ? newsPage(P, n) : null;
    }
    case 'entrevistas': {
      if (!id) return interviewsPage(P);
      const it = ctx.interviews.find((x) => x.id === id);
      return it ? interviewPage(P, it) : null;
    }
    case 'sobre': return sobrePage(P);
    case 'contrate': return contratePage(P);
    default: return homePage(P);
  }
}

function sitemap(ctx, files) {
  const urls = files
    .filter((f) => f.path.endsWith('index.html'))
    .map((f) => `${ctx.siteUrl}/${f.path.replace(/index\.html$/, '')}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
}

function rfc822(iso) {
  return new Date(`${iso}T12:00:00-04:00`).toUTCString();
}

function feed(ctx) {
  const items = [
    ...ctx.news.map((n) => ({ title: n.title, path: `noticias/${n.id}/`, date: n.date, text: n.summary || stripMarkdown(n.body), cat: n.kicker || 'Notícias' })),
    ...ctx.interviews.map((it) => ({ title: it.title, path: `entrevistas/${it.id}/`, date: it.date, text: it.summary || it.role, cat: 'Entrevistas' })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>LLama Lab</title>
  <link>${esc(ctx.siteUrl)}/</link>
  <description>${esc((ctx.site.seo || {}).description || 'O zine da cena cultural de Dourados.')}</description>
  <language>pt-BR</language>
${items.map((i) => `  <item>
    <title>${esc(i.title)}</title>
    <link>${esc(`${ctx.siteUrl}/${i.path}`)}</link>
    <guid>${esc(`${ctx.siteUrl}/${i.path}`)}</guid>
    <pubDate>${rfc822(i.date)}</pubDate>
    <category>${esc(i.cat)}</category>
    <description>${esc(excerpt(i.text, 400))}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
}

// Offset of the site's timezone on a given day, as "+HH:MM"/"-HH:MM" minutes.
function tzOffsetMinutes(dateIso, time) {
  const guess = new Date(`${dateIso}T${time || '12:00'}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SITE.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const get = (t) => +parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - guess.getTime()) / 60000);
}

function icsDate(dateIso, time) {
  if (!time) return dateIso.replace(/-/g, '');
  const offset = tzOffsetMinutes(dateIso, time);
  const local = new Date(`${dateIso}T${time}:00Z`).getTime();
  return new Date(local - offset * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function ics(ctx, ev) {
  const end = eventEnd(ev);
  let start; let finish;
  if (ev.time) {
    start = `DTSTART:${icsDate(ev.date, ev.time)}`;
    const stop = eventStop(ev);
    finish = `DTEND:${icsDate(stop.date, stop.time)}`;
  } else {
    const next = new Date(`${end}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    start = `DTSTART;VALUE=DATE:${ev.date.replace(/-/g, '')}`;
    finish = `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`;
  }
  const stamp = new Date(ctx.buildTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LLama Lab//Agenda//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@llamalab`,
    `DTSTAMP:${stamp}`,
    start, finish,
    `SUMMARY:${icsText(ev.title)}`,
    `LOCATION:${icsText([ev.venue, ev.address, ev.city].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText(excerpt(stripMarkdown(ev.description) || ev.summary || ev.lineup || '', 600))}`,
    `URL:${ctx.siteUrl}/agenda/${ev.id}/`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export { isUpcoming };
