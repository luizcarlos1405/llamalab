# LLama Lab

Site of LLama Lab — Como se LLama, Laboratório Criativo: the agenda, news, interviews and artists of the cultural
scene of Dourados (MS). Live at <https://luizcarlos1405.github.io/llamalab/>.

It's a static site with no server and no database. The content lives in this repository as JSON and
WebP files, GitHub Actions renders it into HTML, and GitHub Pages serves it. The team edits the content
through `/admin`, a small CMS that runs in the browser and publishes each batch of edits as one commit.

## How it fits together

```
data/*.json, images/  ──>  scripts/build.mjs  ──>  _site/  ──>  GitHub Pages
        ^                  (GitHub Actions: every push to main, and daily at 00:07 in Dourados)
        │
  /admin: edits are kept in the browser (IndexedDB) until "Publicar",
  which commits them through the GitHub API
```

- **Content** is one JSON file per type in `data/`: `agenda.json`, `noticias.json` (the Radar Cultural),
  `entrevistas.json` and `artistas.json` (arrays of items), plus `site.json` (home page, ribbons, the footer's call to action and text, contacts, the radio's stations), `sobre.json` and
  `contrate.json`. Fields are defined once in [`src/schema.js`](src/schema.js), which drives the admin forms, the
  validation and the build. Long texts use the small Markdown subset in [`src/markdown.js`](src/markdown.js).
  Entrevistas are the team's longer, journalistic pieces about someone; Artistas is a catalog of short profiles
  (background, area, main works, social links). Each type's admin list says which goes where.
- **Images** live in `images/<type>/` as WebP. The admin resizes every upload to the largest box it's shown in on
  the site, times 2 for sharp phone screens, before committing it (`IMAGE_SLOTS` in [`src/config.js`](src/config.js)).
  Portraits (interviews and artists) and news photos are cropped to their shape; flyers are kept whole. The cards
  show portraits in wider boxes, cropped around a point the editor taps on the photo in the form, with previews
  of the cards (the image's `focus`; the upper part when there's none).
- **Pages** are rendered by [`src/render/`](src/render/) at build time, so every event, news item, interview and artist has
  its own URL and link preview (Open Graph); events and news items also carry structured data. The same render code runs in the admin for the live
  preview. The build also writes `sitemap.xml`, `feed.xml` (RSS), an `.ics` file per event and `version.json`.
- **Daily rebuild:** the Actions workflow also runs every night, so events that already happened leave the home
  page and the agenda without anyone publishing.
