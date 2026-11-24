// The HTML shell every public page shares.

import { esc, excerpt } from '../util.js';
import { nav, footer, symbols, radio } from './parts.js';

// The one inline script, before the first paint: marks that JS runs, and applies the
// lighter effects a slow device was found to need (site.js decides and remembers it;
// ?fx=lite, ?fx=full or ?fx=auto in the address force or forget it). Its hash goes in
// the Content-Security-Policy: change one, change the other (the build checks).
export const JS_FLAG = "(function(h){h.classList.add('js');try{var k='llamalab:fx',m=/[?&]fx=(lite|full|auto)/.exec(location.search);if(m){if(m[1]=='auto')localStorage.removeItem(k);else localStorage.setItem(k,m[1])}if(localStorage.getItem(k)=='lite')h.classList.add('lite')}catch(e){}})(document.documentElement)";
export const JS_FLAG_HASH = "'sha256-3CmV8y6zk5rlu+XrVwqjcbhj1yNox0+EZYAPeTzDLfE='";

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
// runs under the admin page's CSP, which the srcdoc inherits (with the site's
// origin named next to 'self', for the same reason: see nameOriginInAdminCsp
// in scripts/build.mjs). Previews also
// skip the `js` class, so the entrance animations don't replay on every edit.
export function layout(P, opts) {
  const seo = P.site.seo || {};
  const siteTitle = String(seo.title || '').trim() || 'LLama Lab';
  const title = opts.title ? `${opts.title} — LLama Lab` : siteTitle;
  const description = excerpt(opts.description || seo.description || '', 200);
  const image = opts.image && opts.image.src
    ? { url: P.abs(opts.image.src), w: opts.image.w, h: opts.image.h, alt: opts.image.alt }
    : { url: P.abs('assets/og.png'), w: 1200, h: 630, alt: 'LLama Lab — cultura que faz barulho em Dourados' };
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
<meta property="og:site_name" content="LLama Lab">
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
${P.preview ? '' : `<link rel="manifest" href="${P.href('manifest.webmanifest')}">\n<meta name="apple-mobile-web-app-title" content="LLama Lab">`}
<link rel="alternate" type="application/rss+xml" title="LLama Lab" href="${P.href('feed.xml')}">
<link rel="preload" href="${P.href('assets/fonts/anton-400.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${P.href('assets/fonts/outfit-300-800.woff2')}" as="font" type="font/woff2" crossorigin>
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
<div id="pagina">
${opts.before || ''}
<main id="conteudo">
${opts.main}
${footer(P, { withCta: opts.cta !== false })}
</main>
</div>
${radioHtml}
</body>
</html>
`;
}
