// LlamaLab public pages: stage animations, agenda calendar and filters, sharing
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

  function mount() {
    /* events that already ended (the daily rebuild also moves them) */
    $$('[data-until]').forEach((el) => {
      if (el.dataset.until < today) el.remove();
    });

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

    /* ribbons: each repeats its phrase 4 times and loops by one phrase's length, measured
       on a straight, hidden copy of the text: on the curve, Firefox only counts the letters
       that fit, and its getSubStringLength() is off. */
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
          const second = (copy.getNumberOfChars() + 1) / 4;
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

    /* admin shortcut, only for people who saved a token in the admin */
    $$('.admin-fab').forEach((el) => el.remove());
    let token = null;
    try {
      token = localStorage.getItem('llamalab:token');
    } catch {
      token = null;
    }
    if (token && !html.hasAttribute('data-preview')) {
      const fab = d.createElement('a');
      fab.className = 'admin-fab';
      fab.href = `${root()}admin`;
      fab.innerHTML = '<span>✺</span> Admin';
      d.body.append(fab);
      const edit = html.dataset.edit;
      if (edit) {
        const e = d.createElement('a');
        e.className = 'admin-fab';
        e.href = `${root()}admin#/${edit}`;
        e.innerHTML = '<span>✎</span> Editar esta página';
        d.body.append(e);
      }
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
    };
    if (tps.length) measure();
  }

  mount();
  if (d.fonts) {
    d.fonts.ready.then(() => page.tps.length && page.measure());
    d.fonts.addEventListener('loadingdone', () => page.tps.length && page.measure());
  }
  // the ribbons' letters change size at the phone breakpoint (site.css), e.g. when a phone turns
  matchMedia('(max-width: 760px)').addEventListener('change', () => page.tps.length && page.measure());
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && page.menu && !page.menu.hidden) page.closeMenu();
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
  const HEAD_LINKS = 'link[rel="icon"],link[rel="apple-touch-icon"],link[rel="alternate"],link[rel="canonical"]';
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
    if (e.state && e.state.ll) go(new URL(location.href), { push: false, y: e.state.y || 0 });
  });
  if ('scrollRestoration' in history) {
    new MutationObserver(() => {
      if (live()) history.scrollRestoration = 'manual';
    }).observe(html, { attributes: true, attributeFilter: ['class'] });
  }
})();
