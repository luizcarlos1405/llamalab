// The agenda's Instagram carousel, drawn on a canvas the way the team's own
// "Agenda cultural" posts look: a cover, then the events three to a slide on a
// wavy paper card, 1080 × 1350 (4:5, the feed's tallest format).
//
// Two parts are stand-ins until the team sends the originals: the display font
// (their lettering is custom; Bagel Fat One for now, in BRAND.display) and the
// crumpled paper, drawn here by crumple(). The llama and the "llama lab"
// lettering are the brand's own artwork, from src/render/svg.js.

import { llama, wordmark } from '../render/svg.js';
import { parseDate, weekday, eventEnd, fmtLong, stripMarkdown, excerpt } from '../util.js';

export const W = 1080;
export const H = 1350;

export const BRAND = {
  display: { family: 'Bagel Fat One', url: new URL('../../assets/fonts/bagel-fat-one-400.woff2', import.meta.url).href },
  text: 'Outfit',
  night: '#121112',
  red: '#ee3c23',
  deep: '#ba3729',
  ribbonInk: '#b42f1c',
  white: '#fbf6ef',
  // The event cards take turns, slide after slide.
  cards: [
    { fill: '#e4e3df', ink: '#121212', dot: '#e8452c', crease: 1 },
    { fill: '#922c20', ink: '#fbf6ef', dot: '#f3a43a', crease: 0.6 },
    { fill: '#d68d22', ink: '#fbf6ef', dot: '#e3401f', crease: 0.5 },
    { fill: '#cc3620', ink: '#fbf6ef', dot: '#f8b84a', crease: 0.55 },
  ],
};

export const DEFAULT_LINE = 'Confira o que vai rolar a partir de';

// Layout, in pixels of the 1080 × 1350 image.
const MARK = { x: W / 2, y: 54, outer: 98, inner: 70, points: 10, llama: 112 };
const HEADING = { baseline: 236, size: 124, width: 920 };
const CARD = { x: 112, y: 298, w: 856, h: 892, r: 90, amp: 22, wave: 250 };
const PAD = { top: 100, bottom: 60 };
const TEXT_W = 800;
const GAP = 46; // between two events
const PER_SLIDE = 3;
const DATE = { size: 64, min: 42, lh: 78 };
const TITLE = { size: 32, lh: 42, lines: 2 };
const BODY = { size: 32, lh: 42, lines: 3 };
const RIBBON = { y: 1282, amp: 10, wave: 264, mark: 40 };
const PILL = { cx: 652, pad: 66, h: 200, amp: 9, wave: 92, small: 36, day: 68 };
const COVER_LLAMA = { h: 300, starOuter: 124, starInner: 88 };

const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n) => String(n).padStart(2, '0');
const display = (size) => `${size}px "${BRAND.display.family}"`;
const text = (weight, size) => `${weight} ${size}px ${BRAND.text}`;

/* ---------- what each event says ---------- */

// ["19/11", "quinta"], ["28 e 29/11", "sáb e dom"], ["30/11 a 02/12", "seg a qua"]
export function dateParts(ev) {
  const a = parseDate(ev.date);
  if (!a) return ['', ''];
  const last = eventEnd(ev);
  const b = parseDate(last);
  const dm = (p) => `${pad(p.d)}/${pad(p.m)}`;
  if (last === ev.date) return [dm(a), DAYS[weekday(ev.date)]];
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
  const sameMonth = a.m === b.m && a.y === b.y;
  const join = days === 1 ? ' e ' : ' a ';
  const when = `${sameMonth ? pad(a.d) : dm(a)}${join}${dm(b)}`;
  return [when, days < 7 ? `${DAYS_SHORT[weekday(ev.date)]}${join}${DAYS_SHORT[weekday(last)]}` : ''];
}

