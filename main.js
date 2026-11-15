// Photos are shown heavily dithered in black & white. When one reaches the middle of the screen
// the dither dissolves away, dot by dot, to reveal the full-colour photo underneath.

// my age, worked out from my birthday (27 September 2009), so it goes up by itself every year
{
  const now = new Date(), born = { y: 2009, m: 8, d: 27 };          // months count from 0, so 8 = September
  const age = now.getFullYear() - born.y - ((now.getMonth() < born.m || (now.getMonth() === born.m && now.getDate() < born.d)) ? 1 : 0);
  document.querySelectorAll('.age').forEach(el => { el.textContent = age; });
}

// where the page opens:
//  - refresh: always the very top
//  - back / forward (e.g. swiping back from the photos page): exactly where you were
//  - a link to a section, like "index.html#photos": that section
// The browser's own scroll restoring is turned off (it would also restore on refresh), so the
// page remembers its own scroll position each time you leave it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
{
  const nav = performance.getEntriesByType('navigation')[0];
  const type = nav ? nav.type : 'navigate';
  const key = 'scroll:' + location.pathname;
  const jump = y => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, y); document.documentElement.style.scrollBehavior = ''; };
  addEventListener('pagehide', () => { try { sessionStorage.setItem(key, String(Math.round(scrollY))); } catch {} });
  // Safari sometimes keeps the whole page in memory and shows it again on back: keep it where you were
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    let y = null;
    try { y = sessionStorage.getItem(key); } catch {}
    if (y !== null) jump(+y);
  });
  // apply the starting position now, again once fonts and images have loaded (the page gets
  // taller as they arrive) - unless you've already started scrolling yourself
  let moved = false;
  ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach(t => addEventListener(t, () => { moved = true; }, { passive: true, once: true }));
  const settle = fn => { fn(); document.fonts.ready.then(() => { if (!moved) fn(); }); addEventListener('load', () => { if (!moved) fn(); }); };

  let saved = null;
  try { saved = sessionStorage.getItem(key); } catch {}
  if (type === 'reload') {
    // refresh: always the very top
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    settle(() => jump(0));
  } else if (type === 'back_forward' && saved !== null) {
    // back / forward: exactly where you were
    settle(() => jump(+saved));
  } else if (location.hash) {
    // a link to a section, like "index.html#photos": that section
    const go = () => { const t = document.querySelector(location.hash); if (t) { document.documentElement.style.scrollBehavior = 'auto'; t.scrollIntoView(); document.documentElement.style.scrollBehavior = ''; } };
    addEventListener('load', () => document.fonts.ready.then(go));
  } else if (saved !== null) {
    // coming back to a page you've already seen in this tab (iPhone Safari sometimes reports a
    // swipe back as a new visit): where you were
    settle(() => jump(+saved));
  } else {
    // first visit: the top
    settle(() => jump(0));
  }
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// how fast the page is scrolling (px per second, smoothed). Photos dissolve to colour at their
// normal pace when you scroll slowly, and faster the faster you scroll, so you still see colour.
let scrollSpeed = 0;
{
  let lastY = scrollY, lastT = performance.now();
  addEventListener('scroll', () => {
    const now = performance.now(), dt = Math.max(1, now - lastT);
    const v = Math.abs(scrollY - lastY) / dt * 1000;
    scrollSpeed = scrollSpeed * 0.6 + v * 0.4;
    lastY = scrollY; lastT = now;
  }, { passive: true });
  // ease back to zero once scrolling stops
  setInterval(() => { if (performance.now() - lastT > 120) scrollSpeed *= 0.5; }, 100);
}
// 0.3s when still or slow (under ~400 px/s), down to 0.06s when flicking fast
const dissolveTime = () => Math.max(0.06, 0.3 / (1 + Math.max(0, scrollSpeed - 400) / 500));
const DOT = 2; // css px per dither dot
// the size of a dot snapped to whole screen pixels, so dots stay even and crisp at any zoom level
const dotPx = css => Math.max(1, Math.round(css * devicePixelRatio)) / devicePixelRatio;

// 8x8 Bayer matrix, used as the order in which dots dissolve
const BAYER = (() => {
  let b = [[0, 2], [3, 1]];
  for (let n = 2; n < 8; n *= 2) {
    const nb = [];
    for (let y = 0; y < n * 2; y++) {
      nb[y] = [];
      for (let x = 0; x < n * 2; x++) {
        const q = (y < n ? 0 : 2) + (x < n ? 0 : 1);
        nb[y][x] = 4 * b[y % n][x % n] + [0, 2, 3, 1][q];
      }
    }
    b = nb;
  }
  return Float32Array.from(b.flat(), v => (v + 0.5) / 64);
})();

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true });

