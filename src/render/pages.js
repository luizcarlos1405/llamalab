// Every public page. Each function takes a page context (see context.js) and
// returns a complete HTML document.

import { esc, excerpt, stripMarkdown, fmtShort, fmtLong, fmtWeekdayLong, fmtTime, fmtHours, eventStop, weekday, WEEKDAYS, parseDate, monthLabel, isUpcoming, splitList, youtubeId, addDays, capitalize, waLink, MONTHS } from '../util.js';
import { renderMarkdown } from '../markdown.js';
import { SITE } from '../config.js';
import { layout } from './layout.js';
import {
  split, ribbons, stage, pageHero, breadcrumbs, img, row, posterFollower, calendar, calendarList, eventUrl, eventLine, card, interviewUrl, interviewNo,
  quoteHtml, newsFeature, newsItem, chips, categoriesOf, shareBox, badge, rolêLink, llama, wordmark, hash,
  albumUrl, albumCard, albumCover, photoCount, photoGrid, pile, tagMe, instagramOf, ICON_SAVE, ICON_SHARE, mark,
} from './parts.js';

const md = (P, text) => renderMarkdown(text, { url: P.url, image: (p) => P.imageSize(p) });
const jsonLd = (value) => `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
const sameStart = (a, b) => {
  const norm = (s) => stripMarkdown(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return Boolean(a && b) && norm(b).startsWith(norm(a).slice(0, 60));
};
const titleSize = (text, l = 34, xl = 60) => (text.length > xl ? 'xs' : text.length > l ? 's' : 'm');

/* ================= HOME ================= */

export function homePage(P) {
  const h = P.site.hero || {};
  const r = P.site.ribbons || {};
  const next = P.upcoming.find((ev) => ev.featured) || P.upcoming[0];
  const p = next && parseDate(next.date);
  const nextHtml = next
    ? `<a class="next" href="${eventUrl(P, next)}"><b>${String(p.d).padStart(2, '0')}</b><span><small>Próximo rolê · ${esc(WEEKDAYS[weekday(next.date)].split('-')[0])}${next.time ? ` ${esc(fmtTime(next.time))}` : ''}</small><em>${esc(next.title)}</em></span></a>`
    : '';
  // In the preview, data-f-top: the stage stays put while the page slides up over it, so its
  // fields are only whole at the very top (src/admin/spotlight.js scrolls there).
  const hero = `<section class="hero" id="top"${P.preview ? ' data-f-top' : ''}>
  <div class="hero-in">
    ${stage()}<div class="floor"></div>
    <div class="hero-wm">${wordmark('')}</div>
    <div class="hero-l">
      <p class="eyebrow"${mark(P, 'hero.eyebrow')}><span class="live"></span>${esc(h.eyebrow || 'Agenda cultural · Dourados–MS')}</p>
      <h1 class="h1"${mark(P, 'hero.title')}>${esc(h.title || 'Cultura que faz')} <span class="red"${mark(P, 'hero.highlight')}>${esc(h.highlight || 'barulho.')}</span></h1>
      ${nextHtml}
    </div>
    <div class="hero-r">
      ${h.text ? `<p class="lead"${mark(P, 'hero.text')}>${esc(h.text)}</p>` : ''}
      <div class="btns"><a class="btn btn-solid" href="${P.href('agenda/')}">Ver agenda <span class="arr">→</span></a><a class="btn btn-ghost" href="${P.href('entrevistas/')}">Entrevistas</a></div>
    </div>
    <div class="hero-llama"><div class="rise"><div class="glow"></div><div class="sway">${llama('')}</div></div></div>
    ${ribbons(r.top, r.bottom, P)}
    <div class="noise"></div>
  </div>
</section>`;
  const main = [agendaPanel(P), backstagePanel(P), newsPanel(P)].join('\n');
  return layout(P, { main, before: hero, bodyClass: 'home', edit: 'site' });
}

function agendaPanel(P) {
  const list = P.upcoming.slice(0, 6);
  const months = [...new Set(list.map((ev) => ev.date.slice(0, 7)))];
  const monthChips = months.length > 1
    ? months.map((m, i) => `<button class="chip${i ? '' : ' on'}" type="button" data-month="${m}">${MONTHS[+m.slice(5) - 1].slice(0, 3)}</button>`).join('')
    : '';
  const recent = P.past.slice(0, 3);
  const body = list.length
    ? `<div class="dates-wrap"><ol class="dates">${list.map((ev, i) => row(P, ev, i).replace('<li ', `<li data-month="${ev.date.slice(0, 7)}" `)).join('')}</ol>${posterFollower()}</div>`
    : `<div class="empty" data-r><p class="h3">Nenhum rolê marcado por enquanto.</p><p>Tem show, peça, sarau ou feira vindo aí? Manda pra gente que a LLama Lab coloca na agenda.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener"${mark(P, 'cta.eventMessage')}>Enviar meu evento <span class="arr">→</span></a></div>
      ${recent.length ? `<div class="month-h" style="margin-top:clamp(50px,6vw,80px)"><h2>Já rolou</h2><span>ARQUIVO</span></div><div class="dates-wrap"><ol class="dates">${recent.map((ev, i) => row(P, ev, i, { past: true })).join('')}</ol>${posterFollower()}</div>` : ''}`;
  return `<section class="panel light sec" id="agenda">
  <div class="sec-head">
    <div><p class="eyebrow"><span class="live"></span>Próximos rolês</p><h2 class="h2" data-split>${split('Agenda')}</h2></div>
    <div class="months" data-r>${monthChips}<a class="link" href="${P.href('agenda/')}">Calendário completo →</a></div>
  </div>
  ${body}
  ${list.length ? `<div class="agenda-foot" data-r><p>Tem evento cultural em Dourados? Manda pra gente que a LLama Lab coloca na agenda — e no volume máximo.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener"${mark(P, 'cta.eventMessage')}>Enviar meu evento <span class="arr">→</span></a></div>` : ''}
