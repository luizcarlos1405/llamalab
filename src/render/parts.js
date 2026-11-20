// Building blocks shared by the pages: navigation, footer, agenda rows,
// interview cards, news items… Every function returns an HTML string. `P` is
// the page context from context.js (links, image URLs, data).

import { esc, fmtShort, fmtTime, WEEKDAYS_SHORT, weekday, parseDate, monthLabel, MONTHS_SHORT, excerpt, stripMarkdown, splitList, waLink, formatPhone, slugify, eventEnd, hash, spotifyPlaylistId } from '../util.js';
import { symbols, lockup, wordmark, llama, llamaUse, ring } from './svg.js';

export const NAV = [
  { href: 'agenda/', label: 'Agenda', key: 'agenda' },
  { href: 'entrevistas/', label: 'Entrevistas', key: 'entrevistas' },
  { href: 'noticias/', label: 'Notícias', key: 'noticias' },
  { href: 'sobre/', label: 'Sobre', key: 'sobre' },
  { href: 'contrate/', label: 'Contrate', key: 'contrate' },
];

export { symbols, llama, llamaUse, ring, wordmark, hash };

// Link for "send us your event" / "I want to be interviewed": WhatsApp with a
// ready-made message, falling back to e-mail, then to the Contrate page.
export function rolêLink(P, which = 'event') {
  const { cta = {}, contact = {} } = P.site;
  const message = which === 'interview' ? cta.interviewMessage : cta.eventMessage;
  return waLink(contact.whatsapp, message) || (contact.email ? `mailto:${contact.email}` : P.href('contrate/'));
}

// Words wrapped for the slide-up reveal. `d` delays the whole group.
export function split(text, d = 0) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => `<span class="sw"><span class="si" style="--i:${i}${d ? `;--d:${d}ms` : ''}">${esc(w)}</span></span>`).join(' ');
}

export function nav(P, current = '') {
  const links = NAV.map((n) => `<a href="${P.href(n.href)}"${n.key === current ? ' aria-current="page"' : ''}>${n.label}</a>`).join('');
  return `<header class="nav" id="nav">
  <a class="brand" href="${P.href('')}" aria-label="LlamaLab — capa">${lockup}</a>
  <nav class="nav-links" aria-label="Seções">${links}</nav>
  <div class="nav-cta">${radioStations(P).length ? somControl : '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'}<a class="btn btn-solid" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">${esc((P.site.cta || {}).eventLabel || 'Divulgue seu evento')} <span class="arr">→</span></a><button class="burger" type="button" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu"><i></i><i></i></button></div>
</header>
<div class="menu" id="menu" hidden>
  <div class="menu-top"><a href="${P.href('')}" aria-label="LlamaLab — capa">${lockup}</a><button class="close" type="button" aria-label="Fechar menu">×</button></div>
  <nav aria-label="Menu">${links}</nav>
  <a class="btn btn-red" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">${esc((P.site.cta || {}).eventLabel || 'Divulgue seu evento')} <span class="arr">→</span></a>
</div>`;
}

/* ---------- the radio ---------- */

// Stations with a name and a valid playlist link. The admin preview has no radio:
// it would load Spotify into every preview.
export function radioStations(P) {
  if (P.preview) return [];
  return ((P.site.radio || {}).stations || [])
    .map((s) => ({ name: String(s.name || '').trim(), id: spotifyPlaylistId(s.url) }))
    .filter((s) => s.name && s.id);
}

const ICON_PLAY = '<svg class="ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>';
const ICON_PAUSE = '<svg class="ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>';
const chevron = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// Play/pause next to the equalizer bars in the nav (radio.js makes it work).
const somControl = `<div class="som"><button class="som-btn" type="button" aria-pressed="false" aria-label="Tocar o rádio">${ICON_PLAY}${ICON_PAUSE}</button><span class="eqv" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="som-tip" aria-hidden="true"><small>Bota um som?</small><b data-radio-name></b></span></div>`;

