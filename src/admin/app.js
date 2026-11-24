// LLama Lab admin: edit the site's content in the browser, keep the edits as
// drafts on this device, and publish them all at once as one commit.

import { COLLECTIONS, SINGLETONS, emptyItem, normalize, validate } from '../schema.js';
import { REPO } from '../config.js';
import { todayISO, parseDate, MONTHS_SHORT, fmtHours, fmtShort, isUpcoming } from '../util.js';
import { lockup, symbols } from '../render/svg.js';
import { h, add, $, clear, toast, dialog, confirm, formatBytes, timeAgo } from './dom.js';
import { createClient, describeError, ApiError } from './github.js';
import { isPersistent } from './idb.js';
import { net, onNet, setOnline, keepData } from './net.js';
import { buildForm } from './fields.js';
import { previewPane, siteUrl } from './preview.js';
import { postView } from './post.js';
import * as store from './store.js';

const TOKEN_KEY = 'llamalab:token';
// Developers can point the admin at another branch to test publishing:
// localStorage.setItem('llamalab:branch', 'some-test-branch')
const BRANCH_KEY = 'llamalab:branch';
const EDITOR_KEY = 'llamalab:editor';
// The editor's GitHub account (id, login, name), for the commit author when the admin starts offline.
const USER_KEY = 'llamalab:user';
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const editorName = () => ls.get(EDITOR_KEY) || 'você';
const initial = () => ((ls.get(EDITOR_KEY) || '').trim().charAt(0) || '✺').toUpperCase();

const app = { gh: null, user: null, root: null, view: null, guard: null, lastHash: '' };
const clone = (v) => JSON.parse(JSON.stringify(v));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TYPE_ICON = { agenda: '✺', noticias: '✎', entrevistas: '❝', site: '⌂', sobre: 'i', contrate: '$' };
const WIFI_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M2 9.4a15 15 0 0 1 4.4-2.8M22 9.4a15 15 0 0 0-11.7-3.8M12 20h.01"/></svg>';
const WIFI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
// A request that hasn't come back after this long counts as no internet (a weak signal).
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new ApiError('network', 0)), ms))]);
const savedUser = () => {
  try {
    return JSON.parse(ls.get(USER_KEY)) || null;
  } catch {
    return null;
  }
};

/* ================= boot ================= */

export async function start() {
  document.body.insertAdjacentHTML('afterbegin', symbols);
  app.root = h('div', { class: 'app' });
  document.body.append(app.root);
  const token = ls.get(TOKEN_KEY);
  if (!token) {
    loginView();
    return;
  }
  await connect(token);
}