</section>`;
}

// Backstage: the interviews (the featured one first), then the newest artists, and at the end
// of the track a way into each list.
function backstagePanel(P) {
  if (!P.interviews.length && !P.artists.length) return '';
  const feat = P.interviews.find((it) => it.featured) || P.interviews[0];
  const others = P.interviews.filter((it) => it !== feat).slice(0, 4);
  const artists = P.artistsNew.slice(0, 5);
  const lists = [
    P.interviews.length && ['Entrevistas', 'Todas as entrevistas', 'entrevistas/'],
    P.artists.length && ['Artistas', 'Todos os artistas', 'artistas/'],
  ].filter(Boolean);
  return `<section class="panel dark backstage" id="backstage">
  <div class="pin">
    <div class="bs-head">
      <div><p class="eyebrow">${lists.map(([name]) => name).join(' e ')}</p><h2 class="h2 outline" data-split>${split('Backstage')}</h2></div>
      <div class="bs-side" data-r><p class="bs-sub">Papo reto com quem faz a cultura de Dourados acontecer — antes, durante e depois do show.</p><p class="bs-links">${lists.map(([name, , href]) => `<a class="link" href="${P.href(href)}">${name} →</a>`).join('')}</p></div>
    </div>
    <div class="track" id="track">
      ${feat ? card(P, feat, { feat: true }) : ''}
      ${others.map((it) => card(P, it)).join('\n      ')}
      ${artists.map((it) => card(P, it, { artist: true })).join('\n      ')}
      <div class="card ends">${lists.map(([, label, href]) => `<a href="${P.href(href)}"><h3>${label}</h3><span class="big" aria-hidden="true">→</span></a>`).join('')}</div>
    </div>
    <div class="bar"><i id="bar"></i></div>
  </div>
</section>`;
}

function newsPanel(P) {
  if (!P.news.length) return '';
  const lead = P.news.find((n) => n.featured) || P.news[0];
  const rest = P.news.filter((n) => n !== lead).slice(0, 3);
  return `<section class="panel light sec" id="radar-cultural">
  <div class="sec-head">
    <div><p class="eyebrow">Últimas do rolê</p><h2 class="h2" data-split>${split('Radar Cultural')}</h2></div>
    <div class="news-head-r" data-r>${badge()}</div>
  </div>
  <div class="news-grid">
    ${newsFeature(P, lead, { fresh: lead.date >= addDays(P.today, -7) })}
    <div class="nl">${rest.map((n, i) => newsItem(P, n, i)).join('')}${P.news.length > 4 ? `<a class="link" href="${P.href('radar-cultural/')}" style="margin:24px 0 0;align-self:flex-start">Tudo no Radar →</a>` : ''}</div>
  </div>
</section>`;
}

/* ================= AGENDA ================= */

export function agendaPage(P) {
  const t = parseDate(P.today);
  const months = new Map();
  for (const ev of P.upcoming) {
    const key = ev.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(ev);
  }
  let n = 0;
  const blocks = [...months.entries()].map(([key, evs]) => {
    const [y, m] = key.split('-').map(Number);
    return `<div class="month-block" data-month="${key}"><div class="month-h"><h2>${esc(monthLabel(y, m).split(' ')[0])}</h2><span>${y}</span></div><ol class="dates">${evs.map((ev) => row(P, ev, n++)).join('')}</ol></div>`;
  }).join('');
  const empty = `<div class="empty"><p class="h3">Nenhum rolê marcado por enquanto.</p><p>Tem show, peça, sarau ou feira vindo aí? Manda pra gente que a LLama Lab coloca na agenda.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener"${mark(P, 'cta.eventMessage')}>Enviar meu evento <span class="arr">→</span></a></div>`;
  const past = P.past.length
    ? `<details class="past-list"${P.upcoming.length ? '' : ' open'}><summary><span class="h3">Já rolou</span></summary><ol class="dates">${P.past.map((ev, i) => row(P, ev, i, { past: true })).join('')}</ol></details>`
    : '';
  const calData = P.events.map((ev) => ({ id: ev.id, d: ev.date, t: ev.title, up: isUpcoming(ev, P.today) }));
  const main = `${pageHero(P, {
    crumbs: [['Agenda']],
    eyebrow: (P.site.hero || {}).eyebrow || 'Agenda cultural · Dourados–MS',
    live: true,
    title: 'Agenda',
    lead: 'Shows, teatro, saraus, feiras, exposições e festivais: tudo que rola em Dourados e região, num lugar só.',
  })}
<section class="panel light sec">
  <div class="wrap agenda-layout">
    <div class="dates-wrap">
      ${chips(categoriesOf(P.upcoming, 'category'), 'Filtrar por tipo de evento')}
      ${blocks || empty}
      ${past}
      ${posterFollower()}
    </div>
    <aside class="cal" data-calendar data-month="${P.today.slice(0, 7)}" aria-label="Calendário">
      ${calendar(P, t.y, t.m, P.events, { link: 'anchor', nav: true })}
      ${calendarList(P, P.upcoming)}
    </aside>
  </div>
  <div class="wrap agenda-foot"><p>Tem evento cultural em Dourados? Manda pra gente que a LLama Lab coloca na agenda — e no volume máximo.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener"${mark(P, 'cta.eventMessage')}>Enviar meu evento <span class="arr">→</span></a></div>
  <script type="application/json" id="agenda-data">${JSON.stringify(calData).replace(/</g, '\\u003c')}</script>
</section>`;
  return layout(P, {
    title: 'Agenda',
    description: `Agenda cultural de Dourados e região: shows, teatro, saraus, feiras e exposições.${P.upcoming.length ? ` ${P.upcoming.length} ${P.upcoming.length > 1 ? 'rolês' : 'rolê'} na agenda.` : ''}`,
    current: 'agenda',
    main,
    edit: 'agenda',
  });
}