// "21h", "09h às 16h", "16h às 23h30": hours with two digits, as the team writes
// them in the posts (the site writes 9h).
function hours(ev) {
  const fmt = (t) => {
    const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
    return m ? `${m[1]}h${m[2] === '00' ? '' : m[2]}` : '';
  };
  const start = fmt(ev.time);
  const end = start ? fmt(ev.endTime) : '';
  return end ? `${start} às ${end}` : start;
}

// The event's short line: its "Chamada", or else the first sentence of the description.
export function blurb(ev) {
  if (ev.summary && ev.summary.trim()) return ev.summary.trim();
  const plain = stripMarkdown(ev.description);
  const first = plain.split(/(?<=[.!?])\s+/)[0] || '';
  return excerpt(first.replace(/\.$/, ''), 110);
}

export function eventTitle(ev) {
  return [ev.title, ev.venue].filter(Boolean).join(' - ');
}

export function eventBody(ev) {
  return [blurb(ev), hours(ev)].filter(Boolean).join(' - ');
}

/* ---------- small drawing helpers ---------- */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Crumpled paper as a gray shading map (128 is flat), to draw with 'soft-light'
// over any colour: every fold is a short ridge or valley at a random angle that
// fades out at its ends, lit from the top left, plus a fine grain. Computed
// small and smoothed up, so the creases come out soft, like a photo of paper.
function crumple(w, h, { seed, folds, reach, length, contrast, grain }) {
  const scale = 4;
  const sw = Math.ceil(w / scale);
  const sh = Math.ceil(h / scale);
  const rand = rng(seed);
  const span = Math.hypot(sw, sh);
  const pick = ([lo, hi]) => span * (lo + rand() * (hi - lo));
  const lines = Array.from({ length: folds }, () => {
    const a = rand() * Math.PI;
    return {
      nx: Math.cos(a),
      ny: Math.sin(a),
      cx: rand() * sw,
      cy: rand() * sh,
      amp: (0.25 + rand() * 0.75) * (rand() < 0.5 ? -1 : 1),
      reach: pick(reach),
      half: pick(length) / 2,
    };
  });
  const height = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      let v = 0;
      for (const l of lines) {
        const dx = x - l.cx;
        const dy = y - l.cy;
        const dist = Math.abs(l.nx * dx + l.ny * dy);
        if (dist >= l.reach) continue;
        const along = Math.abs(l.nx * dy - l.ny * dx) / l.half;
        if (along >= 1.6) continue;
        const t = 1 - dist / l.reach;
        const fade = along <= 1 ? 1 : 1 - (along - 1) / 0.6;
        v += l.amp * l.reach * t * t * fade * fade;
      }
      height[y * sw + x] = v;
    }
  }
  const shade = new Float32Array(sw * sh);
  let sum = 0;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const i = y * sw + x;
      const gx = height[y * sw + Math.min(sw - 1, x + 1)] - height[y * sw + Math.max(0, x - 1)];
      const gy = height[Math.min(sh - 1, y + 1) * sw + x] - height[Math.max(0, y - 1) * sw + x];
      shade[i] = gx + gy;
      sum += shade[i] * shade[i];
    }
  }
  const rms = Math.sqrt(sum / shade.length) || 1;
  const small = canvas(sw, sh);
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(sw, sh);
  for (let i = 0; i < shade.length; i += 1) {
    const v = 128 + Math.max(-1, Math.min(1, shade[i] / (rms * 2.2))) * contrast;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  const full = ctx.getImageData(0, 0, w, h);
  const noise = rng(seed ^ 0x9e3779b9);
  for (let i = 0; i < full.data.length; i += 4) {
    const n = (noise() - 0.5) * grain;
    full.data[i] += n;
    full.data[i + 1] += n;
    full.data[i + 2] += n;
  }
  ctx.putImageData(full, 0, 0);
  return out;
}

