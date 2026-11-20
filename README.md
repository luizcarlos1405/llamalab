# LlamaLab

Site of LlamaLab — Como se Llama, Laboratório Criativo: the agenda, interviews and news of the cultural
scene of Dourados (MS). Live at <https://luizcarlos1405.github.io/llamalab/>.

It's a static site with no server and no database. The content lives in this repository as JSON and
WebP files, GitHub Actions renders it into HTML, and GitHub Pages serves it. The team edits the content
through `/admin.html`, a small CMS that runs in the browser and publishes each batch of edits as one commit.

## How it fits together

```
data/*.json, images/  ──>  scripts/build.mjs  ──>  _site/  ──>  GitHub Pages
        ^                  (GitHub Actions: every push to main, and daily at 00:07 in Dourados)
        │
  admin.html: edits are kept in the browser (IndexedDB) until "Publicar",
  which commits them through the GitHub API
```

- **Content** is one JSON file per type in `data/`: `agenda.json`, `noticias.json` and `entrevistas.json`
  (arrays of items), plus `site.json` (home page, ribbons, footer call to action, contacts), `sobre.json` and
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

## Working on it locally

Needs Node 20 or newer, no `npm install`.

```sh
npm run dev            # builds and serves http://localhost:8080, rebuilding on every change
PORT=3000 npm run dev  # another port
npm run build          # just build into _site/
```

## The admin (`/admin.html`)

Each editor signs in once with their name and a GitHub token. Both stay in that browser's `localStorage`.
While a token is saved, the public pages show an **Admin** button, plus **Editar esta página** on pages
that can be edited.

- **Painel** lists every unpublished change (new, edited, removed) with undo, and publishes all of them
  as one commit with a generated message. The editor's name is the commit author.
- **Agenda, Notícias, Entrevistas** list, search, filter, create, duplicate (events), edit and remove items.
  The editor shows a live preview of the real page, at desktop or phone width.
- **Páginas** edits the home page settings, contacts, Sobre and Contrate.
- **Drafts** survive reloads and closing the tab: data and staged images are kept in IndexedDB, and so is a
  form that wasn't saved yet.
- **Publishing:**
  - If someone else published in the meantime, the edits are replayed on top of their version, item by item.
    Only an item both people changed counts as a conflict, and the editor picks which version stays.
  - Images that nothing points to any more are deleted in the same commit, which keeps the published site small.
  - After a publish, the admin polls `version.json` until the new version is live (usually under a minute).

### Tokens

The admin talks to `api.github.com` with a personal access token. To make one:

1. Open the link under "Como consigo um token?" on the admin's sign-in screen. It pre-fills a fine-grained
   token with **Contents: Read and write**.
2. Under **Repository access**, choose **Only select repositories** and pick `llamalab`.

GitHub only lets the owner of a personal account's repository create fine-grained tokens for it. So the owner
creates the token(s) and hands them to the team, or the repository moves to an organization the editors belong to.
Anyone with a token can change the site, so treat it like a password and revoke it in GitHub's settings when
someone leaves.

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
admin.html            the CMS (loads src/admin/main.js)
assets/               CSS, the public pages' JS, fonts (Anton, Outfit), logos, icons
data/                 the content, as JSON
images/               the content's images, as WebP
scripts/build.mjs     static build; scripts/dev.mjs is the local server
src/schema.js         content model; src/config.js holds the site settings and image sizes
src/render/           page templates, shared by the build and the admin preview
src/admin/            the CMS: GitHub client, drafts store, forms, image processing
.github/workflows/    build and deploy to Pages
```