// Atkinson dither of `img` (cover-fitted) into w x h black/white pixels
function dither(img, w, h) {
  scratch.width = w; scratch.height = h;
  const ir = img.naturalWidth / img.naturalHeight, cr = w / h;
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (ir > cr) { sw = sh * cr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / cr; sy = (img.naturalHeight - sh) / 2; }
  sctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const d = sctx.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) {
    const l = Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
    L[i] = l; hist[l]++;
  }
  // auto-levels: stretch each photo between its 2nd and 98th percentile,
  // then lift the midtones a little so night shots don't dither to solid black
  const pct = p => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p * L.length) return v; } return 255; };
  const lo = pct(0.02), hi = Math.max(lo + 24, pct(0.98));
  let mean = 0;
  for (let i = 0; i < L.length; i++) { L[i] = Math.min(1, Math.max(0, (L[i] - lo) / (hi - lo))); mean += L[i]; }
  mean /= L.length;
  const gamma = Math.min(1, Math.max(0.45, Math.log(0.45) / Math.log(Math.max(0.02, mean))));
  for (let i = 0; i < L.length; i++) L[i] = Math.pow(L[i], gamma);
  // local contrast: push every pixel away from the blurred average around it, so outlines,
  // faces and shapes survive the dither instead of turning into flat noise
  const blur = (src, r) => {
    const tmp = new Float32Array(src.length), dst = new Float32Array(src.length), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let s = 0; const o = y * w;
      for (let k = -r; k <= r; k++) s += src[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / n;
        s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = s / n;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return dst;
  };
  const near = blur(L, 2), wide = blur(blur(L, Math.max(4, Math.round(Math.min(w, h) / 24))), 2);
  for (let i = 0; i < L.length; i++) {
    let v = L[i] + (L[i] - near[i]) * 0.7 + (L[i] - wide[i]) * 0.5;   // fine edges + big shapes
    v = 0.5 + (v - 0.5) * 1.1;                                          // a touch more overall contrast
    L[i] = Math.min(1, Math.max(0, v));
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = L[i] > 0.5 ? 1 : 0, e = (L[i] - v) / 8;
      out[i] = v;
      if (x + 1 < w) L[i + 1] += e;
      if (x + 2 < w) L[i + 2] += e;
      if (y + 1 < h) {
        if (x > 0) L[i + w - 1] += e;
        L[i + w] += e;
        if (x + 1 < w) L[i + w + 1] += e;
      }
      if (y + 2 < h) L[i + 2 * w] += e;
    }
  }
  return out;
}

class Photo {
  constructor(fig) {
    this.fig = fig;
    fig._photo = this;
    this.img = fig.querySelector('img');
    this.c = document.createElement('canvas');
    this.c.setAttribute('aria-hidden', 'true');
    fig.appendChild(this.c);
    this.t = 0;        // 0 = fully dithered, 1 = fully colour
    this.target = 0;
    this.raf = 0;
    // colour only when it's in the middle of the screen (hovering does nothing)
    this.lit = false;
    fig.addEventListener('click', () => viewer.open(fig));
  }
  async build() {
    if (!this.img.complete || !this.img.naturalWidth) {
      try { await this.img.decode(); } catch { return; }
    }
    const r = this.fig.getBoundingClientRect();
    const d = dotPx(DOT);
    const w = Math.max(8, Math.ceil(r.width / d)), h = Math.max(8, Math.ceil(r.height / d));
    this.dpr = devicePixelRatio;
    this.c.style.width = (w * d) + 'px'; this.c.style.height = (h * d) + 'px';   // whole screen pixels per dot
    const bits = dither(this.img, w, h);
    this.c.width = w; this.c.height = h;
    this.ctx = this.c.getContext('2d');
    this.data = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.data.data.buffer);
    this.bits = bits; this.w = w; this.h = h;
    // a copy that's always fully dithered: the melting band at the top uses this, so a photo
    // that's showing in colour still melts away as dots, never as a smeared colour photo
    this.full = this.full || document.createElement('canvas');
    this.full.width = w; this.full.height = h;
    const fd = new ImageData(w, h), fp = new Uint32Array(fd.data.buffer);
    for (let i = 0; i < bits.length; i++) fp[i] = bits[i] ? 0xffffffff : 0xff000000;
    this.full.getContext('2d').putImageData(fd, 0, 0);
    this.paint();
    this.fig.classList.add('ready');
    if (this.target) this.to(this.target);   // e.g. it's already the centred photo on a phone
  }
  paint() {
    const { w, h, bits, px, t } = this;
    for (let y = 0; y < h; y++) {
      const row = (y & 7) << 3;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // dots whose Bayer rank is below t have dissolved -> transparent
        px[i] = BAYER[row | (x & 7)] < t ? 0 : (bits[i] ? 0xffffffff : 0xff000000);
      }
    }
    this.ctx.putImageData(this.data, 0, 0);
  }
  update() { this.to(this.lit ? 1 : 0); }
  to(target) {
    this.target = target;
    if (!this.bits) return;
    if (reduceMotion) { this.t = target; this.paint(); return; }
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const step = now => {
      const dt = (now - last) / 1000; last = now;
      const dir = Math.sign(this.target - this.t);
      this.t = Math.min(1, Math.max(0, this.t + dir * dt / dissolveTime()));  // ~0.3s, quicker when scrolling fast
      this.paint();
      if (this.t !== this.target) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

// ---------- song player ----------
(() => {
  const box = document.querySelector('.song');
  if (!box) return;
  const audio = box.querySelector('audio'), btn = box.querySelector('.song-play');
  const bar = box.querySelector('.song-bar'), fill = box.querySelector('.song-fill'), time = box.querySelector('.song-time');
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const total = () => (isFinite(audio.duration) && audio.duration) || 176;
  const draw = () => {
    const d = total(), t = audio.currentTime;
    fill.style.width = `${(t / d) * 100}%`;
    time.textContent = `${fmt(t)} / ${fmt(d)}`;
    bar.setAttribute('aria-valuenow', Math.round(t));
  };
  const setState = () => {
    const on = !audio.paused;
    box.classList.toggle('playing', on);
    btn.setAttribute('aria-label', on ? 'pause take more' : 'play take more');
  };
  btn.addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
  audio.addEventListener('play', setState);
  audio.addEventListener('pause', setState);
  audio.addEventListener('ended', () => { audio.currentTime = 0; draw(); setState(); });
  audio.addEventListener('timeupdate', draw);
  audio.addEventListener('loadedmetadata', draw);
  // click or drag along the line to skip around
  const seekTo = e => {
    const r = bar.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total();
    draw();
  };
  bar.addEventListener('pointerdown', e => { bar.setPointerCapture(e.pointerId); seekTo(e); });
  bar.addEventListener('pointermove', e => { if (bar.hasPointerCapture(e.pointerId)) seekTo(e); });
  bar.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') audio.currentTime = Math.min(total(), audio.currentTime + 5);
    else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    else return;
    e.preventDefault(); draw();
  });
})();