- **Offline and installable:** a service worker keeps the site readable without internet, and the site and the
  admin can be installed as apps (see [Offline and installing](#offline-and-installing)).

## The home page's stage

The stage fits the window like a poster: the wordmark, the text, the llama and the ribbons always
fit one screen, without the ribbons covering the text. They're sized by `--u` in
[`assets/site.css`](assets/site.css), which is the window's width (`1vw`) unless the window is too
short for them. On windows wider than 16:10, then, everything follows the window's height and
centres, while the light and the ribbons still run edge to edge. The ribbons are longer than the
1440 units a 16:10 window shows for that (`ribbons()` in [`src/render/parts.js`](src/render/parts.js)),
and repeat their phrase as many times as their length needs (`data-n`, read by `site.js`). At 16:10
or taller, and on phones, the stage is as it always was.

## Motion on slower phones

The stage (beams, grain, the swaying llama, the flowing ribbons) is built to move without
redrawing: only transforms and opacity animate. Its shrinking and dimming as the page scrolls is a CSS
scroll-driven animation where the browser has them (Chrome, Edge, Safari 26), so it keeps pace with the
finger on phones; elsewhere `site.js` does it. Phones get no blur behind the nav and the pill. Devices that still can't keep up get a lighter
version: for a few seconds after a page opens, [`assets/site.js`](assets/site.js) watches how often
frames come, and if they come slowly it adds `lite` to `<html>`. Lite has no grain, no blur behind the
nav and the "Próximo rolê" pill, still llama details, and ribbons that move only with the scroll. The
choice is kept in the browser, and the next pages start light before their first paint.

To compare on a phone, add `?fx=lite` or `?fx=full` to the address; `?fx=auto` forgets the choice and
lets the page decide again.

## The radio

The team's Spotify playlists play from a radio docked at the bottom of every page ([`assets/radio.js`](assets/radio.js)):
each playlist is a station on a dial, and play/pause sits next to the bars in the nav.

- **Stations** are edited in the admin, under **Páginas → Capa e contatos → Rádio**: a short name for the dial and
  the playlist's link (in Spotify: ⋯ → Compartilhar → Copiar link da playlist). Up to 12, in the order given; the
  playlists must be public. With no stations, the radio leaves the site.
- **First visit:** a random station, kept in the browser (`localStorage`), as is the last one chosen. Nothing plays
  by itself: browsers don't allow it.
- **Spotify loads only when the visitor presses play.** Until then, the pages don't contact Spotify at all. Its player
  (the iFrame API) then takes the invite's place in the radio, which it must: it only starts playing while in sight.
- **From page to page:** once the player exists, links within the site swap the page's content instead of reloading
  it (the end of [`assets/site.js`](assets/site.js)), so the music doesn't stop. Each page sets itself up in `mount()`,
  which runs on load and after every swap.
- **Hiding:** the handle on top slides the radio below the screen and brings it back. The choice is remembered.

Worth knowing:

- Visitors who aren't logged into Spotify in that browser hear 30-second previews, and Spotify sometimes shows its
  own "Use o Spotify" invitation inside the player.
- If the music doesn't start after the visitor presses play (some browsers, Safari above all, only allow a click
  inside Spotify's player), a note points at Spotify's own ▶ button.
- The bars don't show the song's spectrum (Spotify's player gives out no audio data): they move on a beat while the
  music plays.
- Spotify's terms ask that its players aren't hidden or covered while they play. Hiding the radio does that, by
  choice. If Spotify ever objects, hiding could pause the music instead (a small change in `hide()`, in radio.js).
- Spotify publishes the iFrame API as a development build that runs its code through `eval()`, so the pages'
  Content-Security-Policy allows `'unsafe-eval'` (in [`src/render/layout.js`](src/render/layout.js)).

## Offline and installing

The site installs as an app (a PWA), **LLama Lab**, with the admin inside it: editors open it from the red pencil button,
which shows on every page once they've signed in. Its manifest is written by the build (`manifest.webmanifest`, linked
from the pages and the admin), and one service worker, [`src/sw.js`](src/sw.js), keeps both usable offline; the build
writes it to `_site/sw.js` with the list of files it may keep and a hash of each one.

Why one app and not a separate one for the admin: on Android, an installed app claims every address under its scope, and
the site's scope (the whole site) contains `/admin`. A second app there can't be installed: Chrome opens the site's app
instead ([web.dev](https://web.dev/articles/building-multiple-pwas-on-the-same-domain)). A separate admin app would need
an address of its own, outside the site's, such as a subdomain (`admin.llamalab.com.br`). The manifest's `id` is the
site's path (`/llamalab/` on github.io), since browsers read it from the domain's root.

What it keeps without internet:

- **In a browser tab:** the CSS, scripts and fonts, the home page and the agenda, and every page and image the visitor
  opens (the last 60 pages and 120 images), the page they arrived on included. That costs nothing extra: they're what the
  visitor already downloaded.
- **In the installed app:** the whole site, every page, image and `.ics` file (about 4 MB, once). Each deploy then
  downloads only the files that changed: usually one page; on a day an event ends, about 20 pages and the `.ics` files
  (~0.2 MB), as every event page lists the next ones. When the app hasn't been opened for 30 days (removed from the phone,
  say), it goes back to keeping only the essentials.
- **The admin:** its page, modules, styles and fonts, once it has been opened on that device (~130 KB).

How it behaves:

- **Pages come from the network first**, so whoever is online always gets the fresh agenda; the saved copy shows when
  there's no connection, or when the network takes more than 3.5 s. A page never saved gets an offline page ("Sem sinal
  por aqui"). Old saved pages don't show events that already happened ([`assets/site.js`](assets/site.js) removes them,
  as it always did).
- **Offline**, a note under the nav says the page is the saved copy and from when, and a toast says when the connection
  is back. The radio says it needs internet. Images never saved show a placeholder.
- **Updates** take over at once and never reload an open page (the radio keeps playing). A deploy that changes the
  admin's own code shows a banner in the admin offering to reload.
- **Installing:** where the browser can install the site (Chrome, Edge, Samsung Internet), a quiet "Instalar o app" shows
  at the end of the phone menu and in the footer, and the admin's dashboard has a card for the same app. iPhones have no
  install button for sites, so there the same buttons explain the way: Compartilhar → Adicionar à Tela de Início.

The admin without internet:

- It opens from what the device saved the last time it loaded the site: the published content and the drafts on it. It
  needs internet the first time on each device, to check the token.
- Everything that happens in the browser works: editing, image resizing, the live preview, the Instagram post.
- **Publishing waits for the connection** ("Publicar quando a conexão voltar"). Nothing publishes by itself. When the
  connection is back (the admin also tries every 30 s), it checks the token, loads what was published meanwhile and
  replays the drafts on it: an item someone else changed too counts as a conflict, as always. Then a banner invites to
  review and publish.
- The admin asks the browser to keep its data even when the device runs low on space.
- **On iPhone**, an app on the home screen keeps its own data, apart from Safari: drafts made in Safari stay in Safari,
  and editors sign in again inside the app. The installed app has no address bar, so its footer shows an "Área da equipe"
  link to the admin (only in the app, never in the browser). Install first, then use only the app.

For developers:

- `?sw=off` in the address removes the worker and what it saved, in that browser, until `?sw=on`.
- With `npm run dev`, every rebuild is a new version of the worker: a page may need a second reload to show a change,
  and the admin offers to reload. `?sw=off` avoids that while working on the site.
- The build names the site's origin next to each `'self'` in the admin's Content-Security-Policy (the meta tag in
  `admin.html`). Firefox blocks the requests of the live preview (an iframe `srcdoc`) that the worker answers when the
  policy allows them only as `'self'`, and the preview then shows without its styles.
- The icons are drawn from the llama in `assets/favicon.svg` by `node scripts/icons.mjs` (needs `rsvg-convert`), into
  `assets/icons/`. Run it again when the llama changes.
- If the worker ever misbehaves on visitors' devices, publish a `src/sw.js` that removes itself (keep the `BUILD` line,
  the build fills it in), and devices drop it on their next visit:

  ```js
  const BUILD = {};
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('llamalab-')) await caches.delete(name);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll()) client.navigate(client.url);
  })()));
  ```

## Working on it locally

Needs Node 20 or newer, no `npm install`.

```sh
npm run dev            # builds and serves http://localhost:8080, rebuilding on every change
PORT=3000 npm run dev  # another port
npm run build          # just build into _site/
```

## The admin (`/admin`)

Each editor signs in once with their name and the token you sent them. Both stay in that browser's `localStorage`.
While a token is saved, the public pages show a red pencil button in the corner. It opens **Editar esta página**
(on pages that can be edited) and **Admin**.

- **Painel** lists every unpublished change (new, edited, removed) with undo, and publishes all of them
  as one commit with a generated message. The editor's name is the commit author.
- **An outdated admin doesn't publish.** The build stamps the admin's version into `admin.html` and `version.json`
  (a hash of its page, modules and styles; content alone doesn't change it). Before publishing, the admin compares
  its own with the site's, and when the site's is newer it asks the editor to reload first; the drafts stay. An admin
  from before a change may not know a new content type or field, and would drop it: on 24/11/2026 one from before
  Artistas removed the artists' photos.
- **Agenda, Radar Cultural, Entrevistas, Artistas** list, search, filter, create, duplicate (events), edit and remove items.
  The editor shows a live preview of the real page, at desktop or phone width.
- **Páginas** edits the home page settings, the radio's stations, contacts, Sobre and Contrate.
- **Post da agenda** (Agenda → Post para o Instagram) turns the events of a date range into the "Agenda
  cultural" carousel the team posts on Instagram (see below).
- **Drafts** survive reloads and closing the tab: data and staged images are kept in IndexedDB, and so is a
  form that wasn't saved yet. Without internet the admin still opens and edits, and publishing waits for the
  connection (see [Offline and installing](#offline-and-installing)).
- **Publishing:**
  - If someone else published in the meantime, the edits are replayed on top of their version, item by item.
    Only an item both people changed counts as a conflict, and the editor picks which version stays.
  - Images that nothing points to any more are deleted in the same commit, which keeps the published site small.
  - After a publish, the admin polls `version.json` until the new version is live (usually under a minute).

### The Instagram post

The editor picks a date range and gets the carousel, drawn in the browser
([`src/admin/post-draw.js`](src/admin/post-draw.js), the screen in [`src/admin/post.js`](src/admin/post.js)):
a cover with the first day, then the events, three per image on paper cards that change colour from image to
image, as 1080 × 1350 JPEGs. Nothing is saved or published.

- Each event is its date and weekday, "name - venue", and its **Chamada** (a field of the event, also used in
  link previews) followed by its hours. Without a Chamada, the first sentence of the description goes in.
  Events can be left out with their checkbox; the cover's line is editable.
- On phones, **Compartilhar** hands the images to Instagram or to the photo gallery. Elsewhere they download as
  one .zip, or one by one. The caption (the team's usual line and the list of events) is ready to copy.
- Two pieces are stand-ins until the team sends the originals: the display font (their lettering is custom;
  [Bagel Fat One](https://fonts.google.com/specimen/Bagel+Fat+One), OFL, for now) and the crumpled paper, drawn
  by `crumple()`. To use their font, put the .woff2 in `assets/fonts/` and point `BRAND.display` at it. The
  colours are in `BRAND` too.

### Tokens

The admin talks to `api.github.com` with a personal access token, which you create and send to each editor.
The admin never mentions GitHub: the sign-in screen asks for a "token de acesso", and when one expires or
stops working it tells the editor to ask whoever looks after the site for a new one.

1. Open this pre-filled link: [new fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Admin+do+site+LLama+Lab&description=Publicar+altera%C3%A7%C3%B5es+no+site+pelo+admin+%28luizcarlos1405%2Fllamalab%29&target_name=luizcarlos1405&expires_in=366&contents=write).
   It sets **Contents: Read and write** and a one-year expiration; pick a shorter one if you prefer.
2. Under **Repository access**, choose **Only select repositories** and pick `llamalab` and `llamalab-keys`.
   The second one is private and holds the key the admin will use to upload event photos to Cloudflare R2 (#7).
3. Name it after the editor, so you can revoke one person's access without touching the others.

Only the owner of a personal account's repository can create fine-grained tokens for it, which is why the
tokens come from you. Anyone with a token can change the site: revoke it under GitHub's
**Settings → Developer settings → Personal access tokens** when someone leaves.

### Testing the admin without touching the site

Point the admin at a scratch branch from the browser console, then reload:

```js
localStorage.setItem('llamalab:branch', 'admin-test') // create the branch on GitHub first
localStorage.removeItem('llamalab:branch')            // back to main
```

A banner shows while it's active. Only pushes to `main` deploy.

## Custom domain

The site is ready to move to `llamalab.com.br`; all internal links are relative. When the old Wix site can go:

1. In the domain's DNS (currently at Wix), point the apex `A` records to GitHub Pages
   (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and `www` as a `CNAME` to
   `luizcarlos1405.github.io`.
2. Set the domain under the repository's **Settings → Pages**, and turn on **Enforce HTTPS** once the
   certificate is ready.
3. Update `defaultUrl` in [`src/config.js`](src/config.js).

Browsers keep tokens, drafts, installed apps and offline copies per address, so editors sign in again on the new
domain, and whoever installed the app installs it again from there. Publish everything before switching.
The old address keeps working for them: its service worker fetches pages from the network first, so it follows
GitHub's redirect to the new domain.

## Layout

```
admin.html            the CMS, served at /admin (loads src/admin/main.js)
assets/               CSS, the public pages' JS (site.js; radio.js for the radio), fonts (Anton, Outfit; Bagel Fat One
                      for the Instagram post), logos, icons (icons/: the app's, drawn by scripts/icons.mjs)
data/                 the content, as JSON
images/               the content's images, as WebP
scripts/build.mjs     static build; scripts/dev.mjs is the local server; scripts/icons.mjs draws the app icons
src/schema.js         content model; src/config.js holds the site settings and image sizes
src/render/           page templates, shared by the build and the admin preview
src/sw.js             the service worker (offline copies), completed by the build
src/admin/            the CMS: GitHub client, drafts store, forms, image processing, the Instagram post, the
                      connection (net.js)
.github/workflows/    build and deploy to Pages
```
