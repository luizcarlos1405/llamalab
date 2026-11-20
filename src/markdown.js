// A small, safe Markdown subset for the long texts edited in the admin.
//
// Blocks: paragraphs (a single line break inside a paragraph is kept as a
// line break), # / ## / ### headings, > quotes, - and 1. lists, --- rules and
// images alone on a line, which become figures (the "title" is the caption).
// Inline: **bold**, *italic* or _italic_, ~~strike~~, `code`, [links](url),
// ![images](images/foo.webp) and bare https:// links.
//
// All text is HTML-escaped first; only http(s), mailto, tel and relative URLs
// survive. `ctx.url(path)` turns repository paths such as "images/foo.webp"
// into URLs for the page being rendered, and `ctx.image(path)` may return
// { w, h } so images get their intrinsic size.

import { esc, isSafeUrl } from './util.js';

const BLOCK_START = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|([-*_])(\s*\2){2,}\s*$)/;
const IMAGE_LINE = /^\s*!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)\s*$/;

export function renderMarkdown(source, ctx = {}) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length === 1 ? 2 : heading[1].length));
      out.push(`<h${level}>${inline(heading[2], ctx)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), ctx)}</blockquote>`);
      continue;
    }
    const listType = /^\s*[-*+]\s+/.test(line) ? 'ul' : /^\s*\d+[.)]\s+/.test(line) ? 'ol' : null;
    if (listType) {
      const marker = listType === 'ul' ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/;
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        if (marker.test(lines[i])) {
          items.push(lines[i].replace(marker, ''));
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      out.push(`<${listType}>${items.map((item) => `<li>${inline(item, ctx)}</li>`).join('')}</${listType}>`);
      continue;
    }
    const image = IMAGE_LINE.exec(line);
    if (image) {
      out.push(figure(image[1], image[2], image[3], ctx));
      i += 1;
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !IMAGE_LINE.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inline(buf.join('\n').trim(), ctx)}</p>`);
  }
  return out.join('\n');
}

function inline(text, ctx) {
  const tokens = [];
  const keep = (html) => `\u0001${tokens.push(html) - 1}\u0002`;
  let s = String(text);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (m, ch) => keep(esc(ch)));
  s = s.replace(/`([^`\n]+)`/g, (m, code) => keep(`<code>${esc(code)}</code>`));
  s = s.replace(/!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g, (m, alt, src) => keep(imgTag(alt, src, ctx)));
  s = s.replace(/\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"\n]*)")?\s*\)/g, (m, label, href) => keep(linkTag(href, emphasis(label), ctx)));
  s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"»”])/g, (m, pre, url) =>
    pre + keep(linkTag(url.startsWith('www.') ? `https://${url}` : url, esc(url), ctx)));
  s = emphasis(s);
  for (let round = 0; round < 4 && s.includes('\u0001'); round += 1) {
    s = s.replace(/\u0001(\d+)\u0002/g, (m, n) => tokens[+n]);
  }
  return s;
}

function emphasis(text) {
  return esc(text)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\p{L}\p{N}])\*(?=\S)([^*\n]*?\S)\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>')
    .replace(/(^|[^_\p{L}\p{N}])_(?=\S)([^_\n]*?\S)_(?![_\p{L}\p{N}])/gu, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\n/g, '<br>\n');
}

function resolve(href, ctx) {
  const url = String(href || '').trim();
  if (!isSafeUrl(url)) return '';
  return ctx.url ? ctx.url(url) : url;
}

function linkTag(href, html, ctx) {
  const url = resolve(href, ctx);
  if (!url) return html;
  const external = /^https?:\/\//i.test(url);
  return `<a href="${esc(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${html}</a>`;
}

function imgTag(alt, src, ctx) {
  const url = resolve(src, ctx);
  if (!url) return '';
  const size = ctx.image ? ctx.image(src) : null;
  const dims = size && size.w && size.h ? ` width="${size.w}" height="${size.h}"` : '';
  return `<img src="${esc(url)}" alt="${esc(alt)}"${dims} loading="lazy" decoding="async">`;
}

function figure(alt, src, caption, ctx) {
  const img = imgTag(alt, src, ctx);
  if (!img) return '';
  return `<figure class="md-fig">${img}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}
