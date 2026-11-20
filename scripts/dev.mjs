#!/usr/bin/env node
// Local preview: builds the site, serves _site/ and rebuilds when a source
// file changes.
//
//   node scripts/dev.mjs            # http://localhost:8080/
//   PORT=3000 node scripts/dev.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const PORT = Number(process.env.PORT) || 8080;
const SITE_URL = `http://localhost:${PORT}`;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ics': 'text/calendar; charset=utf-8',
};

let building = null;
let queued = false;
async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  // A fresh process per build, so edited modules under src/ are picked up.
  building = new Promise((resolve) => {
    spawn(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit', env: { ...process.env, SITE_URL } })
      .on('exit', resolve)
      .on('error', (error) => {
        console.error(error.message);
        resolve();
      });
  });
  await building;
  building = null;
  if (queued) {
    queued = false;
    rebuild();
  }
}

await rebuild();

let timer = null;
for (const dir of ['src', 'assets', 'data', 'images', 'admin.html']) {
  const target = path.join(ROOT, dir);
  if (!fs.existsSync(target)) continue;
  fs.watch(target, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, SITE_URL);
  let file = path.join(OUT, decodeURIComponent(url.pathname));
  if (!file.startsWith(OUT)) {
    res.writeHead(403).end();
    return;
  }
  // Like GitHub Pages: /admin serves admin.html.
  if (!fs.existsSync(file) && !path.extname(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) {
      res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    file = path.join(file, 'index.html');
  }
  const found = fs.existsSync(file);
  const body = fs.readFileSync(found ? file : path.join(OUT, '404.html'));
  res.writeHead(found ? 200 : 404, {
    'Content-Type': TYPES[path.extname(found ? file : '.html')] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}).on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Try PORT=8081 npm run dev.` : error.message);
  process.exit(1);
}).listen(PORT, () => console.log(`Serving ${SITE_URL}/ (admin: ${SITE_URL}/admin). Watching for changes.`));
