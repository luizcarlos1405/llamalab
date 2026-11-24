// LLama Lab public pages: stage animations, agenda calendar and filters, sharing
// and the admin shortcut. Pages are prerendered; this only adds behaviour.
//
// Everything that belongs to a page is set up in mount(), which runs on load and again
// whenever the page is swapped without a reload (see "From page to page" at the end:
// that happens once the radio plays, so the music doesn't stop).
(() => {
  const d = document;
  const html = d.documentElement;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => [...c.querySelectorAll(s)];
  const root = () => html.dataset.root || './';
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // CSS ties the stage's shrinking to the scroll where it can (site.css); the loop does it elsewhere
  const SCROLL_FX = Boolean(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'));
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // What the animation loop and the global handlers need from the current page.
  // the editors' shortcut's icons (Lucide's pencil, x and layout-grid)
  const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"/></svg>';
  const ICON_X = '<svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_GRID = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
  let page = {};
  let io = null;
  let rest = null;

  requestAnimationFrame(() => setTimeout(() => html.classList.add('ready'), 60));

  /* Lighter effects where the device can't keep up. For a few seconds after the page
     opens, watch how often frames come; if they come slowly, switch to html.lite (no
     grain, blur or llama details, ribbons that move only with the scroll: site.css) and
     remember it, so the next pages start light. The inline script in <head> applies the
     remembered choice before the first paint, and takes ?fx=lite, ?fx=full or ?fx=auto
     (forget) in the address, to compare. */
  const FX = 'llamalab:fx';
  const lite = () => html.classList.contains('lite');
  (() => {
    let chosen = null;
    try {
      chosen = localStorage.getItem(FX);
    } catch { /* not available: decide for this page only */ }
    if (RM || chosen || lite()) return;
    const gaps = [];
    let prev = 0;
    let begin = 0;
    const watch = (t) => {
      if (d.hidden) {
        prev = 0;
        requestAnimationFrame(watch);
        return;
      }
      if (!begin) begin = t;
      if (prev && t - begin > 1200) gaps.push(t - prev); // after the first second of loading
      prev = t;
      if (gaps.length < 150 && t - begin < 5000) {
        requestAnimationFrame(watch);
        return;
      }
      if (gaps.length < 40) return;
      gaps.sort((a, b) => a - b);
      const median = gaps[gaps.length >> 1];
      const hitches = gaps.filter((g) => g > 40).length / gaps.length;
      if (median > 22 || hitches > 0.15) {
        html.classList.add('lite');
        try {
          localStorage.setItem(FX, 'lite');
        } catch { /* not remembered */ }
      }
    };
    requestAnimationFrame(watch);
  })();

  /* toast */
  let toastEl;
  let toastTimer;
  const toast = (text) => {
    if (!toastEl) {
      toastEl = d.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      d.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
  };

  /* Without internet, a note under the nav says the page is a saved copy, and from when
     (the service worker knows); a toast says when the connection is back. The offline
     page says it itself. */
  const WIFI_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.3-1.6M2 9.4a15 15 0 0 1 4.4-2.8M22 9.4a15 15 0 0 0-11.7-3.8M12 20h.01"/></svg>';
  let note = null;
  const savedAt = (url) => new Promise((resolve) => {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data || null);
    };
    sw.postMessage({ type: 'saved', url }, [channel.port2]);
  });
  async function offlineNote() {
    if (navigator.onLine || d.body.classList.contains('offline-page')) {
      if (note) note.hidden = true;
      return;
    }
    if (!note) {
      note = d.createElement('div');
      note.className = 'offline-note';
      note.setAttribute('role', 'status');
      d.body.append(note);
    }
    const at = await savedAt(location.href);
    const t = at ? new Date(at) : null;
    const when = !t ? '' : `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` === today ? 'hoje' : `em ${pad(t.getDate())}/${pad(t.getMonth() + 1)}`;
    note.innerHTML = `${WIFI_OFF}Sem internet${when ? ` <span>· salva ${when}</span>` : ''}`;
    note.hidden = navigator.onLine;
  }
  addEventListener('offline', offlineNote);
  addEventListener('online', () => {
    if (note && !note.hidden) toast('A conexão voltou ✺');
    if (note) note.hidden = true;
  });

  // the site opened as an installed app (from the home screen), not in a browser tab
  const installed = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)').matches || navigator.standalone === true;

  /* Installing: where the browser can install the site (Chrome, Edge, Samsung Internet), a
     quiet "Instalar o app" at the end of the phone menu and in the footer. iPhones have no
     install button for sites, so there the same button shows the way through Compartilhar. */
  let installPrompt = null;
  const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const showInstall = () => {
    const can = !installed() && !html.hasAttribute('data-preview') && Boolean(installPrompt || IOS);
    $$('[data-install]').forEach((el) => {
      el.hidden = !can;
    });
  };
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    showInstall();
  });
  addEventListener('appinstalled', () => {
    installPrompt = null;
    showInstall();
  });
  const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
  function iosTip() {
    const dim = d.createElement('div');
    dim.className = 'ios-dim';
    const tip = d.createElement('div');
    tip.className = 'ios-tip';
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    tip.setAttribute('aria-label', 'Como instalar no iPhone');
    tip.innerHTML = `<h2>Instale no iPhone</h2><p>O LLama Lab vira um app na tela inicial e funciona até sem internet.</p><ol><li><span>Toque em <span class="sh">${SHARE}</span> <b>Compartilhar</b>, na barra do navegador.</span></li><li><span>Escolha <b>Adicionar à Tela de Início</b>.</span></li><li><span>Toque em <b>Adicionar</b>.</span></li></ol><button class="btn btn-k" type="button">Entendi</button>`;
    const close = () => {
      dim.remove();
      tip.remove();
      d.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    dim.addEventListener('click', close);
    $('button', tip).addEventListener('click', close);
    d.addEventListener('keydown', onKey);
    d.body.append(dim, tip);
    $('button', tip).focus();
  }
  d.addEventListener('click', async (e) => {
    if (!e.target.closest('.install')) return;
    if (installPrompt) {
      const ask = installPrompt;
      installPrompt = null;
      ask.prompt();
      await ask.userChoice.catch(() => null);
      showInstall();
    } else if (IOS) {
      iosTip();
    }
  });


  /* The photo viewer, on an album's page (/fotos/<album>/): the photos large, on black. On
     phones a swipe goes to the next one (its neighbours peek at the edges); on computers the
     arrows, the keyboard and a strip of small photos. The address follows it (#foto-12), so a
     photo can be linked to, and the back button closes it. "Salvar foto" turns the photo into
     a JPEG, what phones and Instagram handle best: on iPhone it goes to the share sheet ("Salvar
     imagem", Instagram), the only way into Photos; elsewhere it downloads. Without JavaScript
     each photo is a link to itself. */
  const ICON_SAVE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
  const ICON_SEND = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 7l-4-4-4 4M12 3v12"/></svg>';
  const vw = { el: null, album: null, items: [], i: 0, pushed: false, back: null, closing: false };
  let offHash = null;
  const nn = (n) => String(n).padStart(2, '0');
  const fileName = (album, n) => `llamalab-${album.album || 'foto'}-${nn(n)}.jpg`;

  // The photo as a JPEG (a File, ready to share or download), with the LLama Lab mark when the
  // site asks for it (src/config.js PHOTOS.mark).
  async function jpeg(item, album) {
    const res = await fetch(item.full, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    let pic;
    try {
      pic = await createImageBitmap(blob);
    } catch {
      pic = new Image();
      pic.src = URL.createObjectURL(blob);
      await pic.decode();
    }
    const canvas = d.createElement('canvas');
    canvas.width = pic.naturalWidth || pic.width;
    canvas.height = pic.naturalHeight || pic.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(pic, 0, 0);
    if (pic.close) pic.close();
    else URL.revokeObjectURL(pic.src);
    if (album.mark) await mark(ctx, canvas.width, canvas.height, album);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    return new File([out], fileName(album, item.n), { type: 'image/jpeg' });
  }

  // The mark: the llama and "LLama Lab · @llama.etc", small, at the bottom left, with whoever
  // took the photo.
  async function mark(ctx, w, h, album) {
    const sym = d.getElementById('ll-sym');
    const u = Math.max(w, h) / 1080;
    const x = Math.round(28 * u);
    const y = h - Math.round(30 * u);
    if (sym) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.getAttribute('viewBox')}">${sym.innerHTML}</svg>`;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode().catch(() => {});
      const lh = 62 * u;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 10 * u;
      if (img.naturalWidth) ctx.drawImage(img, x, y - lh, lh * (119.9 / 193), lh);
      ctx.restore();
    }
    await Promise.all([d.fonts.load(`${Math.round(30 * u)}px Anton`), d.fonts.load(`600 ${Math.round(15 * u)}px Outfit`)]).catch(() => {});
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 8 * u;
    const tx = x + (sym ? 48 * u : 0);
    ctx.font = `${Math.round(30 * u)}px Anton, Impact, sans-serif`;
    ctx.fillText('LLAMA LAB', tx, y - 26 * u);
    ctx.font = `600 ${Math.round(15 * u)}px Outfit, sans-serif`;
    ctx.fillText(`@LLAMA.ETC${album.credit ? ` · FOTO ${album.credit.toUpperCase()}` : ''}`, tx, y - 4 * u);
    ctx.restore();
  }

  function download(file) {
    const a = d.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    d.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  const canShareFile = (file) => Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));

  async function busy(btn, fn) {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    try {
      await fn();
    } catch (error) {
      if (!error || error.name !== 'AbortError') toast(navigator.onLine ? 'Não deu para preparar a foto. Tente de novo.' : 'Sem internet: a foto não veio.');
    } finally {
      btn.classList.remove('busy');
    }
  }

  function buildViewer() {
    const el = d.createElement('div');
    el.className = 'vw';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="vw-top"><p class="vw-n" aria-live="polite"><b></b><span></span></p><button class="vw-x" type="button" aria-label="Fechar">×</button></div>
  <div class="vw-stage"><div class="vw-track"></div><button class="vw-prev" type="button" aria-label="Foto anterior">←</button><button class="vw-next" type="button" aria-label="Próxima foto">→</button><p class="vw-msg" role="status" hidden></p></div>
  <div class="vw-foot"><div class="vw-cred"></div><div class="vw-film" aria-hidden="true"></div><div class="vw-act"><button class="btn btn-solid" type="button" data-save>${ICON_SAVE} Salvar foto</button><button class="btn btn-ghost" type="button" data-send>${ICON_SEND} Compartilhar</button></div></div>`;
    d.body.append(el);
    $('.vw-x', el).addEventListener('click', () => closeViewer());
    $('.vw-prev', el).addEventListener('click', () => show(vw.i - 1));
    $('.vw-next', el).addEventListener('click', () => show(vw.i + 1));
    $('.vw-film', el).addEventListener('click', (e) => {
      const t = e.target.closest('[data-n]');
      if (t) show(+t.dataset.n - 1);
    });
    $('[data-save]', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const file = await jpeg(vw.items[vw.i], vw.album);
      if (IOS && canShareFile(file)) await navigator.share({ files: [file] });
      else {
        download(file);
        toast('Foto salva ✺');
      }
    }));
    $('[data-send]', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const url = location.href;
      if (navigator.share) {
        const file = await jpeg(vw.items[vw.i], vw.album).catch(() => null);
        if (file && canShareFile(file)) {
          await navigator.share({ files: [file], title: vw.album.title || d.title });
          return;
        }
        await navigator.share({ title: vw.album.title || d.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link da foto copiado ✺');
    }));
    // a swipe: the photos follow the finger, and past a third of a photo (or a quick flick) the
    // next one comes; pinching still zooms
    const stage = $('.vw-stage', el);
    const track = $('.vw-track', el);
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId, dx: 0, on: false };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.on && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - drag.y)) {
        drag.on = true;
        track.classList.add('drag');
        stage.setPointerCapture(e.pointerId);
      }
      if (drag.on) {
        drag.dx = dx;
        track.style.setProperty('--dx', `${dx}px`);
      }
    });
    const end = () => {
      if (!drag) return;
      const { dx, t, on } = drag;
      drag = null;
      track.classList.remove('drag');
      track.style.setProperty('--dx', '0px');
      if (!on) return;
      const quick = Math.abs(dx) > 30 && Date.now() - t < 280;
      if (Math.abs(dx) > stage.clientWidth / 3 || quick) show(vw.i + (dx < 0 ? 1 : -1));
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // keyboard: arrows, Esc, and Tab stays inside (wherever the focus is while it's open)
    d.addEventListener('keydown', (e) => {
      if (!viewerOpen() || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') show(vw.i + 1);
      else if (e.key === 'ArrowLeft') show(vw.i - 1);
      else if (e.key === 'Escape') closeViewer();
      else if (e.key === 'Tab') {
        const focusable = $$('button,a[href]', el).filter((b) => b.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && d.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && d.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      } else return;
      e.stopPropagation();
    }, true);
    return el;
  }

  // The photos near the one in sight get their large version (the small one shows meanwhile).
  function load(i) {
    const fig = vw.el && $$('.vw-track figure', vw.el)[i];
    const item = vw.items[i];
    if (!fig || !item) return;
    const img = $('img', fig);
    if (!img.src) img.src = item.thumb;
    if (fig.dataset.full) return;
    fig.dataset.full = '1';
    const big = new Image();
    big.onload = () => {
      img.src = item.full;
    };
    big.src = item.full;
  }

  function show(i, { first = false } = {}) {
    const n = vw.items.length;
    if (!n) return;
    vw.i = Math.max(0, Math.min(n - 1, i));
    const { el, album } = vw;
    const item = vw.items[vw.i];
    const figs = $$('.vw-track figure', el);
    figs.forEach((f, k) => f.classList.toggle('on', k === vw.i));
    $('.vw-track', el).style.setProperty('--i', vw.i);
    $('.vw-n b', el).textContent = item.n;
    $('.vw-n span', el).textContent = `de ${n}${album.title ? ` · ${album.title}` : ''}`;
    $('.vw-prev', el).disabled = vw.i === 0;
    $('.vw-next', el).disabled = vw.i === n - 1;
    for (const k of [vw.i, vw.i + 1, vw.i - 1, vw.i + 2]) load(k);
    const from = Math.max(0, Math.min(vw.i - 5, n - 11));
    $('.vw-film', el).innerHTML = vw.items.slice(from, from + 11).map((it) => `<i data-n="${it.n}"${it === item ? ' class="on"' : ''} style="background-image:url('${it.thumb.replace(/'/g, '%27')}')"></i>`).join('');
    if (!first) history.replaceState(history.state, '', `#foto-${item.n}`);
  }

  function openViewer(album, items, i, from, { push = true } = {}) {
    if (!vw.el) vw.el = buildViewer();
    const { el } = vw;
    vw.album = album;
    vw.items = items;
    vw.back = from;
    el.setAttribute('aria-label', `Fotos: ${album.title || ''}`);
    $('.vw-track', el).innerHTML = items.map((it) => `<figure><img alt="Foto ${it.n} de ${items.length}" width="${it.w}" height="${it.h}" decoding="async"></figure>`).join('');
    const ig = album.handle ? ` · <a href="https://instagram.com/${encodeURIComponent(album.handle)}" target="_blank" rel="noopener">@${escHtml(album.handle)}</a>` : '';
    $('.vw-cred', el).innerHTML = `${album.credit || ig ? `<b>Foto${album.credit ? `: ${escHtml(album.credit)}` : ''}${ig}</b>` : ''}${escHtml([album.title, album.when, album.venue].filter(Boolean).join(' · '))}<p class="vw-tip">Postou? Marca a @llama.etc <span class="st">✺</span></p>`;
    el.hidden = false;
    html.classList.add('vw-open');
    if (push) {
      history.pushState({ ...(history.state || {}), vw: true }, '', `#foto-${items[i].n}`);
      vw.pushed = true;
    } else {
      vw.pushed = false;
    }
    show(i, { first: true });
    $('.vw-x', el).focus({ preventScroll: true });
  }

  // fromHistory: the back button closed it (the address is already the page's).
  function closeViewer({ fromHistory = false } = {}) {
    if (!vw.el || vw.el.hidden) return;
    vw.el.hidden = true;
    html.classList.remove('vw-open');
    if (!fromHistory) {
      if (vw.pushed) {
        vw.closing = true; // the popstate this causes isn't a page change
        history.back();
      } else history.replaceState(history.state, '', location.pathname + location.search);
    }
    vw.pushed = false;
    // back to the photo that was in sight, on the page
    const at = vw.items[vw.i] && $(`.jg a[data-n="${vw.items[vw.i].n}"]`);
    const target = at || vw.back;
    if (target) {
      target.focus({ preventScroll: true });
      if (at) at.scrollIntoView({ block: 'nearest' });
    }
  }
  const viewerOpen = () => Boolean(vw.el && !vw.el.hidden);
  const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The album on the page: its photos open the viewer; "Baixar todas" makes a .zip of them as
  // JPEGs, on computers.
  function setupAlbum() {
    if (offHash) removeEventListener('hashchange', offHash);
    offHash = null;
    const grid = $('.jg');
    if (!grid) return;
    const items = $$('a[data-n]', grid).map((a) => ({ full: a.href, thumb: $('img', a).getAttribute('src'), w: +a.dataset.w || 3, h: +a.dataset.h || 2, n: +a.dataset.n }));
    const album = { ...grid.dataset };
    grid.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-n]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      e.preventDefault();
      openViewer(album, items, +a.dataset.n - 1, a);
    });
    const fromHash = () => {
      const m = /^#foto-(\d+)$/.exec(location.hash);
      if (m && items[+m[1] - 1] && !viewerOpen()) openViewer(album, items, +m[1] - 1, null, { push: false });
    };
    fromHash();
    // a link to one of the photos from the same page
    offHash = fromHash;
    addEventListener('hashchange', fromHash);
    const zipBtn = $('[data-zip]');
    if (zipBtn && items.length > 1 && matchMedia('(pointer: fine)').matches) {
      zipBtn.hidden = false;
      const label = zipBtn.innerHTML;
      zipBtn.addEventListener('click', async () => {
        if (zipBtn.classList.contains('busy')) return;
        zipBtn.classList.add('busy');
        try {
          const { zip } = await import(new URL('src/zip.js', new URL(root(), location.href)).href);
          const files = [];
          for (const item of items) {
            zipBtn.textContent = `Preparando ${files.length + 1} de ${items.length}…`;
            const file = await jpeg(item, album);
            files.push({ name: file.name, blob: file });
          }
          download(new File([await zip(files)], `llamalab-${album.album || 'fotos'}.zip`, { type: 'application/zip' }));
          toast('Fotos baixadas ✺');
        } catch {
          toast(navigator.onLine ? 'Não deu para juntar as fotos. Tente de novo.' : 'Sem internet: as fotos não vieram.');
        } finally {
          zipBtn.innerHTML = label;
          zipBtn.classList.remove('busy');
        }
      });
    }
  }

  function mount() {
    // a page swapped in (the radio's): the viewer belonged to the old one
    if (viewerOpen()) closeViewer({ fromHistory: true });
    setupAlbum();

    /* events that already ended (the daily rebuild also moves them) */
    $$('[data-until]').forEach((el) => {
      if (el.dataset.until < today) el.remove();
    });

    /* the offline page, which the service worker shows for pages this device hasn't saved */
    $$('[data-retry]').forEach((btn) => btn.addEventListener('click', () => location.reload()));
    $$('[data-app-note]').forEach((el) => {
      el.hidden = installed();
    });
    // the installed app has no address bar: "Área da equipe" (footer) leads to the admin, which
    // matters on iPhone, where the app keeps its own sign-in apart from Safari
    $$('[data-app-only]').forEach((el) => {
      el.hidden = !installed() || html.hasAttribute('data-preview');
    });
    showInstall();

    /* reveal on scroll */
    if (io) io.disconnect();
    const observer = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    }), { threshold: 0.12 });
    io = observer;
    $$('[data-r],[data-split],[data-io]').forEach((el) => observer.observe(el));

    /* animations rest where nobody sees them, so phones can idle: site.css pauses what's
       inside a .rest (the stages, every llama, the footer's round badge) */
    if (rest) rest.disconnect();
    rest = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('rest', !e.isIntersecting)), { rootMargin: '120px 0px' });
    $$('.hero,.phero,.nf404,.llama,.magnet').forEach((el) => rest.observe(el));

    /* videos are their thumbnail until someone presses play: YouTube's player loads then */
    $$('.video .yt[data-yt]').forEach((link) => link.addEventListener('click', (e) => {
      const id = link.dataset.yt;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button || !/^[\w-]{11}$/.test(id)) return;
      e.preventDefault();
      const frame = d.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
      frame.title = link.getAttribute('aria-label') || 'Vídeo';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      link.replaceWith(frame);
    }));

    /* spotlight follows the pointer on dark heroes */
    $$('.hero,.phero,.nf404').forEach((stage) => {
      const target = $('.hero-in', stage) || stage;
      stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        target.style.setProperty('--mx', `${e.clientX - r.left}px`);
        target.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });

    /* headbang: on hover, and the main llama while scrolling. The big llama on the home
       page stays out of it: it only lifts a little on hover (site.css). */
    const llamas = $$('.llama').filter((l) => !l.closest('.hero'));
    llamas.forEach((l) => {
      l.addEventListener('pointerenter', () => l.classList.add('bang'));
      l.addEventListener('pointerleave', () => l.classList.remove('bang'));
    });

    /* ribbons: each repeats its phrase data-n times (parts.js) and loops by one phrase's length,
       measured on a straight, hidden copy of the text: on the curve, Firefox only counts the
       letters that fit, and its getSubStringLength() is off. */
    const tps = $$('.ribbons textPath');
    const measure = () => {
      page.unit = tps.map((tp) => {
        const copy = d.createElementNS('http://www.w3.org/2000/svg', 'text');
        copy.setAttribute('class', 'rb-text');
        copy.setAttribute('visibility', 'hidden');
        copy.append(...[...tp.childNodes].map((n) => n.cloneNode(true)));
        tp.parentNode.after(copy);
        try {
          // the second phrase's first letter (SVG drops the text's final space)
          const second = (copy.getNumberOfChars() + 1) / (Number(tp.dataset.n) || 4);
          return copy.getStartPositionOfChar(second).x - copy.getStartPositionOfChar(0).x || 900;
        } catch {
          return 900;
        } finally {
          copy.remove();
        }
      });
    };

    /* poster that follows the pointer over agenda rows */
    const followers = $$('.dates-wrap').map((wrap) => {
      const poster = $('.poster', wrap);
      if (!poster) return null;
      const f = { wrap, poster, px: 0, py: 0, tx: 0, ty: 0 };
      const art = $('.art', poster);
      const set = (key, value) => {
        const el = $(`[data-p="${key}"]`, poster);
        if (el) el.textContent = value;
      };
      wrap.addEventListener('pointermove', (e) => {
        const r = wrap.getBoundingClientRect();
        f.tx = e.clientX - r.left;
        f.ty = e.clientY - r.top;
      });
      $$('.row', wrap).forEach((row) => row.addEventListener('pointerenter', () => {
        poster.dataset.v = row.dataset.v || '0';
        set('d', $('.d b', row).textContent);
        set('m', $('.d span', row).innerText.replace(/\n/g, ' · '));
        set('t', $('h3', row).textContent);
        set('v', $('.v span', row).textContent);
        set('tag', $('.tag', row).textContent);
        const src = row.dataset.img;
        poster.classList.toggle('has-img', Boolean(src));
        art.innerHTML = '';
        if (src) {
          const im = new Image();
          im.alt = '';
          im.src = src;
          art.append(im);
        }
        poster.classList.add('on');
      }));
      wrap.addEventListener('pointerleave', () => poster.classList.remove('on'));
      return f;
    }).filter(Boolean);

    /* magnetic button */
    $$('.magnet').forEach((mag) => {
      mag.addEventListener('pointermove', (e) => {
        const r = mag.getBoundingClientRect();
        mag.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.3}px,${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      });
      mag.addEventListener('pointerleave', () => {
        mag.style.transform = '';
      });
    });

    /* mobile menu */
    const burger = $('.burger');
    const menu = $('#menu');
    let closeMenu = null;
    if (burger && menu) {
      closeMenu = () => {
        menu.hidden = true;
        burger.setAttribute('aria-expanded', 'false');
        d.body.style.overflow = '';
        burger.focus();
      };
      burger.addEventListener('click', () => {
        menu.hidden = false;
        burger.setAttribute('aria-expanded', 'true');
        d.body.style.overflow = 'hidden';
        $('nav a', menu).focus();
      });
      $('.close', menu).addEventListener('click', closeMenu);
    }

    /* share: native sheet on phones, copy the link elsewhere */
    $$('[data-share]').forEach((btn) => btn.addEventListener('click', async () => {
      const url = btn.dataset.share || location.href;
      const title = btn.dataset.title || d.title;
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
          await navigator.share({ title, url });
          return;
        } catch (error) {
          if (error && error.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copiado ✺');
      } catch {
        prompt('Copie o link:', url);
      }
    }));

    /* month chips on the home agenda */
    $$('.months [data-month]').forEach((chip, i, all) => chip.addEventListener('click', () => {
      all.forEach((c) => c.classList.toggle('on', c === chip));
      $$('#agenda li[data-month]').forEach((li) => {
        li.hidden = li.dataset.month !== chip.dataset.month;
      });
    }));
    const firstMonth = $('.months [data-month]');
    if (firstMonth) firstMonth.click();

    /* filters (event types, interview areas) */
    $$('.chips').forEach((group) => {
      const scope = group.parentElement;
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-filter]');
        if (!chip) return;
        const key = chip.dataset.filter;
        $$('[data-filter]', group).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        $$('[data-cat]', scope).forEach((el) => {
          if (el.closest('.past-list')) return;
          el.hidden = Boolean(key) && el.dataset.cat !== key;
        });
        $$('.month-block', scope).forEach((block) => {
          block.hidden = !$$('[data-cat]', block).some((el) => !el.hidden);
        });
      });
    });

    /* agenda calendar: month navigation */
    const cal = $('[data-calendar]');
    const dataEl = $('#agenda-data');
    if (cal && dataEl) {
      const events = JSON.parse(dataEl.textContent || '[]');
      const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      const months = [...new Set(events.map((e) => e.d.slice(0, 7)).concat(today.slice(0, 7)))].sort();
      let current = today.slice(0, 7);
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const render = () => {
        const [y, m] = current.split('-').map(Number);
        const first = new Date(y, m - 1, 1).getDay();
        const days = new Date(y, m, 0).getDate();
        const byDay = {};
        events.filter((e) => e.d.startsWith(current)).forEach((e) => {
          const day = +e.d.slice(8);
          (byDay[day] = byDay[day] || []).push(e);
        });
        const cells = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w) => `<i>${w}</i>`);
        for (let i = 0; i < first; i += 1) cells.push('<span aria-hidden="true"></span>');
        for (let day = 1; day <= days; day += 1) {
          const iso = `${current}-${pad(day)}`;
          const evs = byDay[day];
          const cls = [evs ? 'ev' : '', iso === today ? 'today' : ''].filter(Boolean).join(' ');
          if (evs) {
            const onPage = d.getElementById(`ev-${evs[0].id}`);
            const target = onPage && !onPage.closest('[hidden]') ? `#ev-${evs[0].id}` : `${root()}agenda/${evs[0].id}/`;
            const label = `${day} de ${MONTHS[m - 1]}: ${evs.map((e) => e.t).join(', ')}`;
            cells.push(`<a class="${cls}" href="${esc(target)}" title="${esc(label)}" aria-label="${esc(label)}">${day}</a>`);
          } else {
            cells.push(`<span${cls ? ` class="${cls}"` : ''}>${day}</span>`);
          }
        }
        $('.cal-h b', cal).textContent = MONTHS[m - 1];
        $('.cal-h span', cal).textContent = y;
        $('.cal-g', cal).innerHTML = cells.join('');
        const idx = months.indexOf(current);
        $('[data-cal="-1"]', cal).disabled = idx <= 0;
        $('[data-cal="1"]', cal).disabled = idx >= months.length - 1;
      };
      cal.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cal]');
        if (btn) {
          const idx = months.indexOf(current) + Number(btn.dataset.cal);
          if (months[idx]) {
            current = months[idx];
            render();
          }
          return;
        }
        const link = e.target.closest('.cal-g a[href^="#"]');
        if (link) {
          const target = d.getElementById(link.getAttribute('href').slice(1));
          if (target) {
            e.preventDefault();
            const details = target.closest('details');
            if (details) details.open = true;
            target.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
            target.animate([{ background: 'rgba(238,60,35,0)' }, { background: 'rgba(238,60,35,.25)' }, { background: 'rgba(238,60,35,0)' }], { duration: 1400 });
          }
        }
      });
      render();
    }

    /* the editors' shortcut, only for people who saved a token in the admin: a pencil button
       that opens "Editar esta página" (on pages that can be edited) and "Admin" */
    $$('.fab').forEach((el) => el.remove());
    let token = null;
    try {
      token = localStorage.getItem('llamalab:token');
    } catch {
      token = null;
    }
    let closeFab = null;
    if (token && !html.hasAttribute('data-preview')) {
      const fab = d.createElement('div');
      fab.className = 'fab';
      const btn = d.createElement('button');
      btn.className = 'fab-btn';
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', 'fab-menu');
      btn.setAttribute('aria-label', 'Atalhos da equipe');
      btn.innerHTML = ICON_PEN.replace('<svg', '<svg class="pen"') + ICON_X;
      const list = d.createElement('div');
      list.className = 'fab-menu';
      list.id = 'fab-menu';
      list.hidden = true;
      const link = (href, icon, label, cls) => {
        const a = d.createElement('a');
        a.href = href;
        if (cls) a.className = cls;
        a.innerHTML = icon;
        a.append(` ${label}`);
        list.append(a);
      };
      const edit = html.dataset.edit;
      if (edit) link(`${root()}admin#/${edit}`, ICON_PEN, 'Editar esta página', 'edit');
      link(`${root()}admin`, ICON_GRID, 'Admin');
      fab.append(btn, list);
      d.body.append(fab);
      const set = (open) => {
        fab.classList.toggle('open', open);
        list.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      };
      closeFab = () => set(false);
      btn.addEventListener('click', () => set(list.hidden));
      // Esc on a shortcut takes the focus back to the pencil, and the document's Esc handler
      // then closes the menu: hidden with it, the shortcut would drop the focus on the page,
      // and the next Tab would start again from the top
      list.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') btn.focus();
      });
    }

    const hero = $('.hero');
    // the seal badges turn only while they're on screen
    const rings = $$('.badge .ring');
    if (rings.length && 'IntersectionObserver' in window) {
      const seen = new IntersectionObserver((entries) => entries.forEach((e) => { e.target.inView = e.isIntersecting; }));
      rings.forEach((ring) => seen.observe(ring));
    }
    page = {
      nav: $('#nav'),
      hero,
      hin: hero && $('.hero-in', hero),
      hl: hero && $('.hero-llama', hero),
      bs: $('#backstage'),
      track: $('#track'),
      bar: $('#bar'),
      rings,
      llama: llamas[0],
      tps,
      unit: tps.map(() => 900),
      measure,
      followers,
      menu,
      closeMenu,
      closeFab,
    };
    if (tps.length) measure();
    offlineNote();
  }

  mount();
  if (d.fonts) {
    d.fonts.ready.then(() => page.tps.length && page.measure());
    d.fonts.addEventListener('loadingdone', () => page.tps.length && page.measure());
  }
  // the ribbons' letters change size at the phone breakpoint (site.css), e.g. when a phone turns
  matchMedia('(max-width: 760px)').addEventListener('change', () => page.tps.length && page.measure());
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (page.menu && !page.menu.hidden) page.closeMenu();
    if (page.closeFab) page.closeFab();
  });
  // a tap anywhere but the editors' shortcut closes it
  d.addEventListener('click', (e) => {
    if (page.closeFab && !e.target.closest('.fab')) page.closeFab();
  });

  /* headbang while scrolling */
  let bangTimer;
  const bang = () => {
    const main = page.llama;
    if (!main) return;
    main.classList.add('bang');
    clearTimeout(bangTimer);
    bangTimer = setTimeout(() => {
      if (!main.matches(':hover')) main.classList.remove('bang');
    }, 650);
  };

  /* one animation loop. It only writes to the page when a value changed: rewriting the
     same style or attribute every frame still costs phones a redraw. And it sleeps when
     nothing moves, woken by scrolling, the pointer and resizing, so a still page costs
     the phone nothing. */
  let lastY = -1; // read in the first frame: reading it while the page loads forces a layout
  let vel = 0;
  let rot = 0;
  let lastT = 0;
  let drift = 0; // seconds the ribbons have flowed; they stand still in lite mode
  let raf = 0;
  let odd = false;
  const TOUCH = matchMedia('(pointer: coarse)').matches;
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const frame = (t) => {
    raf = 0;
    const { nav, hero, hin, hl, bs, track, bar, rings, tps, unit, followers } = page;
    const y = scrollY;
    if (lastY < 0) lastY = y;
    const dy = y - lastY;
    lastY = y;
    // the ribbons flow while the home stage shows, except in lite mode or with reduced motion
    const flowing = Boolean(hero && tps.length && !RM && !lite() && y < innerHeight);
    if (lastT && flowing) drift += Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    vel += (dy - vel) * 0.12;
    if (Math.abs(dy) > 3) bang();
    if (nav) nav.classList.toggle('scrolled', y > 30);
    const vh = innerHeight;
    if (hero) {
      const hp = Math.min(1, y / vh);
      const value = hp.toFixed(4);
      if (value !== page.hp) {
        page.hp = value;
        // Without CSS scroll animations, shrink and dim the stage from here. Writing the
        // two elements' own styles (not a variable the whole stage inherits) keeps it cheap.
        if (!SCROLL_FX && !RM) {
          hin.style.transform = `scale(${(1 - hp * 0.1).toFixed(4)}) translateY(${(-hp * 4).toFixed(2)}%)`;
          hin.style.opacity = (1 - hp * 0.85).toFixed(3);
          if (hl) hl.style.transform = `translateX(-50%) translateY(${(hp * 12).toFixed(2)}%)`;
        }
        hero.classList.toggle('off', hp >= 1);
      }
      // The ribbons flow by themselves and with the scroll; in lite mode only with the
      // scroll, so nothing is redrawn while the page is still.
      // Phones redraw them every other frame: they move slowly, and it halves the cost.
      const key = `${drift.toFixed(3)}|${y}`;
      if (hp < 1 && !RM && key !== page.ribbonKey && (!TOUCH || (odd = !odd))) {
        page.ribbonKey = key;
        tps.forEach((tp, i) => {
          const u = unit[i] || 900;
          const off = ((drift * (i ? 38 : 55)) + y * 0.5) % u;
          tp.setAttribute('startOffset', i ? (off - u).toFixed(1) : (-off).toFixed(1));
        });
      }
    }
    if (bs && track && innerWidth > 760) {
      const r = bs.getBoundingClientRect();
      const total = bs.offsetHeight - vh;
      const p = Math.min(1, Math.max(0, -r.top / total));
      const max = track.scrollWidth - innerWidth;
      track.style.transform = `translate3d(${(-p * Math.max(0, max)).toFixed(1)}px,0,0)`;
      if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
    }
    if (rings.length && !RM) {
      // a slow turn, faster while scrolling; in lite mode only while scrolling
      const step = (lite() ? 0 : 0.25) + Math.min(6, Math.abs(vel) * 0.25);
      if (step > 0.01) {
        rot += step;
        rings.forEach((ring) => {
          if (ring.inView !== false) ring.style.transform = `rotate(${rot.toFixed(2)}deg)`;
        });
      }
    }
    let following = false;
    for (const f of followers) {
      if (!f.poster.classList.contains('on')) continue;
      f.px += (f.tx - f.px) * 0.14;
      f.py += (f.ty - f.py) * 0.14;
      f.poster.style.transform = `translate(${(f.px + 30).toFixed(1)}px,${(f.py - 165).toFixed(1)}px) rotate(${((f.tx - f.px) * 0.06).toFixed(2)}deg)`;
      if (Math.abs(f.tx - f.px) > 0.3 || Math.abs(f.ty - f.py) > 0.3) following = true;
    }
    const turning = rings.length && !RM && rings.some((r) => r.inView !== false) && (!lite() || Math.abs(vel) > 0.05);
    if (flowing || dy || Math.abs(vel) > 0.05 || following || turning) wake();
  };
  addEventListener('scroll', wake, { passive: true });
  addEventListener('resize', wake);
  d.addEventListener('pointermove', wake, { passive: true });
  wake();

  /* Offline: the service worker (sw.js, built from src/sw.js) keeps the base files and the
     pages and images opened along the way. ?sw=off in the address removes it and what it
     saved, in this browser, until ?sw=on. */
  const SW_KEY = 'llamalab:sw';
  (() => {
    if (!('serviceWorker' in navigator) || html.hasAttribute('data-preview')) return;
    let off = false;
    try {
      const m = /[?&]sw=(on|off)\b/.exec(location.search);
      if (m && m[1] === 'off') localStorage.setItem(SW_KEY, 'off');
      if (m && m[1] === 'on') localStorage.removeItem(SW_KEY);
      off = localStorage.getItem(SW_KEY) === 'off';
    } catch { /* storage blocked: keep the worker */ }
    if (off) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      if (window.caches) caches.keys().then((names) => names.filter((n) => n.startsWith('llamalab-')).forEach((n) => caches.delete(n)));
      return;
    }
    // A page that loaded before the worker ran (the first visit) tells it about itself and its
    // images, so the page someone arrived on stays readable too.
    const arrived = !navigator.serviceWorker.controller;
    const register = () => navigator.serviceWorker.register(`${root()}sw.js`)
      .then(() => arrived && navigator.serviceWorker.ready)
      .then((reg) => {
        if (!reg || !reg.active) return;
        const images = $$('img').filter((im) => im.complete && im.naturalWidth).map((im) => im.currentSrc || im.src);
        reg.active.postMessage({ type: 'seen', urls: [location.href, ...images] });
      })
      .catch(() => { /* no offline copy: the site works as before */ });
    if (d.readyState === 'complete') register();
    else addEventListener('load', register, { once: true });

    // The installed app keeps the whole site, every page and image, and the worker keeps it
    // current at each deploy. Asked once per launch, and right after installing (Android).
    const keepSite = () => navigator.serviceWorker.ready
      .then((reg) => reg.active && reg.active.postMessage({ type: 'keep', pack: 'site' }))
      .catch(() => { /* only what was opened stays */ });
    try {
      if (installed() && !sessionStorage.getItem('llamalab:kept')) {
        sessionStorage.setItem('llamalab:kept', '1');
        keepSite();
      }
    } catch {
      if (installed()) keepSite();
    }
    addEventListener('appinstalled', keepSite);
  })();

  /* From page to page without reloading, once the radio is on (radio.js adds radio-on
     to <html> when Spotify's player exists), so the music keeps going. The new page's
     content (#pagina), nav and menu replace the current ones; the radio stays where it
     is, and so does the nav's play/pause, which moves into the new nav. Anything that
     isn't a page of the site (other sites, files, the admin) loads as usual, and so does
     any page that fails to load this way. */
  const live = () => html.classList.contains('radio-on');

  function sitePage(a, e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return null;
    if (!url.pathname.startsWith(new URL(root(), location.href).pathname)) return null;
    if (!/\/$|\.html$/.test(url.pathname)) return null;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  // The head's own links (icon, feed…) are relative, and browsers read some of them again
  // as soon as the address changes, before the new page arrives: make them absolute.
  const HEAD_LINKS = 'link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"],link[rel="alternate"],link[rel="canonical"]';
  const pinHead = () => $$(HEAD_LINKS).forEach((link) => link.setAttribute('href', link.href));

  let loading = null;
  async function go(url, { push = true, y = 0 } = {}) {
    pinHead();
    if (loading) loading.abort();
    const ctrl = new AbortController();
    loading = ctrl;
    let doc;
    try {
      const res = await fetch(url.href, { signal: ctrl.signal, headers: { Accept: 'text/html' } });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      if (!(res.headers.get('content-type') || '').includes('text/html')) throw new Error('not a page');
      doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      if (res.redirected && res.url) {
        // e.g. a folder without its final slash: the address must be the page's real one
        const hash = url.hash;
        url = new URL(res.url);
        url.hash = hash;
      }
    } catch (error) {
      if (error.name !== 'AbortError') location.assign(url.href);
      return;
    }
    if (ctrl !== loading) return;
    loading = null;
    const next = doc.getElementById('pagina');
    if (!next) {
      location.assign(url.href);
      return;
    }
    if (push) {
      history.replaceState({ ...history.state, ll: true, y: scrollY }, '');
      history.pushState({ ll: true, y: 0 }, '', url.href);
    }

    // the description, canonical and head links come from the new page (the stylesheets
    // and scripts stay: they're already loaded and the same everywhere)
    d.title = doc.title;
    for (const sel of ['meta[name="description"]', ...HEAD_LINKS.split(',')]) {
      const mine = $(sel);
      const theirs = doc.querySelector(sel);
      if (mine && theirs) mine.replaceWith(d.importNode(theirs, true));
    }
    pinHead();
    for (const attr of ['data-root', 'data-edit']) {
      const v = doc.documentElement.getAttribute(attr);
      if (v === null) html.removeAttribute(attr);
      else html.setAttribute(attr, v);
    }
    d.body.className = doc.body.className;
    d.body.style.overflow = '';

    const som = $('#nav .som');
    const nav = d.importNode(doc.getElementById('nav'), true);
    const slot = $('.som', nav);
    if (som && slot) slot.replaceWith(som);
    $('#nav').replaceWith(nav);
    $('#menu').replaceWith(d.importNode(doc.getElementById('menu'), true));
    $('#pagina').replaceWith(d.importNode(next, true));
    mount();
    wake();

    const target = url.hash && d.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target) target.scrollIntoView();
    else scrollTo(0, y);
    lastY = scrollY;
    const main = $('#conteudo');
    if (main) {
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  }

  d.addEventListener('click', (e) => {
    if (!live()) return;
    const a = e.target.closest('a[href]');
    const url = a && sitePage(a, e);
    if (!url) return;
    e.preventDefault();
    go(url, { push: url.href !== location.href });
  });
  addEventListener('popstate', (e) => {
    // the back button closes the photo viewer, and stays on the page
    if (vw.closing) {
      vw.closing = false;
      return;
    }
    if (viewerOpen()) {
      closeViewer({ fromHistory: true });
      return;
    }
    if (e.state && e.state.vw) return;
    if (e.state && e.state.ll) go(new URL(location.href), { push: false, y: e.state.y || 0 });
  });
  if ('scrollRestoration' in history) {
    new MutationObserver(() => {
      if (live()) history.scrollRestoration = 'manual';
    }).observe(html, { attributes: true, attributeFilter: ['class'] });
  }
})();
