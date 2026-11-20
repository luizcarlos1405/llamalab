// LlamaLab public pages: stage animations, agenda calendar and filters, sharing
// and the admin shortcut. Pages are prerendered; this only adds behaviour.
(() => {
  const d = document;
  const html = d.documentElement;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => [...c.querySelectorAll(s)];
  const root = html.dataset.root || './';
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  /* events that already ended (the daily rebuild also moves them) */
  $$('[data-until]').forEach((el) => {
    if (el.dataset.until < today) el.remove();
  });

  /* reveal on scroll */
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }), { threshold: 0.12 });
  $$('[data-r],[data-split],[data-io]').forEach((el) => io.observe(el));
  requestAnimationFrame(() => setTimeout(() => html.classList.add('ready'), 60));

  /* spotlight follows the pointer on dark heroes */
  $$('.hero,.phero,.nf404').forEach((stage) => {
    const target = $('.hero-in', stage) || stage;
    stage.addEventListener('pointermove', (e) => {
      const r = stage.getBoundingClientRect();
      target.style.setProperty('--mx', `${e.clientX - r.left}px`);
      target.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  /* headbang: on hover, and the main llama while scrolling */
  const llamas = $$('.llama');
  let bangTimer;
  const bang = () => {
    const main = llamas[0];
    if (!main) return;
    main.classList.add('bang');
    clearTimeout(bangTimer);
    bangTimer = setTimeout(() => {
      if (!main.matches(':hover')) main.classList.remove('bang');
    }, 650);
  };
  llamas.forEach((l) => {
    l.addEventListener('pointerenter', () => l.classList.add('bang'));
    l.addEventListener('pointerleave', () => l.classList.remove('bang'));
  });

  /* ribbons: each repeats its phrase 4 times; loop by one phrase length */
  const tps = $$('.ribbons textPath');
  let unit = tps.map(() => 900);
  const measure = () => {
    unit = tps.map((tp) => {
      try {
        return tp.getComputedTextLength() / 4 || 900;
      } catch {
        return 900;
      }
    });
  };
  if (tps.length) {
    measure();
    if (d.fonts) {
      d.fonts.ready.then(measure);
      d.fonts.addEventListener('loadingdone', measure);
    }
  }

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

  /* one animation loop */
  const nav = $('#nav');
  const hero = $('.hero');
  const hin = hero && $('.hero-in', hero);
  const bs = $('#backstage');
  const track = $('#track');
  const bar = $('#bar');
  const rings = $$('.badge .ring');
  let lastY = scrollY;
  let vel = 0;
  let rot = 0;
  const t0 = performance.now();
  const frame = (t) => {
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    vel += (dy - vel) * 0.12;
    if (Math.abs(dy) > 3) bang();
    if (nav) nav.classList.toggle('scrolled', y > 30);
    const vh = innerHeight;
    if (hero) {
      const hp = Math.min(1, y / vh);
      hin.style.setProperty('--hp', hp.toFixed(4));
      hero.classList.toggle('off', hp >= 1);
      if (hp < 1 && !RM) {
        const tt = (t - t0) / 1000;
        tps.forEach((tp, i) => {
          const u = unit[i] || 900;
          const off = ((tt * (i ? 38 : 55)) + y * 0.5) % u;
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
      rot += 0.25 + Math.min(6, Math.abs(vel) * 0.25);
      rings.forEach((ring) => {
        ring.style.transform = `rotate(${rot.toFixed(2)}deg)`;
      });
    }
    for (const f of followers) {
      if (!f.poster.classList.contains('on')) continue;
      f.px += (f.tx - f.px) * 0.14;
      f.py += (f.ty - f.py) * 0.14;
      f.poster.style.transform = `translate(${(f.px + 30).toFixed(1)}px,${(f.py - 165).toFixed(1)}px) rotate(${((f.tx - f.px) * 0.06).toFixed(2)}deg)`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* mobile menu */
  const burger = $('.burger');
  const menu = $('#menu');
  if (burger && menu) {
    const close = () => {
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
    $('.close', menu).addEventListener('click', close);
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
  }

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
          const target = onPage && !onPage.closest('[hidden]') ? `#ev-${evs[0].id}` : `${root}agenda/${evs[0].id}/`;
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
  let token = null;
  try {
    token = localStorage.getItem('llamalab:token');
  } catch {
    token = null;
  }
  if (token && !html.hasAttribute('data-preview')) {
    const fab = d.createElement('a');
    fab.className = 'admin-fab';
    fab.href = `${root}admin.html`;
    fab.innerHTML = '<span>✺</span> Admin';
    d.body.append(fab);
    const edit = html.dataset.edit;
    if (edit) {
      const e = d.createElement('a');
      e.className = 'admin-fab';
      e.href = `${root}admin.html#/${edit}`;
      e.innerHTML = '<span>✎</span> Editar esta página';
      d.body.append(e);
    }
  }
})();
