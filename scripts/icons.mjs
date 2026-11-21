#!/usr/bin/env node
// Draws the installed app's icons from the llama in assets/favicon.svg and saves them as
// PNGs in assets/icons/. Needs rsvg-convert (librsvg).
// Run it again when the llama changes; the build doesn't, so it needs nothing extra.
//
//   node scripts/icons.mjs

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/icons');

// The favicon's square is "-40 -6 200 200", with the head in it as translate(6 10) scale(.93).
const favicon = await fs.readFile(path.join(ROOT, 'assets/favicon.svg'), 'utf8');
const head = favicon.slice(favicon.indexOf('<g transform'), favicon.lastIndexOf('</svg>'));

// bg: the tile; glow: the light behind the head; accent: glasses, tuft and earring.
const LOOKS = {
  site: { bg: '#0a0a0a', glow: '#5c1307', accent: '#ee3c23' },
};

// round: corner radius in the square's units (0 = full bleed, what phones crop themselves).
// scale and dy: the head around the square's centre; maskable icons keep it in the safe circle.
function svg({ bg, glow, accent }, { round = 0, scale = 1, dy = 0 }) {
  const art = head.replaceAll('fill:#ee3c23', `fill:${accent}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -6 200 200">
<defs>
<radialGradient id="g" cx="60" cy="98" r="104" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${glow}"/><stop offset=".62" stop-color="${glow}" stop-opacity=".25"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
<clipPath id="c"><rect x="-40" y="-6" width="200" height="200" rx="${round}"/></clipPath>
</defs>
<g clip-path="url(#c)"><rect x="-40" y="-6" width="200" height="200" fill="${bg}"/><rect x="-40" y="-6" width="200" height="200" fill="url(#g)"/>
<g transform="translate(60 ${94 + dy}) scale(${scale}) translate(-60 -94)">${art}</g></g>
</svg>`;
}

const ANY = { round: 44 };
const MASKABLE = { scale: 0.8, dy: 6 };
const ICONS = [
  ['site-192.png', 'site', ANY, 192],
  ['site-512.png', 'site', ANY, 512],
  ['site-maskable-512.png', 'site', MASKABLE, 512],
];

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'llamalab-icons-'));
await fs.mkdir(OUT, { recursive: true });
try {
  for (const [file, look, shape, size] of ICONS) {
    const src = path.join(tmp, `${file}.svg`);
    await fs.writeFile(src, svg(LOOKS[look], shape));
    execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', path.join(OUT, file), src]);
    const { size: bytes } = await fs.stat(path.join(OUT, file));
    console.log(`assets/icons/${file}  ${size}×${size}  ${Math.round(bytes / 1024)} KB`);
  }
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
