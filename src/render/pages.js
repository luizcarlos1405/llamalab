// Every public page. Each function takes a page context (see context.js) and
// returns a complete HTML document.

import { esc, excerpt, stripMarkdown, fmtShort, fmtLong, fmtWeekdayLong, fmtTime, fmtHours, eventStop, weekday, WEEKDAYS, parseDate, monthLabel, isUpcoming, splitList, youtubeId, addDays, capitalize, waLink, MONTHS } from '../util.js';
import { renderMarkdown } from '../markdown.js';
import { SITE } from '../config.js';
import { layout } from './layout.js';
import {
  split, ribbons, stage, pageHero, breadcrumbs, img, row, posterFollower, calendar, calendarList, eventUrl, eventLine, card, interviewUrl, interviewNo,
  quoteHtml, newsFeature, newsItem, chips, categoriesOf, shareBox, badge, rolêLink, llama, wordmark, hash,
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
  const hero = `<section class="hero" id="top">
  <div class="hero-in">
    ${stage()}<div class="floor"></div>
    <div class="hero-wm">${wordmark('')}</div>
    <div class="hero-l">
      <p class="eyebrow"><span class="live"></span>${esc(h.eyebrow || 'Agenda cultural · Dourados–MS')}</p>
      <h1 class="h1">${esc(h.title || 'Cultura que faz')} <span class="red">${esc(h.highlight || 'barulho.')}</span></h1>
      ${nextHtml}
    </div>
    <div class="hero-r">
      ${h.text ? `<p class="lead">${esc(h.text)}</p>` : ''}
      <div class="btns"><a class="btn btn-solid" href="${P.href('agenda/')}">Ver agenda <span class="arr">→</span></a><a class="btn btn-ghost" href="${P.href('entrevistas/')}">Entrevistas</a></div>
    </div>
    <div class="hero-llama"><div class="rise"><div class="glow"></div>${llama('')}</div></div>
    ${ribbons(r.top, r.bottom)}
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
    : `<div class="empty" data-r><p class="h3">Nenhum rolê marcado por enquanto.</p><p>Tem show, peça, sarau ou feira vindo aí? Manda pra gente que a LlamaLab coloca na agenda.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Enviar meu evento <span class="arr">→</span></a></div>
      ${recent.length ? `<div class="month-h" style="margin-top:clamp(50px,6vw,80px)"><h2>Já rolou</h2><span>ARQUIVO</span></div><div class="dates-wrap"><ol class="dates">${recent.map((ev, i) => row(P, ev, i, { past: true })).join('')}</ol>${posterFollower()}</div>` : ''}`;
  return `<section class="panel light sec" id="agenda">
  <div class="sec-head">
    <div><p class="eyebrow"><span class="live"></span>Próximos rolês</p><h2 class="h2" data-split>${split('Agenda')}</h2></div>
    <div class="months" data-r>${monthChips}<a class="link" href="${P.href('agenda/')}">Calendário completo →</a></div>
  </div>
  ${body}
  ${list.length ? `<div class="agenda-foot" data-r><p>Tem evento cultural em Dourados? Manda pra gente que a LlamaLab coloca na agenda — e no volume máximo.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Enviar meu evento <span class="arr">→</span></a></div>` : ''}
</section>`;
}

function backstagePanel(P) {
  if (!P.interviews.length) return '';
  const feat = P.interviews.find((it) => it.featured) || P.interviews[0];
  const rest = P.interviews.filter((it) => it !== feat).slice(0, 5);
  return `<section class="panel dark backstage" id="backstage">
  <div class="pin">
    <div class="bs-head">
      <div><p class="eyebrow">Entrevistas</p><h2 class="h2 outline" data-split>${split('Backstage')}</h2></div>
      <p class="bs-sub" data-r>Papo reto com quem faz a cultura de Dourados acontecer — antes, durante e depois do show.</p>
    </div>
    <div class="track" id="track">
      ${card(P, feat, { feat: true })}
      ${rest.map((it) => card(P, it)).join('\n      ')}
      <a class="card end" href="${P.href('entrevistas/')}"><h3>Todas as entrevistas</h3><span class="big" aria-hidden="true">→</span></a>
    </div>
    <div class="bar"><i id="bar"></i></div>
  </div>
</section>`;
}

function newsPanel(P) {
  if (!P.news.length) return '';
  const lead = P.news.find((n) => n.featured) || P.news[0];
  const rest = P.news.filter((n) => n !== lead).slice(0, 3);
  return `<section class="panel light sec" id="noticias">
  <div class="sec-head">
    <div><p class="eyebrow">Últimas do rolê</p><h2 class="h2" data-split>${split('Notícias')}</h2></div>
    <div class="news-head-r" data-r>${badge()}</div>
  </div>
  <div class="news-grid">
    ${newsFeature(P, lead, { fresh: lead.date >= addDays(P.today, -7) })}
    <div class="nl">${rest.map((n, i) => newsItem(P, n, i)).join('')}${P.news.length > 4 ? `<a class="link" href="${P.href('noticias/')}" style="margin:24px 0 0;align-self:flex-start">Todas as notícias →</a>` : ''}</div>
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
  const empty = `<div class="empty"><p class="h3">Nenhum rolê marcado por enquanto.</p><p>Tem show, peça, sarau ou feira vindo aí? Manda pra gente que a LlamaLab coloca na agenda.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Enviar meu evento <span class="arr">→</span></a></div>`;
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
  <div class="wrap agenda-foot"><p>Tem evento cultural em Dourados? Manda pra gente que a LlamaLab coloca na agenda — e no volume máximo.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Enviar meu evento <span class="arr">→</span></a></div>
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
    ['Quando', `${esc(whenText)}${ev.time ? ` · ${esc(fmtHours(ev))}` : ''}`],
    where && ['Onde', `${esc(where)}${ev.venue || ev.address ? ` · <a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(mapQuery)}" target="_blank" rel="noopener">ver no mapa ↗</a>` : ''}`],
    ev.price && ['Entrada', esc(ev.price)],
    acts.length && ['Atrações', esc(acts.join(' · '))],
    ev.link && ['Link', `<a href="${esc(ev.link)}" target="_blank" rel="noopener">${esc(ev.linkLabel || ev.link.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0])} ↗</a>`],
  ].filter(Boolean);
  const v = hash(ev.id) % 5;
  const media = ev.image && ev.image.src
    ? `<div class="media-glow" data-r style="--d:200ms"><div class="media">${img(P, ev.image, { eager: true, alt: ev.image.alt || `Flyer de ${ev.title}` })}</div></div>`
    : `<div class="media-glow" data-r style="--d:200ms"><div class="poster on" data-v="${v}" style="position:relative;width:min(100%,380px);height:auto;aspect-ratio:25/33;scale:1;margin:0 auto"><div class="art"></div><div class="pi"><div class="pv">${esc(ev.category || 'Rolê')}</div><div><div class="pd">${String(p.d).padStart(2, '0')}</div><div class="pv" style="margin:8px 0 14px">${esc(MONTHS[p.m - 1].slice(0, 3).toUpperCase())} · ${esc(WEEKDAYS[weekday(ev.date)].slice(0, 3).toUpperCase())}</div><div class="pt">${esc(ev.title)}</div></div><div class="pv">${esc(ev.venue || 'Dourados')}</div></div></div></div>`;
  const others = P.upcoming.filter((e) => e.id !== ev.id).slice(0, 4);
  const url = P.canonical;
  const hero = `<section class="phero">
  ${stage()}
  <div class="phero-in phero-grid">
    <div>
      ${breadcrumbs(P, [['Agenda', P.href('agenda/')], [ev.title]])}
      <div class="tags">${ev.category ? `<span class="tag">${esc(ev.category)}</span>` : ''}${ev.price ? `<span class="tag r">${esc(ev.price)}</span>` : ''}${past ? '<span class="stamp-past">Já rolou</span>' : ''}</div>
      <h1 class="h2 ${titleSize(ev.title, 20, 40)}" data-split>${split(ev.title)}</h1>
      <div class="when" data-r style="--d:150ms"><b>${String(p.d).padStart(2, '0')}</b><span>${esc(MONTHS[p.m - 1])} · ${p.y}<small>${esc(WEEKDAYS[weekday(ev.date)])}${ev.time ? ` · ${esc(fmtHours(ev))}` : ''}${multi ? ` · até ${esc(fmtShort(ev.endDate, false))}` : ''}</small><small>${esc(ev.venue || ev.city || '')}</small></span></div>
      <div class="btns" data-r style="--d:250ms;margin-top:30px">
        ${ev.link ? `<a class="btn btn-red" href="${esc(ev.link)}" target="_blank" rel="noopener">${esc(ev.linkLabel || 'Mais informações')} <span class="arr">→</span></a>` : ''}
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
      <dl class="ficha">${rows.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}</dl>
      ${ev.description || ev.summary ? `<div class="prose" style="margin-top:clamp(36px,4vw,56px)">${ev.description ? md(P, ev.description) : `<p>${esc(ev.summary)}</p>`}</div>` : ''}
    </div>
    <aside class="aside">${shareBox(P, ev.title, url)}${past ? '' : `<div class="box"><b>Salvar</b><a href="${esc(googleCalendarLink(ev))}" target="_blank" rel="noopener">Google Agenda ↗</a><a href="${P.href(`agenda/${ev.id}/evento.ics`)}" download>Apple, Outlook (.ics)</a></div>`}<div class="box k"><b>Agenda</b><a href="${P.href('agenda/')}">Todos os rolês →</a></div></aside>
  </div>
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
    ...(ev.image && ev.image.src ? { image: [P.abs(ev.image.src)] } : {}),
    description: excerpt(ev.summary || stripMarkdown(ev.description) || eventLine(ev) || ev.title, 300),
    url,
    organizer: { '@type': 'Organization', name: 'LlamaLab', url: P.abs('') },
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

/* ================= NOTÍCIAS ================= */

export function newsListPage(P) {
  const lead = P.news.find((n) => n.featured) || P.news[0];
  const rest = P.news.filter((n) => n !== lead);
  const side = rest.slice(0, 3);
  const more = rest.slice(3);
  const content = P.news.length
    ? `<div class="news-grid">${newsFeature(P, lead, { fresh: lead.date >= addDays(P.today, -7), tag: 'h2' })}<div class="nl">${side.map((n, i) => newsItem(P, n, i)).join('')}</div></div>
      ${more.length ? `<div class="ncards">${more.map((n) => newsFeature(P, n)).join('')}</div>` : ''}`
    : `<div class="empty"><p class="h3">Nenhuma notícia por enquanto.</p><p>Edital, festival, estreia, inscrições abertas: a LlamaLab conta tudo por aqui. Tem uma pauta? Manda pra gente.</p><a class="btn btn-k" href="${esc(rolêLink(P))}" target="_blank" rel="noopener">Sugerir pauta <span class="arr">→</span></a></div>`;
  const main = `${pageHero(P, { crumbs: [['Notícias']], eyebrow: 'Últimas do rolê', title: 'Notícias', lead: 'Editais, festivais, estreias e oportunidades da cena cultural de Dourados.' })}