function googleCalendarLink(ev) {
  const compact = (d) => d.replace(/-/g, '');
  const endDay = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
  let dates;
  if (ev.time) {
    const stop = eventStop(ev);
    dates = `${compact(ev.date)}T${ev.time.replace(':', '')}00/${compact(stop.date)}T${stop.time.replace(':', '')}00`;
  } else {
    dates = `${compact(ev.date)}/${compact(addDays(endDay, 1))}`;
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates,
    ctz: SITE.timezone,
    details: excerpt(stripMarkdown(ev.description) || ev.summary || ev.lineup || '', 400),
    location: [ev.venue, ev.address, ev.city].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function eventPage(P, ev) {
  const past = !isUpcoming(ev, P.today);
  const multi = ev.endDate && ev.endDate > ev.date;
  const p = parseDate(ev.date);
  const whenText = multi
    ? `De ${fmtLong(ev.date, ev.date.slice(0, 4) !== ev.endDate.slice(0, 4))} a ${fmtLong(ev.endDate)}`
    : capitalize(fmtWeekdayLong(ev.date, true));
  const where = [ev.venue, ev.address, ev.city].filter(Boolean).join(' — ');
  const mapQuery = [ev.venue, ev.address, ev.city || 'Dourados', 'MS'].filter(Boolean).join(', ');
  const acts = splitList(ev.lineup);
  const rows = [
    ['Quando', `${esc(whenText)}${ev.time ? ` · ${esc(fmtHours(ev))}` : ''}`, ['date', 'endDate', 'time', 'endTime']],
    where && ['Onde', `${esc(where)}${ev.venue || ev.address ? ` · <a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(mapQuery)}" target="_blank" rel="noopener">ver no mapa ↗</a>` : ''}`, ['venue', 'address', 'city']],
    ev.price && ['Entrada', esc(ev.price), ['price']],
    acts.length && ['Atrações', esc(acts.join(' · ')), ['lineup']],
    ev.link && ['Link', `<a href="${esc(ev.link)}" target="_blank" rel="noopener">${esc(ev.linkLabel || ev.link.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0])} ↗</a>`, ['link', 'linkLabel']],
  ].filter(Boolean);
  const v = hash(ev.id) % 5;
  const media = ev.image && ev.image.src
    ? `<div class="media-glow" data-r style="--d:200ms"><div class="media"${mark(P, 'image')}>${img(P, ev.image, { eager: true, alt: ev.image.alt || `Flyer de ${ev.title}` })}</div></div>`
    : `<div class="media-glow" data-r style="--d:200ms"><div class="poster on" data-v="${v}"${mark(P, 'image')} style="position:relative;width:min(100%,380px);height:auto;aspect-ratio:25/33;scale:1;margin:0 auto"><div class="art"></div><div class="pi"><div class="pv"${mark(P, 'category')}>${esc(ev.category || 'Rolê')}</div><div><div class="pd">${String(p.d).padStart(2, '0')}</div><div class="pv" style="margin:8px 0 14px">${esc(MONTHS[p.m - 1].slice(0, 3).toUpperCase())} · ${esc(WEEKDAYS[weekday(ev.date)].slice(0, 3).toUpperCase())}</div><div class="pt"${mark(P, 'title')}>${esc(ev.title)}</div></div><div class="pv"${mark(P, 'venue')}>${esc(ev.venue || 'Dourados')}</div></div></div></div>`;
  const others = P.upcoming.filter((e) => e.id !== ev.id).slice(0, 4);
  const url = P.canonical;
  const album = P.albumOf.get(ev.id);
  const hero = `<section class="phero">
  ${stage()}
  <div class="phero-in phero-grid">
    <div>
      ${breadcrumbs(P, [['Agenda', P.href('agenda/')], [ev.title]])}
      <div class="tags">${ev.category ? `<span class="tag"${mark(P, 'category')}>${esc(ev.category)}</span>` : ''}${ev.price ? `<span class="tag r"${mark(P, 'price')}>${esc(ev.price)}</span>` : ''}${past ? '<span class="stamp-past">Já rolou</span>' : ''}</div>
      <h1 class="h2 ${titleSize(ev.title, 20, 40)}" data-split${mark(P, 'title')}>${split(ev.title)}</h1>
      <div class="when" data-r style="--d:150ms"${mark(P, 'date')}><b>${String(p.d).padStart(2, '0')}</b><span>${esc(MONTHS[p.m - 1])} · ${p.y}<small${mark(P, 'time', 'endTime', 'endDate')}>${esc(WEEKDAYS[weekday(ev.date)])}${ev.time ? ` · ${esc(fmtHours(ev))}` : ''}${multi ? ` · até ${esc(fmtShort(ev.endDate, false))}` : ''}</small><small${mark(P, ev.venue ? 'venue' : 'city')}>${esc(ev.venue || ev.city || '')}</small></span></div>
      <div class="btns" data-r style="--d:250ms;margin-top:30px">
        ${album ? `<a class="btn btn-red" href="${albumUrl(P, album)}">Ver as ${esc(photoCount(album))} <span class="arr">→</span></a>` : ''}
        ${ev.link ? `<a class="btn ${album ? 'btn-ghost' : 'btn-red'}" href="${esc(ev.link)}" target="_blank" rel="noopener"${mark(P, 'link', 'linkLabel')}>${esc(ev.linkLabel || 'Mais informações')} <span class="arr">→</span></a>` : ''}
        ${past ? '' : `<a class="btn btn-solid" href="${esc(googleCalendarLink(ev))}" target="_blank" rel="noopener">Salvar na agenda <span class="arr">→</span></a>`}
        <button class="btn btn-ghost" type="button" data-share="${esc(url)}" data-title="${esc(ev.title)}">Compartilhar</button>
      </div>
    </div>
    ${media}
  </div>
  <div class="noise"></div>
</section>`;
  const main = `${hero}
<section class="panel light sec">
  <div class="detail">
    <div>
      <dl class="ficha">${rows.map(([dt, dd, paths]) => `<div${mark(P, ...paths)}><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}</dl>
      ${ev.description || ev.summary ? `<div class="prose"${mark(P, ev.description ? 'description' : 'summary')} style="margin-top:clamp(36px,4vw,56px)">${ev.description ? md(P, ev.description) : `<p>${esc(ev.summary)}</p>`}</div>` : ''}
    </div>
    <aside class="aside">${shareBox(P, ev.title, url)}${past ? '' : `<div class="box"><b>Salvar</b><a href="${esc(googleCalendarLink(ev))}" target="_blank" rel="noopener">Google Agenda ↗</a><a href="${P.href(`agenda/${ev.id}/evento.ics`)}" download>Apple, Outlook (.ics)</a></div>`}<div class="box k"><b>Agenda</b><a href="${P.href('agenda/')}">Todos os rolês →</a></div></aside>
  </div>
  ${album ? eventPhotos(P, album) : ''}
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais rolês</h2><a class="link" href="${P.href('agenda/')}">Agenda completa →</a></div><div class="dates-wrap"><ol class="dates">${others.map((e, i) => row(P, e, i)).join('')}</ol>${posterFollower()}</div></div>` : ''}
</section>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.title,
    startDate: ev.time ? `${ev.date}T${ev.time}:00-04:00` : ev.date,
    ...(ev.time && ev.endTime ? { endDate: `${eventStop(ev).date}T${ev.endTime}:00-04:00` } : multi ? { endDate: ev.endDate } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: ev.venue || ev.city || 'Dourados', address: [ev.address, ev.city || 'Dourados', 'MS'].filter(Boolean).join(', ') },
    ...(ev.image && ev.image.src ? { image: [P.absSrc(ev.image.src)] } : {}),
    description: excerpt(ev.summary || stripMarkdown(ev.description) || eventLine(ev) || ev.title, 300),
    url,
    organizer: { '@type': 'Organization', name: 'LLama Lab', url: P.abs('') },
  };
  return layout(P, {
    title: `${ev.title} · ${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`,
    description: [`${whenText}${ev.time ? `, ${fmtHours(ev)}` : ''}`, where, acts.join(', '), ev.summary || stripMarkdown(ev.description)].filter(Boolean).join(' · '),
    image: ev.image,
    type: 'article',
    current: 'agenda',
    main,
    head: jsonLd(ld),
    edit: `agenda/${ev.id}`,
  });
}

// The event's album on its page: its first photos, and the rest behind a "+35".
function eventPhotos(P, a) {
  const shown = a.photos.slice(0, 5);
  const more = a.photos.length - shown.length;
  const ig = instagramOf(a.instagram);
  return `<div class="ev-photos" data-r><div class="more-head"><h2 class="h2 xs">Fotos do rolê</h2><a class="link" href="${albumUrl(P, a)}">Ver as ${esc(photoCount(a))} →</a></div>
  <div class="strip">${shown.map((p, i) => `<a href="${albumUrl(P, a)}#foto-${i + 1}" aria-label="Foto ${i + 1} de ${a.photos.length}"><img src="${esc(P.src(p.thumb))}" alt="" width="${p.w}" height="${p.h}" loading="lazy" decoding="async"></a>`).join('')}${more > 0 ? `<a class="more" href="${albumUrl(P, a)}"><b>+${more}</b><span>${a.photographer ? `Fotos: ${esc(a.photographer)}` : ig ? `@${esc(ig.handle)}` : 'Ver todas'}</span><i aria-hidden="true">→</i></a>` : ''}</div></div>`;
}

/* ================= FOTOS (event coverage, at /fotos/) ================= */

// The albums, newest first, by month: each month a block the type filter can hide whole.
export function photosPage(P) {
  const latest = P.albums[0];
  const lead = 'Os rolês de Dourados pelas lentes da LLama Lab. Se achou? Salva, posta e marca a @llama.etc.';
  const hero = `<section class="phero">
  ${stage()}<div class="flash" aria-hidden="true"></div>
  <div class="phero-in${latest ? ' phero-grid' : ''}">
    <div>
      ${breadcrumbs(P, [['Fotos']])}
      <p class="eyebrow">Cobertura dos rolês</p>
      <h1 class="h2" data-split>${split('Fotos')}</h1>
      <p class="lead" data-r style="--d:200ms">${esc(lead)}</p>
      ${latest ? latestPill(P, latest) : ''}
    </div>
    ${latest ? `<a class="media-glow" href="${albumUrl(P, latest)}" aria-label="${esc(`${latest.title}, ${photoCount(latest)}`)}" data-r style="--d:200ms">${pile(P, latest, { count: false, eager: true })}</a>` : ''}
  </div>
  <div class="noise"></div>
</section>`;
  const months = new Map();
  for (const a of P.albums) {
    const key = a.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(a);
  }
  const blocks = [...months.entries()].map(([key, list]) => {
    const [y, m] = key.split('-').map(Number);
    return `<div class="month-block fm"><div class="month-h"><h2>${esc(MONTHS[m - 1])}</h2><span>${y}</span></div><div class="albs">${list.map((a) => albumCard(P, a)).join('')}</div></div>`;
  }).join('');
  const foot = `<div class="fotos-foot"><p><b>Teve rolê e quer cobertura?</b> A LLama Lab fotografa shows, festas e festivais de Dourados e região.</p><a class="btn btn-k" href="${P.href('contrate/')}">Chamar a LLama <span class="arr">→</span></a></div>`;
  const content = P.albums.length
    ? `${chips(categoriesOf(P.albums, 'category'), 'Filtrar por tipo de rolê')}${blocks}${foot}`
    : `<div class="empty"><p class="h3">Nenhum álbum por enquanto.</p><p>As fotos dos rolês que a LLama Lab cobre chegam aqui, para você achar a sua, salvar e postar.</p><a class="btn btn-k" href="${P.href('contrate/')}">Quero cobertura no meu rolê <span class="arr">→</span></a></div>`;
  const main = `${hero}
<section class="panel light sec"><div class="wrap">${content}</div></section>`;
  return layout(P, {
    title: 'Fotos',
    description: 'Fotos dos rolês de Dourados e região: shows, festas e festivais, pelas lentes da LLama Lab. Salve, poste e marque a @llama.etc.',
    image: latest ? albumImage(latest) : null,
    current: 'fotos',
    main,
    edit: 'fotos',
  });
}

function latestPill(P, a) {
  const p = parseDate(a.date);
  return `<a class="next" href="${albumUrl(P, a)}"><b>${String(p.d).padStart(2, '0')}</b><span><small>Último álbum · ${esc(WEEKDAYS[weekday(a.date)].split('-')[0])} ${p.d}/${p.m}</small><em>${esc(a.title)} · ${esc(photoCount(a))}</em></span></a>`;
}

// The cover, full size, for link previews.
function albumImage(a) {
  const c = albumCover(a);
  return c ? { src: c.src, w: c.w, h: c.h, alt: `${a.title}: uma das fotos` } : null;
}

export function albumPage(P, a) {
  const p = parseDate(a.date);
  const ev = a.event ? P.events.find((e) => e.id === a.event) : null;
  const ig = instagramOf(a.instagram);
  const more = P.albums.filter((x) => x.id !== a.id).slice(0, 3);
  const when = `${esc(MONTHS[p.m - 1])} · ${p.y}<small>${esc(WEEKDAYS[weekday(a.date)])}${ev && ev.time && ev.date === a.date ? ` · ${esc(fmtTime(ev.time))}` : ''}</small>${a.venue ? `<small>${esc(a.venue)}</small>` : ''}`;
  const credit = a.photographer || ig
    ? `<p class="byline">Fotos${a.photographer ? `: ${esc(a.photographer)}` : ''}${ig ? ` · <a href="${esc(ig.url)}" target="_blank" rel="noopener">@${esc(ig.handle)}</a>` : ''}</p>`
    : '';
  const hero = `<section class="phero">
  ${stage()}<div class="flash" aria-hidden="true" style="--fx:74%;--fy:38%"></div>
  <div class="phero-in phero-grid">
    <div>
      ${breadcrumbs(P, [['Fotos', P.href('fotos/')], [excerpt(a.title, 40)]])}
      <div class="tags">${a.category ? `<span class="tag">${esc(a.category)}</span>` : ''}<span class="tag r">${esc(photoCount(a))}</span></div>
      <h1 class="h2 ${titleSize(a.title, 20, 40)}" data-split>${split(a.title)}</h1>
      <div class="when" data-r style="--d:150ms"><b>${String(p.d).padStart(2, '0')}</b><span>${when}</span></div>
      ${credit}
      <div class="btns" data-r style="--d:250ms;margin-top:28px">
        <a class="btn btn-solid" href="#fotos">Ver as fotos <span class="arr">↓</span></a>
        ${ev ? `<a class="btn btn-ghost" href="${eventUrl(P, ev)}">O evento</a>` : ''}
        <button class="btn btn-ghost sh" type="button" data-share="${esc(P.canonical)}" data-title="${esc(a.title)}" aria-label="Compartilhar o álbum">${ICON_SHARE}<span>Compartilhar</span></button>
      </div>
    </div>
    <div class="media-glow" data-r style="--d:200ms">${pile(P, a, { count: false, eager: true })}</div>
  </div>
  <div class="noise"></div>
</section>`;
  const main = `${hero}
<section class="panel light sec" id="fotos"><div class="wrap">
  <div class="ph-head"><div><h2 class="h2 xs">${esc(photoCount(a))}</h2><p>Toque numa foto para ver grande e salvar.</p></div><button class="btn btn-ghost btn-sm dl" type="button" data-zip hidden>${ICON_SAVE} Baixar todas (.zip)</button></div>
  ${photoGrid(P, a)}
  ${tagMe(a)}
  ${more.length ? `<div class="more-fotos"><div class="more-head"><h2 class="h2 xs">Mais fotos</h2><a class="link" href="${P.href('fotos/')}">Todos os álbuns →</a></div><div class="albs row-x">${more.map((x) => albumCard(P, x)).join('')}</div></div>` : ''}
</div></section>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: a.title,
    datePublished: a.date,
    ...(albumCover(a) ? { image: [P.absSrc(albumCover(a).src)] } : {}),
    ...(a.photographer ? { author: { '@type': 'Person', name: a.photographer } } : {}),
    publisher: { '@type': 'Organization', name: 'LLama Lab' },
  };
  return layout(P, {
    title: `Fotos: ${a.title}`,
    description: `${a.title}: ${photoCount(a)}${a.venue ? `, em ${a.venue}` : ''}, ${p.d}/${p.m}/${p.y}${a.photographer ? `, por ${a.photographer}` : ''}. Salve, poste e marque a @llama.etc.`,
    image: albumImage(a),
    type: 'article',
    current: 'fotos',
    main,
    head: jsonLd(ld),
    edit: `fotos/${a.id}`,
  });
}

/* ================= RADAR CULTURAL (the news, at /radar-cultural/) ================= */

export function newsListPage(P) {
  const lead = P.news.find((n) => n.featured) || P.news[0];
  const rest = P.news.filter((n) => n !== lead);
  const side = rest.slice(0, 3);
  const more = rest.slice(3);
  const content = P.news.length
    ? `<div class="news-grid">${newsFeature(P, lead, { fresh: lead.date >= addDays(P.today, -7), tag: 'h2' })}<div class="nl">${side.map((n, i) => newsItem(P, n, i)).join('')}</div></div>
      ${more.length ? `<div class="ncards">${more.map((n) => newsFeature(P, n)).join('')}</div>` : ''}`
    : `<div class="empty"><p class="h3">Nada no radar por enquanto.</p><p>Edital, festival, estreia, inscrições abertas: a LLama Lab conta tudo por aqui. Tem uma pauta? Manda pra gente.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Sugerir pauta <span class="arr">→</span></a></div>`;
  const main = `${pageHero(P, { crumbs: [['Radar Cultural']], eyebrow: 'Últimas do rolê', title: 'Radar Cultural', lead: 'Editais, festivais, estreias e oportunidades da cena cultural de Dourados.' })}
<section class="panel light sec"><div class="wrap">${content}</div></section>`;
  return layout(P, { title: 'Radar Cultural', description: 'Radar Cultural da LLama Lab: editais, festivais, estreias e oportunidades da cena cultural de Dourados.', current: 'noticias', main, edit: 'noticias' });
}

export function newsPage(P, n) {
  const others = P.news.filter((x) => x.id !== n.id).slice(0, 3);
  const showLede = n.summary && !sameStart(n.summary, n.body);
  const main = `${pageHero(P, {
    crumbs: [['Radar Cultural', P.href('radar-cultural/')], [excerpt(n.title, 40)]],
    eyebrow: [n.kicker, fmtLong(n.date), n.author && `por ${n.author}`].filter(Boolean).join(' · '),
    title: n.title,
    titleClass: titleSize(n.title, 40, 80),
    lead: showLede ? n.summary : '',
  })}
<section class="panel light sec">
  ${n.image && n.image.src ? `<figure class="wrap" style="max-width:1040px;margin:0 auto clamp(40px,5vw,70px)"><div class="media wide">${img(P, n.image, { eager: true })}</div>${n.image.credit || n.image.alt ? `<figcaption style="margin-top:14px;font-size:14px;color:#6b6b6b">${esc([n.image.alt, n.image.credit && `Foto: ${n.image.credit}`].filter(Boolean).join(' · '))}</figcaption>` : ''}</figure>` : ''}
  <div class="detail">
    <div class="prose dropcap">${md(P, n.body)}</div>
    <aside class="aside">${shareBox(P, n.title, P.canonical)}<div class="box k"><b>Radar Cultural</b><a href="${P.href('radar-cultural/')}">Tudo no Radar →</a></div></aside>
  </div>
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais do Radar</h2><a class="link" href="${P.href('radar-cultural/')}">Ver tudo →</a></div><div class="ncards" style="margin-top:0">${others.map((x) => newsFeature(P, x)).join('')}</div></div>` : ''}
</section>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: n.title,
    datePublished: n.date,
    ...(n.image && n.image.src ? { image: [P.absSrc(n.image.src)] } : {}),
    author: n.author ? { '@type': 'Person', name: n.author } : { '@type': 'Organization', name: 'LLama Lab' },
    publisher: { '@type': 'Organization', name: 'LLama Lab' },
  };
  return layout(P, { title: n.title, description: n.summary || stripMarkdown(n.body), image: n.image, type: 'article', current: 'noticias', main, head: jsonLd(ld), edit: `noticias/${n.id}` });
}