// The radio docked at the bottom of every page: a knob, a dial with the stations and,
// once the visitor presses play, Spotify's own player. It stays hidden until radio.js
// sets it up, so pages without JavaScript don't show a radio that can't play.
export function radio(P) {
  const stations = radioStations(P);
  if (!stations.length) return '';
  const n = stations.length;
  const x = (i) => (n > 1 ? 5 + (i * 90) / (n - 1) : 50).toFixed(2);
  const mhz = [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108].map((f) => `<span>${f}</span>`).join('');
  const dial = stations.map((s, i) => `<button class="st${i % 2 ? ' lo' : ''}" type="button" data-id="${s.id}" style="--i:${i};--x:${x(i)}%" aria-pressed="false">${esc(s.name)}</button>`).join('');
  return `<div class="radio" id="radio" data-hidden="false" style="--n:${n}" hidden>
  <button class="alca" type="button" aria-expanded="true" aria-label="Esconder o rádio"><span class="eqv sm" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="alca-l">Rádio · <span data-radio-name></span></span>${chevron('M6 9l6 6 6-6')}</button>
  <div class="knob-w"><button class="knob" type="button" data-radio="next" aria-label="Próxima estação"></button><small aria-hidden="true">Sintonia</small></div>
  <div class="dial" role="group" aria-label="Estações do rádio">
    <div class="scale"><div class="mhz" aria-hidden="true">${mhz}</div><div class="ticks" aria-hidden="true"></div><span class="halo" aria-hidden="true"></span><span class="needle" aria-hidden="true"></span>${dial}</div>
    <button class="nudge l" type="button" data-radio="prev" aria-label="Estação anterior">${chevron('M15 6l-6 6 6 6')}</button>
    <button class="nudge r" type="button" data-radio="next" aria-label="Próxima estação">${chevron('M9 6l6 6-6 6')}</button>
  </div>
  <div class="slot">
    <div class="inv"><button class="play-big" type="button" data-radio="play" aria-label="Tocar o rádio">${ICON_PLAY}</button><p><b>Bota um som?</b><span>A LLama sintonizou <b data-radio-name></b>.</span></p></div>
    <div class="sp"></div>
    <p class="sp-hint" role="status" hidden>Aperta o ▶ do Spotify</p>
  </div>
</div>`;
}

export function ribbons(top, bottom) {
  const line = (words, times) => {
    const list = (words || []).map((w) => String(w).trim()).filter(Boolean);
    const unit = list.map((w) => `${esc(w)} <tspan class="st">✺</tspan> `).join('');
    return unit.repeat(times);
  };
  return `<div class="ribbons" aria-hidden="true">
  <svg viewBox="0 0 1440 230">
    <defs>
      <path id="rpa" d="M-80 150C240 40 520 60 760 140S1220 230 1540 70"/>
      <path id="rpb" d="M-80 70C260 200 640 210 940 120S1320 30 1540 150"/>
    </defs>
    <g class="rb-b"><use href="#rpb" class="rb-band"/><text class="rb-text"><textPath href="#rpb">${line(bottom, 4)}</textPath></text></g>
    <g class="rb-a"><use href="#rpa" class="rb-band"/><text class="rb-text"><textPath href="#rpa">${line(top, 4)}</textPath></text></g>
  </svg>
</div>`;
}

export function stage() {
  return '<div class="spot"></div><div class="beams" aria-hidden="true"><i></i><i></i><i></i></div>';
}

// Dark page header used by every inner page.
export function pageHero(P, { crumbs = [], eyebrow = '', live = false, title = '', titleClass = '', lead = '', extra = '' }) {
  return `<section class="phero">
  ${stage()}
  <div class="phero-in">
    ${breadcrumbs(P, crumbs)}
    ${eyebrow ? `<p class="eyebrow">${live ? '<span class="live"></span>' : ''}${esc(eyebrow)}</p>` : ''}
    <h1 class="h2 ${titleClass}" data-split>${split(title)}</h1>
    ${lead ? `<p class="lead" data-r style="--d:200ms">${esc(lead)}</p>` : ''}
    ${extra}
  </div>
  <div class="noise"></div>
</section>`;
}