// A rounded rectangle whose outline ripples `amp` px out and in, with a whole
// number of waves around it so the ends meet.
function wavyRect(ctx, x, y, w, h, { r, amp, wave, phase = 0 }) {
  const sw = Math.max(0, w - 2 * r);
  const sh = Math.max(0, h - 2 * r);
  const arc = (Math.PI / 2) * r;
  const corner = (cx, cy, from) => (t) => {
    const a = from + (t * Math.PI) / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)];
  };
  const segs = [
    [sw, (t) => [x + r + t * sw, y, 0, -1]],
    [arc, corner(x + w - r, y + r, -Math.PI / 2)],
    [sh, (t) => [x + w, y + r + t * sh, 1, 0]],
    [arc, corner(x + w - r, y + h - r, 0)],
    [sw, (t) => [x + w - r - t * sw, y + h, 0, 1]],
    [arc, corner(x + r, y + h - r, Math.PI / 2)],
    [sh, (t) => [x, y + h - r - t * sh, -1, 0]],
    [arc, corner(x + r, y + r, Math.PI)],
  ];
  const per = segs.reduce((n, [len]) => n + len, 0);
  const waves = Math.max(4, Math.round(per / wave));
  let walked = 0;
  ctx.beginPath();
  segs.forEach(([len, at], k) => {
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let i = k ? 1 : 0; i <= steps; i += 1) {
      const t = i / steps;
      const [px, py, nx, ny] = at(t);
      const off = amp * Math.sin(((walked + t * len) / per) * waves * 2 * Math.PI + phase);
      if (!k && !i) ctx.moveTo(px + nx * off, py + ny * off);
      else ctx.lineTo(px + nx * off, py + ny * off);
    }
    walked += len;
  });
  ctx.closePath();
}

function star(ctx, cx, cy, outer, inner, points, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = rotation + (i * Math.PI) / points;
    if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function fillStar(ctx, color, ...args) {
  star(ctx, ...args);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.fill();
  ctx.stroke();
}

// Greedy word wrap; line breaks typed by the editor are kept.
function wrap(ctx, value, width) {
  const out = [];
  for (const para of String(value).split(/\n+/)) {
    let line = '';
    for (const word of para.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// Wrapped into at most `max` lines of similar length, the last one cut with "…"
// when the text doesn't fit. When every sentence fits on a line of its own,
// that's where the lines break, as a designer would set it.
function fit(ctx, value, max, width = TEXT_W) {
  const lines = wrap(ctx, value, width);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = `${kept[max - 1]} ${lines[max]}`;
    while (last && ctx.measureText(`${last}…`).width > width) last = last.replace(/\s*\S+$/, '');
    kept[max - 1] = `${last.replace(/[\s.,;:!?–—-]+$/, '')}…`;
    return kept;
  }
  if (lines.length < 2 || /\n/.test(value)) return lines;
  const sentences = value.split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ý0-9"“(])/);
  if (sentences.length > 1 && sentences.length <= max && sentences.every((s) => ctx.measureText(s).width <= width)) return sentences;
  return keepNames(ctx, balance(ctx, value, width, lines.length), width);
}

// The narrowest width that keeps the same number of lines: lines of similar length.
function balance(ctx, value, width, count) {
  let lo = width / 2;
  let hi = width;
  for (let i = 0; i < 10; i += 1) {
    const mid = (lo + hi) / 2;
    if (wrap(ctx, value, mid).length <= count) hi = mid;
    else lo = mid;
  }
  return wrap(ctx, value, hi);
}

// Names stay on one line ("Bon Jovi", "Não Tem Hora"): a break inside a run of
// capitalized words moves the run's part on one side to the other line, when
// that line still fits. Short words don't end a line either.
function keepNames(ctx, lines, width) {
  const cap = (word) => /^[A-ZÀ-Ý]/.test(word || '');
  const closes = (word) => /[.!?…:;,]$/.test(word);
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i].split(' ');
    const b = lines[i + 1].split(' ');
    const end = a[a.length - 1];
    if (!cap(end) || closes(end) || !cap(b[0])) continue;
    let tail = 1;
    while (tail < a.length - 1 && cap(a[a.length - 1 - tail]) && !closes(a[a.length - 1 - tail])) tail += 1;
    let head = 1;
    while (head < b.length - 1 && !closes(b[head - 1]) && cap(b[head])) head += 1;
    const up = [...a, ...b.slice(0, head)].join(' ');
    const down = [...a.slice(a.length - tail), ...b].join(' ');
    if (head < b.length && ctx.measureText(up).width <= width) {
      lines[i] = up;
      lines[i + 1] = b.slice(head).join(' ');
    } else if (tail < a.length && ctx.measureText(down).width <= width) {
      lines[i] = a.slice(0, a.length - tail).join(' ');
      lines[i + 1] = down;
    }
  }
  // and a line doesn't end on a short word ("da", "que", "com"): it goes down
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i].split(' ');
    const end = a[a.length - 1];
    const down = `${end} ${lines[i + 1]}`;
    if (a.length > 2 && /^[a-zà-ÿ]{1,3}$/.test(end) && ctx.measureText(down).width <= width) {
      lines[i] = a.slice(0, -1).join(' ');
      lines[i + 1] = down;
    }
  }
  return lines;
}