/* ================= ENTREVISTAS ================= */

export function interviewsPage(P) {
  const feat = P.interviews.find((it) => it.featured) || P.interviews[0];
  const rest = P.interviews.filter((it) => it !== feat);
  const featHtml = feat ? `<div class="phero-grid" style="margin-bottom:clamp(60px,7vw,100px)">
    <div>
      <p class="eyebrow">${esc([interviewNo(P, feat), feat.area].filter(Boolean).join(' · '))} · Em destaque</p>
      ${feat.quote ? `<p class="quote-big" data-r style="margin-top:18px">“${quoteHtml(feat.quote, feat.highlight)}”</p><p class="byline" style="color:#6b6b6b">${esc(feat.name)} — ${esc(feat.title)}</p>` : `<h2 class="h2 s" data-r>${esc(feat.title)}</h2>`}
      ${feat.summary ? `<p class="lead" style="margin-top:22px;max-width:620px">${esc(excerpt(feat.summary, 260))}</p>` : ''}
      <div class="btns" style="margin-top:28px"><a class="btn btn-k" href="${interviewUrl(P, feat)}">Ler a entrevista <span class="arr">→</span></a></div>
    </div>
    <a href="${interviewUrl(P, feat)}" class="media-glow" aria-label="${esc(`${interviewNo(P, feat)} · ${feat.title}`)}"><div class="media cover">${feat.photo ? img(P, feat.photo) : ''}<span class="num">${esc(interviewNo(P, feat))}</span></div></a>
  </div>` : `<div class="empty"><p class="h3">Nenhuma entrevista por enquanto.</p><a class="btn btn-k" href="${esc(rolêLink(P, 'interview'))}" target="_blank" rel="noopener">Quero dar entrevista <span class="arr">→</span></a></div>`;
  const main = `${pageHero(P, { crumbs: [['Entrevistas']], eyebrow: 'Entrevistas', title: 'Backstage', titleClass: 'outline', lead: 'Papo reto com quem faz a cultura de Dourados acontecer: música, rap, teatro, circo, artes visuais e o que mais vier.' })}
<section class="panel light sec"><div class="wrap">
  ${featHtml}
  ${rest.length ? `<div class="more-head"><h2 class="h2 xs">Arquivo <span style="color:#888">· ${rest.length + 1}</span></h2></div>${chips(categoriesOf(rest, 'area'), 'Filtrar por área')}<div class="cards">${rest.map((it, i) => card(P, it, { reveal: true, i })).join('')}</div>` : ''}
</div></section>`;
  return layout(P, { title: 'Entrevistas', description: 'Entrevistas e perfis de artistas, bandas e produtores da cena cultural de Dourados.', current: 'entrevistas', main, edit: 'entrevistas' });
}