export function breadcrumbs(P, items) {
  if (!items.length) return '';
  return `<nav class="crumbs" aria-label="Caminho"><a href="${P.href('')}">Capa</a>${items.map(([label, href]) => `<span aria-hidden="true">/</span>${href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`}`).join('')}</nav>`;
}

export function footer(P, { withCta = true } = {}) {
  const c = P.site.contact || {};
  const cta = P.site.cta || {};
  const social = [
    c.instagram && ['Instagram', `https://instagram.com/${c.instagram.replace(/^@/, '')}`],
    c.tiktok && ['TikTok', `https://www.tiktok.com/@${c.tiktok.replace(/^@/, '')}`],
    c.youtube && ['YouTube', c.youtube],
    c.spotify && ['Spotify', c.spotify],
  ].filter(Boolean);
  const year = (parseDate(P.today) || { y: new Date().getFullYear() }).y;
  const label = cta.eventLabel || 'Divulgue seu evento';
  const ctaHtml = withCta ? `<div class="cta">
    <h2 class="h-cta"><span data-split>${split(cta.line1 || 'Tem um rolê')}</span><br><span data-split>${split(cta.line2 || 'rolando?', 120)}</span><br><span class="red" data-split>${split(cta.highlight || 'A gente espalha.', 240)}</span></h2>
    <div class="cta-row">
      <p data-r>${esc(cta.text || '')}</p>
      <div class="side">
        <a class="magnet" href="${esc(rolêLink(P))}" target="_blank" rel="noopener" aria-label="${esc(label)}"><svg class="mt" viewBox="0 0 200 200" aria-hidden="true"><defs><path id="mc" d="M100 100m-84 0a84 84 0 1 1 168 0a84 84 0 1 1-168 0"/></defs><text><textPath href="#mc">${esc(label)} • ${esc(label)} • </textPath></text></svg><span class="ma" aria-hidden="true">→</span></a>
        ${cta.interviewLabel ? `<a class="link" href="${esc(rolêLink(P, 'interview'))}" target="_blank" rel="noopener">${esc(cta.interviewLabel)} →</a>` : ''}
      </div>
    </div>
  </div>` : '';
  return `<section class="panel dark foot" id="contato">
  ${ctaHtml}
  <div class="fgrid">
    <div><h2>LlamaLab</h2><p>Laboratório criativo de divulgação cultural. Agenda, entrevistas e notícias de quem faz a cultura acontecer em Dourados — MS.</p>${c.whatsapp ? `<a class="btn btn-red btn-sm" href="${esc(waLink(c.whatsapp))}" target="_blank" rel="noopener">Chama no WhatsApp <span class="arr">→</span></a>` : ''}</div>
    <div><h2>Navegue</h2>${NAV.map((n) => `<a href="${P.href(n.href)}">${n.label}</a>`).join('')}</div>
    ${social.length ? `<div><h2>Redes</h2>${social.map(([name, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${name}</a>`).join('')}</div>` : ''}
    <div><h2>Contato</h2>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.whatsapp ? `<a href="${esc(waLink(c.whatsapp))}" target="_blank" rel="noopener">${esc(formatPhone(c.whatsapp))}</a>` : ''}<a href="${P.href('sobre/')}">Dourados — MS</a></div>
  </div>
  <div class="fwm" data-io><div class="peek" aria-hidden="true"><div class="pk">${llama('')}</div></div><span class="bubble" aria-hidden="true">Bora?</span>${wordmark('')}</div>
  <div class="legal"><span>© ${year} LlamaLab — Laboratório Criativo${c.cnpj ? ` · CNPJ ${esc(c.cnpj)}` : ''}</span><span>Feito em Dourados, no volume máximo.</span></div>
</section>`;
}

/* ---------- images ---------- */

export function img(P, image, { cls = '', eager = false, alt } = {}) {
  if (!image || !image.src) return '';
  const dims = image.w && image.h ? ` width="${image.w}" height="${image.h}"` : '';
  const focus = image.focus ? ` style="object-position:${esc(image.focus)}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(P.src(image.src))}" alt="${esc(alt ?? image.alt ?? '')}"${dims}${focus} loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
}

export function llamaFallback() {
  return `<div class="sun" aria-hidden="true"></div>${llamaUse('ll-fb')}`;
}

/* ---------- agenda ---------- */

export function eventUrl(P, ev) {
  return P.href(`agenda/${ev.id}/`);
}

export function eventWhere(ev) {
  return [ev.venue, ev.city && ev.city !== 'Dourados' ? ev.city : ''].filter(Boolean).join(' · ');
}

export function eventInfo(ev) {
  return [fmtTime(ev.time), ev.price].filter(Boolean).join(' · ');
}

export function eventLine(ev) {
  const acts = splitList(ev.lineup);
  if (acts.length) return acts.join(' + ');
  return excerpt(stripMarkdown(ev.description), 110);
}

export function row(P, ev, i = 0, { past = false, tag = 'li' } = {}) {
  const p = parseDate(ev.date);
  const v = hash(ev.id) % 5;
  const until = past ? '' : ` data-until="${esc(eventEnd(ev))}"`;
  const imgAttr = ev.image && ev.image.src ? ` data-img="${esc(P.src(ev.image.src))}"` : '';
  const multi = ev.endDate && ev.endDate > ev.date ? ` → ${parseDate(ev.endDate).d}/${parseDate(ev.endDate).m}` : '';
  const line = eventLine(ev);
  return `<${tag} data-cat="${esc(slugify(ev.category || 'role'))}"${until}><a class="row${past ? ' past' : ''}" id="ev-${esc(ev.id)}" href="${eventUrl(P, ev)}" data-r style="--d:${(i % 5) * 80}ms" data-v="${v}"${imgAttr}>
  <div class="d"><b>${String(p.d).padStart(2, '0')}</b><span>${MONTHS_SHORT[p.m - 1].toUpperCase()}<br>${WEEKDAYS_SHORT[weekday(ev.date)].toUpperCase()}${multi}</span></div>
  <div class="t"><h3>${esc(ev.title)}</h3>${line ? `<p>${esc(line)}</p>` : ''}</div>
  <div class="v"><span>${esc(eventWhere(ev) || 'Dourados')}</span><span>${esc(eventInfo(ev) || (past ? 'Já rolou' : ''))}</span></div>
  <span class="tag">${esc(ev.category || 'Rolê')}</span><span class="go" aria-hidden="true">→</span>
</a></${tag}>`;
}

export function posterFollower() {
  return '<div class="poster" aria-hidden="true"><div class="art"></div><div class="pi"><div class="pv" data-p="tag"></div><div><div class="pd" data-p="d"></div><div class="pv" data-p="m" style="margin:8px 0 14px"></div><div class="pt" data-p="t"></div></div><div class="pv" data-p="v"></div></div></div>';
}

// Month calendar; days with an event start are marked and link to it.
export function calendar(P, y, m, events, { link = 'event', nav: withNav = false } = {}) {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = weekday(first);
  const byDay = new Map();
  for (const ev of events) {
    const p = parseDate(ev.date);
    if (p && p.y === y && p.m === m) {
      if (!byDay.has(p.d)) byDay.set(p.d, []);
      byDay.get(p.d).push(ev);
    }
  }
  const t = parseDate(P.today);
  const monthName = monthLabel(y, m).split(' ')[0];
  const cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<i>${d}</i>`);
  for (let i = 0; i < offset; i += 1) cells.push('<span aria-hidden="true"></span>');
  for (let d = 1; d <= days; d += 1) {
    const isToday = t && t.y === y && t.m === m && t.d === d;
    const evs = byDay.get(d);
    const cls = [evs ? 'ev' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
    if (evs) {
      const target = link === 'anchor' ? `#ev-${esc(evs[0].id)}` : eventUrl(P, evs[0]);
      const label = `${d} de ${monthName.toLowerCase()}: ${evs.map((e) => e.title).join(', ')}`;
      cells.push(`<a class="${cls}" href="${target}" title="${esc(label)}" aria-label="${esc(label)}">${d}</a>`);
    } else {
      cells.push(`<span${cls ? ` class="${cls}"` : ''}>${d}</span>`);
    }
  }
  const navHtml = withNav ? '<div class="nav-m"><button type="button" data-cal="-1" aria-label="Mês anterior">‹</button><button type="button" data-cal="1" aria-label="Próximo mês">›</button></div>' : '';
  return `<div class="cal-h"><div><b>${esc(monthName)}</b> <span>${y}</span></div>${navHtml}</div>
    <div class="cal-g">${cells.join('')}</div>`;
}