async function connect(token) {
  loadingView('Carregando o conteúdo do site…');
  app.gh = createClient(token, { branch: ls.get(BRANCH_KEY) || REPO.branch });
  try {
    if (!net.online) throw new ApiError('network', 0);
    app.user = await withTimeout(app.gh.user(), 10000);
    ls.set(USER_KEY, JSON.stringify({ id: app.user.id, login: app.user.login, name: app.user.name }));
    await store.init(app.gh);
    setOnline(true);
  } catch (error) {
    if (error.status === 401) {
      ls.del(TOKEN_KEY);
      loginView(describeError(error));
      return;
    }
    // No internet (or none that answers): start from what this device saved, publish later.
    if (error.status !== 0 || !await store.initOffline()) {
      errorView(error);
      return;
    }
    app.user = savedUser();
    setOnline(false);
  }
  shell();
  keepData();
  // while offline, try again now and then: a weak signal doesn't always tell the browser
  setInterval(() => {
    if (!net.online) reconnect();
  }, 30000);
  window.addEventListener('hashchange', onHash);
  window.addEventListener('beforeunload', (e) => {
    if (app.guard && app.guard()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  store.onOtherTab(async () => {
    if (app.guard && app.guard()) return;
    await store.reloadDrafts();
    route();
  });
  route();
  if (store.state.conflicts.length) conflictsDialog();
}

// The connection came back (or might have): check the token, load what was published
// meanwhile and replay the drafts on it. A form with unsaved changes keeps its data until
// it's left (route() refreshes then); publishing always checks again anyway.
let reconnecting = null;
function reconnect() {
  if (!reconnecting) {
    reconnecting = (async () => {
      try {
        const user = await withTimeout(app.gh.user(), 10000);
        app.user = user;
        ls.set(USER_KEY, JSON.stringify({ id: user.id, login: user.login, name: user.name }));
        if (app.guard && app.guard()) app.stale = true;
        else await refreshDrafts();
        app.backOnline = true;
        setOnline(true);
        app.showNet();
      } catch (error) {
        if (error.status === 401) {
          ls.del(TOKEN_KEY);
          loginView(describeError(error));
        } else if (error.status === 0 || error.status === undefined) {
          setOnline(false);
        }
      } finally {
        reconnecting = null;
      }
    })();
  }
  return reconnecting;
}

async function refreshDrafts() {
  const conflicts = await store.refresh(app.gh);
  if (conflicts.length) conflictsDialog();
}

async function reloadAdmin() {
  if (app.guard && app.guard() && !await confirm({ title: 'Recarregar o admin?', text: 'Você fez alterações que ainda não foram salvas nos rascunhos.', ok: 'Recarregar mesmo assim', danger: true })) return;
  app.guard = null;
  location.reload();
}

/* ================= login ================= */

function loginView(error = '') {
  const name = h('input', { id: 'nm', type: 'text', autocomplete: 'name', value: ls.get(EDITOR_KEY) || '', placeholder: 'Seu nome', required: true });
  const token = h('input', { id: 'tk', type: 'password', autocomplete: 'off', placeholder: 'Cole aqui o token que você recebeu', required: true, spellcheck: 'false' });
  const msg = h('p', { class: 'err', hidden: !error }, error);
  const submit = h('button', { class: 'btn btn-red', type: 'submit' }, 'Entrar ', h('span', { class: 'arr' }, '→'));
  const form = h('form', {
    class: 'login-form',
    onsubmit: async (e) => {
      e.preventDefault();
      msg.hidden = true;
      submit.disabled = true;
      submit.firstChild.textContent = 'Conferindo… ';
      try {
        const gh = createClient(token.value.trim());
        const repo = await gh.repo();
        if (repo.permissions && !repo.permissions.push) throw Object.assign(new Error('no push'), { status: 403 });
        ls.set(TOKEN_KEY, token.value.trim());
        ls.set(EDITOR_KEY, name.value.trim());
        await connect(token.value.trim());
      } catch (err) {
        msg.textContent = describeError(err);
        msg.hidden = false;
        submit.disabled = false;
        submit.firstChild.textContent = 'Entrar ';
      }
    },
  },
  h('label', { class: 'field', for: 'nm' }, h('span', { class: 'lbl' }, 'Seu nome'), name, h('span', { class: 'hint' }, 'Aparece no histórico de cada publicação.')),
  h('label', { class: 'field', for: 'tk' }, h('span', { class: 'lbl' }, 'Token de acesso'), token, h('span', { class: 'hint' }, 'Fica salvo só neste navegador. Guarde-o como uma senha.')),
  msg,
  submit);
  if (!error && !net.online) {
    msg.textContent = 'Sem internet. Para entrar pela primeira vez neste aparelho, conecte-se à internet: o token precisa ser conferido.';
    msg.hidden = false;
  }
  clear(app.root).append(h('div', { class: 'login' },
    h('div', { class: 'stage-bg', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'login-card' },
      h('div', { class: 'login-brand', html: lockup }),
      h('p', { class: 'eyebrow' }, h('i', { class: 'live' }), 'Admin do site'),
      h('h1', null, 'Bora atualizar ', h('span', { class: 'red' }, 'o site?')),
      form,
      h('p', { class: 'ask' }, 'Não tem um token ou o seu expirou? Peça a quem cuida do site.'))));
  (name.value ? token : name).focus();
}

function loadingView(text) {
  clear(app.root).append(h('div', { class: 'loading' }, h('div', { class: 'eq big', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), h('p', null, text)));
}

function errorView(error) {
  const text = error.status === 0 ? 'Sem internet. Para abrir o admin pela primeira vez neste aparelho, conecte-se à internet.' : describeError(error);
  clear(app.root).append(h('div', { class: 'loading' },
    h('p', { class: 'err' }, text),
    h('div', { class: 'btns' }, h('button', { class: 'btn btn-red', onclick: () => location.reload() }, 'Tentar de novo'), h('button', { class: 'btn btn-ghost', onclick: logout }, 'Sair'))));
}

async function logout() {
  if (store.hasChanges() && !await confirm({
    title: 'Sair do admin?',
    text: 'Você tem alterações não publicadas. Elas continuam guardadas neste navegador e voltam quando você entrar de novo.',
    ok: 'Sair mesmo assim',
  })) return;
  ls.del(TOKEN_KEY);
  ls.del(USER_KEY);
  location.hash = '';
  location.reload();
}

/* ================= shell ================= */

const TABS = [
  ['', 'Painel'],
  ['agenda', 'Agenda'],
  ['noticias', 'Radar Cultural'],
  ['entrevistas', 'Entrevistas'],
  ['paginas', 'Páginas'],
];

function shell() {
  const pubCount = h('b', { class: 'count' });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Seções do admin' }, TABS.map(([key, label]) => h('a', { href: `#/${key}`, dataset: { tab: key } }, label)));
  const avatar = h('span', { class: 'av', id: 'me-initial' }, initial());
  const menu = h('div', { class: 'menu-pop', hidden: true },
    h('p', { class: 'muted' }, 'Publicando como ', h('b', { id: 'me-name' }, editorName())),
    h('button', { type: 'button', onclick: renameEditor }, 'Mudar meu nome'),
    h('a', { href: siteUrl(), target: '_blank', rel: 'noopener' }, 'Ver o site ↗'),
    h('button', { type: 'button', onclick: logout }, 'Sair'));
  const me = h('button', { class: 'me', type: 'button', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, avatar);
  document.addEventListener('click', () => { menu.hidden = true; });
  const chip = h('span', { class: 'net-chip', hidden: true }, h('i'), 'Offline');
  const top = h('header', { class: 'top' },
    h('a', { class: 'brand', href: '#/', 'aria-label': 'Painel' }, h('span', { html: lockup }), h('span', { class: 'tag' }, 'Admin'), chip),
    tabs,
    h('div', { class: 'top-r' },
      h('a', { class: 'btn btn-red pub', href: '#/' }, 'Publicar ', pubCount),
      h('div', { class: 'me-wrap' }, me, menu)));
  app.view = h('main', { class: 'view', id: 'view' });
  const warn = isPersistent() ? null : h('div', { class: 'banner' }, 'Este navegador não deixa guardar rascunhos (janela anônima?). Publique antes de fechar a aba para não perder nada.');
  const test = app.gh.branch !== REPO.branch ? h('div', { class: 'banner' }, `Modo de teste: publicando no branch "${app.gh.branch}", não no site.`) : null;
  const offline = h('div', { class: 'banner net offline', role: 'status', hidden: true }, h('span', { html: WIFI_OFF }), h('p', null, h('b', null, 'Sem internet.'), ' Pode editar à vontade: as alterações ficam guardadas neste aparelho e você publica quando a conexão voltar.'));
  const back = h('div', { class: 'banner back', role: 'status', hidden: true });
  const update = h('div', { class: 'banner net update', role: 'status', hidden: true },
    h('p', null, h('b', null, 'O admin foi atualizado.'), ' Recarregue para usar a versão nova: seus rascunhos continuam aqui.'),
    h('button', { class: 'btn', type: 'button', onclick: reloadAdmin }, 'Recarregar'));
  add(clear(app.root), top, warn, test, update, offline, back, app.view);
  // the connection: offline, back with changes waiting to be published, a new admin
  const showNet = () => {
    chip.hidden = net.online;
    offline.hidden = net.online;
    update.hidden = !net.updated;
    const waiting = net.online && app.backOnline ? store.changes().length + store.imageChanges().added.length : 0;
    back.hidden = !waiting;
    if (!waiting) return;
    clear(back);
    add(back, h('span', { html: WIFI }),
      h('p', null, h('b', null, 'A conexão voltou.'), ` ${waiting} ${waiting > 1 ? 'alterações esperando' : 'alteração esperando'} para ir para o site.`),
      h('a', { class: 'btn', href: '#/', onclick: () => setTimeout(() => { const box = $('.pending'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60) }, 'Revisar e publicar →'));
  };
  let wasOnline = net.online;
  onNet(() => {
    if (net.online && !wasOnline) reconnect();
    wasOnline = net.online;
    showNet();
  });
  store.subscribe(showNet);
  app.showNet = showNet;
  showNet();
  const refresh = () => {
    const n = store.changes().length + store.imageChanges().added.length;
    pubCount.textContent = n ? String(n) : '';
    pubCount.hidden = !n;
    top.querySelector('.pub').classList.toggle('has', n > 0);
  };
  store.subscribe(refresh);
  refresh();
}

function setTab(key) {
  app.root.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === key));
}

async function renameEditor() {
  const input = h('input', { type: 'text', value: ls.get(EDITOR_KEY) || '' });
  dialog({
    title: 'Seu nome nas publicações',
    body: h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nome'), input),
    actions: (close) => [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancelar'),
      h('button', {
        class: 'btn btn-k',
        type: 'button',
        onclick: () => {
          ls.set(EDITOR_KEY, input.value.trim());
          $('#me-initial').textContent = initial();
          $('#me-name').textContent = editorName();
          close();
          toast('Nome atualizado.');
        },
      }, 'Salvar'),
    ],
  });
}

/* ================= routing ================= */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) };
}

async function onHash() {
  if (app.guard && app.guard() && location.hash !== app.lastHash) {
    const target = location.hash;
    history.replaceState(null, '', app.lastHash || '#/');
    const ok = await confirm({ title: 'Sair sem salvar?', text: 'Você fez alterações que ainda não foram salvas nos rascunhos.', ok: 'Descartar e sair', danger: true });
    if (!ok) return;
    app.guard = null;
    location.hash = target;
    return;
  }
  route();
}

function route() {
  app.guard = null;
  app.lastHash = location.hash;
  if (app.stale && net.online) {
    app.stale = false;
    refreshDrafts().catch(() => {});
  }
  const { parts, query } = parseHash();
  const [type, id] = parts;
  window.scrollTo(0, 0);
  if (!type) return dashboard();
  if (COLLECTIONS[type]) {
    if (!id) return listView(type);
    return itemEditor(type, id === 'novo' ? null : id, query);
  }
  if (type === 'paginas') return pagesView();
  if (type === 'instagram') return postScreen();
  if (SINGLETONS[type]) return singletonEditor(type);
  return dashboard();
}

/* ================= dashboard ================= */

function dashboard() {
  setTab('');
  const view = clear(app.view);
  const name = (ls.get(EDITOR_KEY) || '').split(' ')[0];
  const pending = h('div', { class: 'card dark pending' });
  const install = h('div', { hidden: true });
  const status = h('div', { class: 'card status' }, h('h2', null, 'Site no ar'), h('p', { class: 'muted' }, 'Carregando…'));
  const quick = h('div', { class: 'card quick' }, h('h2', null, 'Criar'),
    h('a', { class: 'btn btn-k', href: '#/agenda/novo' }, '+ Evento'),
    h('a', { class: 'btn btn-k', href: '#/noticias/novo' }, '+ Notícia'),
    h('a', { class: 'btn btn-k', href: '#/entrevistas/novo' }, '+ Entrevista'));
  const today = todayISO();
  const upcoming = store.state.working.agenda.filter((ev) => isUpcoming(ev, today));
  const next = h('div', { class: 'card next' }, h('h2', null, 'Próximos rolês'),
    upcoming.length
      ? h('ol', { class: 'mini-list' }, upcoming.slice(0, 5).map((ev) => h('li', null, h('a', { href: `#/agenda/${ev.id}` }, h('b', null, fmtShort(ev.date, false)), ' ', ev.title))))
      : h('p', { class: 'warn' }, 'A agenda está vazia: o site mostra "Nenhum rolê marcado". ', h('a', { href: '#/agenda/novo' }, 'Adicionar um evento →')),
    upcoming.length ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/instagram' }, 'Montar o post da agenda') : null);
  add(view, h('section', { class: 'dash' },
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Painel'), h('h1', null, name ? `Oi, ${name}.` : 'Oi!')),
    h('div', { class: 'dash-grid' }, pending, h('div', { class: 'dash-side' }, install, status, quick, next))));
  installCard(install);
  renderPending(pending);
  loadStatus(status);
  const unsubNet = onNet(() => {
    if (!status.isConnected) {
      unsubNet();
      return;
    }
    loadStatus(status);
  });
}

// Installing the LLama Lab app, with the admin inside it: where the browser offers to, or on
// iPhone (the way through Compartilhar). "Agora não" hides the card on this device.
const INSTALL_KEY = 'llamalab:install-card';
const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches || navigator.standalone === true;

function installCard(slot) {
  const draw = () => {
    clear(slot);
    slot.hidden = standalone() || ls.get(INSTALL_KEY) === 'no' || !(net.installPrompt || IOS);
    if (slot.hidden) return;
    add(slot, h('div', { class: 'card app' },
      h('img', { src: 'assets/icons/site-192.png', alt: '', width: '72', height: '72' }),
      h('div', null,
        h('h2', null, matchMedia('(pointer: coarse)').matches ? 'O app no celular' : 'O app no computador'),
        h('p', { class: 'muted' }, 'Instale o app do LLama Lab: o site e este admin funcionam até sem internet. O admin abre pelo botão Admin, em qualquer página.'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn btn-k btn-sm', type: 'button', onclick: () => installApp(draw) }, 'Instalar o app'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { ls.set(INSTALL_KEY, 'no'); draw(); } }, 'Agora não')))));
  };
  draw();
  const unsub = onNet(() => {
    if (!slot.isConnected) {
      unsub();
      return;
    }
    draw();
  });
}

async function installApp(done) {
  if (net.installPrompt) {
    const ask = net.installPrompt;
    net.installPrompt = null;
    ask.prompt();
    await ask.userChoice.catch(() => null);
    done();
    return;
  }
  dialog({
    title: 'Instale no iPhone',
    body: h('div', { class: 'ios-steps' },
      h('p', null, 'O LLama Lab vira um app na tela inicial, com o admin dentro, e funciona até sem internet.'),
      h('ol', null,
        h('li', null, 'Toque em ', h('b', null, 'Compartilhar'), ' (o quadrado com a seta), na barra do navegador.'),
        h('li', null, 'Escolha ', h('b', null, 'Adicionar à Tela de Início'), '.'),
        h('li', null, 'Toque em ', h('b', null, 'Adicionar'), '.')),
      h('p', { class: 'muted' }, 'O app guarda os dados separado do navegador. Publique antes o que estiver esperando aqui; depois, no app, toque em “Área da equipe”, no fim de qualquer página, e entre de novo com seu nome e o token.')),
    actions: (close) => [h('button', { class: 'btn btn-k', type: 'button', onclick: () => close() }, 'Entendi')],
  });
}

function changeLink(c) {
  if (SINGLETONS[c.type]) return `#/${c.type}`;
  return c.kind === 'remove' ? `#/${c.type}` : `#/${c.type}/${c.id}`;
}

function renderPending(box) {
  let lastSummary = '';
  const draw = () => {
    const list = store.changes();
    const img = store.imageChanges();
    // a summary the editor wrote stays when the box is drawn again
    const prev = box.querySelector('.field.msg input');
    const typed = prev && prev.value !== lastSummary ? prev.value : null;
    clear(box);
    if (store.state.conflicts.length) {
      box.append(h('div', { class: 'conflict-banner' }, h('b', null, `${store.state.conflicts.length} ${store.state.conflicts.length > 1 ? 'conflitos' : 'conflito'}`), ' com alterações publicadas por outra pessoa. ', h('button', { class: 'btn btn-solid btn-sm', type: 'button', onclick: conflictsDialog }, 'Resolver')));
    }
    if (!list.length && !img.added.length && !img.removed.length) {
      add(box, h('h2', null, 'Tudo publicado ', h('span', { class: 'red' }, '✓')), h('p', { class: 'muted' }, 'O site está igual ao que você vê aqui. Crie ou edite algo e as alterações aparecem nesta lista até você publicar.'));
      return;
    }
    const sign = { add: ['+', 'Novo'], edit: ['~', 'Editado'], remove: ['−', 'Removido'] };
    const summary = store.commitSummary();
    lastSummary = summary.title;
    const msg = h('input', { type: 'text', value: typed ?? summary.title, maxlength: '120', 'aria-label': 'Resumo da publicação' });
    add(box,
      h('h2', null, 'Para publicar ', h('span', { class: 'count' }, String(list.length + img.added.length + img.removed.length))),
      h('p', { class: 'muted' }, net.online ? 'Essas alterações estão guardadas só neste navegador. Publique para que elas vão para o site.' : 'Essas alterações estão guardadas neste aparelho. Assim que a internet voltar, publique para que elas vão para o site.'),
      h('ul', { class: 'changes' }, list.map((c) => h('li', { class: `ch ${c.kind}` },
        h('span', { class: 'sig', title: sign[c.kind][1] }, sign[c.kind][0]),
        h('a', { href: changeLink(c) }, h('small', null, `${COLLECTIONS[c.type] ? COLLECTIONS[c.type].singular : 'página'} · ${sign[c.kind][1].toLowerCase()}`), h('span', null, c.title), c.fields ? h('small', null, c.fields.join(', ')) : null),
        h('button', { class: 'undo', type: 'button', title: 'Desfazer esta alteração', onclick: async () => {
          if (await confirm({ title: 'Desfazer esta alteração?', text: `“${c.title}” volta a ficar como está publicado.`, ok: 'Desfazer' })) {
            store.revert(c);
            await store.pruneStaged();
            draw();
          }
        } }, 'Desfazer')))),
      img.added.length || img.removed.length ? h('p', { class: 'imgs' }, [
        img.added.length ? `${img.added.length} ${img.added.length > 1 ? 'imagens novas' : 'imagem nova'} (${formatBytes(img.bytes)})` : '',
        img.removed.length ? `${img.removed.length} ${img.removed.length > 1 ? 'imagens sem uso serão apagadas' : 'imagem sem uso será apagada'}` : '',
      ].filter(Boolean).join(' · ')) : null,
      h('label', { class: 'field msg' }, h('span', { class: 'lbl' }, 'Resumo da publicação'), msg),
      h('div', { class: 'btns' },
        net.online
          ? h('button', { class: 'btn btn-red big', type: 'button', onclick: () => publishFlow(msg.value.trim() || summary.title) }, 'Publicar no site ', h('span', { class: 'arr' }, '→'))
          : h('button', { class: 'btn big wait', type: 'button', disabled: true }, h('span', { html: CLOCK }), 'Publicar quando a conexão voltar'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
          if (await confirm({ title: 'Descartar tudo?', text: 'Todas as alterações não publicadas serão apagadas deste navegador.', ok: 'Descartar tudo', danger: true })) {
            store.revertAll();
            await store.pruneStaged();
            draw();
          }
        } }, 'Descartar tudo')));
  };
  draw();
  const unsub = store.subscribe(() => {
    if (!box.isConnected) {
      unsub();
      return;
    }
    draw();
  });
  const unsubNet = onNet(() => {
    if (!box.isConnected) {
      unsubNet();
      return;
    }
    draw();
  });
}

async function loadStatus(box) {
  const offline = () => {
    clear(box);
    add(box, h('h2', null, 'Site no ar'), h('p', { class: 'muted' }, 'Sem internet: não dá para conferir agora.'));
  };
  if (!net.online) {
    offline();
    return;
  }
  try {
    const [commits, deployed] = await Promise.all([app.gh.commits(1), fetchVersion()]);
    const last = commits[0];
    const live = deployed && deployed.sha === last.sha;
    const age = (Date.now() - new Date(last.commit.committer.date).getTime()) / 60000;
    clear(box);
    add(box,
      h('h2', null, 'Site no ar'),
      h('p', { class: `deploy ${live ? 'ok' : age < 10 ? 'busy' : 'warn'}` }, live ? '● Atualizado' : age < 10 ? '● Publicando… leva cerca de 1 minuto' : '● A última publicação ainda não apareceu no site. Se continuar assim, avise quem cuida do site.'),
      h('p', { class: 'muted' }, `Última publicação ${timeAgo(last.commit.author.date)}, por ${last.commit.author.name}.`),
      h('div', { class: 'btns' }, h('a', { class: 'btn btn-ghost btn-sm', href: siteUrl(), target: '_blank', rel: 'noopener' }, 'Ver o site ↗')));
    if (!live && age < 10) setTimeout(() => box.isConnected && loadStatus(box), 8000);
  } catch (error) {
    if (error.status === 0) {
      setOnline(false);
      return;
    }
    clear(box);
    add(box, h('h2', null, 'Site no ar'), h('p', { class: 'muted' }, 'Não consegui conferir agora.'), h('a', { class: 'btn btn-ghost btn-sm', href: siteUrl(), target: '_blank', rel: 'noopener' }, 'Ver o site ↗'));
  }
}

async function fetchVersion() {
  try {
    const res = await fetch(`${siteUrl()}/version.json?t=${Date.now()}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/* ================= publishing ================= */

async function publishFlow(title) {
  if (!net.online) {
    toast('Sem internet: publique quando a conexão voltar.');
    return;
  }
  const problems = store.validateAll();
  if (problems.length) {
    dialog({
      title: 'Falta arrumar algumas coisas',
      body: h('div', null, h('p', null, 'Corrija estes itens antes de publicar:'),
        h('ul', { class: 'problems' }, problems.map((p) => h('li', null, h('a', { href: p.id ? `#/${p.type}/${p.id}` : `#/${p.type}`, onclick: () => document.querySelector('dialog.dlg')?.close() }, h('b', null, p.title), ' — ', p.message))))),
      actions: (close) => [h('button', { class: 'btn btn-k', type: 'button', onclick: () => close() }, 'Entendi')],
    });
    return;
  }
  await store.pruneStaged();
  const step = h('p', { class: 'step' }, 'Começando…');
  const bar = h('div', { class: 'progress' }, h('i'));
  const { close } = dialog({ title: 'Publicando', body: h('div', { class: 'publishing' }, h('div', { class: 'eq big', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), step, bar) });
  const summary = store.commitSummary();
  try {
    if (!app.user) app.user = await app.gh.user();
    const editor = ls.get(EDITOR_KEY) || app.user.name || app.user.login;
    const result = await store.publish(app.gh, {
      message: `${title}\n\n${summary.body}`,
      author: { name: editor, email: `${app.user.id}+${app.user.login}@users.noreply.github.com` },
      onStep: (text) => { step.textContent = text; },
    });
    close();
    if (result.conflicts) {
      conflictsDialog();
      return;
    }
    if (result.problems) {
      publishFlow(title);
      return;
    }
    if (result.nothing) {
      toast('Nada para publicar: o site já está assim.');
      return;
    }
    app.backOnline = false;
    publishedDialog(result.commit);
  } catch (error) {
    if (error.status === 0) setOnline(false);
    close();
    dialog({
      title: 'Não deu para publicar',
      body: h('div', null, h('p', null, describeError(error)), h('p', { class: 'muted' }, 'Suas alterações continuam guardadas aqui. Nada foi perdido.')),
      actions: (c) => [h('button', { class: 'btn btn-k', type: 'button', onclick: () => c() }, 'Ok')],
    });
  }
}

function publishedDialog(commit) {
  const status = h('p', { class: 'deploy busy' }, '● Atualizando o site… costuma levar 1 minuto.');
  const started = Date.now();
  let stop = false;
  const poll = async () => {
    if (stop) return;
    const v = await fetchVersion();
    if (v && v.sha === commit.sha) {
      status.className = 'deploy ok';
      status.textContent = '● No ar! Já dá para ver no site.';
      return;
    }
    if (Date.now() - started > 5 * 60000) {
      status.className = 'deploy warn';
      status.textContent = '● Está demorando mais que o normal. Se não aparecer em alguns minutos, avise quem cuida do site.';
      return;
    }
    setTimeout(poll, 5000);
  };
  setTimeout(poll, 15000);
  dialog({
    title: 'Publicado ✺',
    body: h('div', { class: 'published' },
      h('p', { class: 'big' }, 'Suas alterações foram enviadas para o site.'),
      status,
      h('p', { class: 'muted' }, 'Se uma página ainda aparecer antiga, recarregue: o navegador pode guardar a versão anterior por alguns minutos.')),
    onClose: () => { stop = true; route(); },
    actions: (close) => [
      h('a', { class: 'btn btn-ghost', href: siteUrl(), target: '_blank', rel: 'noopener' }, 'Abrir o site ↗'),
      h('button', { class: 'btn btn-k', type: 'button', onclick: () => close() }, 'Fechar'),
    ],
  });
}

function conflictsDialog() {
  const list = store.state.conflicts;
  if (!list.length) return;
  const body = h('div', { class: 'conflicts' },
    h('p', null, 'Outra pessoa publicou alterações nos mesmos itens que você editou. Escolha qual versão fica em cada um:'));
  const rows = list.map((c) => {
    const row = h('div', { class: 'conflict' },
      h('b', null, c.title),
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-k btn-sm', type: 'button', onclick: () => { store.resolveConflict(c, 'mine'); row.remove(); done(); } }, 'Manter a minha'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { store.resolveConflict(c, 'theirs'); row.remove(); done(); } }, c.theirs === undefined ? 'Aceitar a remoção' : 'Usar a publicada')));
    return row;
  });
  add(body, rows);
  const { close } = dialog({
    title: 'Conflitos',
    body,
    actions: (c) => [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => c() }, 'Decidir depois')],
  });
  function done() {
    if (!store.state.conflicts.length) {
      close();
      toast('Conflitos resolvidos. Agora é só publicar.');
      route();
    }
  }
}

/* ================= lists ================= */

function badge(text, cls = '') {
  return h('span', { class: `badge ${cls}` }, text);
}

function statusBadges(type, item, status) {
  const out = [];
  if (status === 'add') out.push(badge('Novo', 'new'));
  if (status === 'edit') out.push(badge('Editado', 'edit'));
  if (status === 'remove') out.push(badge('Removido', 'rm'));
  if (item.featured) out.push(badge('Destaque', 'feat'));
  if (type === 'agenda' && !isUpcoming(item, todayISO())) out.push(badge('Já rolou', 'past'));
  return out;
}

function itemLine(type, item) {
  if (type === 'agenda') return [item.venue, fmtHours(item), item.category, item.price].filter(Boolean).join(' · ');
  if (type === 'noticias') return [item.kicker, fmtShort(item.date)].filter(Boolean).join(' · ');
  return [item.name !== item.title ? item.name : '', item.area, fmtShort(item.date)].filter(Boolean).join(' · ');
}

function itemArt(type, item) {
  if (type === 'agenda') {
    const p = parseDate(item.date) || { d: '?', m: 1, y: '' };
    return h('div', { class: 'item-date' }, h('b', null, String(p.d).padStart(2, '0')), h('span', null, `${MONTHS_SHORT[p.m - 1]} ${p.y}`));
  }
  const image = item.photo || item.image;
  const src = image && image.src ? store.assetUrl(image.src) : null;
  // as on the site: news photos in black and white, interview photos in colour
  return h('div', { class: 'item-thumb' }, src ? h('img', { src, alt: '', loading: 'lazy', class: type === 'noticias' ? 'bw' : null }) : h('span', null, TYPE_ICON[type]));
}

function listView(type) {
  setTab(type);
  const t = COLLECTIONS[type];
  const view = clear(app.view);
  const today = todayISO();
  const saved = sessionStorage.getItem(`filter:${type}`) || (type === 'agenda' ? 'up' : 'all');
  let filter = saved;
  let query = '';
  const search = h('input', { type: 'search', placeholder: `Buscar ${t.label.toLowerCase()}…`, 'aria-label': 'Buscar', oninput: () => { query = norm(search.value); draw(); } });
  const filters = type === 'agenda'
    ? [['up', 'Próximos'], ['past', 'Já rolou'], ['all', 'Todos'], ['changed', 'Com alterações']]
    : [['all', 'Todas'], ['feat', 'Destaques'], ['changed', 'Com alterações']];
  const chips = h('div', { class: 'chips' }, filters.map(([key, label]) => h('button', { type: 'button', class: `chip${key === filter ? ' on' : ''}`, dataset: { f: key }, onclick: () => { filter = key; sessionStorage.setItem(`filter:${type}`, key); chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.f === key)); draw(); } }, label)));
  const list = h('ol', { class: 'items' });
  const count = h('span', { class: 'count' });
  add(view, h('section', { class: 'list-view' },
    h('div', { class: 'page-head row' },
      h('div', null, h('p', { class: 'eyebrow' }, 'Conteúdo'), h('h1', null, t.label, ' ', count)),
      h('div', { class: 'btns' },
        type === 'agenda' ? h('a', { class: 'btn btn-ghost', href: '#/instagram' }, 'Post para o Instagram') : null,
        h('a', { class: 'btn btn-red', href: `#/${type}/novo` }, `+ ${t.newLabel}`))),
    h('div', { class: 'tools' }, search, chips),
    list));

  function draw() {
    const working = store.state.working[type];
    const removed = store.state.base[type].filter((b) => !working.some((w) => w.id === b.id));
    let items = [...working.map((item) => ({ item, status: store.itemStatus(type, item.id) })), ...removed.map((item) => ({ item, status: 'remove' }))];
    count.textContent = String(working.length);
    if (type === 'agenda') {
      if (filter === 'up') items = items.filter(({ item }) => isUpcoming(item, today)).sort((a, b) => t.sort(a.item, b.item));
      else items.sort((a, b) => t.sort(b.item, a.item));
      if (filter === 'past') items = items.filter(({ item }) => !isUpcoming(item, today));
    } else {
      items.sort((a, b) => t.sort(a.item, b.item));
      if (filter === 'feat') items = items.filter(({ item }) => item.featured);
    }
    if (filter === 'changed') items = items.filter(({ status }) => status);
    if (query) items = items.filter(({ item }) => norm([item.title, item.name, item.venue, item.kicker, item.area, item.lineup, item.role].join(' ')).includes(query));
    clear(list);
    if (!items.length) {
      list.append(h('li', { class: 'empty-row' }, query ? 'Nada encontrado com essa busca.' : filter === 'up' ? 'Nenhum evento futuro. ' : 'Nada por aqui ainda. ', filter === 'up' && !query ? h('a', { href: '#/agenda/novo' }, 'Adicionar um evento →') : null));
      return;
    }
    for (const { item, status } of items) {
      const actions = h('div', { class: 'item-actions' });
      if (status === 'remove') {
        actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { store.revert({ type, id: item.id, kind: 'remove' }); draw(); } }, 'Desfazer remoção'));
      } else {
        if (type === 'agenda') actions.append(h('a', { class: 'btn btn-ghost btn-sm', href: `#/agenda/novo?copia=${encodeURIComponent(item.id)}`, title: 'Criar um evento a partir deste' }, 'Duplicar'));
        actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm danger', onclick: () => removeFlow(type, item, draw) }, 'Remover'));
      }
      list.append(h('li', { class: `item ${status}` },
        h(status === 'remove' ? 'div' : 'a', { class: 'item-main', href: status === 'remove' ? null : `#/${type}/${item.id}` },
          itemArt(type, item),
          h('div', { class: 'item-text' }, h('h3', null, store.titleOf(type, item)), h('p', null, itemLine(type, item))),
          h('div', { class: 'badges' }, statusBadges(type, item, status))),
        actions));
    }
  }
  draw();
}