export function interviewPage(P, it) {
  const others = P.interviews.filter((x) => x.id !== it.id).slice(0, 3);
  const showLede = it.summary && !sameStart(it.summary, it.body);
  const firstName = String(it.name || '').split(/\s+/)[0].toUpperCase();
  const vid = youtubeId(it.video);
  const qa = (it.qa || []).filter((x) => x.q || x.a);
  const hero = `<section class="phero">
  ${stage()}
  <div class="phero-in phero-grid">
    <div>
      ${breadcrumbs(P, [['Entrevistas', P.href('entrevistas/')], [it.name || excerpt(it.title, 30)]])}
      <div class="tags">${interviewNo(P, it) ? `<span class="tag r">${esc(interviewNo(P, it))}</span>` : ''}${it.area ? `<span class="tag">${esc(it.area)}</span>` : ''}</div>
      <h1 class="h2 ${titleSize(it.title, 24, 50)}" data-split>${split(it.title)}</h1>
      ${it.role ? `<p class="lead" data-r style="--d:150ms;margin-top:22px">${esc(it.name)}${it.name ? ' — ' : ''}${esc(it.role)}</p>` : ''}
      <p class="byline">${[it.author && `por ${esc(it.author)}`, esc(fmtLong(it.date))].filter(Boolean).join(' · ')}</p>
    </div>
    ${it.photo && it.photo.src ? `<div class="media-glow" data-r style="--d:200ms"><div class="media cover">${img(P, it.photo, { eager: true })}<span class="num">${esc(interviewNo(P, it))}</span></div></div>` : ''}
  </div>
  <div class="noise"></div>
</section>`;
  const main = `${hero}
<section class="panel light sec">
  <div class="detail">
    <div>
      ${showLede ? `<p class="lead" style="font-size:clamp(19px,1.6vw,23px);color:#222;max-width:720px;margin-bottom:1.4em">${esc(it.summary)}</p>` : ''}
      ${it.quote ? `<blockquote class="pull" data-r><p class="q">“${quoteHtml(it.quote, it.highlight)}”</p>${it.name ? `<cite>— ${esc(it.name)}</cite>` : ''}</blockquote>` : ''}
      ${it.body ? `<div class="prose${it.quote ? '' : ' dropcap'}">${md(P, it.body)}</div>` : ''}
      ${qa.length ? `<div class="qa-full">${qa.map((x) => `<div><p class="q"><b>LLAMA</b>${esc(x.q)}</p><p class="a"><b>${esc(firstName || 'RESPOSTA')}</b>${esc(x.a).replace(/\n/g, '<br>')}</p></div>`).join('')}</div>` : ''}
      ${vid ? `<div class="video"><a class="yt" href="https://www.youtube.com/watch?v=${vid}" data-yt="${vid}" target="_blank" rel="noopener" aria-label="Ver o vídeo: ${esc(it.title)}"><img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="yt-play" aria-hidden="true"></span></a></div>` : it.video ? `<p class="linkrow"><a class="btn btn-k" href="${esc(it.video)}" target="_blank" rel="noopener">Assistir ao vídeo <span class="arr">→</span></a></p>` : ''}
      ${(it.links || []).length ? `<div class="linkrow">${it.links.map((l, i) => `<a class="btn ${i ? 'btn-ghost' : 'btn-k'} btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span class="arr">↗</span></a>`).join('')}</div>` : ''}
    </div>
    <aside class="aside">${shareBox(P, it.title, P.canonical)}<div class="box k"><b>Backstage</b><a href="${P.href('entrevistas/')}">Todas as entrevistas →</a></div></aside>
  </div>
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais entrevistas</h2><a class="link" href="${P.href('entrevistas/')}">Ver todas →</a></div><div class="cards">${others.map((x, i) => card(P, x, { reveal: true, i })).join('')}</div></div>` : ''}
</section>`;
  return layout(P, { title: it.title, description: it.summary || it.role || stripMarkdown(it.body), image: it.photo, type: 'article', current: 'entrevistas', main, edit: `entrevistas/${it.id}` });
}

/* ================= ARTISTAS (the catalog of local artists) ================= */

export function artistsPage(P) {
  const list = P.artists;
  const content = list.length
    ? `${chips(categoriesOf(list, 'area'), 'Filtrar por área')}<div class="cards">${list.map((it, i) => card(P, it, { artist: true, reveal: true, i })).join('')}</div>`
    : '<div class="empty"><p class="h3">Nenhum artista por enquanto.</p></div>';
  const main = `${pageHero(P, { crumbs: [['Artistas']], eyebrow: 'Quem faz a cena', title: 'Artistas', lead: 'Música, rap, circo, fotografia e artes visuais: quem faz a cultura de Dourados e região, e o que cada um faz.' })}