/* ---------- artwork and fonts, loaded once ---------- */

let assets = null;

// The brand's artwork (src/render/svg.js) drawn straight onto the canvas as
// paths: no image to decode, and a canvas with only paths and text can always be
// exported (Safari refuses to export some canvases that had SVG images drawn on).
// The markup is simple: paths in groups, filled or stroked, colours as CSS
// variables, groups moved with translate().
function resolve(value, vars) {
  let v = String(value || '').trim();
  for (let i = 0; i < 6 && v.startsWith('var('); i += 1) {
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(v);
    if (!m) break;
    v = vars[m[1]] !== undefined ? vars[m[1]] : (m[2] || '').trim();
  }
  if (v === 'currentColor') v = vars.currentColor || '#000';
  return v && v !== 'none' && v !== 'transparent' ? v : null;
}

function compileArt(markup, vars, byClass = {}) {
  const doc = new DOMParser().parseFromString(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 'image/svg+xml');
  const root = doc.documentElement;
  const box = root.getAttribute('viewBox').split(/[\s,]+/).map(Number);
  const ops = [];
  const walk = (el, inherited) => {
    const own = { ...inherited };
    const set = (prop, value) => {
      if (!value) return;
      if (prop === 'fill' || prop === 'stroke') own[prop] = value;
      else if (prop === 'stroke-width') own.width = Number(value);
      else if (prop === 'stroke-linejoin') own.join = value;
    };
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-linejoin']) set(prop, el.getAttribute(prop));
    for (const decl of (el.getAttribute('style') || '').split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
    for (const cls of (el.getAttribute('class') || '').split(/\s+/)) if (byClass[cls]) Object.assign(own, byClass[cls]);
    const t = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(el.getAttribute('transform') || '');
    if (t) {
      own.tx = (inherited.tx || 0) + Number(t[1]);
      own.ty = (inherited.ty || 0) + Number(t[2]);
    }
    if (el.localName === 'path') {
      ops.push({
        path: new Path2D(el.getAttribute('d')),
        fill: resolve(own.fill || '#000', vars),
        stroke: resolve(own.stroke || 'none', vars),
        width: own.width || 1,
        join: own.join || 'miter',
        tx: own.tx || 0,
        ty: own.ty || 0,
      });
    }
    for (const child of el.children) walk(child, own);
  };
  walk(root, {});
  return { box, ops };
}

function drawArt(ctx, art, x, y, w, h) {
  const [vx, vy, vw, vh] = art.box;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / vw, h / vh);
  ctx.translate(-vx, -vy);
  for (const op of art.ops) {
    ctx.save();
    ctx.translate(op.tx, op.ty);
    if (op.fill) {
      ctx.fillStyle = op.fill;
      ctx.fill(op.path);
    }
    if (op.stroke) {
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.width;
      ctx.lineJoin = op.join;
      ctx.stroke(op.path);
    }
    ctx.restore();
  }
  ctx.restore();
}