<section class="panel light sec"><div class="wrap">${content}</div></section>`;
  return layout(P, { title: 'Notícias', description: 'Notícias da cena cultural de Dourados: editais, festivais, estreias e oportunidades.', current: 'noticias', main, edit: 'noticias' });
}

export function newsPage(P, n) {
  const others = P.news.filter((x) => x.id !== n.id).slice(0, 3);
  const showLede = n.summary && !sameStart(n.summary, n.body);
  const main = `${pageHero(P, {
    crumbs: [['Notícias', P.href('noticias/')], [excerpt(n.title, 40)]],
    eyebrow: [n.kicker, fmtLong(n.date), n.author && `por ${n.author}`].filter(Boolean).join(' · '),
    title: n.title,
    titleClass: titleSize(n.title, 40, 80),
    lead: showLede ? n.summary : '',
  })}
<section class="panel light sec">
  ${n.image && n.image.src ? `<figure class="wrap" style="max-width:1040px;margin:0 auto clamp(40px,5vw,70px)"><div class="media wide">${img(P, n.image, { eager: true })}</div>${n.image.credit || n.image.alt ? `<figcaption style="margin-top:14px;font-size:14px;color:#777">${esc([n.image.alt, n.image.credit && `Foto: ${n.image.credit}`].filter(Boolean).join(' · '))}</figcaption>` : ''}</figure>` : ''}
  <div class="detail">
    <div class="prose dropcap">${md(P, n.body)}</div>
    <aside class="aside">${shareBox(P, n.title, P.canonical)}<div class="box k"><b>Notícias</b><a href="${P.href('noticias/')}">Todas as notícias →</a></div></aside>
  </div>
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais notícias</h2><a class="link" href="${P.href('noticias/')}">Ver todas →</a></div><div class="ncards" style="margin-top:0">${others.map((x) => newsFeature(P, x)).join('')}</div></div>` : ''}
</section>`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: n.title,
    datePublished: n.date,
    ...(n.image && n.image.src ? { image: [P.abs(n.image.src)] } : {}),
    author: n.author ? { '@type': 'Person', name: n.author } : { '@type': 'Organization', name: 'LlamaLab' },
    publisher: { '@type': 'Organization', name: 'LlamaLab' },
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
      ${feat.quote ? `<p class="quote-big" data-r style="margin-top:18px">“${quoteHtml(feat.quote, feat.highlight)}”</p><p class="byline" style="color:#777">${esc(feat.name)} — ${esc(feat.title)}</p>` : `<h2 class="h2 s" data-r>${esc(feat.title)}</h2>`}
      ${feat.summary ? `<p class="lead" style="margin-top:22px;max-width:620px">${esc(excerpt(feat.summary, 260))}</p>` : ''}
      <div class="btns" style="margin-top:28px"><a class="btn btn-k" href="${interviewUrl(P, feat)}">Ler a entrevista <span class="arr">→</span></a></div>
    </div>
    <a href="${interviewUrl(P, feat)}" class="media-glow" aria-label="${esc(feat.title)}"><div class="media cover">${feat.photo ? img(P, feat.photo) : ''}<span class="num">${esc(interviewNo(P, feat))}</span></div></a>
  </div>` : `<div class="empty"><p class="h3">Nenhuma entrevista por enquanto.</p><a class="btn btn-k" href="${esc(rolêLink(P, 'interview'))}" target="_blank" rel="noopener">Quero dar entrevista <span class="arr">→</span></a></div>`;
  const main = `${pageHero(P, { crumbs: [['Entrevistas']], eyebrow: 'Entrevistas', title: 'Backstage', titleClass: 'outline', lead: 'Papo reto com quem faz a cultura de Dourados acontecer: música, rap, teatro, circo, artes visuais e o que mais vier.' })}
