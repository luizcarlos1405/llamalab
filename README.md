# LlamaLab

Site of LlamaLab — Como se Llama, Laboratório Criativo: the agenda, interviews and news of the cultural
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

- **Content** is one JSON file per type in `data/`: `agenda.json`, `noticias.json` and `entrevistas.json`
  (arrays of items), plus `site.json` (home page, ribbons, footer call to action, contacts, the radio's stations), `sobre.json` and
  `contrate.json`. Fields are defined once in [`src/schema.js`](src/schema.js), which drives the admin forms, the
  validation and the build. Long texts use the small Markdown subset in [`src/markdown.js`](src/markdown.js).
- **Images** live in `images/<type>/` as WebP. The admin resizes every upload to the largest box it's shown in on
  the site, times 2 for sharp phone screens, before committing it (`IMAGE_SLOTS` in [`src/config.js`](src/config.js)).
  Interview portraits and news photos are cropped to their shape; flyers are kept whole.
- **Pages** are rendered by [`src/render/`](src/render/) at build time, so every event, news item and interview has
  its own URL, link preview (Open Graph) and structured data. The same render code runs in the admin for the live
  preview. The build also writes `sitemap.xml`, `feed.xml` (RSS), an `.ics` file per event and `version.json`.
- **Daily rebuild:** the Actions workflow also runs every night, so events that already happened leave the home
  page and the agenda without anyone publishing.

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

## Working on it locally

Needs Node 20 or newer, no `npm install`.

```sh
npm run dev            # builds and serves http://localhost:8080, rebuilding on every change
PORT=3000 npm run dev  # another port
npm run build          # just build into _site/
```

## The admin (`/admin`)

Each editor signs in once with their name and the token you sent them. Both stay in that browser's `localStorage`.
While a token is saved, the public pages show an **Admin** button, plus **Editar esta página** on pages
that can be edited.

- **Painel** lists every unpublished change (new, edited, removed) with undo, and publishes all of them
  as one commit with a generated message. The editor's name is the commit author.
- **Agenda, Notícias, Entrevistas** list, search, filter, create, duplicate (events), edit and remove items.
  The editor shows a live preview of the real page, at desktop or phone width.
- **Páginas** edits the home page settings, the radio's stations, contacts, Sobre and Contrate.
- **Drafts** survive reloads and closing the tab: data and staged images are kept in IndexedDB, and so is a
  form that wasn't saved yet.
- **Publishing:**
  - If someone else published in the meantime, the edits are replayed on top of their version, item by item.
    Only an item both people changed counts as a conflict, and the editor picks which version stays.
  - Images that nothing points to any more are deleted in the same commit, which keeps the published site small.
  - After a publish, the admin polls `version.json` until the new version is live (usually under a minute).

### Tokens

The admin talks to `api.github.com` with a personal access token, which you create and send to each editor.
The admin never mentions GitHub: the sign-in screen asks for a "token de acesso", and when one expires or
stops working it tells the editor to ask whoever looks after the site for a new one.

1. Open this pre-filled link: [new fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Admin+do+site+LlamaLab&description=Publicar+altera%C3%A7%C3%B5es+no+site+pelo+admin+%28luizcarlos1405%2Fllamalab%29&target_name=luizcarlos1405&expires_in=366&contents=write).
   It sets **Contents: Read and write** and a one-year expiration; pick a shorter one if you prefer.
2. Under **Repository access**, choose **Only select repositories** and pick `llamalab`.
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

Browsers keep tokens and drafts per address, so editors sign in again on the new domain. Publish everything
before switching.

## Layout

```
admin.html            the CMS, served at /admin (loads src/admin/main.js)
assets/               CSS, the public pages' JS (site.js; radio.js for the radio), fonts (Anton, Outfit), logos, icons
data/                 the content, as JSON
images/               the content's images, as WebP
scripts/build.mjs     static build; scripts/dev.mjs is the local server
src/schema.js         content model; src/config.js holds the site settings and image sizes
src/render/           page templates, shared by the build and the admin preview
src/admin/            the CMS: GitHub client, drafts store, forms, image processing
.github/workflows/    build and deploy to Pages
```