// The site's llama with sunglasses: `lens` paints the lenses and hides the eyes.
function llamaArt({ white, line, red, lens }) {
  return compileArt(llama(''), { '--llw': white, '--llk': line, '--llr': red, '--llh': 'transparent' }, {
    'll-lens': { fill: lens },
    'll-eye': { fill: lens },
  });
}

const LLAMA_RATIO = 119.9 / 193;
const WORDMARK_RATIO = 340.8 / 67.5;

export function prepare() {
  if (!assets) {
    assets = (async () => {
      const face = new FontFace(BRAND.display.family, `url("${BRAND.display.url}") format("woff2")`);
      document.fonts.add(face);
      await Promise.all([face.load(), ...[400, 500, 600].map((w) => document.fonts.load(text(w, 40)))]);
      return {
        art: {
          cover: llamaArt({ white: '#fff', line: BRAND.night, red: BRAND.red, lens: '#2a2626' }),
          mark: llamaArt({ white: '#fff', line: BRAND.red, red: '#fff', lens: BRAND.red }),
          ribbon: compileArt(wordmark(''), { currentColor: BRAND.ribbonInk }),
        },
        night: crumple(W, H, { seed: 7, folds: 130, reach: [0.02, 0.11], length: [0.1, 0.5], contrast: 58, grain: 9 }),
        paper: crumple(W, H, { seed: 31, folds: 120, reach: [0.02, 0.1], length: [0.1, 0.45], contrast: 90, grain: 12 }),
      };
    })();
    assets.catch(() => { assets = null; });
  }
  return assets;
}

/* ---------- the slide's pieces ---------- */

function background(ctx, a) {
  ctx.fillStyle = BRAND.night;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(a.night, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

// The red band at the bottom: "llama lab ✸ llama lab ✸ …"
function ribbon(ctx, a) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) ctx.lineTo(x, RIBBON.y + RIBBON.amp * Math.sin((x / RIBBON.wave) * 2 * Math.PI + 1.2));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = BRAND.red;
  ctx.fill();
  const mid = (RIBBON.y + RIBBON.amp + H) / 2 + 2;
  const w = RIBBON.mark * WORDMARK_RATIO;
  let x = 22;
  while (x < W + 20) {
    fillStar(ctx, BRAND.ribbonInk, x, mid, 13, 6.5, 8, 0);
    x += 13 + 24;
    drawArt(ctx, a.art.ribbon, x, mid - RIBBON.mark / 2, w, RIBBON.mark);
    x += w + 24 + 13;
  }
}

function mark(ctx, a) {
  fillStar(ctx, BRAND.red, MARK.x, MARK.y, MARK.outer, MARK.inner, MARK.points);
  const w = MARK.llama * LLAMA_RATIO;
  drawArt(ctx, a.art.mark, MARK.x - w / 2, MARK.y - MARK.llama * 0.5, w, MARK.llama);
}

function heading(ctx) {
  let size = HEADING.size;
  ctx.font = display(size);
  const w = ctx.measureText('agenda cultural').width;
  if (w > HEADING.width) {
    size = Math.floor((size * HEADING.width) / w);
    ctx.font = display(size);
  }
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('agenda cultural', W / 2, HEADING.baseline);
}

function card(ctx, a, look, n) {
  wavyRect(ctx, CARD.x, CARD.y, CARD.w, CARD.h, { r: CARD.r, amp: CARD.amp, wave: CARD.wave, phase: n * 1.7 });
  ctx.save();
  ctx.clip();
  ctx.fillStyle = look.fill;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'soft-light';
  // the same sheet, turned around, so the slides don't share the same creases
  ctx.translate(n % 2 ? W : 0, n % 4 > 1 ? H : 0);
  ctx.scale(n % 2 ? -1 : 1, n % 4 > 1 ? -1 : 1);
  ctx.globalAlpha = look.crease;
  ctx.drawImage(a.paper, 0, 0);
  ctx.restore();
}