export function calendarList(P, upcoming) {
  const rows = upcoming.slice(0, 4).map((ev) => `<a href="${eventUrl(P, ev)}"><b>${String(parseDate(ev.date).d).padStart(2, '0')}</b>${esc(MONTHS_SHORT[parseDate(ev.date).m - 1])} · ${esc(ev.title)}</a>`);
  if (!rows.length) rows.push('<span class="dim">Nenhum rolê marcado por enquanto.</span>');
  return `<div class="cal-l">${rows.join('')}</div>`;
}

/* ---------- interviews ---------- */

export function interviewUrl(P, it) {
  return P.href(`entrevistas/${it.id}/`);
}

export function interviewNo(P, it) {
  const n = P.ivNumber.get(it.id);
  return n ? `Nº ${String(n).padStart(2, '0')}` : '';
}

export function card(P, it, { feat = false, tag = 'h3', reveal = false, i = 0 } = {}) {
  const photo = it.photo && it.photo.src ? img(P, it.photo, { cls: 'bw', alt: '' }) : llamaFallback();
  const text = it.quote ? `<q>${esc(excerpt(it.quote, 140))}</q>` : `<p class="sum">${esc(excerpt(it.summary || stripMarkdown(it.body), 150))}</p>`;
  const role = [it.area, it.role && excerpt(it.role, 60)].filter(Boolean).join(' · ');
  return `<a class="card${feat ? ' feat' : ''}" href="${interviewUrl(P, it)}" data-cat="${esc(slugify(it.area || 'papo'))}"${reveal ? ` data-r style="--d:${(i % 3) * 90}ms"` : ''}>
  <div class="ph">${photo}<span class="num">${esc(interviewNo(P, it))}</span></div>
  <div class="body"><span class="role">${esc(role)}</span><${tag}>${esc(it.name || it.title)}</${tag}>${text}<span class="more">${it.video ? 'Ver o papo' : 'Ler entrevista'} <i aria-hidden="true">→</i></span></div>
</a>`;
}