async function removeFlow(type, item, after) {
  const t = COLLECTIONS[type];
  const status = store.itemStatus(type, item.id);
  const ok = await confirm({
    title: `Remover ${t.singular}?`,
    text: status === 'add'
      ? `“${store.titleOf(type, item)}” ainda não foi publicado e será descartado.`
      : `“${store.titleOf(type, item)}” sai do site quando você publicar. Até lá dá para desfazer.`,
    ok: 'Remover',
    danger: true,
  });
  if (!ok) return;
  store.removeItem(type, item.id);
  await store.pruneStaged();
  toast(status === 'add' ? 'Descartado.' : 'Removido. Publique para tirar do site.');
  if (after) after();
}

/* ================= post da agenda ================= */

function postScreen() {
  setTab('agenda');
  postView(clear(app.view));
}

/* ================= editors ================= */

function formKey(route) {
  return `llamalab:form:${route}`;
}

function editorShell({ back, backLabel, title, badges = [], actions = [], form, preview, onSave, onCancel, saveLabel = 'Salvar' }) {
  const state = h('span', { class: 'ed-state' }, '');
  const saveBtn = h('button', { class: 'btn btn-red', type: 'button', onclick: onSave }, saveLabel);
  const el = h('section', { class: 'editor' },
    h('div', { class: 'ed-head' },
      h('a', { class: 'back', href: back }, `← ${backLabel}`),
      h('div', { class: 'ed-title' }, h('h1', null, title), h('div', { class: 'badges' }, badges)),
      h('div', { class: 'ed-actions' }, actions)),
    h('div', { class: 'ed-body' }, h('div', { class: 'ed-form' }, form), h('aside', { class: 'ed-preview' }, preview)),
    h('div', { class: 'ed-bar' }, state, h('div', { class: 'btns' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: onCancel }, 'Cancelar'), saveBtn)));
  return { el, setState: (text, cls = '') => { state.textContent = text; state.className = `ed-state ${cls}`; } };
}

