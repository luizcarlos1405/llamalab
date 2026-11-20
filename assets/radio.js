// The radio: the team's Spotify playlists as stations on a dial, docked at the bottom
// of every page, with play/pause next to the bars in the nav.
//
// - First visit: a random station, kept in localStorage; later visits start from the
//   last one chosen. Nothing plays by itself: browsers block it.
// - Spotify's player (its iFrame API) only loads when the visitor presses play, so
//   pages stay light and nothing of Spotify's runs before the visitor chooses to listen.
//   From then on, links within the site swap the page instead of reloading it
//   (site.js, while <html> has the class radio-on), so the music keeps going.
// - The handle on top hides the radio below the screen and brings it back; that's
//   remembered too.
(() => {
  const d = document;
  const html = d.documentElement;
  const radio = d.getElementById('radio');
  if (!radio || html.hasAttribute('data-preview')) return;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => [...c.querySelectorAll(s)];
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const API = 'https://open.spotify.com/embed/iframe-api/v1';
  const KEY = { station: 'llamalab:estacao', hidden: 'llamalab:radio' };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private browsing: just not remembered */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* same */ } },
  };

  const dialButtons = $$('.st', radio);
  const stations = dialButtons.map((b) => ({ id: b.dataset.id, name: b.textContent.trim(), x: b.style.getPropertyValue('--x') }));
  if (!stations.length) return;
  const uri = (i) => `spotify:playlist:${stations[i].id}`;

  let idx = stations.findIndex((s) => s.id === store.get(KEY.station));
  if (idx < 0) {
    idx = Math.floor(Math.random() * stations.length);
    store.set(KEY.station, stations[idx].id);
  }

  let api = null; // Spotify's iFrame API, once asked for
  let controller = null; // Spotify's player
  let creating = false;
  let wantPlay = false; // play as soon as the player is ready
  let playing = false;
  // One load at a time: while Spotify's player loads a station (until it says 'ready'),
  // its updates are about the old one, and a new choice waits for its turn.
  let loadingId = null;
  let loadTimer = 0;
  let fresh = true; // the station loaded last hasn't played yet: play(), not resume()
  let hintTimer = 0;
  const hint = $('.sp-hint', radio);

  /* ---------- state → page ---------- */
  function render() {
    const s = stations[idx];
    html.dataset.player = !controller && !wantPlay ? 'invite' : playing ? 'playing' : wantPlay ? 'loading' : 'paused';
    radio.style.setProperty('--c', idx);
    radio.style.setProperty('--cx', s.x);
    dialButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
    $$('[data-radio-name]').forEach((el) => { el.textContent = s.name; });
    $$('.som-btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(playing));
      b.setAttribute('aria-label', `${playing ? 'Pausar' : 'Tocar'} o rádio: ${s.name}`);
    });
    $$('.som-tip small').forEach((el) => { el.textContent = html.dataset.player === 'invite' ? 'Bota um som?' : playing ? 'No ar' : 'Pausado'; });
    wake();
  }

  /* ---------- Spotify ---------- */
  function loadApi() {
    if (!api) {
      api = new Promise((resolve, reject) => {
        const fail = () => {
          api = null;
          reject(new Error('Spotify iFrame API'));
        };
        const timer = setTimeout(fail, 15000);
        window.onSpotifyIframeApiReady = (IFrameAPI) => {
          clearTimeout(timer);
          resolve(IFrameAPI);
        };
        const s = d.createElement('script');
        s.src = API;
        s.async = true;
        s.onerror = () => {
          clearTimeout(timer);
          fail();
        };
        d.head.append(s);
      });
    }
    return api;
  }

  function say(text) {
    hint.textContent = text;
    hint.hidden = false;
  }

  // If the music hasn't started a few seconds after we asked (some browsers, Safari
  // above all, only let a click inside Spotify's player start it), point at its button.
  function armHint() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (playing) return;
      wantPlay = false;
      say('Aperta o ▶ do Spotify');
      render();
    }, 5000);
  }
  function clearHint() {
    clearTimeout(hintTimer);
    hint.hidden = true;
  }

  async function start() {
    wantPlay = true;
    clearHint();
    render();
    if (controller) {
      controller.play();
      armHint();
      return;
    }
    if (creating) return;
    creating = true;
    let IFrameAPI;
    try {
      IFrameAPI = await loadApi();
    } catch {
      creating = false;
      wantPlay = false;
      render();
      say('O Spotify não carregou. Tenta de novo?');
      return;
    }
    const el = d.createElement('div');
    $('.sp', radio).replaceChildren(el);
    loadingId = stations[idx].id;
    IFrameAPI.createController(el, { uri: uri(idx), width: '100%', height: 80, theme: 'dark' }, (c) => {
      controller = c;
      creating = false;
      html.classList.add('radio-on');
      const frame = $('.sp iframe', radio);
      if (frame) frame.title = 'Player do Spotify';
      // 'ready' comes after the first load and after every loadUri
      c.addListener('ready', loaded);
      c.addListener('playback_update', ({ data }) => {
        if (loadingId || !data) return;
        const now = !data.isPaused;
        if (now) {
          wantPlay = false;
          fresh = false;
          clearHint();
        }
        if (now !== playing) {
          playing = now;
          render();
        }
      });
      render();
    });
  }

  function toggle() {
    if (!controller) {
      start();
      return;
    }
    if (playing || wantPlay) {
      wantPlay = false;
      playing = false;
      clearHint();
      controller.pause();
      render();
    } else {
      wantPlay = true;
      if (loadingId) {
        // still loading: 'ready' will play it
      } else if (fresh) controller.play();
      else controller.resume();
      armHint();
      render();
    }
  }

  function load(i) {
    loadingId = stations[i].id;
    fresh = true;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(loaded, 10000); // if 'ready' never comes, carry on anyway
    controller.loadUri(uri(i));
  }

  function loaded() {
    clearTimeout(loadTimer);
    const done = loadingId;
    loadingId = null;
    if (done !== stations[idx].id) {
      // the visitor turned the dial while it loaded: now load where it stopped
      load(idx);
      return;
    }
    if (wantPlay) {
      controller.play();
      armHint();
    } else if (playing) {
      playing = false;
      render();
    }
  }

  function select(i, play) {
    idx = (i + stations.length) % stations.length;
    store.set(KEY.station, stations[idx].id);
    if (controller) {
      wantPlay = play;
      clearHint();
      if (!loadingId) load(idx);
    } else if (play) {
      start();
      return;
    }
    render();
  }

  /* ---------- hide below the screen / bring back ---------- */
  const alca = $('.alca', radio);
  function hide(v) {
    radio.dataset.hidden = String(v);
    alca.setAttribute('aria-expanded', String(!v));
    alca.setAttribute('aria-label', v ? 'Mostrar o rádio' : 'Esconder o rádio');
    $$(':scope > :not(.alca)', radio).forEach((el) => { el.inert = v; });
    space();
  }

  // The room the radio takes at the bottom of the screen, kept free at the end of the
  // page so the footer's last line isn't stuck behind it.
  function space() {
    const down = parseFloat(getComputedStyle(radio).bottom) || 0;
    const room = radio.dataset.hidden === 'true' ? 40 : radio.offsetHeight + down + 12;
    html.style.setProperty('--radio-space', `${Math.round(room)}px`);
  }

  /* ---------- the bars: not the song's spectrum (Spotify's player gives no audio data),
     but a beat read like an analyzer: kick on every beat, snare on 2 and 4, hi-hats in
     between, fast rise and slow fall. Paused, they settle low and the loop stops. */
  const BPM = 116;
  const REST = 0.14;
  const STILL = [0.8, 0.55, 0.7, 0.45, 0.6];
  const levels = new WeakMap();
  let raf = 0;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function wake() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    let moving = false;
    const t = now / 1000;
    const beat = 60 / BPM;
    const ph = t % beat;
    const kick = Math.exp(-ph / 0.11);
    const snare = Math.floor(t / beat) % 2 ? Math.exp(-ph / 0.17) : 0;
    const hat = Math.exp(-(t % (beat / 2)) / 0.05);
    for (const el of d.querySelectorAll('.eqv')) {
      const bars = el.children;
      let st = levels.get(el);
      if (!st) {
        st = { lv: Array.from(bars, () => REST), dr: Array.from(bars, () => Math.random()) };
        levels.set(el, st);
      }
      for (let i = 0; i < bars.length; i += 1) {
        const band = bars.length > 1 ? i / (bars.length - 1) : 0.5;
        let target = REST;
        if (playing && RM) target = STILL[i % STILL.length];
        else if (playing) {
          st.dr[i] = clamp(st.dr[i] + (Math.random() - 0.5) * 0.18, 0, 1);
          target = 0.1 + 0.85 * (0.6 * (1 - band) ** 1.4 * kick + 0.45 * (1 - Math.abs(band - 0.5) * 2) * snare + 0.4 * band ** 1.4 * hat + 0.32 * st.dr[i]);
        }
        target = clamp(target, 0.1, 1);
        const v = st.lv[i];
        const next = RM ? target : v + (target - v) * (target > v ? 0.55 : 0.12);
        st.lv[i] = next;
        if (Math.abs(next - target) > 0.003) moving = true;
        bars[i].style.transform = `scaleY(${next.toFixed(3)})`;
      }
    }
    if (playing || moving) raf = requestAnimationFrame(frame);
  }

  /* ---------- clicks ---------- */
  radio.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b === alca) {
      const v = radio.dataset.hidden !== 'true';
      hide(v);
      if (v) store.set(KEY.hidden, 'escondido');
      else store.del(KEY.hidden);
    } else if (b.classList.contains('st')) select(dialButtons.indexOf(b), true);
    else if (b.dataset.radio === 'play') start();
    else if (b.dataset.radio === 'next') select(idx + 1, playing || wantPlay);
    else if (b.dataset.radio === 'prev') select(idx - 1, playing || wantPlay);
  });
  // the nav moves from page to page with site.js, so listen on the document
  d.addEventListener('click', (e) => {
    if (e.target.closest('.som-btn')) toggle();
  });

  hide(store.get(KEY.hidden) === 'escondido');
  render();
  radio.hidden = false;
  space();
  if ('ResizeObserver' in window) new ResizeObserver(space).observe(radio);
})();