// The quote with the highlighted word in red.
export function quoteHtml(quote, highlight) {
  const q = String(quote || '');
  const h = String(highlight || '').trim();
  const idx = h ? q.toLowerCase().indexOf(h.toLowerCase()) : -1;
  if (idx < 0) return esc(q);
  return `${esc(q.slice(0, idx))}<span class="mk">${esc(q.slice(idx, idx + h.length))}</span>${esc(q.slice(idx + h.length))}`;
}

/* ---------- news ---------- */

export function newsUrl(P, n) {
  return P.href(`noticias/${n.id}/`);
}

export function newsImage(P, n, { stamp = '' } = {}) {
  const word = (n.kicker || 'Notícia').split(/\s+/)[0];
  const art = n.image && n.image.src
    ? img(P, n.image, { cls: 'bw' })
    : `<div class="ht" aria-hidden="true"></div><div class="big" aria-hidden="true">${esc(word)}<span>${esc((n.date || '').slice(0, 4))}</span></div>`;
  return `<div class="img">${art}${stamp ? `<div class="stamp">${stamp}</div>` : ''}</div>`;
}

export function newsFeature(P, n, { fresh = false, tag = 'h3' } = {}) {
  return `<a class="nf" href="${newsUrl(P, n)}" data-r data-cat="${esc(slugify(n.kicker || 'cena'))}">
  ${newsImage(P, n, { stamp: fresh ? 'Fresqui<br>nho' : '' })}
  <div class="meta">${n.kicker ? `<span class="tag">${esc(n.kicker)}</span>` : ''}<time datetime="${esc(n.date)}">${fmtShort(n.date)}</time></div>
  <${tag}><span class="uw">${esc(n.title)}</span></${tag}>
  ${n.summary || n.body ? `<p>${esc(excerpt(n.summary || stripMarkdown(n.body), 220))}</p>` : ''}
</a>`;
}

export function newsItem(P, n, i) {
  return `<a class="ni" href="${newsUrl(P, n)}" data-r style="--d:${(i % 4) * 80}ms" data-cat="${esc(slugify(n.kicker || 'cena'))}"><span class="n">${String(i + 2).padStart(2, '0')}</span><div><div class="meta">${n.kicker ? `<span class="tag">${esc(n.kicker)}</span>` : ''}<time datetime="${esc(n.date)}">${fmtShort(n.date, false)}</time></div><h3>${esc(n.title)}</h3><span class="wave"></span></div><span class="go" aria-hidden="true">→</span></a>`;
}

/* ---------- misc ---------- */

export function chips(items, label) {
  if (items.length < 2) return '';
  const buttons = ['<button class="chip" type="button" data-filter="" aria-pressed="true">Tudo</button>']
    .concat(items.map(([key, text]) => `<button class="chip" type="button" data-filter="${esc(key)}" aria-pressed="false">${esc(text)}</button>`));
  return `<div class="chips" role="group" aria-label="${esc(label)}">${buttons.join('')}</div>`;
}

export function categoriesOf(list, key) {
  const seen = new Map();
  for (const item of list) {
    const value = String(item[key] || '').trim();
    if (value && !seen.has(slugify(value))) seen.set(slugify(value), value);
  }
  return [...seen.entries()];
}

export function shareBox(P, title, url) {
  const wa = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  return `<div class="box"><b>Compartilhar</b><a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp ↗</a><button type="button" data-share="${esc(url)}" data-title="${esc(title)}">Copiar link</button></div>`;
}

export function badge() {
  return `<div class="badge" aria-hidden="true">${ring}${llamaUse('bh')}</div>`;
}