function itemEditor(type, id, query) {
  setTab(type);
  const t = COLLECTIONS[type];
  const view = clear(app.view);
  const existing = id ? store.find(type, id) : null;
  if (id && !existing) {
    add(view, h('section', { class: 'editor missing' }, h('h1', null, 'Não encontrei esse item.'), h('p', null, 'Ele pode ter sido removido. '), h('a', { class: 'btn btn-k', href: `#/${type}` }, `Ver ${t.label.toLowerCase()}`)));
    return;
  }
  const routeKey = location.hash;
  let model;
  if (existing) {
    model = clone(existing);
  } else {
    const copyOf = query.get('copia') && store.find(type, query.get('copia'));
    model = copyOf ? { ...clone(copyOf), date: '', featured: false } : emptyItem(t.fields, todayISO());
    delete model.id;
  }
  const original = JSON.stringify(normalize(t.fields, model));
  let restored = false;
  try {
    const stash = localStorage.getItem(formKey(routeKey));
    if (stash) {
      const parsed = JSON.parse(stash);
      if (JSON.stringify(normalize(t.fields, parsed)) !== original) {
        model = parsed;
        restored = true;
      }
    }
  } catch { /* ignore */ }

  const previewId = existing ? existing.id : '__novo';
  const previewData = () => {
    const data = clone(store.state.working);
    const item = normalize(t.fields, model);
    item.id = previewId;
    if (type === 'agenda' && !item.date) item.date = todayISO();
    if (!item.title && !item.name) item.title = t.newLabel;
    if (type === 'entrevistas' && !item.name) item.name = item.title;
    data[type] = data[type].filter((i) => i.id !== previewId).concat(item).sort(t.sort);
    return data;
  };
  const pv = previewPane({ getData: previewData, getRoute: () => `${type}/${previewId}` });
  let shell;
  const dirty = () => JSON.stringify(normalize(t.fields, model)) !== original;
  const ctx = {
    model,
    imageDir: t.imageDir,
    titleHint: () => model.title || model.name || '',
    altHint: (field) => (field.slot === 'retrato' && model.name ? `Retrato de ${model.name}` : field.slot === 'flyer' && model.title ? `Flyer de ${model.title}` : ''),
    changed: () => {
      pv.update();
      const d = dirty();
      shell.setState(d ? 'Alterações não salvas' : existing && store.itemStatus(type, existing.id) ? 'Rascunho salvo, falta publicar' : '', d ? 'dirty' : '');
      try {
        if (d) localStorage.setItem(formKey(routeKey), JSON.stringify(model));
        else localStorage.removeItem(formKey(routeKey));
      } catch { /* ignore */ }
    },
  };
  const form = buildForm(t.fields, ctx);
  const status = existing ? store.itemStatus(type, existing.id) : 'add';
  const published = existing && store.findBase(type, existing.id);
  const save = async () => {
    const item = normalize(t.fields, model);
    const problems = validate(t.fields, item);
    if (problems.length) {
      form.showErrors(problems);
      toast('Confira os campos marcados em vermelho.', 'error');
      return;
    }
    const savedId = store.saveItem(type, item, existing ? existing.id : null);
    await store.pruneStaged();
    try { localStorage.removeItem(formKey(routeKey)); } catch { /* ignore */ }
    app.guard = null;
    toast('Salvo nos rascunhos. Publique no Painel quando terminar.');
    location.hash = `#/${type}/${savedId}`;
    if (location.hash === routeKey) route();
  };
  const cancel = async () => {
    if (dirty() && !await confirm({ title: 'Descartar as alterações?', text: 'O que você mudou neste formulário e ainda não salvou será perdido.', ok: 'Descartar', danger: true })) return;
    try { localStorage.removeItem(formKey(routeKey)); } catch { /* ignore */ }
    app.guard = null;
    location.hash = `#/${type}`;
  };
  shell = editorShell({
    back: `#/${type}`,
    backLabel: t.label,
    title: existing ? store.titleOf(type, existing) : query.get('copia') ? `${t.newLabel} (cópia)` : t.newLabel,
    badges: existing ? statusBadges(type, existing, status) : [badge('Novo', 'new')],
    actions: [
      published ? h('a', { class: 'btn btn-ghost btn-sm', href: `${siteUrl()}/${t.route}/${existing.id}/`, target: '_blank', rel: 'noopener' }, 'Ver no site ↗') : null,
      existing && type === 'agenda' ? h('a', { class: 'btn btn-ghost btn-sm', href: `#/agenda/novo?copia=${encodeURIComponent(existing.id)}` }, 'Duplicar') : null,
      existing ? h('button', { class: 'btn btn-ghost btn-sm danger', type: 'button', onclick: () => removeFlow(type, existing, () => { app.guard = null; location.hash = `#/${type}`; }) }, 'Remover') : null,
    ],
    form: form.el,
    preview: pv.el,
    onSave: save,
    onCancel: cancel,
    saveLabel: existing ? 'Salvar alterações' : `Adicionar ${t.singular}`,
  });
  add(view, shell.el);
  app.guard = dirty;
  if (restored) {
    shell.setState('Recuperei alterações que você não tinha salvado.', 'dirty');
  } else if (status && existing) {
    shell.setState('Rascunho salvo, falta publicar');
  }
  if (published) {
    const url = h('p', { class: 'hint url' }, 'Endereço: ', h('code', null, `/${t.route}/${existing.id}/`));
    form.el.prepend(url);
  }
  if (!existing) setTimeout(() => form.el.querySelector('input,textarea')?.focus(), 50);
}