<section class="panel light sec"><div class="wrap">${content}</div></section>`;
  return layout(P, { title: 'Artistas', description: 'Catálogo dos artistas de Dourados e região: música, rap, circo, fotografia, artes visuais e mais.', current: 'artistas', main, edit: 'artistas' });
}

// An artist's profile: an interview's page, without what only interviews have. The role alone
// under the name, and the author without a date.
export function artistPage(P, it) {
  const showLede = it.summary && !sameStart(it.summary, it.body);
  const vid = youtubeId(it.video);
  // more artists: the same area first, then the ones after this one in the catalog
  const at = P.artists.findIndex((x) => x.id === it.id);
  const around = [...P.artists.slice(at + 1), ...P.artists.slice(0, Math.max(0, at))];
  const others = [...around.filter((x) => it.area && x.area === it.area), ...around.filter((x) => !it.area || x.area !== it.area)].slice(0, 3);
  const hero = `<section class="phero">
  ${stage()}
  <div class="phero-in phero-grid">
    <div>
      ${breadcrumbs(P, [['Artistas', P.href('artistas/')], [it.name]])}
      <div class="tags">${it.area ? `<span class="tag">${esc(it.area)}</span>` : ''}</div>
      <h1 class="h2 ${titleSize(it.name, 24, 50)}" data-split>${split(it.name)}</h1>
      ${it.role ? `<p class="lead" data-r style="--d:150ms;margin-top:22px">${esc(it.role)}</p>` : ''}
      ${it.author ? `<p class="byline">por ${esc(it.author)}</p>` : ''}
    </div>
    ${it.photo && it.photo.src ? `<div class="media-glow" data-r style="--d:200ms"><div class="media cover">${img(P, it.photo, { eager: true })}</div></div>` : ''}
  </div>
  <div class="noise"></div>