// ---------- contact form: sends without leaving the page ----------
(() => {
  const form = document.querySelector('.contact-form');
  if (!form) return;
  const status = form.querySelector('.form-status'), btn = form.querySelector('button');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form._honey.value) return;                     // a bot filled the hidden field
    btn.disabled = true; status.textContent = 'sending…';
    try {
      const res = await fetch('https://formsubmit.co/ajax/finnjp9@icloud.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false || data.success === 'false') throw new Error(data.message || res.status);
      form.reset();
      status.textContent = "Sent, thank you! I'll get back to you soon.";
    } catch {
      status.innerHTML = 'That didn\u2019t send. Please email me at <a class="inline" href="mailto:finnjp9@icloud.com">finnjp9@icloud.com</a>.';
    } finally {
      btn.disabled = false;
    }
  });
})();

// ---------- full-size viewer: colour, no dither, back / next through the same set ----------
const viewer = (() => {
  const el = document.querySelector('.viewer');
  // the photo sits on its own solid black stage; every photo gets a brand-new <img> and the old
  // one is removed, so Safari can never leave bits of the previous photo painted around it
  const stage = document.createElement('div'); stage.className = 'viewer-stage';
  let img = el.querySelector('.viewer-img');
  el.insertBefore(stage, img); stage.appendChild(img);
  const count = el.querySelector('.v-count');
  let set = [], i = 0, lastFocus = null, token = 0;

  const show = (n, animate = true) => {
    i = (n + set.length) % set.length;
    const src = set[i].querySelector('img');
    // fully load + decode the next photo before swapping, so Safari never shows the old one
    // underneath a half-drawn new one
    const url = src.dataset.full || src.currentSrc || src.src, want = ++token;   // always the full-size version
    const pre = new Image(); pre.src = url;
    const ready = (pre.decode ? pre.decode() : Promise.resolve()).catch(() => {});
    const faded = animate ? new Promise(r => { img.classList.add('swap'); setTimeout(r, 180); }) : Promise.resolve();
    Promise.all([ready, faded]).then(() => {
      if (want !== token) return;                    // a newer back/next click won
      const next = document.createElement('img');
      next.className = 'viewer-img swap'; next.src = url; next.alt = src.alt;
      stage.replaceChildren(next); img = next;
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove('swap')));
    });
    count.textContent = `${i + 1} / ${set.length}` + (set[i].dataset.cam ? `  ·  ${set[i].dataset.cam}` : '');
    // warm up the neighbours so back / next feel instant
    [i - 1, i + 1].forEach(k => { const f = set[(k + set.length) % set.length]; if (f) { const im = f.querySelector('img'); new Image().src = im.dataset.full || im.src; } });
  };
  const open = fig => {
    set = [...fig.parentElement.querySelectorAll('.ph, .shot')].filter(f => getComputedStyle(f).display !== 'none');
    if (!set.length) set = [fig];
    lastFocus = document.activeElement;
    el.hidden = false;
    show(set.indexOf(fig), false);
    requestAnimationFrame(() => el.classList.add('open'));
    document.body.style.overflow = 'hidden';
    el.querySelector('.v-close').focus({ preventScroll: true });
  };
  const close = () => {
    el.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { el.hidden = true; stage.replaceChildren(); }, 350);
    lastFocus?.focus?.({ preventScroll: true });
  };
  const single = () => set.length < 2;
  el.querySelector('.v-close').addEventListener('click', close);
  el.querySelector('.v-prev').addEventListener('click', () => show(i - 1));
  el.querySelector('.v-next').addEventListener('click', () => show(i + 1));
  el.addEventListener('click', e => { if (e.target === el || e.target === stage) close(); });
  addEventListener('keydown', e => {
    if (el.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && !single()) show(i - 1);
    else if (e.key === 'ArrowRight' && !single()) show(i + 1);
  });
  // swipe left / right on phones
  let sx = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx === null || single()) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
  });
  const toggleArrows = () => el.querySelectorAll('.v-prev, .v-next, .v-count').forEach(b => b.style.display = single() ? 'none' : '');
  return { open: fig => { open(fig); toggleArrows(); } };
})();

