// Draws the link preview image, assets/og.png (1200 × 630): the wordmark, the llama and the home
// page's headline (`hero` in data/site.json: the title, then the highlight in red). Run it again
// when the team changes the headline:
//
//   node scripts/og.mjs
//
// It needs Playwright's Chromium: `npm i -g @playwright/cli` (or playwright-core in the project).

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { wordmark, llama } from '../src/render/svg.js';
import { esc } from '../src/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/og.png');

function playwright() {
  const places = [import.meta.url, path.join(os.homedir(), '.local/lib/node_modules/@playwright/cli/package.json')];
  for (const place of places) {
    try {
      return createRequire(place)('playwright-core');
    } catch {
      // not there: try the next place
    }
  }
  throw new Error('scripts/og.mjs needs Playwright: npm i -g @playwright/cli (with its Chromium), or playwright-core in this project.');
}

const font = async (file) => `data:font/woff2;base64,${(await fs.readFile(path.join(ROOT, 'assets/fonts', file))).toString('base64')}`;

const site = JSON.parse(await fs.readFile(path.join(ROOT, 'data/site.json'), 'utf8'));
const hero = site.hero || {};
const title = String(hero.title || '').trim();
const highlight = String(hero.highlight || '').trim();

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'Anton';font-weight:400;src:url(${await font('anton-400.woff2')}) format('woff2')}
@font-face{font-family:'Outfit';font-weight:300 800;src:url(${await font('outfit-300-800.woff2')}) format('woff2')}
body{margin:0;background:#0a0a0a;color:#fff;font-family:Outfit}
.c{position:relative;width:1200px;height:630px;overflow:hidden;background:radial-gradient(700px circle at 50% 40%,rgba(255,255,255,.10),transparent 68%),#0a0a0a}
.b{position:absolute;top:-10%;width:640px;height:125%;background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,0) 78%);clip-path:polygon(47% 0,53% 0,100% 100%,0 100%);filter:blur(12px);opacity:.5}
.wm{position:absolute;left:48px;right:48px;top:70px;width:1104px;height:auto}
.ll{position:absolute;left:50%;bottom:-40px;height:470px;width:292px;transform:translateX(-50%)}
.g{position:absolute;left:50%;top:62%;width:520px;height:520px;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(238,60,35,.62),rgba(238,60,35,.22) 32%,rgba(238,60,35,0) 62%)}
.t{position:absolute;left:48px;bottom:46px;max-width:380px;font:400 54px/.9 Anton;text-transform:uppercase}
.t span{color:#ee3c23}
.e{position:absolute;right:48px;bottom:54px;font:600 16px/1 Outfit;letter-spacing:.24em;text-transform:uppercase;color:#bbb}
</style>
<div class="c">
  <i class="b" style="left:-260px;transform:rotate(-24deg)"></i><i class="b" style="right:-260px;transform:rotate(22deg)"></i>
  ${wordmark('wm')}
  <div class="g"></div>
  <div class="ll">${llama('')}</div>
  <div class="t">${esc(title)}${title && highlight ? '<br>' : ''}${highlight ? `<span>${esc(highlight)}</span>` : ''}</div>
  <div class="e">Dourados · MS</div>
</div>`;

const { chromium } = playwright();
const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('54px Anton'), document.fonts.load('600 16px Outfit')]);
    await document.fonts.ready;
  });
  await page.locator('.c').screenshot({ path: OUT });
  console.log(`Wrote ${path.relative(ROOT, OUT)}: "${[title, highlight].filter(Boolean).join(' ')}"`);
} finally {
  await browser.close();
}