</section>`;
  const main = `${hero}
<section class="panel light sec">
  <div class="detail">
    <div>
      ${showLede ? `<p class="lead" style="font-size:clamp(19px,1.6vw,23px);color:#222;max-width:720px;margin-bottom:1.4em">${esc(it.summary)}</p>` : ''}
      ${it.body ? `<div class="prose dropcap">${md(P, it.body)}</div>` : ''}
      ${vid ? `<div class="video"><a class="yt" href="https://www.youtube.com/watch?v=${vid}" data-yt="${vid}" target="_blank" rel="noopener" aria-label="Ver o vídeo: ${esc(it.name)}"><img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="yt-play" aria-hidden="true"></span></a></div>` : it.video ? `<p class="linkrow"><a class="btn btn-k" href="${esc(it.video)}" target="_blank" rel="noopener">Assistir ao vídeo <span class="arr">→</span></a></p>` : ''}
      ${(it.links || []).length ? `<div class="linkrow">${it.links.map((l, i) => `<a class="btn ${i ? 'btn-ghost' : 'btn-k'} btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span class="arr">↗</span></a>`).join('')}</div>` : ''}
    </div>
    <aside class="aside">${shareBox(P, it.name, P.canonical)}<div class="box k"><b>Artistas</b><a href="${P.href('artistas/')}">Todos os artistas →</a></div></aside>
  </div>
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais artistas</h2><a class="link" href="${P.href('artistas/')}">Ver todos →</a></div><div class="cards">${others.map((x, i) => card(P, x, { artist: true, reveal: true, i })).join('')}</div></div>` : ''}
</section>`;
  return layout(P, { title: it.name, description: it.summary || it.role || stripMarkdown(it.body), image: it.photo, type: 'profile', current: 'artistas', main, edit: `artistas/${it.id}` });
}