const photos = [...document.querySelectorAll('.ph')].map(f => new Photo(f));
// design photos: no dither, just click to see them full size
document.querySelectorAll('.shot').forEach(f => f.addEventListener('click', () => viewer.open(f)));

// build each dither just before it scrolls into view
const lazy = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  lazy.unobserve(e.target);
  const p = photos.find(p => p.fig === e.target);
  if (p) { p.img.loading = 'eager'; p.build(); }       // start downloading now, not when it's on screen
}), { rootMargin: '2000px 0px' });
photos.forEach(p => lazy.observe(p.fig));

// as you scroll, the photos in the middle of the screen turn to colour by themselves (no hover
// needed): the one nearest the middle, plus any beside it in the same row. Only while the whole
// photo is in view below the melting band, so it turns back into dots before it melts away.
const bandBottom = () => {
  const n = document.querySelector('.nav');
  return (n && n.classList.contains('show') ? n.getBoundingClientRect().height : 0) + topBandHeight();
};
const touch = matchMedia('(hover: none)').matches || innerWidth <= 640;
// the melting band along the top runs everywhere except the all-photos page on phones/tablets
// (a long page you flick through fast, where it can't keep up)
const noBand = touch && !!document.querySelector('.all-photos');
const topBandHeight = () => noBand ? 0 : Math.round(document.documentElement.clientHeight * (innerWidth <= 640 ? 0.07 : 0.12));
{
  let q = false;
  const many = !!document.querySelector('.all-photos');
  const pick = () => {
    q = false;
    const top = bandBottom() + 6, bottom = innerHeight - 6, mid = (top + bottom) / 2;
    const seen = [];
    let bd = Infinity;
    for (const p of photos) {
      const r = p.fig.getBoundingClientRect();
      if (r.top < top || r.bottom > bottom || !r.height) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      seen.push([p, d]); bd = Math.min(bd, d);
    }
    // the all-photos page has lots of small photos, so there a whole middle stretch of the screen
    // lights up (several rows at once); elsewhere just the row nearest the middle
    const reach = many ? (bottom - top) * 0.3 : 0;
    let on = new Set(seen.filter(([, d]) => d <= Math.max(bd + 40, reach)).map(([p]) => p));
    // phones (one photo per row): every photo that's at least half on screen is in colour, so you
    // still see colour while flicking through quickly (they melt away in colour at the top)
    if (innerWidth <= 640) {
      on = new Set(photos.filter(p => {
        const r = p.fig.getBoundingClientRect();
        return r.height && Math.min(r.bottom, innerHeight) - Math.max(r.top, bandBottom()) >= r.height * 0.5;
      }));
    }
    for (const p of photos) {
      const lit = on.has(p);
      if (lit !== p.lit) { p.lit = lit; p.update(); }
    }
  };
  addEventListener('scroll', () => { if (!q) { q = true; requestAnimationFrame(pick); } }, { passive: true });
  addEventListener('resize', pick);
  pick();
}

// redraw a photo's dither whenever its box changes size (window resize, layout change),
// so the dots always match the photo exactly instead of being stretched
const sized = new ResizeObserver(entries => entries.forEach(e => {
  const ph = photos.find(p => p.fig === e.target);
  if (!ph || !ph.bits) return;
  const r = e.target.getBoundingClientRect();
  const d = dotPx(DOT);
  const w = Math.max(8, Math.ceil(r.width / d)), h = Math.max(8, Math.ceil(r.height / d));
  if (w === ph.w && h === ph.h && ph.dpr === devicePixelRatio) return;
  clearTimeout(ph.rt);
  ph.rt = setTimeout(() => ph.build(), 120);
}));
photos.forEach(p => sized.observe(p.fig));
let zoomRt;
addEventListener('resize', () => {
  clearTimeout(zoomRt);
  zoomRt = setTimeout(() => photos.forEach(p => { if (p.bits && p.dpr !== devicePixelRatio) p.build(); }), 150);
});

// the menu shows which section you're in
(() => {
  const onHome = !!document.querySelector('.intro');
  const links = onHome ? [...document.querySelectorAll('.nav-links a')].filter(a => a.hash && document.querySelector(a.hash)) : [];
  if (!links.length) {
    // other pages: the link marked as the current page
    document.querySelectorAll('.nav-links a[aria-current]').forEach(a => a.classList.add('on'));
    return;
  }
  const secs = links.map(a => document.querySelector(a.hash));
  let q = false;
  const mark = () => {
    q = false;
    const y = innerHeight * 0.4;
    let cur = -1;
    secs.forEach((s, k) => { if (s.getBoundingClientRect().top <= y) cur = k; });
    // at the very bottom of the page, the last section counts as current
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
    links.forEach((a, k) => a.classList.toggle('on', k === cur));
  };
  addEventListener('scroll', () => { if (!q) { q = true; requestAnimationFrame(mark); } }, { passive: true });
  mark();
})();