function block(ctx, b, top, look) {
  ctx.fillStyle = look.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.font = display(b.size);
  const dot = Math.round(b.size * 0.19);
  const space = Math.round(b.size * 0.24);
  const wWhen = ctx.measureText(b.when).width;
  const wDays = b.days ? ctx.measureText(b.days).width : 0;
  const total = wWhen + (b.days ? space * 2 + dot * 2 + wDays : 0);
  const baseline = top + Math.round(DATE.lh * 0.78);
  let x = (W - total) / 2;
  ctx.textAlign = 'left';
  ctx.fillText(b.when, x, baseline);
  if (b.days) {
    x += wWhen + space;
    ctx.beginPath();
    ctx.arc(x + dot, baseline - b.size * 0.3, dot, 0, Math.PI * 2);
    ctx.fillStyle = look.dot;
    ctx.fill();
    ctx.fillStyle = look.ink;
    ctx.fillText(b.days, x + dot * 2 + space, baseline);
  }
  ctx.textAlign = 'center';
  let y = top + DATE.lh + 4;
  ctx.font = text(600, TITLE.size);
  for (const line of b.title) {
    ctx.fillText(line, W / 2, y + Math.round(TITLE.lh * 0.76));
    y += TITLE.lh;
  }
  ctx.font = text(400, BODY.size);
  for (const line of b.body) {
    ctx.fillText(line, W / 2, y + Math.round(BODY.lh * 0.76));
    y += BODY.lh;
  }
}

function measureBlock(ctx, ev) {
  const [when, days] = dateParts(ev);
  let size = DATE.size;
  const width = () => {
    ctx.font = display(size);
    return ctx.measureText(when).width + (days ? ctx.measureText(days).width + size * 0.86 : 0);
  };
  while (width() > TEXT_W && size > DATE.min) size -= 2;
  ctx.font = text(600, TITLE.size);
  const title = fit(ctx, eventTitle(ev), TITLE.lines);
  ctx.font = text(400, BODY.size);
  const body = fit(ctx, eventBody(ev), BODY.lines);
  return { ev, when, days, size, title, body, height: DATE.lh + 4 + title.length * TITLE.lh + body.length * BODY.lh };
}

// Up to three events a slide, fewer when long texts would overflow the card.
function paginate(blocks) {
  const room = CARD.h - PAD.top - PAD.bottom;
  const pages = [];
  let page = [];
  let used = 0;
  for (const b of blocks) {
    if (page.length && (page.length >= PER_SLIDE || used + GAP + b.height > room)) {
      pages.push(page);
      page = [];
      used = 0;
    }
    used += (page.length ? GAP : 0) + b.height;
    page.push(b);
  }
  if (page.length) pages.push(page);
  return pages;
}

function drawEvents(ctx, a, page, n) {
  background(ctx, a);
  mark(ctx, a);
  heading(ctx);
  const look = BRAND.cards[n % BRAND.cards.length];
  card(ctx, a, look, n);
  let top = CARD.y + PAD.top;
  for (const b of page) {
    block(ctx, b, top, look);
    top += b.height + GAP;
  }
  ribbon(ctx, a);
}

