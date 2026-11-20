// The HTML shell every public page shares.

import { esc, excerpt } from '../util.js';
import { nav, footer, symbols, radio } from './parts.js';

// Hash of the one inline script below, for the Content-Security-Policy.
const JS_FLAG = "document.documentElement.classList.add('js')";
const JS_FLAG_HASH = "'sha256-Du+OJKJSbdUgz5nrHeWWINvez6XKDDU/tyj/5c2uvwo='";

// Spotify, for the radio: radio.js loads the iFrame API from open.spotify.com, which
// loads the rest of itself from embed-cdn.spotifycdn.com and puts Spotify's player in
// an iframe from open.spotify.com. Spotify publishes that script as a development
// build that runs every module through eval(), hence 'unsafe-eval'. Our own scripts
// never evaluate strings and the pages have no visitor-submitted content; the rest of
// the policy (no inline scripts, no other script hosts) still holds.
export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${JS_FLAG_HASH} 'unsafe-eval' https://open.spotify.com https://embed-cdn.spotifycdn.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://raw.githubusercontent.com https://i.ytimg.com",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.youtube-nocookie.com https://open.spotify.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

// opts: { title, description, image, type, current, bodyClass, main, cta, edit, head }
// Admin previews leave out the page's own CSP: Firefox doesn't match 'self'
// inside an iframe srcdoc and would block the stylesheets. The preview still
// runs under the admin page's CSP, which the srcdoc inherits. Previews also
// skip the `js` class, so the entrance animations don't replay on every edit.
export function layout(P, opts) {
  const seo = P.site.seo || {};
  const siteTitle = seo.title || 'LlamaLab';
  const title = opts.title ? `${opts.title} — LlamaLab` : siteTitle;
  const description = excerpt(opts.description || seo.description || '', 200);
  const image = opts.image && opts.image.src
    ? { url: P.abs(opts.image.src), w: opts.image.w, h: opts.image.h, alt: opts.image.alt }
    : { url: P.abs('assets/og.png'), w: 1200, h: 630, alt: 'LlamaLab — cultura que faz barulho em Dourados' };
  const v = P.version ? `?v=${P.version}` : '';
  const edit = opts.edit ? ` data-edit="${esc(opts.edit)}"` : '';
  const radioHtml = radio(P);
  return `<!doctype html>
<html lang="pt-BR" data-root="${P.root}"${edit}${P.preview ? ' data-preview' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${P.preview ? '' : `<meta http-equiv="Content-Security-Policy" content="${CSP}">`}
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="canonical" href="${esc(P.canonical)}">
<meta property="og:type" content="${opts.type || 'website'}">
<meta property="og:site_name" content="LlamaLab">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(opts.title || siteTitle)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:url" content="${esc(P.canonical)}">
<meta property="og:image" content="${esc(image.url)}">
${image.w ? `<meta property="og:image:width" content="${image.w}">\n<meta property="og:image:height" content="${image.h}">` : ''}
${image.alt ? `<meta property="og:image:alt" content="${esc(image.alt)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0a0a">
<link rel="icon" href="${P.href('assets/favicon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${P.href('assets/apple-touch-icon.png')}">
<link rel="alternate" type="application/rss+xml" title="LlamaLab" href="${P.href('feed.xml')}">
<link rel="preload" href="${P.href('assets/fonts/anton-400.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${P.href('assets/fonts/outfit-300-800.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${P.href('assets/fonts.css')}${v}">
<link rel="stylesheet" href="${P.href('assets/site.css')}${v}">
${P.preview ? '' : `<script>${JS_FLAG}</script>`}
<script src="${P.href('assets/site.js')}${v}" defer></script>
${radioHtml ? `<script src="${P.href('assets/radio.js')}${v}" defer></script>` : ''}
${opts.head || ''}
</head>
<body class="${esc(opts.bodyClass || '')}">
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
${symbols}
${nav(P, opts.current)}
${opts.before || ''}
<main id="conteudo">
${opts.main}
${footer(P, { withCta: opts.cta !== false })}
</main>
${radioHtml}
</body>
</html>
`;
}