<section class="panel light sec"><div class="wrap">
  ${featHtml}
  ${rest.length ? `<div class="more-head"><h2 class="h2 xs">Arquivo <span style="color:#999">· ${rest.length + 1}</span></h2></div>${chips(categoriesOf(rest, 'area'), 'Filtrar por área')}<div class="cards">${rest.map((it, i) => card(P, it, { reveal: true, i })).join('')}</div>` : ''}
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
      ${vid ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${vid}" title="Vídeo: ${esc(it.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>` : it.video ? `<p class="linkrow"><a class="btn btn-k" href="${esc(it.video)}" target="_blank" rel="noopener">Assistir ao vídeo <span class="arr">→</span></a></p>` : ''}
      ${(it.links || []).length ? `<div class="linkrow">${it.links.map((l, i) => `<a class="btn ${i ? 'btn-ghost' : 'btn-k'} btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span class="arr">↗</span></a>`).join('')}</div>` : ''}
    </div>
    <aside class="aside">${shareBox(P, it.title, P.canonical)}<div class="box k"><b>Backstage</b><a href="${P.href('entrevistas/')}">Todas as entrevistas →</a></div></aside>
  </div>
  ${others.length ? `<div class="wrap" style="margin-top:clamp(70px,8vw,120px)"><div class="more-head"><h2 class="h2 xs">Mais entrevistas</h2><a class="link" href="${P.href('entrevistas/')}">Ver todas →</a></div><div class="cards">${others.map((x, i) => card(P, x, { reveal: true, i })).join('')}</div></div>` : ''}
</section>`;
  return layout(P, { title: it.title, description: it.summary || it.role || stripMarkdown(it.body), image: it.photo, type: 'article', current: 'entrevistas', main, edit: `entrevistas/${it.id}` });
}

/* ================= SOBRE / CONTRATE / 404 ================= */

export function sobrePage(P) {
  const s = P.data.sobre || {};
  const c = P.site.contact || {};
  const main = `${pageHero(P, { crumbs: [['Sobre']], eyebrow: 'Quem é a Llama', title: s.title || 'Sobre', titleClass: titleSize(s.title || '', 14, 30), lead: s.lead })}
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
  return layout(P, { title: s.title || 'Contrate', description: s.lead || 'Serviços de divulgação cultural da LlamaLab.', current: 'contrate', main, cta: false, edit: 'contrate' });
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
