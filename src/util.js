// Small helpers shared by the build (Node) and the browser (admin preview).
// No DOM access here.

import { SITE } from './config.js';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function slugify(text, max = 80) {
  const slug = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/g, '') || 'item';
}

export function uniqueSlug(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// Stable small hash, used to pick a poster style or a tilt per item.
export function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------- dates (always YYYY-MM-DD strings, local to Dourados) ---------- */

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function utcNoon(iso) {
  const p = parseDate(iso);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d, 12)) : null;
}

export function weekday(iso) {
  const date = utcNoon(iso);
  return date ? date.getUTCDay() : 0;
}

export function addDays(iso, days) {
  const date = utcNoon(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayISO(timeZone = SITE.timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const pad = (n) => String(n).padStart(2, '0');

// "21.11"
export function fmtDM(iso) {
  const p = parseDate(iso);
  return p ? `${pad(p.d)}.${pad(p.m)}` : '';
}

// "21 nov 2026"
export function fmtShort(iso, withYear = true) {
  const p = parseDate(iso);
  if (!p) return '';
  return `${pad(p.d)} ${MONTHS_SHORT[p.m - 1]}${withYear ? ` ${p.y}` : ''}`;
}

// "21 de novembro de 2026"
export function fmtLong(iso, withYear = true) {
  const p = parseDate(iso);
  if (!p) return '';
  return `${p.d} de ${MONTHS[p.m - 1]}${withYear ? ` de ${p.y}` : ''}`;
}

// "sábado, 21 de novembro"
export function fmtWeekdayLong(iso, withYear = false) {
  return iso ? `${WEEKDAYS[weekday(iso)]}, ${fmtLong(iso, withYear)}` : '';
}

export function fmtTime(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!m) return '';
  return m[2] === '00' ? `${+m[1]}h` : `${+m[1]}h${m[2]}`;
}

// An event's hours: "21h", or "16h às 23h30" when it says when it ends.
export function fmtHours(event) {
  const start = fmtTime(event.time);
  const end = start ? fmtTime(event.endTime) : '';
  return end ? `${start} às ${end}` : start;
}

export function monthLabel(y, m) {
  return `${capitalize(MONTHS[m - 1])} ${y}`;
}

export function capitalize(text) {
  const s = String(text || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Event spans: is the event still on (today between start and end)?
export function eventEnd(event) {
  return event.endDate && event.endDate > event.date ? event.endDate : event.date;
}

export function isUpcoming(event, today) {
  return eventEnd(event) >= today;
}

// When an event with a start time ends, for calendars: its end time on its last
// day (the next day when that's earlier than the start: it goes past midnight);
// without one, three hours after the start, or 23:59 on a multi-day event's last day.
export function eventStop(event) {
  const last = eventEnd(event);
  if (/^\d{2}:\d{2}$/.test(event.endTime || '')) {
    return { date: event.endTime <= event.time ? addDays(last, 1) : last, time: event.endTime };
  }
  const [h, m] = String(event.time).split(':').map(Number);
  if (last !== event.date || h + 3 > 23) return { date: last, time: '23:59' };
  return { date: last, time: `${pad(h + 3)}:${pad(m)}` };
}

// Replaces {mes} and {ano} in editable texts.
export function fillTokens(text, today) {
  const p = parseDate(today) || { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
  return String(text || '')
    .replace(/\{Mes\}/g, capitalize(MONTHS[p.m - 1]))
    .replace(/\{mes\}/gi, MONTHS[p.m - 1])
    .replace(/\{ano\}/gi, String(p.y));
}

/* ---------- text ---------- */

export function stripMarkdown(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?–—-]+$/, '')}…`;
}

export function splitList(text) {
  return String(text || '')
    .split(/\s*(?:,|·|\||\n|\s\+\s)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------- links ---------- */

export function waLink(phone, message = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function formatPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export function youtubeId(url) {
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(String(url || ''));
  return m ? m[1] : null;
}

// A Spotify playlist link, as the app's "Copiar link da playlist" gives it:
// open.spotify.com/playlist/<id>, maybe with intl-xx/ or embed/ and a query string.
export const SPOTIFY_PLAYLIST = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})(?:[/?#]|$)/i;

export function spotifyPlaylistId(url) {
  const m = SPOTIFY_PLAYLIST.exec(String(url || '').trim());
  return m ? m[1] : null;
}

export function isSafeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//');
}

export function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Every repository path under images/ mentioned anywhere in a value.
export function imageRefs(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/images\/[\w./-]+?\.(?:webp|png|jpe?g|gif|svg|avif)/gi)) out.add(m[0]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => imageRefs(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => imageRefs(v, out));
  }
  return out;
}