// things fade in quietly as you scroll
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.12 });
document.querySelectorAll('section > *:not(.grid)').forEach(el => {
  el.classList.add('reveal'); io.observe(el);
});

// ---------- opening screen: the name stays pinned, dithers and melts upward as you scroll ----------
const nav = document.querySelector('.nav'), intro = document.querySelector('.intro');
const melt = (() => {
  if (!intro) { nav.classList.add('show'); return null; }
  const pin = intro.querySelector('.intro-pin');
  const text = intro.querySelector('.intro-text');
  const cue = intro.querySelector('.scroll-cue');
  const c = intro.querySelector('.melt');
  const ctx = c.getContext('2d');
  let MD = 2;                         // css px per dot (snapped to whole screen pixels in build)
  let W, H, src, col, speed, img, px, ready = false, lastP = -1;

  const build = () => {
    const r = pin.getBoundingClientRect();
    MD = dotPx(2);
    W = Math.ceil(r.width / MD); H = Math.ceil(r.height / MD);
    c.width = W; c.height = H;
    c.style.width = (W * MD) + 'px'; c.style.height = (H * MD) + 'px';
    // draw the real text exactly where the page draws it (same font, size, colour and baseline),
    // sharp at full screen resolution, then shrink it to the dot grid
    const S = Math.max(1, devicePixelRatio);
    const rg = document.createRange();
    const small = document.createElement('canvas'); small.width = W; small.height = H;
    const so = small.getContext('2d', { willReadFrequently: true });
    so.imageSmoothingQuality = 'high';
    src = new Float32Array(W * H);                // how much of each dot is covered by ink
    col = new Uint32Array(W * H);                 // and what colour that ink is
    for (const el of text.children) {
      const big = document.createElement('canvas'); big.width = Math.ceil(W * MD * S); big.height = Math.ceil(H * MD * S);
      const o = big.getContext('2d');
      o.setTransform(S, 0, 0, S, 0, 0);
      o.textAlign = 'left'; o.textBaseline = 'alphabetic';
      const cs = getComputedStyle(el);
      o.font = `${cs.fontSize} "Finn Hand"`;
      o.fillStyle = cs.color;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const m = o.measureText('Hg'), asc = m.fontBoundingBoxAscent, des = m.fontBoundingBoxDescent;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        // word by word, each at its own spot, so the copy follows the real line breaks
        const t = n.textContent;
        let i = 0;
        for (const word of t.split(/(\s+)/)) {
          if (word.trim()) {
            rg.setStart(n, i); rg.setEnd(n, i + word.length);
            const b = rg.getClientRects()[0];
            if (b) {
              // the word's box spans the font's ascent + descent; the baseline sits ascent below its top
              const base = b.top + (b.height - (asc + des)) / 2 + asc;
              o.fillText(word, b.left - r.left, base - r.top);
            }
          }
          i += word.length;
        }
      }
      so.clearRect(0, 0, W, H);
      so.drawImage(big, 0, 0, W, H);
      const d = so.getImageData(0, 0, W, H).data;
      // big text: sharpen the edges so the dots keep the letters' real thickness;
      // small text: strokes are only a dot or two wide, so let the dots average out to the real weight
      const sharp = parseFloat(cs.fontSize) >= 48;
      for (let i = 0; i < src.length; i++) {
        const a = d[i * 4 + 3] / 255;
        if (!a) continue;
        const v = sharp ? Math.min(1, Math.max(0, (a - 0.3) / 0.4)) : a * 0.85;
        if (v <= src[i]) continue;
        src[i] = v;
        col[i] = 0xff000000 | (d[i * 4 + 2] << 16) | (d[i * 4 + 1] << 8) | d[i * 4];   // the ink's real colour
      }
    }
    // each column melts at its own speed (smooth random), so the letters drip unevenly
    speed = new Float32Array(W);
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    for (let x = 0; x < W; x++) {
      const n = Math.sin(x * 0.045 + ph[0]) * 0.5 + Math.sin(x * 0.13 + ph[1]) * 0.3 + Math.sin(x * 0.31 + ph[2]) * 0.2;
      speed[x] = 0.55 + 0.45 * n + Math.random() * 0.12;
    }
    img = ctx.createImageData(W, H);
    px = new Uint32Array(img.data.buffer);
    ready = true; lastP = -1;
    update();
  };

  const draw = p => {
    const e = Math.pow(p, 2.2);          // starts gently, speeds up near the end
    const fade = 1 - Math.pow(p, 1.6);   // dither thins out slowly
    const grow = Math.min(1, p / 0.06);  // drips start from nothing, so the first frames match the real text
    for (let x = 0; x < W; x++) {
      const d = Math.round(e * Math.max(0.15, speed[x]) * H * 0.9);  // how far this column has risen
      const decay = (1 - 1 / (1.5 + e * 45 * speed[x])) * grow;       // trail length grows as it melts
      let trail = 0, tc = 0xffffffff;
      for (let y = 0; y < H; y++) {
        const sy = y + d;
        const v = sy < H ? src[sy * W + x] : 0;
        if (v >= trail * decay) { trail = v; if (v > 0) tc = col[sy * W + x]; } else trail *= decay;   // drip trails left below the letters
        const i = y * W + x;
        px[i] = trail * fade > BAYER[((y & 7) << 3) | (x & 7)] ? tc : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const update = () => {
    const r = intro.getBoundingClientRect();
    const range = intro.offsetHeight - pin.offsetHeight;          // scroll distance while pinned
    const p = Math.min(1, Math.max(0, -r.top / (range * 0.85)));
    nav.classList.toggle('show', p >= 0.95);
    cue.style.opacity = String(Math.max(0, 1 - p * 5));
    if (!ready || Math.abs(p - lastP) < 0.002) return;
    lastP = p;
    // crisp real text at rest; as you start scrolling it cross-fades into the dotted copy,
    // which sits exactly on top of it, so there's no jump
    const h = Math.min(1, Math.max(0, (p - 0.002) / 0.03));
    text.style.opacity = String(1 - h);
    c.style.opacity = String(h);
    if (p >= 0.002 && p < 1) draw(p);
    if (p >= 1) ctx.clearRect(0, 0, W, H);
  };

  if (!reduceMotion) {
    document.fonts.ready.then(build);
    let q = false;
    addEventListener('scroll', () => { if (!q) { q = true; requestAnimationFrame(() => { q = false; update(); }); } }, { passive: true });
    let rt, lw = innerWidth;
    let ld = devicePixelRatio;
    addEventListener('resize', () => { if (innerWidth === lw && devicePixelRatio === ld) return; lw = innerWidth; ld = devicePixelRatio; clearTimeout(rt); rt = setTimeout(build, 200); });
  } else {
    new IntersectionObserver(([e]) => nav.classList.toggle('show', !e.isIntersecting), { threshold: 0.35 }).observe(intro);
  }
  return { update };
})();

// ---------- the very top of the screen is always melting ----------
// Inside a band at the top of the screen the real page is covered by solid black, and redrawn
// twice on top: a sharp copy (identical to the page at the band's lower edge, fading out going
// up) and a dithered copy that stretches upward in uneven drips. So content slides smoothly
// from normal, into dither, into drips, and away.
(() => {
  const back = document.querySelector('.top-back');
  const clean = document.querySelector('.top-clean');
  const c = document.querySelector('.top-melt');
  if (!c || !clean || reduceMotion || noBand) return;   // (see `noBand` above)
  const ctx = c.getContext('2d');
  const cx = clean.getContext('2d');
  let D = 1;                                     // css px per dither dot (fine, so body text stays legible; snapped in build)
  const sc = document.createElement('canvas');   // low-res copy used for the dither
  const sx = sc.getContext('2d', { willReadFrequently: true });
  const M = 48;                                  // extra rows above the band (hidden under the nav) so a fast scroll never opens a gap
  let W, H, Hb, Mr, Hpx, dpr, img, px, L, C, P, R, speed, raf = 0, running = true, active = false, amp = 0, lastT = 0, bandTop = 0;

  const items = [...document.querySelectorAll(
    'main h2, main p, main .links a, main .btns a, main .song-top, main .video, main .video-soon, main .footer, main .cover, main .portrait, main .drawing, main .ph, main h3, main .project-more, main .project-shots img, main .project-sketch img, main .shot img, main figcaption, main .back, main .contact-form label, main .contact-form button')];

  const build = () => {
    if (!innerWidth || !document.documentElement.clientHeight) return false;   // window not laid out yet
    Hpx = topBandHeight();   // thinner on phones
    dpr = Math.min(2, devicePixelRatio || 1);
    D = dotPx(1);
    W = Math.ceil(innerWidth / D); Hb = Math.ceil(Hpx / D); Mr = Math.ceil(M / D); H = Hb + Mr;
    c.width = W; c.height = H; c.style.height = (H * D) + 'px'; c.style.width = (W * D) + 'px';
    sc.width = W; sc.height = Hb;
    clean.width = Math.round(innerWidth * dpr); clean.height = Math.round(Hpx * dpr);
    img = ctx.createImageData(W, H); px = new Uint32Array(img.data.buffer);
    L = new Float32Array(W * Hb);
    P = new Uint8Array(W * Hb);                 // 1 where the band is over a photo / picture
    C = new Uint32Array(W * Hb);                // the colour of each spot, so dots keep the photo's colours
    R = new Float32Array(W * H);
    for (let i = 0; i < R.length; i++) R[i] = Math.random();
    speed = new Float32Array(W);
    const ph = [Math.random() * 9, Math.random() * 9, Math.random() * 9];
    const spikes = new Float32Array(W);
    for (let x = 0; x < W; x++) spikes[x] = Math.pow(Math.random(), 10);
    for (let x = 0; x < W; x++) {
      // blur the random drips over ~9 columns so they're soft, not single-pixel shreds
      let sp = 0, n = 0;
      for (let k = -4; k <= 4; k++) { const j = x + k; if (j >= 0 && j < W) { sp += spikes[j] * (5 - Math.abs(k)); n += 5 - Math.abs(k); } }
      const smooth = 0.5 + 0.28 * Math.sin(x * 0.021 + ph[0]) + 0.15 * Math.sin(x * 0.053 + ph[1]) + 0.07 * Math.sin(x * 0.11 + ph[2]);
      speed[x] = Math.min(1.3, 0.55 + 0.45 * smooth + (sp / n) * 2.5);   // capped so content never tears
    }
  };

  const cover = (el, r) => {
    const ir = el.naturalWidth / el.naturalHeight, cr = r.width / r.height;
    let w = el.naturalWidth, h = el.naturalHeight, x0 = 0, y0 = 0;
    if (ir > cr) { w = h * cr; x0 = (el.naturalWidth - w) / 2; } else { h = w / cr; y0 = (el.naturalHeight - h) / 2; }
    cx.drawImage(el, x0, y0, w, h, r.left, r.top, r.width, r.height);
  };

  const band = { top: 0, bottom: 0 };
  const range = document.createRange();
  const drawText = el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    cx.textBaseline = 'middle';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const cs = getComputedStyle(n.parentElement);
      const op = parseFloat(getComputedStyle(n.parentElement.closest('.reveal') || n.parentElement).opacity);
      if (cs.visibility === 'hidden' || op === 0) continue;
      cx.globalAlpha = op;
      cx.font = `${cs.fontSize} "Finn Hand"`;
      cx.fillStyle = cs.color;
      const t = n.textContent;
      let i = 0;
      for (const word of t.split(/(\s+)/)) {
        if (word.trim()) {
          range.setStart(n, i); range.setEnd(n, i + word.length);
          const r = range.getClientRects()[0];
          if (r && r.bottom > band.top && r.top < band.bottom) cx.fillText(word, r.left, r.top + r.height / 2);
        }
        i += word.length;
      }
      // underlines on links
      const a = n.parentElement.closest('.links a, .inline');
      if (a) {
        const r = a.getBoundingClientRect();
        if (r.bottom > band.top && r.top < band.bottom) {
          cx.fillStyle = 'rgba(255,255,255,.33)'; cx.fillRect(r.left, r.bottom - 1, r.width, 1);
        }
      }
      cx.globalAlpha = 1;
    }
  };

  const rasterize = () => {
    band.top = bandTop; band.bottom = bandTop + Hpx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, clean.width, clean.height);
    cx.fillStyle = '#000'; cx.fillRect(0, 0, clean.width, clean.height);
    cx.setTransform(dpr, 0, 0, dpr, 0, -band.top * dpr);
    P.fill(0);
    const mark = r => {                          // remember where pictures are (in dither-grid coords)
      const x0 = Math.max(0, Math.floor(r.left / D)), x1 = Math.min(W, Math.ceil(r.right / D));
      const y0 = Math.max(0, Math.floor((r.top - band.top) / Hpx * Hb)), y1 = Math.min(Hb, Math.ceil((r.bottom - band.top) / Hpx * Hb));
      for (let y = y0; y < y1; y++) P.fill(1, y * W + x0, y * W + x1);
    };
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.bottom < band.top || r.top > band.bottom || r.width === 0) continue;
      const op = parseFloat(getComputedStyle(el.closest('.reveal') || el).opacity);
      if (op === 0) continue;
      cx.globalAlpha = op;
      if (el.classList.contains('ph') || el.tagName === 'IMG') mark(r);
      if (el.classList.contains('ph')) {
        // draw it exactly as it looks right now: colour where it's dissolved, dots elsewhere
        const ph = el._photo, im = el.querySelector('img'), cv = el.querySelector('canvas');
        cx.fillStyle = '#0c0c0c'; cx.fillRect(r.left, r.top, r.width, r.height);
        if (ph && ph.t > 0 && im.naturalWidth) cover(im, r);
        cx.imageSmoothingEnabled = false;
        if (cv && cv.width > 1) cx.drawImage(cv, r.left, r.top, r.width, r.height);
        cx.imageSmoothingEnabled = true;
      } else if (el.tagName === 'IMG') {
        if (el.naturalWidth) cover(el, r);      // same crop as on the page
      } else if (el.classList.contains('video') || el.classList.contains('player')) {
        cx.fillStyle = el.classList.contains('player') ? '#262626' : '#0c0c0c';
        cx.fillRect(r.left, r.top, r.width, r.height);
      } else {
        cx.globalAlpha = 1;
        drawText(el);
      }
      cx.globalAlpha = 1;
    }
    // low-res copy for the dither
    sx.drawImage(clean, 0, 0, W, Hb);
    const d = sx.getImageData(0, 0, W, Hb).data;
    for (let i = 0; i < L.length; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], m = Math.max(r, g, b);
      if (P[i]) {
        // pictures: every dot is on, in the picture's exact colour and brightness, so the melted
        // copy matches the real photo below it (no darker strip where they meet)
        L[i] = m > 4 ? 1 : 0;
        C[i] = 0xff000000 | (b << 16) | (g << 8) | r;
        continue;
      }
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      // how many dots: brightness, but counting strong colours (a red face, purple light) as bright too
      L[i] = Math.min(1, Math.max(0, (Math.max(l, m / 255 * 0.8) - 0.14) * 2.3));   // thin strokes -> solid dots
      // what colour the dots are: the real colour there, brightened a little so dots aren't muddy
      const k = m ? Math.min(2.2, 255 / m) : 0;
      C[i] = 0xff000000 | (Math.min(255, b * k) << 16) | (Math.min(255, g * k) << 8) | Math.min(255, r * k);
    }
  };

  const frame = now => {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    // ease the whole effect in when it turns on, and out when it turns off
    amp = Math.max(0, Math.min(1, amp + (active ? dt : -dt) / 0.9));
    // on phones, Safari moves the page by itself during a fast flick, before this code can follow,
    // which would leave the band floating mid-screen: so hide it while flicking, back when slower
    const flicking = touch && scrollSpeed > 900;
    c.style.visibility = flicking ? 'hidden' : '';
    const showing = amp > 0 && !flicking;
    for (const el of [back, clean, c]) el.classList.toggle('on', amp > 0);
    if (!showing) { ctx.clearRect(0, 0, W, H); }
    if (showing && !img) build();                                // wasn't laid out yet at start
    if (showing && img) {
      const sy0 = window.scrollY;                                // page position this frame is drawn for
      rasterize();
      const t = now / 1000;
      const a = amp * amp * (3 - 2 * amp);                       // smooth ramp
      const K = 0.35;                                            // lower part of the band shows the real page
      for (let x = 0; x < W; x++) {
        // margin rows (under the nav): solid black
        for (let y = 0; y < Mr; y++) px[y * W + x] = 0;   // rows tucked under the menu: see-through, so a fast scroll up never shows a black bar
        const s = speed[x] * (0.85 + 0.15 * Math.sin(t * 0.9 + x * 0.07));
        let trail = 0, tc = 0xffffffff;
        const decay = 0.8 + 0.12 * Math.min(1, s);              // short trails: drips, not bars
        for (let yb = Hb - 1; yb >= 0; yb--) {
          const y = yb + Mr, i = y * W + x;
          const f = 1 - yb / Hb;                                 // 0 at the band's bottom edge, 1 at the top
          const b = BAYER[((y & 7) << 3) | (x & 7)];
          // stretch starts at zero where the real page hands over, so the melted letters line up with the real ones
          const fd = Math.max(0, (f - K) / (1 - K));
          const sy = yb + Math.round(Math.pow(fd, 1.5) * s * Hb * 0.25 * a);
          const v = sy < Hb ? L[sy * W + x] : 0;
          if (v >= trail * decay) { trail = v; if (sy < Hb) tc = C[sy * W + x]; } else trail *= decay;
          if (R[i] > a) { px[i] = 0; trail = 0; continue; }       // easing in/out: real page shows
          if (1 - f / K > b) { px[i] = 0; trail = 0; continue; }  // lower band: real page, giving way dot by dot
          const fade = 1 - Math.pow(f, 2.2);                     // melted copy thins out toward the top
          px[i] = trail * fade > b ? tc : 0xff000000;
        }
      }
      ctx.putImageData(img, 0, 0);
      // attach the canvas to the page at the spot this content came from, so if the page
      // scrolls on before the next frame, the melt moves with it instead of lagging behind
      if (touch) {
        // phones: pinned to the screen, so it can never be left behind mid-page when Safari
        // scrolls on its own during a flick
        c.style.position = 'fixed'; c.style.top = (bandTop - M) + 'px';
      } else {
        c.style.top = (sy0 + bandTop - M) + 'px';
      }
    }
    if (running) raf = requestAnimationFrame(frame);
  };

  const place = () => {
    active = nav.classList.contains('show');
    // tuck 1px under the nav: its real height can be fractional, and a sub-pixel gap shows the page through
    bandTop = active ? Math.max(0, Math.floor(nav.getBoundingClientRect().height) - 1) : 0;
    if (active && !amp) build();
  };
  new MutationObserver(place).observe(nav, { attributes: true, attributeFilter: ['class'] });

  build(); place();
  document.fonts.ready.then(() => { raf = requestAnimationFrame(frame); });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    cancelAnimationFrame(raf);
    if (running) raf = requestAnimationFrame(frame);
  });
  let rt, lw = innerWidth;
  let ld = devicePixelRatio;
  // window resized or zoomed: rebuild the band at the new size (even while it's running)
  addEventListener('resize', () => {
    if (innerWidth === lw && devicePixelRatio === ld) return;
    lw = innerWidth; ld = devicePixelRatio;
    clearTimeout(rt); rt = setTimeout(() => { build(); place(); }, 200);
  });
})();