function drawCover(ctx, a, { from, line }) {
  background(ctx, a);
  // "agenda / cultural", as big as the width allows
  const words = ['agenda', 'cultural'];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = display(100);
  const widest = Math.max(...words.map((w) => ctx.measureText(w).width));
  const size = Math.min(300, Math.floor((100 * (W - 88)) / widest));
  ctx.font = display(size);
  const m = words.map((w) => ctx.measureText(w));
  const base1 = 14 + m[0].actualBoundingBoxAscent;
  const base2 = base1 + m[0].actualBoundingBoxDescent + size * 0.06 + m[1].actualBoundingBoxAscent;
  ctx.fillStyle = BRAND.white;
  ctx.fillText(words[0], 44 + m[0].actualBoundingBoxLeft, base1);
  ctx.fillText(words[1], 44 + m[1].actualBoundingBoxLeft, base2);

  // the red pill: the line above and the first day
  const small = String(line ?? DEFAULT_LINE).trim().toLocaleUpperCase('pt-BR');
  const day = fmtLong(from, false);
  let smallSize = PILL.small;
  ctx.font = text(500, smallSize);
  while (small && ctx.measureText(small).width > W - 48 - PILL.pad * 2 && smallSize > 18) {
    smallSize -= 1;
    ctx.font = text(500, smallSize);
  }
  const wSmall = small ? ctx.measureText(small).width : 0;
  ctx.font = display(PILL.day);
  const wDay = ctx.measureText(day).width;
  const pw = Math.min(W - 48, Math.max(wSmall, wDay) + PILL.pad * 2);
  const ph = small ? PILL.h : 128;
  const px = Math.max(24, Math.min(W - 24 - pw, PILL.cx - pw / 2));
  const py = base2 + m[1].actualBoundingBoxDescent + 34;
  wavyRect(ctx, px, py, pw, ph, { r: ph / 2, amp: PILL.amp, wave: PILL.wave });
  ctx.fillStyle = BRAND.red;
  ctx.fill();
  ctx.fillStyle = BRAND.white;
  ctx.textAlign = 'center';
  const cx = px + pw / 2;
  if (small) {
    ctx.font = text(500, smallSize);
    ctx.fillText(small, cx, py + 78);
    ctx.font = display(PILL.day);
    ctx.fillText(day, cx, py + 152);
  } else {
    ctx.font = display(PILL.day);
    ctx.fillText(day, cx, py + 88);
  }

  // the llama on its star, centred in the room left above the ribbon
  const blockH = COVER_LLAMA.h * 0.917 + COVER_LLAMA.starOuter;
  const room = RIBBON.y - (py + ph);
  const top = py + ph + Math.max(20, (room - blockH) / 2);
  fillStar(ctx, BRAND.deep, W / 2, top + COVER_LLAMA.h * 0.917, COVER_LLAMA.starOuter, COVER_LLAMA.starInner, 10, -Math.PI / 2 + Math.PI / 10);
  const lw = COVER_LLAMA.h * LLAMA_RATIO;
  drawArt(ctx, a.art.cover, W / 2 - lw / 2, top, lw, COVER_LLAMA.h);
  ribbon(ctx, a);
}

/* ---------- the carousel ---------- */

let measurer = null;

// events: the agenda items, in order. Returns the slides, each with draw(ctx)
// and an alt text: the cover first, then the events.
export async function carousel(events, { from, line = DEFAULT_LINE } = {}) {
  const a = await prepare();
  if (!measurer) measurer = canvas(8, 8).getContext('2d');
  const pages = paginate(events.map((ev) => measureBlock(measurer, ev)));
  const day = fmtLong(from, false);
  const cover = {
    kind: 'cover',
    alt: `Agenda cultural. ${String(line || '').trim()} ${day}.`.replace(/\s+/g, ' '),
    draw: (ctx) => drawCover(ctx, a, { from, line }),
  };
  return [cover, ...pages.map((page, n) => ({
    kind: 'events',
    events: page.map((b) => b.ev),
    alt: `Agenda cultural: ${page.map((b) => `${b.when}${b.days ? ` (${b.days})` : ''}, ${eventTitle(b.ev)}, ${eventBody(b.ev)}`).join('; ')}.`,
    draw: (ctx) => drawEvents(ctx, a, page, n),
  }))];
}

// Draws a slide at full size, on the given canvas or a new one.
export function paint(slide, target = canvas(W, H)) {
  target.width = W;
  target.height = H;
  const ctx = target.getContext('2d');
  slide.draw(ctx);
  return target;
}
