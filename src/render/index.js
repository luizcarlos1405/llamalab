// Renders the whole site (build) or a single page (admin preview).

import { esc, excerpt, stripMarkdown, isUpcoming, eventEnd, eventStop } from '../util.js';
import { SITE } from '../config.js';
import { createContext, pageContext } from './context.js';
import {
  homePage, agendaPage, eventPage, newsListPage, newsPage, interviewsPage, interviewPage, sobrePage, contratePage, notFoundPage,
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

  // GitHub Pages serves 404.html at whatever URL was asked for, so its links
  // must be absolute paths.
  const P404 = pageContext(ctx, '404.html');
  const base = new URL(`${ctx.siteUrl}/`).pathname;
  P404.root = base;
  P404.href = (to = '') => base + to;
  P404.src = (p) => base + p;
  files.push({ path: '404.html', html: notFoundPage(P404) });

  files.push({ path: 'sitemap.xml', html: sitemap(ctx, files) });
  files.push({ path: 'feed.xml', html: feed(ctx) });
  files.push({ path: 'robots.txt', html: `User-agent: *\nDisallow: /admin\nSitemap: ${ctx.siteUrl}/sitemap.xml\n` });
  return files;
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
  <title>LlamaLab</title>
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
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LlamaLab//Agenda//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
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