function pagesView() {
  setTab('paginas');
  const view = clear(app.view);
  const cards = Object.values(SINGLETONS).map((s) => h('a', { class: `page-card${store.singletonChanged(s.name) ? ' changed' : ''}`, href: `#/${s.name}` },
    h('span', { class: 'ic' }, TYPE_ICON[s.name]),
    h('h2', null, s.label),
    h('p', null, {
      site: 'Abertura da capa, faixas, chamada do rodapé, contatos e redes.',
      sobre: 'A página Sobre: quem é a LLama.',
      contrate: 'Serviços e chamada para contratar a LLama.',
    }[s.name]),
    store.singletonChanged(s.name) ? badge('Editado', 'edit') : null));
  add(view, h('section', { class: 'pages' }, h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Conteúdo'), h('h1', null, 'Páginas')), h('div', { class: 'page-grid' }, cards)));
}

function singletonEditor(name) {
  setTab('paginas');
  const s = SINGLETONS[name];
  const view = clear(app.view);
  const routeKey = location.hash;
  let model = clone(store.state.working[name]);
  const original = JSON.stringify(normalize(s.fields, model));
  let restored = false;
  try {
    const stash = localStorage.getItem(formKey(routeKey));
    if (stash && JSON.stringify(normalize(s.fields, JSON.parse(stash))) !== original) {
      model = JSON.parse(stash);
      restored = true;
    }
  } catch { /* ignore */ }
  const route = { site: 'home', sobre: 'sobre', contrate: 'contrate' }[name];
  const pv = previewPane({
    getData: () => {
      const data = clone(store.state.working);
      data[name] = normalize(s.fields, model);
      return data;
    },
    getRoute: () => route,
  });
  let shell;
  const dirty = () => JSON.stringify(normalize(s.fields, model)) !== original;
  const ctx = {
    model,
    imageDir: s.imageDir || 'images/paginas',
    titleHint: () => model.title || name,
    altHint: () => '',
    changed: () => {
      pv.update();
      const d = dirty();
      shell.setState(d ? 'Alterações não salvas' : store.singletonChanged(name) ? 'Rascunho salvo, falta publicar' : '', d ? 'dirty' : '');
      try {
        if (d) localStorage.setItem(formKey(routeKey), JSON.stringify(model));
        else localStorage.removeItem(formKey(routeKey));
      } catch { /* ignore */ }
    },
  };
  const form = buildForm(s.fields, ctx);
  shell = editorShell({
    back: '#/paginas',
    backLabel: 'Páginas',
    title: s.label,
    badges: store.singletonChanged(name) ? [badge('Editado', 'edit')] : [],
    actions: [h('a', { class: 'btn btn-ghost btn-sm', href: `${siteUrl()}/${s.route ? `${s.route}/` : ''}`, target: '_blank', rel: 'noopener' }, 'Ver no site ↗')],
    form: form.el,
    preview: pv.el,
    onSave: async () => {
      const value = normalize(s.fields, model);
      const problems = validate(s.fields, value);
      if (problems.length) {
        form.showErrors(problems);
        toast('Confira os campos marcados em vermelho.', 'error');
        return;
      }
      store.saveSingleton(name, value);
      await store.pruneStaged();
      try { localStorage.removeItem(formKey(routeKey)); } catch { /* ignore */ }
      app.guard = null;
      toast('Salvo nos rascunhos. Publique no Painel quando terminar.');
      singletonEditor(name);
    },
    onCancel: async () => {
      if (dirty() && !await confirm({ title: 'Descartar as alterações?', text: 'O que você mudou e ainda não salvou será perdido.', ok: 'Descartar', danger: true })) return;
      try { localStorage.removeItem(formKey(routeKey)); } catch { /* ignore */ }
      app.guard = null;
      location.hash = '#/paginas';
    },
    saveLabel: 'Salvar alterações',
  });
  add(view, shell.el);
  app.guard = dirty;
  if (restored) shell.setState('Recuperei alterações que você não tinha salvado.', 'dirty');
  else if (store.singletonChanged(name)) shell.setState('Rascunho salvo, falta publicar');
}