/* ================= SOBRE / CONTRATE / 404 ================= */

export function sobrePage(P) {
  const s = P.data.sobre || {};
  const c = P.site.contact || {};
  const main = `${pageHero(P, { crumbs: [['Sobre']], eyebrow: 'Quem é a LLama', title: s.title || 'Sobre', titleClass: titleSize(s.title || '', 14, 30), lead: s.lead })}
<section class="panel light sec">
  <div class="detail">
    <div class="prose dropcap">${md(P, s.body)}</div>
    <aside class="aside">
      ${s.image && s.image.src ? `<div class="media wide">${img(P, s.image, { cls: 'bw' })}</div>` : ''}
      <div class="box k"><b>Fala com a gente</b>${c.whatsapp ? `<a href="${esc(waLink(c.whatsapp))}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ''}${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.instagram ? `<a href="https://instagram.com/${esc(c.instagram)}" target="_blank" rel="noopener">@${esc(c.instagram)}</a>` : ''}</div>
    </aside>
  </div>
</section>`;
  return layout(P, { title: s.title || 'Sobre', description: s.lead || stripMarkdown(s.body), image: s.image, current: 'sobre', main, edit: 'sobre' });
}

export function contratePage(P) {
  const s = P.data.contrate || {};
  const link = waLink((P.site.contact || {}).whatsapp, s.ctaMessage) || rolêLink(P);
  const services = (s.services || []).filter((x) => x.title);
  const main = `${pageHero(P, { crumbs: [['Contrate']], eyebrow: 'Bora trabalhar junto?', title: s.title || 'Contrate', titleClass: titleSize(s.title || '', 14, 30), lead: s.lead })}
<section class="panel light sec"><div class="wrap">
  ${services.length ? `<ol class="services">${services.map((x, i) => `<li data-r style="--d:${(i % 2) * 120}ms"><h2>${esc(x.title)}</h2>${x.text ? `<p>${esc(x.text)}</p>` : ''}</li>`).join('')}</ol>` : ''}
  ${s.body ? `<div class="prose" style="margin-top:clamp(40px,5vw,70px)">${md(P, s.body)}</div>` : ''}
  <div class="pull" style="margin-top:clamp(50px,6vw,80px);display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between"><p class="q" style="max-width:720px">${esc(s.ctaText || 'Conta pra gente o que você precisa.')}</p><a class="btn btn-red" href="${esc(link)}" target="_blank" rel="noopener">${esc(s.ctaLabel || 'Chamar no WhatsApp')} <span class="arr">→</span></a></div>
</div></section>`;
  return layout(P, { title: s.title || 'Contrate', description: s.lead || 'Serviços de divulgação cultural da LLama Lab.', current: 'contrate', main, cta: false, edit: 'contrate' });
}

export function notFoundPage(P) {
  const main = `<section class="nf404">
  ${stage()}
  <div style="position:relative;z-index:2">
    <p class="eyebrow"><span class="live"></span>Erro 404</p>
    <h1 class="h2 m" data-split>${split('Esse rolê não existe.')}</h1>
    <p class="lead" style="margin:24px 0 30px;max-width:520px">A página pode ter mudado de endereço ou saído da agenda. Volta pra capa ou dá uma olhada no que vem por aí.</p>
    <div class="btns"><a class="btn btn-solid" href="${P.href('')}">Voltar pra capa <span class="arr">→</span></a><a class="btn btn-ghost" href="${P.href('agenda/')}">Ver a agenda</a></div>
  </div>
  <div class="lla"><div class="glow"></div>${llama('')}</div>
  <div class="noise"></div>
</section>`;
  return layout(P, { title: 'Página não encontrada', main, cta: false });
}

// What the service worker (src/sw.js) shows offline for a page this device hasn't saved, at
// whatever address was asked for: its links are absolute paths, like the 404's.
export function offlinePage(P) {
  const main = `<section class="nf404">
  ${stage()}
  <div style="position:relative;z-index:2">
    <p class="eyebrow"><span class="off" aria-hidden="true"></span>Sem internet</p>
    <h1 class="h2 m" data-split>${split('Sem sinal por aqui.')}</h1>
    <p class="lead" style="margin:24px 0 30px;max-width:520px">Essa página ainda não foi salva neste aparelho. Quando a conexão voltar, ela abre normalmente.</p>
    <div class="btns"><button class="btn btn-solid" type="button" data-retry>Tentar de novo <span class="arr" aria-hidden="true">↻</span></button><a class="btn btn-ghost" href="${P.href('agenda/')}">Ver a agenda</a></div>
    <p class="saved">A capa, a agenda e as páginas que você já abriu funcionam sem internet. <b data-app-note>Com o app instalado, o site inteiro.</b></p>
  </div>
  <div class="lla"><div class="glow"></div>${llama('')}</div>
  <div class="noise"></div>
</section>`;
  return layout(P, { title: 'Sem internet', main, cta: false, bodyClass: 'offline-page', head: '<meta name="robots" content="noindex">' });
}
