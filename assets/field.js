/* ReadyAid Lab — particle motion graphics. Shared by / (index.html) and /en/ (en.html). WebGL, no libraries.

   How it works
   - Every page is a <section data-scene="..."> with one or more empty .art boxes.
   - The particles draw that page's graphic inside its .art box(es) and scroll with the page.
     When another page reaches the middle of the screen, the particles fly over and form its graphic.
   - A graphic can be a short story (frames that loop) plus moving parts (groups: needle, gears, ambulance).
   - Colours follow the original site: Black ink and Red signal on Bone; on the black Principles band the ink turns Bone.

   Tint values per particle: 0 red · 1 ink · 2 grey · 2–3 grey fading out · 3.5 hidden · 4–5 red fading out. */
(() => {
'use strict';

const root = document.documentElement;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = Array.from(document.querySelectorAll('[data-scene]'));
if (!sections.length) return;
const footer = document.querySelector('.footer');
const darkSec = document.querySelector('.values');
const dotsNav = document.getElementById('dots');
const pad2 = n => String(n).padStart(2, '0');

/* ---------- text reveal ---------- */
if ('IntersectionObserver' in window && !RM) {
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), {threshold: 0.15});
  sections.forEach(s => io.observe(s));
} else {
  sections.forEach(s => s.classList.add('in'));
}

/* ---------- page dots ---------- */
const dotEls = sections.map((sec, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', pad2(i + 1) + ' ' + sec.dataset.name);
  b.title = sec.dataset.name;
  b.addEventListener('click', () => sec.scrollIntoView({behavior: RM ? 'auto' : 'smooth'}));
  if (dotsNav) dotsNav.appendChild(b);
  return b;
});

/* ---------- WebGL context ---------- */
const canvas = document.getElementById('field');
let gl = null;
try {
  gl = canvas ? canvas.getContext('webgl', {alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true}) : null;
} catch (e) { gl = null; }
if (!gl) root.classList.add('no-gl');

// Hero headline: drawn entirely by dots. The HTML text stays in place (layout, search, screen readers) but is
// transparent while .gl-intro is on. The page <head> adds .gl-intro early; .gl-on confirms the dots are drawn.
const heroSec = sections.find(s => s.dataset.scene === 'hero');
const heroName = document.querySelector('.hero-name');
const heroMain = document.querySelector('.hero-main');
const heroDots = !!(gl && !RM && heroName && heroSec);
if (heroDots) root.classList.add('gl-intro'); else root.classList.remove('gl-intro');

let ready = false, curId = null, applyScene = null;
let activeIdx = -1, scrollDirty = true;

function pickSection() {
  const mid = innerHeight * 0.5;
  let best = 0, bestD = 1e9;
  sections.forEach((sec, i) => {
    const r = sec.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
function updateUI(force) {
  scrollDirty = false;
  const best = pickSection();
  if (best !== activeIdx || force) {
    activeIdx = best;
    dotEls.forEach((b, i) => b.setAttribute('aria-current', i === best ? 'true' : 'false'));
  }
  const ft = footer ? footer.getBoundingClientRect().top : Infinity;
  root.classList.toggle('footer-near', ft < innerHeight * 0.5 + 160);
  if (applyScene && ready) {
    const id = sections[best].dataset.scene;
    if (id !== curId || force) applyScene(id, id !== curId);
  }
}
let uiQueued = false;
addEventListener('scroll', () => {
  scrollDirty = true;
  if (!gl && !uiQueued) { uiQueued = true; requestAnimationFrame(() => { uiQueued = false; updateUI(false); }); }
}, {passive: true});
if (!gl) { addEventListener('resize', () => updateUI(true)); updateUI(true); return; }

/* ====================================================================== */
const SMALL = Math.min(innerWidth, innerHeight) < 600;
const M = SMALL ? 8600 : 15400;                          // particles that draw each page's graphic
const heroRect0 = heroName ? heroName.getBoundingClientRect() : {width: 0, height: 0};
const HN = heroDots ? Math.round(Math.min((navigator.hardwareConcurrency || 4) <= 4 ? 45000 : 72000,
  Math.max(SMALL ? 26000 : 30000, heroRect0.width * heroRect0.height * 0.2))) : 0;   // dots that draw the headline
const D = Math.floor(M * 0.04);                         // faint ambient dust (screen-fixed, slow parallax)
const HO = D, SO = D + HN, N = D + HN + M;              // index ranges: dust | headline | page graphics
const CAM = 3, TAU = Math.PI * 2;
const FONT = '900 %px "Pretendard Variable", Pretendard, sans-serif';

const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), rnd = new Float32Array(N * 3);
const stat = new Float32Array(N * 3);   // seed, size, alpha
const dyn = new Float32Array(N * 2);    // tint, aux (pulse phase)
const tintT = new Float32Array(N), kArr = new Float32Array(N);
const dust = new Float32Array(D * 3);

let W = 1, H = 1, dpr = 1, aspect = 1;
let time = 0, pulse = 0, pulseT = 0;
let cur = {sway: 0}, forms = {};
// Two particle pools, each with its own graphic (form), current frame and clock.
const heroP = {from: HO, n: HN, form: null, fi: -1, t: 0, sway: 0, on: false};
const sceneP = {from: SO, n: M, form: null, fi: -1, t: 0, sway: 0, on: true};
let scrollKick = 0, lastY = scrollY, lastFrameY = scrollY;
const mouse = {x: 0, y: 0, nx: 0, ny: 0, on: false};
const tilt = [0, 0];

const rand = Math.random;
function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function gr(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const scrollW = () => scrollY / H * 2;

/* ---------- page boxes -> world units (y up, screen height = 2, page-anchored) ---------- */
function boxOf(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const top = r.top + scrollY;
  return {x: ((r.left + r.width / 2) / W * 2 - 1) * aspect, y: 1 - (top + r.height / 2) / H * 2,
    w: r.width / W * 2 * aspect, h: r.height / H * 2};
}
function boxesFor(id) {
  const sec = sections.find(s => s.dataset.scene === id) || sections[0];
  const arts = Array.from(sec.querySelectorAll('.art')).map(boxOf).filter(Boolean);
  return arts.length ? arts : [boxOf(sec) || {x: 0, y: 0, w: aspect, h: 1}];
}

/* ---------- shapes: each is {w: visual mass, s: sampler(random) -> [x, y, u]} ---------- */
function disk(cx, cy, rad) {
  return {w: Math.PI * rad * rad, s: r => { const a = r() * TAU, d = rad * Math.sqrt(r()); return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, d / rad]; }};
}
function ring(cx, cy, r0, r1, a0 = 0, a1 = TAU) {
  return {w: Math.abs(a1 - a0) * 0.5 * (r1 * r1 - r0 * r0), s: r => {
    const u = r(), a = a0 + (a1 - a0) * u, d = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * r());
    return [cx + Math.cos(a) * d, cy + Math.sin(a) * d, u];
  }};
}
function seg(x0, y0, x1, y1, th) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1e-6;
  return {w: L * th, s: r => { const u = r(), o = (r() - 0.5) * th; return [x0 + dx * u - dy / L * o, y0 + dy * u + dx / L * o, u]; }};
}
function pline(pts, th) {
  const cum = []; let tot = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) { tot += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]); cum.push(tot); }
  return {w: tot * th, s: r => {
    const v = r() * tot; let k = 0;
    while (k < cum.length - 1 && cum[k] < v) k++;
    const i = k * 2, x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1e-6, u = (v - (k ? cum[k - 1] : 0)) / L, o = (r() - 0.5) * th;
    return [x0 + (x1 - x0) * u - (y1 - y0) / L * o, y0 + (y1 - y0) * u + (x1 - x0) / L * o, v / tot];
  }};
}
function rect(x0, y0, x1, y1) {
  return {w: Math.abs((x1 - x0) * (y1 - y0)), s: r => { const u = r(); return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * r(), u]; }};
}
function region(x0, y0, x1, y1, inside) {
  const q = mulberry(97); let hit = 0;
  for (let i = 0; i < 600; i++) if (inside(x0 + (x1 - x0) * q(), y0 + (y1 - y0) * q())) hit++;
  return {w: Math.abs((x1 - x0) * (y1 - y0)) * Math.max(hit, 1) / 600, s: r => {
    for (let i = 0; i < 500; i++) { const u = r(), x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * r(); if (inside(x, y)) return [x, y, u]; }
    return [(x0 + x1) / 2, (y0 + y1) / 2, 0.5];
  }};
}
function rot(sh, cx, cy, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return {w: sh.w, s: r => { const p = sh.s(r), dx = p[0] - cx, dy = p[1] - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c, p[2]]; }};
}
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
    const xi = P[i], yi = P[i + 1], xj = P[j], yj = P[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inRR(x, y, cx, cy, w, h, rr) {
  const ax = Math.abs(x - cx), ay = Math.abs(y - cy);
  if (ax > w / 2 || ay > h / 2) return false;
  const dx = ax - (w / 2 - rr), dy = ay - (h / 2 - rr);
  return dx <= 0 || dy <= 0 || dx * dx + dy * dy <= rr * rr;
}
const rrFill = (cx, cy, w, h, rr) => region(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, (x, y) => inRR(x, y, cx, cy, w, h, rr));
const rrLine = (cx, cy, w, h, rr, th) => region(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2,
  (x, y) => inRR(x, y, cx, cy, w, h, rr) && !inRR(x, y, cx, cy, w - 2 * th, h - 2 * th, Math.max(rr - th, 0)));
// A standing figure, feet at (fx, fy), height H.
function inPerson(x, y, fx, fy, H) {
  const lx = x - fx, ly = y - fy, hr = 0.15 * H, hy = 0.84 * H;
  if (lx * lx + (ly - hy) * (ly - hy) < hr * hr) return true;
  const top = 0.62 * H, hw = 0.26 * H, rr = 0.16 * H;
  if (ly < 0 || ly > top || Math.abs(lx) > hw) return false;
  if (ly > top - rr && Math.abs(lx) > hw - rr) { const dx = Math.abs(lx) - (hw - rr), dy = ly - (top - rr); return dx * dx + dy * dy < rr * rr; }
  return true;
}
const person = (fx, fy, H) => region(fx - 0.27 * H, fy, fx + 0.27 * H, fy + H, (x, y) => inPerson(x, y, fx, fy, H));
const check = (cx, cy, s, th) => pline([cx - 0.5 * s, cy + 0.02 * s, cx - 0.15 * s, cy - 0.33 * s, cx + 0.55 * s, cy + 0.42 * s], th);

const tcv = document.createElement('canvas');
tcv.width = 800; tcv.height = 400;
const tctx = tcv.getContext('2d', {willReadFrequently: true});
function text(str, cx, cy, hgt) {
  tctx.clearRect(0, 0, 800, 400);
  tctx.font = FONT.replace('%', 240); tctx.textAlign = 'center'; tctx.textBaseline = 'middle'; tctx.fillStyle = '#fff';
  tctx.fillText(str, 400, 200);
  const d = tctx.getImageData(0, 0, 800, 400).data, px = [];
  let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
  for (let y = 0; y < 400; y += 2) for (let x = 0; x < 800; x += 2) if (d[(y * 800 + x) * 4 + 3] > 110) {
    px.push(x, y); if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x;
  }
  if (px.length < 8) return disk(cx, cy, hgt * 0.1);
  const sc = hgt / Math.max(y1 - y0, 8), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, n = px.length / 2;
  return {w: (x1 - x0) * (y1 - y0) * sc * sc * 0.4, s: r => {
    const c = (r() * n) | 0;
    return [cx + (px[c * 2] - mx + (r() - 0.5) * 2) * sc, cy - (px[c * 2 + 1] - my + (r() - 0.5) * 2) * sc, 0.5];
  }};
}

/* ---------- painter: distributes all M particles over a list of shapes -> one frame ---------- */
function painter(px, py, size = M) {
  const list = [];
  const api = {
    add(sh, o = {}) { list.push({sh, o}); return api; },
    build() {
      const fr = {pos: new Float32Array(size * 3), tint: new Float32Array(size), aux: new Float32Array(size),
        grp: new Int8Array(size).fill(-1), groups: [], ranges: {}, update: null};
      list.push({sh: {w: 0, s: r => [px + gr(r) * 0.45, py + gr(r) * 0.35, 0]}, o: {tint: 3.5, tj: 0}});   // spare particles wait hidden
      let fixed = 0, wsum = 0;
      for (const it of list) { if (it.o.frac) fixed += it.o.frac; else wsum += it.sh.w; }
      const freeM = Math.max(0, size - Math.floor(size * fixed));
      let j = 0;
      list.forEach((it, i) => {
        const o = it.o;
        let cnt = o.frac ? Math.floor(size * o.frac) : (wsum > 0 ? Math.floor(freeM * it.sh.w / wsum) : 0);
        if (i === list.length - 1) cnt = size - j;
        cnt = Math.max(0, Math.min(cnt, size - j));
        const r = o.seed != null ? mulberry(o.seed) : rand, from = j;
        for (let k = 0; k < cnt; k++, j++) {
          const q = it.sh.s(r), u = q[2];
          const t = typeof o.tint === 'function' ? o.tint(u) : (o.tint ?? 1) + (o.tj ?? 0.06) * r();
          const a = typeof o.aux === 'function' ? o.aux(u) : (o.aux ?? r());
          const j3 = j * 3;
          fr.pos[j3] = q[0]; fr.pos[j3 + 1] = q[1]; fr.pos[j3 + 2] = (o.z || 0) + gr(r) * (o.zj ?? 0.004);
          fr.tint[j] = t; fr.aux[j] = a;
          if (o.grp != null) fr.grp[j] = o.grp;
        }
        if (o.key) fr.ranges[o.key] = [from, j];
      });
      return fr;
    }
  };
  return api;
}
// A scene graphic: frames with durations (seconds), sway pivot, frame shown with reduced motion.
// Frames loop; with loopFrom, frames before it play once as an intro and only the rest loop.
function mk(frames, dur, pivot, rmFrame, loopFrom) {
  const d = dur || [1], sum = (a, b) => d.slice(a, b).reduce((x, y) => x + y, 0);
  const lf = loopFrom || 0;
  return {frames, dur: d, pivot, rmFrame: rmFrame ?? frames.length - 1, loopFrom: lf, introTotal: sum(0, lf), loopTotal: sum(lf, d.length) || 1};
}
function frameAt(F, t) {
  if (F.frames.length === 1) return [0, t];
  let tt, fi;
  if (t < F.introTotal) { tt = t; fi = 0; } else { tt = (t - F.introTotal) % F.loopTotal; fi = F.loopFrom; }
  while (fi < F.frames.length - 1 && tt >= F.dur[fi]) { tt -= F.dur[fi]; fi++; }
  return [fi, tt];
}
function setTint(fr, key, T, o, v) { const rg = fr.ranges[key]; if (!rg) return; for (let j = rg[0]; j < rg[1]; j++) T[o + j] = v; }

/* ---------- shared moving parts ---------- */
const GA0 = Math.PI * 7 / 6, GSW = Math.PI * 4 / 3, OK0 = 0.62, OK1 = 0.8, GP = 6.5;
function gaugeV(t) {
  if (RM) return 0.71;
  const p = (t % GP) / GP;
  if (p < 0.1) return 0.04;
  if (p > 0.88) return 0.71 + (0.04 - 0.71) * smooth(0.88, 1, p);
  const q = (p - 0.1) * GP;
  return 0.71 - 0.67 * Math.exp(-1.5 * q) * Math.cos(4.4 * q);
}
const gaugeOK = t => RM || ((t % GP) / GP > 0.5 && (t % GP) / GP < 0.88);
function addGauge(p, cx, cy, R, g) {
  p.add(ring(cx, cy, R * 0.86, R * 0.93, GA0, GA0 - GSW), {tint: 2});
  p.add(ring(cx, cy, R * 0.8, R * 0.99, GA0 - OK0 * GSW, GA0 - OK1 * GSW), {tint: 1});
  for (let i = 0; i <= 10; i++) {
    const a = GA0 - i / 10 * GSW, r0 = R * (i % 5 ? 0.7 : 0.63), r1 = R * 0.77;
    p.add(seg(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, R * 0.028), {tint: 1.2});
  }
  p.add(seg(cx - R * 0.12, cy, cx + R * 0.8, cy, R * 0.055), {tint: 0, grp: g});
  p.add(disk(cx, cy, R * 0.085), {tint: 1});
  return {cx, cy, fn: t => [GA0 - gaugeV(t) * GSW, 0, 0, 1]};
}
function inGear(x, y, R, n, phase) {
  const r = Math.hypot(x, y);
  if (r > R || r < 0.13 * R) return false;
  if (r < 0.25 * R) return true;
  const a = Math.atan2(y, x);
  if (r >= 0.6 * R && r <= 0.84 * R) return true;
  if (r > 0.84 * R) return Math.cos(n * a + phase) > 0.12;
  const sp = 5, fr = ((a / TAU * sp) % 1 + 1) % 1;
  return r * Math.min(fr, 1 - fr) * TAU / sp < 0.065 * R;
}
function addGears(p, cx, cy, R1, g0) {
  const R2 = R1 / 2, d = 0.92 * (R1 + R2), off = -(d + R2 - R1) / 2;
  const a = [cx + off, cy], b = [cx + off + d, cy];
  p.add(region(a[0] - R1, a[1] - R1, a[0] + R1, a[1] + R1, (x, y) => inGear(x - a[0], y - a[1], R1, 12, 0)), {tint: 1, grp: g0});
  p.add(region(b[0] - R2, b[1] - R2, b[0] + R2, b[1] + R2, (x, y) => inGear(x - b[0], y - b[1], R2, 6, Math.PI)), {tint: 0, grp: g0 + 1});
  return [{cx: a[0], cy: a[1], fn: t => [RM ? 0 : t * 0.55, 0, 0, 1]}, {cx: b[0], cy: b[1], fn: t => [RM ? 0 : -t * 1.1, 0, 0, 1]}];
}

/* ====================================================================== */
/* Scenes                                                                  */
/* ====================================================================== */

// Before fonts load: a soft cloud where the first graphic will be.
function sVoid(bs) {
  const {x, y, w, h} = bs[0], p = painter(x, y);
  p.add({w: 1, s: r => [x + gr(r) * w * 0.22, y + gr(r) * h * 0.22, 0.5]}, {tint: 2});
  return mk([p.build()], [1], [x, y]);
}

// Hero — the headline "Making everyone / Ready / to aid." drawn entirely by tens of thousands of dots,
// at the exact place, size and colours of the HTML headline (which stays transparent underneath).
// Calm intro: scattered dots gather line by line. Afterwards only "Ready" changes: a wave of dot density
// (darker / lighter) travels through it from left to right every 5 seconds. The dots themselves stay still.
function heroGlyphs() {
  const hr = heroName.getBoundingClientRect();
  if (hr.width < 10) return null;
  const pad = 80, cw = Math.ceil(hr.width + pad * 2), ch = Math.ceil(hr.height + pad * 2);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d', {willReadFrequently: true});
  const toW = (px, py) => [((px - pad + hr.left) / W * 2 - 1) * aspect, 1 - (py - pad + hr.top + scrollY) / H * 2];
  let dot = null, fsW = 0.1;
  const lines = Array.from(heroName.querySelectorAll('.line')).map(span => {
    const out = {px: [], chars: [], em: false, right: -1e9};
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement, cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
      if (el.closest('.em')) out.em = true;
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
      g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
      const mm = g.measureText('M');
      const asc = mm.fontBoundingBoxAscent || fs * 0.93, desc = mm.fontBoundingBoxDescent || fs * 0.25;
      fsW = fs / H * 2;
      const s = node.textContent;
      for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) continue;
        const rg = document.createRange(); rg.setStart(node, i); rg.setEnd(node, i + 1);
        const r = rg.getClientRects()[0];
        if (!r) continue;
        const x = r.left - hr.left + pad, base = r.top - hr.top + pad + asc;
        const x0 = Math.max(0, Math.floor(x - fs * 0.35)), x1 = Math.min(cw, Math.ceil(x + r.width + fs * 0.45));
        const y0 = Math.max(0, Math.floor(base - asc - 4)), y1 = Math.min(ch, Math.ceil(base + desc + 4));
        const bw = x1 - x0, bh = y1 - y0;
        if (bw < 1 || bh < 1) continue;
        g.clearRect(x0, y0, bw, bh);
        g.fillText(s[i], x, base);
        const d = g.getImageData(x0, y0, bw, bh).data, cpx = [];
        let sx = 0, sy = 0;
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
          if (d[(yy * bw + xx) * 4 + 3] > 110) { cpx.push(x0 + xx, y0 + yy); sx += x0 + xx; sy += y0 + yy; }
        }
        g.clearRect(x0, y0, bw, bh);
        if (!cpx.length) continue;
        const n = cpx.length / 2;
        out.chars.push({px: cpx, c: toW(sx / n, sy / n)});
        for (let k = 0; k < cpx.length; k++) out.px.push(cpx[k]);
        out.right = Math.max(out.right, toW(x + r.width, 0)[0]);
        if (s[i] === '.') dot = toW(sx / n, sy / n);
      }
    }
    return out;
  });
  if (lines.some(l => l.px.length < 8)) return null;
  if (!dot) { const l = lines[lines.length - 1]; dot = l.chars[l.chars.length - 1].c; }
  return {lines, toW, dot, fsW, left: toW(pad, 0)[0], top: toW(0, pad)[1], bottom: toW(0, pad + hr.height)[1]};
}

const H_WAVE = 5;                                         // seconds for the wave to cross "Ready"
function sHeroDots() {
  const G0 = heroGlyphs();
  if (!G0) return null;
  const {lines, toW, dot, fsW} = G0;
  const ei = Math.max(0, lines.findIndex(l => l.em));
  const em = lines[ei];
  const hm = heroMain.getBoundingClientRect();
  const xR = ((hm.right - 20) / W * 2 - 1) * aspect;
  const total = lines.reduce((a, l) => a + l.px.length, 0);
  const fracOf = i => 0.985 * lines[i].px.length / total;          // even density over every letter
  // Every sampler draws 3 randoms per dot so a dot keeps the same glyph point in every frame.
  const glyph = px => {
    const n = px.length / 2;
    return {w: 1, s: r => {
      const c = (r() * n) | 0, jx = r() - 0.5, jy = r() - 0.5;
      const p = toW(px[c * 2] + jx, px[c * 2 + 1] + jy);
      return [p[0], p[1], 0.5];
    }};
  };
  // before a line forms, its dots rest faintly in a loose band around where it will be
  const scatter = l => {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (let q = 0; q < l.px.length; q += 2) { a = Math.min(a, l.px[q]); b = Math.max(b, l.px[q]); c = Math.min(c, l.px[q + 1]); d = Math.max(d, l.px[q + 1]); }
    const p0 = toW(a, c), p1 = toW(b, d), mx = fsW * 0.35, my = fsW * 0.3;
    return {w: 1, s: r => { r(); r(); r(); return [p0[0] - mx + r() * (p1[0] - p0[0] + 2 * mx), p1[1] - my + r() * (p0[1] - p1[1] + 2 * my), 0.5]; }};
  };
  const emX0 = em.chars.length ? em.chars[0].c[0] : G0.left;
  const emX1 = em.chars.length ? em.chars[em.chars.length - 1].c[0] : G0.left + 0.5;
  const lambda = Math.max((emX1 - emX0) * 1.15, fsW);                // about one wave across the word
  // stage: 0 scattered, 1 "Making everyone", 2 + "Ready", 3 all lines
  const frame = stage => {
    const p = painter(dot[0], dot[1], HN);
    lines.forEach((l, i) => {
      const formed = i < ei ? stage >= 1 : i === ei ? stage >= 2 : stage >= 3;
      const tint = formed ? (i === ei ? 4 : 1) : (i === ei ? 4.75 : 2.6);
      p.add(formed ? glyph(l.px) : scatter(l), {frac: fracOf(i), seed: 300 + i, tint, tj: 0, key: 'l' + i});
    });
    const f = p.build();
    if (stage >= 2 && f.ranges['l' + ei]) {
      const [a, b] = f.ranges['l' + ei], kx = TAU / lambda, wt = TAU / H_WAVE;
      f.update = (t, T, o) => {      // 4 = full red, 4.6 = 40 % strength: a lighter band sweeps left -> right
        for (let j = a; j < b; j++) T[o + j] = 4 + 0.6 * (0.5 + 0.5 * Math.sin(kx * (f.pos[j * 3] - emX0) - wt * t));
      };
    }
    return f;
  };
  return mk([frame(0), frame(1), frame(2), frame(3)], [0.6, 1.0, 1.0, 1], [dot[0], dot[1]], 3, 3);
}

// While the headline is on screen the page-graphic particles rest, hidden, around it.
function sRest(bs) {
  const {x, y} = bs[0], p = painter(x, y);
  return mk([p.build()], [1], [x, y]);
}

// Mission — "누구나, / 현장에서, / 바로 처치할 수 있게 한다." told as one scene:
// 1 anyone: different people · 2 on scene: someone has collapsed, a location pin marks the spot ·
// 3 at once: a bystander kneels beside them with the first-aid kit. The step names under the picture light up in turn.
function kneeling(kx, gy, H) {          // kneeling on the ground, facing left, hands reaching down to the patient
  const th = H * 0.13;
  return [
    seg(kx, gy + th * 0.5, kx + H * 0.3, gy + th * 0.5, th),                          // shin on the ground
    seg(kx + H * 0.02, gy + th * 0.5, kx + H * 0.12, gy + H * 0.36, H * 0.15),          // thigh
    seg(kx + H * 0.12, gy + H * 0.36, kx - H * 0.05, gy + H * 0.63, H * 0.23),          // back, leaning forward
    disk(kx - H * 0.13, gy + H * 0.79, H * 0.125),                                      // head
    seg(kx - H * 0.04, gy + H * 0.6, kx - H * 0.3, gy + H * 0.27, H * 0.085)            // arms down to the patient
  ];
}
function lying(cx, gy, L) {              // a person lying on the ground, head to the right
  const t = L * 0.2, hr = L * 0.105;
  return [
    rrFill(cx - L * 0.1, gy + t / 2, L * 0.8, t, t / 2),                                 // body and legs
    disk(cx + L * 0.4, gy + hr, hr)                                                      // head
  ];
}
function kitClosed(cx, cy, s) {          // first-aid kit: body, red band, handle -> [[shape, tint], ...]
  const bw = s, bh = s * 0.62, band = bh * 0.1;
  return [
    [region(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, (px, py) => inRR(px, py, cx, cy, bw, bh, s * 0.08) && Math.abs(py - cy) > band), 1],
    [rect(cx - bw / 2, cy - band, cx + bw / 2, cy + band), 0],
    [ring(cx, cy + bh / 2, s * 0.13, s * 0.19, 0, Math.PI), 1]
  ];
}
function pinShape(cx, tip, pr) {          // map pin whose point touches (cx, tip)
  const cy = tip + pr * 2.1;
  return region(cx - pr, tip, cx + pr, cy + pr, (px, py) => {
    const dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy;
    if (d2 < (pr * 0.42) ** 2) return false;
    if (d2 < pr * pr) return true;
    if (py < cy && py > tip) return Math.abs(dx) < pr * 0.93 * (py - tip) / (cy - tip);
    return false;
  });
}
function sMission(bs) {
  const {x, y, w, h} = bs[0], U = Math.min(w, h * 1.35);
  const gy = y - h * 0.2, Hp = U * 0.36, th = Math.max(0.003, h * 0.006);
  const ground = () => seg(x - w * 0.46, gy, x + w * 0.46, gy, th);
  const pl = Hp * 1.05, pcx = x - w * 0.12;
  const patient = p => lying(pcx, gy, pl).forEach(sh => p.add(sh, {tint: 0}));          // lying down, head to the right

  const A = painter(x, y);
  A.add(ground(), {tint: 2, frac: 0.05, seed: 1});
  [[-0.38, 0.84], [-0.19, 1.0], [0, 0.74], [0.19, 0.93], [0.38, 0.8]].forEach(([dx, s]) => A.add(person(x + dx * w, gy, Hp * s), {tint: 1}));

  const B = painter(x, y);
  B.add(ground(), {tint: 2, frac: 0.05, seed: 1});
  patient(B);
  const pr = Hp * 0.19, tip = gy + pl * 0.4;
  B.add(pinShape(pcx, tip, pr), {tint: 1});
  B.add(disk(pcx, tip + pr * 2.1, pr * 0.24), {tint: 0});
  B.add(person(x + w * 0.34, gy, Hp * 0.95), {tint: 1});

  const C = painter(x, y);
  C.add(ground(), {tint: 2, frac: 0.05, seed: 1});
  patient(C);
  kneeling(pcx + pl * 0.6, gy, Hp).forEach(sh => C.add(sh, {tint: 1}));
  kitClosed(x + w * 0.36, gy + Hp * 0.42 * 0.31, Hp * 0.42).forEach(([sh, t]) => C.add(sh, {tint: t}));

  const f = mk([A.build(), B.build(), C.build()], [2.4, 2.4, 3.2], [x, y]);
  const sec = sections.find(s => s.dataset.scene === 'mission');
  const steps = sec ? Array.from(sec.querySelectorAll('.step')) : [];
  f.onFrame = fi => steps.forEach((s, i) => s.classList.toggle('on', i === fi));
  return f;
}

// Problem — a 20-minute timeline. The red golden time drains as "now" moves; the ambulance only arrives at 8–17 min.
// Labels (0 / 5 / 8 / 17 min) are HTML inside the same box: left% = 18 + 3.9 × minute.
function sProblem(bs) {
  const {x, y, w, h} = bs[0];
  const x0 = x - 0.32 * w, x1 = x + 0.46 * w, ay = y - 0.12 * h, X = m => x0 + m / 20 * (x1 - x0);
  const th = Math.max(0.004, h * 0.01);
  const p = painter(x, y);
  p.add(seg(x0, ay, x1, ay, th), {tint: 1, frac: 0.06, seed: 1});
  for (let m = 0; m <= 20; m++) p.add(seg(X(m), ay - h * 0.012, X(m), ay - h * (m % 5 ? 0.035 : 0.06), th * 0.7), {tint: 2});
  p.add(rect(X(0), ay + h * 0.02, X(5), ay + h * 0.1), {tint: 0, frac: 0.2, seed: 2, key: 'gold', aux: u => u * 5 / 20});
  p.add(rect(X(8), ay + h * 0.02, X(17), ay + h * 0.045), {tint: 1.25, frac: 0.07, seed: 3});
  p.add(seg(X(0), ay - h * 0.08, X(0), ay + h * 0.17, th * 0.8), {tint: 1, frac: 0.03, seed: 4, grp: 0});
  p.add(disk(X(0), ay + h * 0.17, th * 1.8), {tint: 0, frac: 0.008, seed: 5, grp: 0});
  // the bystander who doesn't know what to do
  const bx = x - 0.43 * w, bH = h * 0.3;
  p.add(person(bx, ay + h * 0.005, bH), {tint: 2});
  p.add(text('?', bx + bH * 0.04, ay + bH * 1.32, bH * 0.34), {tint: 1});
  // ambulance (drawn at its arrival point, driven in by group 1)
  const axp = X(12.5), aL = w * 0.15, aH = h * 0.13, ab = ay + h * 0.06;
  p.add(rrFill(axp + aL * 0.12, ab + aH * 0.58, aL * 0.76, aH * 0.82, aH * 0.06), {tint: 1, grp: 1});
  p.add(rrFill(axp - aL * 0.36, ab + aH * 0.42, aL * 0.26, aH * 0.5, aH * 0.1), {tint: 1, grp: 1});
  p.add(rect(axp - aL * 0.02, ab + aH * 0.99, axp + aL * 0.16, ab + aH * 1.1), {tint: 0, grp: 1});
  p.add(disk(axp - aL * 0.28, ab + aH * 0.1, aH * 0.14), {tint: 1, grp: 1});
  p.add(disk(axp + aL * 0.32, ab + aH * 0.1, aH * 0.14), {tint: 1, grp: 1});
  const fr = p.build();
  const now = t => RM ? 17 : Math.min(17, (t % 8.5) / 6 * 17);
  fr.groups = [
    {cx: X(0), cy: ay, fn: t => [0, X(now(t)) - X(0), 0, 1]},
    {cx: axp, cy: ab, fn: t => [0, (1 - smooth(0, 1, now(t) / 12.5)) * (x1 - axp + w * 0.06), 0, 1]}
  ];
  fr.update = (t, T, o) => {
    const n = now(t) / 20, rg = fr.ranges.gold;
    for (let j = rg[0]; j < rg[1]; j++) T[o + j] = fr.aux[j] > n ? 0 : 2.35;
  };
  return mk([fr], [1], [x, y]);
}

// Thesis — "AED가 증명했다. 시스템이 있으면 비의료인도 생명을 살린다."  no pulse → AED shock → heartbeat.
function sThesis(bs) {
  const {x, y, w, h} = bs[0], U = Math.min(w, h * 1.3), S = U * 0.0195, hx = x, hy = y + h * 0.12;
  const heart = [], heartIn = [];
  for (let i = 0; i < 240; i++) {
    const t = i / 240 * TAU, st = Math.sin(t);
    const X = 16 * st * st * st, Y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5;
    heart.push(hx + X * S, hy + Y * S); heartIn.push(hx + X * S * 0.8, hy + Y * S * 0.8);
  }
  const B0 = [2, 10, 7, 10, 3, 2, 7, 2, -3, -13, 0, -1, -4, -1], bolt = [];
  for (let i = 0; i < B0.length; i += 2) bolt.push(hx + (B0[i] * 0.95 + 0.4) * S, hy + (B0[i + 1] * 0.95 + 2) * S);
  const hb = [hx - 17 * S, hy - 15 * S, hx + 17 * S, hy + 15 * S];
  const outline = region(hb[0], hb[1], hb[2], hb[3], (px, py) => inPoly(px, py, heart) && !inPoly(px, py, heartIn));
  const ecgY = y - h * 0.38, ex0 = x - 0.46 * w, ex1 = x + 0.46 * w, EW = ex1 - ex0, A = h * 0.13, th = Math.max(0.004, h * 0.011);
  const flat = seg(ex0, ecgY, ex1, ecgY, th);
  const ecg = [ex0, ecgY];
  [0.2, 0.5, 0.8].forEach(c => {
    const cx = ex0 + EW * c;
    ecg.push(cx - 0.1 * EW, ecgY, cx - 0.075 * EW, ecgY + 0.12 * A, cx - 0.05 * EW, ecgY, cx - 0.02 * EW, ecgY - 0.15 * A,
      cx, ecgY + A, cx + 0.022 * EW, ecgY - 0.35 * A, cx + 0.045 * EW, ecgY, cx + 0.085 * EW, ecgY + 0.22 * A, cx + 0.12 * EW, ecgY);
  });
  ecg.push(ex1, ecgY);

  const fa = painter(x, y); fa.add(outline, {tint: 2}); fa.add(flat, {tint: 2});
  const fb = painter(x, y); fb.add(outline, {tint: 1}); fb.add(region(hb[0], hb[1], hb[2], hb[3], (px, py) => inPoly(px, py, bolt)), {tint: 0}); fb.add(flat, {tint: 2});
  const C = painter(x, y);
  C.add(region(hb[0], hb[1], hb[2], hb[3], (px, py) => inPoly(px, py, heart)), {tint: 0, grp: 0});
  C.add(pline(ecg, th), {tint: 1, aux: u => u});
  const fc = C.build();
  fc.groups = [{cx: hx, cy: hy, fn: t => {
    if (RM) return [0, 0, 0, 1];
    const q = t % 1.1;
    return [0, 0, 0, 1 + 0.07 * Math.exp(-Math.pow((q - 0.06) / 0.05, 2)) + 0.04 * Math.exp(-Math.pow((q - 0.3) / 0.06, 2))];
  }}];
  return mk([fa.build(), fb.build(), fc], [1.7, 0.9, 3.8], [x, y]);
}

// Why — "최고의 한 사람에 기대는 의료에서, 누가 있든 같은 결과를 내는 시스템으로."
// before: results depend on who is there · after: everyone goes through the system → equal results.
function sWhy(bs) {
  const {x, y, w, h} = bs[0], sizes = [1.25, 0.78, 0.95, 0.7], rowY = k => y + h * (0.34 - k * 0.226);
  const ph = h * 0.17, px = x - 0.41 * w, th = Math.max(0.004, h * 0.01), bh = h * 0.035;
  const people = (p, tints) => sizes.forEach((s, k) => p.add(person(px, rowY(k) - ph * s / 2, ph * s), {tint: tints[k]}));
  const arrow = (p, xa, xb, yy, t) => {
    p.add(seg(xa, yy, xb, yy, th), {tint: t});
    p.add(seg(xb - h * 0.03, yy + h * 0.025, xb, yy, th), {tint: t});
    p.add(seg(xb - h * 0.03, yy - h * 0.025, xb, yy, th), {tint: t});
  };
  const A = painter(x, y);
  people(A, [1, 2, 2, 2]);
  const L = [0.44, 0.1, 0.2, 0.05];
  for (let k = 0; k < 4; k++) {
    arrow(A, x - 0.33 * w, x - 0.04 * w, rowY(k), k ? 2 : 1);
    A.add(rect(x + 0.01 * w, rowY(k) - bh, x + (0.01 + L[k]) * w, rowY(k) + bh), {tint: k ? 2 : 1});
  }
  const B = painter(x, y);
  people(B, [1, 1, 1, 1]);
  B.add(rrLine(x - 0.12 * w, y - h * 0.0, 0.13 * w, h * 0.9, 0.02 * w, th * 1.6), {tint: 1});
  for (let k = 0; k < 4; k++) {
    arrow(B, x - 0.33 * w, x - 0.2 * w, rowY(k), 2);
    B.add(seg(x - 0.035 * w, rowY(k), x + 0.02 * w, rowY(k), th), {tint: 1});
    B.add(rect(x + 0.05 * w, rowY(k) - bh, x + 0.45 * w, rowY(k) + bh), {tint: 0});
  }
  return mk([A.build(), B.build()], [2.8, 3.8], [x, y]);
}

// Principles overview on the black band: one small graphic above each column.
function sValues(bs) {
  const b = i => bs[Math.min(i, bs.length - 1)], sz = i => Math.min(b(i).w * 0.9, b(i).h) * 0.46;
  const p = painter(b(0).x, b(0).y);
  // 01 Ready — a stopwatch that fills
  const s0 = b(0), R0 = sz(0) * 0.92, sy0 = s0.y - R0 * 0.08;
  p.add(ring(s0.x, sy0, R0 * 0.86, R0, Math.PI / 2, Math.PI / 2 - TAU), {tint: 1, key: 'sw', aux: u => u});
  p.add(rect(s0.x - R0 * 0.13, sy0 + R0 * 1.05, s0.x + R0 * 0.13, sy0 + R0 * 1.17), {tint: 1});
  p.add(seg(s0.x, sy0 - R0 * 0.08, s0.x, sy0 + R0 * 0.68, R0 * 0.07), {tint: 0, grp: 0});
  p.add(disk(s0.x, sy0, R0 * 0.08), {tint: 0});
  // 02 Aid — on target
  const s1 = b(1), R1 = sz(1);
  [0.33, 0.63, 0.93].forEach((rr, i) => p.add(ring(s1.x, s1.y, R1 * (rr - 0.05), R1 * (rr + 0.05)), {tint: 1 + i * 0.2, aux: rr * 0.6}));
  p.add(disk(s1.x, s1.y, R1 * 0.13), {tint: 0, aux: 0});
  // 03 Certain — meshed gears
  const s2 = b(2), gears = addGears(p, s2.x, s2.y, sz(2) * 0.72, 1);
  // 04 Guided — gauge settling in the right zone
  const s3 = b(3), R3 = sz(3) * 1.05, gg = addGauge(p, s3.x, s3.y - R3 * 0.15, R3, 3);
  const fr = p.build();
  const prog = t => RM ? 0.3 : (t % 4) / 4;
  fr.groups = [{cx: s0.x, cy: sy0, fn: t => [-prog(t) * TAU, 0, 0, 1]}, gears[0], gears[1], gg];
  fr.update = (t, T, o) => {
    const pr = prog(t), rg = fr.ranges.sw;
    for (let j = rg[0]; j < rg[1]; j++) T[o + j] = fr.aux[j] < pr ? 0 : 1;
  };
  return mk([fr], [1], [b(0).x, b(0).y]);
}

// 01 Ready — "비훈련 일반인도 30초 안에 사용 시작 · 포장 개봉부터 첫 처치까지": three steps (open the package → take the
// device out → start aid) above a 0–30 s bar. The red bar fills and each step switches on as the bar reaches it.
// Captions and the 0/30 s marks are HTML in the same box (icons at 17/50/83 %, bar at 80 % from the top).
function sReady(bs) {
  const {x, y, w, h} = bs[0];
  const X = f => x + (f - 0.5) * w, Y = f => y + (0.5 - f) * h;
  const s = Math.min(w * 0.19, h * 0.3), iy = Y(0.38);
  const p = painter(x, y);
  const parts = [[], [], []];
  let n = 0;
  const add = (k, sh, t) => { const key = 'i' + (n++); p.add(sh, {tint: t, key}); parts[k].push([key, t]); };
  kitClosed(X(0.17), iy - s * 0.05, s).forEach(([sh, t]) => add(0, sh, t));
  { const cx = X(0.5), bw = s, bh = s * 0.62, cy = iy - s * 0.2, hinge = cy + bh * 0.05;
    add(1, region(cx - bw / 2, cy - bh / 2, cx + bw / 2, hinge, (px, py) => inRR(px, py, cx, cy, bw, bh, s * 0.08) && py < hinge), 1);
    add(1, rot(rect(cx - bw / 2, hinge + s * 0.02, cx + bw / 2, hinge + bh * 0.42), cx - bw / 2, hinge, 1.0), 1);
    add(1, rrFill(cx + bw * 0.14, hinge + s * 0.3, bw * 0.22, s * 0.5, s * 0.05), 0); }
  { const cx = X(0.83);
    add(2, ring(cx, iy, s * 0.42, s * 0.5), 1);
    add(2, check(cx, iy - s * 0.02, s * 0.5, s * 0.08), 0); }
  [[0.17, 0.5], [0.5, 0.83]].forEach(([a, b]) => {
    const x0 = X(a) + s * 0.68, x1 = X(b) - s * 0.68, t = s * 0.03;
    p.add(seg(x0, iy, x1, iy, t), {tint: 2});
    p.add(seg(x1 - s * 0.1, iy + s * 0.08, x1, iy, t), {tint: 2});
    p.add(seg(x1 - s * 0.1, iy - s * 0.08, x1, iy, t), {tint: 2});
  });
  const by = Y(0.8), bt = Math.max(0.006, h * 0.018), bx0 = X(0.08), bx1 = X(0.92);
  p.add(rect(bx0, by - bt / 2, bx1, by + bt / 2), {tint: 2.3});
  p.add(rect(bx0, by - bt, bx1, by + bt), {tint: 0, key: 'fill', aux: u => u});
  const fr = p.build();
  const prog = t => RM ? 1 : Math.min(1, (t % 6.5) / 5);
  const at = [0.08, 0.5, 0.9];
  fr.update = (t, T, o) => {
    const pr = prog(t), rg = fr.ranges.fill;
    for (let j = rg[0]; j < rg[1]; j++) T[o + j] = fr.aux[j] < pr ? 0 : 3.5;
    parts.forEach((list, k) => list.forEach(([key, t0]) => setTint(fr, key, T, o, pr >= at[k] ? t0 : 2.5)));
  };
  return mk([fr], [1], [x, y]);
}

// 02 Aid — "의학적으로 옳은 행동 · 가이드라인 친화적": a guideline checklist ticked off step by step.
function sAid(bs) {
  const {x, y, w, h} = bs[0], U = Math.min(w * 0.9, h * 0.82), bw = U * 0.66, bh = U * 0.92, cx = x, cy = y - U * 0.02;
  const rows = [0, 1, 2].map(k => cy + bh * (0.2 - k * 0.27));
  const frames = [0, 1, 2, 3].map(nChecked => {
    const p = painter(cx, cy);
    p.add(rrLine(cx, cy, bw, bh, U * 0.05, U * 0.022), {tint: 1, frac: 0.2, seed: 1});
    p.add(rrFill(cx, cy + bh / 2, bw * 0.36, U * 0.09, U * 0.03), {tint: 1, frac: 0.05, seed: 2});
    rows.forEach((ry, k) => {
      const bxc = cx - bw * 0.26;
      p.add(rrLine(bxc, ry, U * 0.12, U * 0.12, U * 0.02, U * 0.016), {tint: 1, frac: 0.045, seed: 10 + k});
      p.add(seg(cx - bw * 0.12, ry + U * 0.025, cx + bw * 0.32, ry + U * 0.025, U * 0.022), {tint: 2, frac: 0.04, seed: 20 + k});
      p.add(seg(cx - bw * 0.12, ry - U * 0.03, cx + bw * 0.16, ry - U * 0.03, U * 0.022), {tint: 2, frac: 0.03, seed: 30 + k});
      if (k < nChecked) p.add(check(bxc + U * 0.012, ry + U * 0.005, U * 0.17, U * 0.038), {tint: 0, frac: 0.05, seed: 40 + k});
      else p.add(disk(bxc, ry, U * 0.005), {tint: 3.5, tj: 0, frac: 0.05, seed: 40 + k});
    });
    return p.build();
  });
  return mk(frames, [1.0, 0.8, 0.8, 2.8], [cx, cy]);
}

// 03 Certain — "무전원 기계식 · 배터리·소프트웨어 실패 모드 제거": no battery → gears that keep turning.
function sCertain(bs) {
  const {x, y, w, h} = bs[0], U = Math.min(w, h * 1.3);
  const A = painter(x, y), bw = U * 0.62, bh = U * 0.32, bx = x - U * 0.04;
  A.add(rrLine(bx, y, bw, bh, U * 0.05, U * 0.028), {tint: 1});
  A.add(rrFill(bx + bw / 2 + U * 0.035, y, U * 0.05, bh * 0.42, U * 0.012), {tint: 1});
  A.add(rrFill(bx - bw / 2 + U * 0.09, y, U * 0.07, bh * 0.56, U * 0.012), {tint: 2});
  A.add(seg(x - U * 0.4, y - U * 0.3, x + U * 0.36, y + U * 0.3, U * 0.045), {tint: 0});
  const B = painter(x, y), gg = addGears(B, x, y, U * 0.34, 0);
  const fb = B.build(); fb.groups = gg;
  return mk([A.build(), fb], [2.0, 4.6], [x, y], 1);
}

// 04 Guided — "올바른 적용을 직접 알려준다": the needle searches, settles in the zone, and a ✓ appears.
function sGuided(bs) {
  const {x, y, w, h} = bs[0], U = Math.min(w, h * 1.25), R = U * 0.4, gy = y - U * 0.04;
  const p = painter(x, gy);
  const g = addGauge(p, x, gy, R, 0);
  p.add(check(x, gy - R * 0.45, R * 0.42, R * 0.08), {tint: 3.5, tj: 0, key: 'ck'});
  const fr = p.build();
  fr.groups = [g];
  fr.update = (t, T, o) => setTint(fr, 'ck', T, o, gaugeOK(t) ? 1 : 3.5);
  return mk([fr], [1], [x, gy]);
}

// Contact — "모든 연락은 이메일로": a letter goes into the envelope, the envelope closes and flies off to the right.
function sContact(bs) {
  const {x, y, w, h} = bs[0], s = Math.min(w * 0.2, h * 0.5), ew = s * 1.5, eh = s, th = s * 0.04;
  const frame = (cx, closed, letter, fly) => {
    const p = painter(x, y), top = y + eh / 2;
    p.add(rrLine(cx, y, ew, eh, s * 0.05, th), {tint: 1, frac: 0.3, seed: 1});
    p.add(pline(closed ? [cx - ew / 2 + th, top - th, cx, y - eh * 0.08, cx + ew / 2 - th, top - th]
                       : [cx - ew / 2 + th, top - th, cx, top + eh * 0.55, cx + ew / 2 - th, top - th], th), {tint: 1, frac: 0.12, seed: 2});
    const lw = ew * 0.72, lh = eh * 0.95, ly = y + eh * 0.45;
    const hid = (sd, fr) => p.add(disk(cx, y, s * 0.01), {tint: 3.5, tj: 0, frac: fr, seed: sd});
    if (letter) {
      p.add(rrLine(cx, ly, lw, lh, s * 0.03, th * 0.8), {tint: 1, frac: 0.15, seed: 3});
      p.add(rect(cx - lw * 0.36, ly + lh * 0.24, cx + lw * 0.36, ly + lh * 0.33), {tint: 0, frac: 0.05, seed: 4});
      [0.08, -0.08, -0.24].forEach((dy, i) => p.add(seg(cx - lw * 0.34, ly + lh * dy, cx + lw * (i === 2 ? 0.1 : 0.34), ly + lh * dy, th * 0.8), {tint: 2, frac: 0.03, seed: 5 + i}));
    } else { hid(3, 0.15); hid(4, 0.05); [0, 1, 2].forEach(i => hid(5 + i, 0.03)); }
    [0.22, 0, -0.22].forEach((dy, i) => {
      const x1 = cx - ew / 2 - s * 0.14, L = s * (i === 1 ? 0.75 : 0.5);
      if (fly) p.add(seg(x1 - L, y + eh * dy, x1, y + eh * dy, th * 1.1), {tint: 0, frac: 0.03, seed: 9 + i});
      else hid(9 + i, 0.03);
    });
    return p.build();
  };
  const dx = Math.min(w * 0.28, s * 2.2);
  return mk([frame(x, false, true, false), frame(x, true, false, false), frame(x + dx, true, false, true)], [1.7, 1.0, 1.5], [x, y], 1);
}

const SCENES = {
  void:    {build: sVoid},
  hero:    {build: sRest},
  mission: {build: sMission, sway: 0.12},
  problem: {build: sProblem, sway: 0.03},
  thesis:  {build: sThesis, sway: 0.06, pulse: 0.8},
  why:     {build: sWhy, sway: 0.05},
  values:  {build: sValues, sway: 0, pulse: 0.5},
  ready:   {build: sReady, sway: 0.08},
  aid:     {build: sAid, sway: 0.08},
  certain: {build: sCertain, sway: 0.08},
  guided:  {build: sGuided, sway: 0.06},
  contact: {build: sContact, sway: 0.06}
};

applyScene = (id, kick) => {
  const key = SCENES[id] ? id : 'void';
  curId = id; cur = SCENES[key];
  sceneP.form = forms[key] || (forms[key] = cur.build(boxesFor(key)));
  sceneP.fi = -1; sceneP.t = 0; sceneP.sway = cur.sway || 0;
  pulseT = RM ? 0 : (cur.pulse || 0);
  if (kick && !RM) {
    for (let i = SO; i < N; i++) {
      const i3 = i * 3;
      vel[i3] += rnd[i3] * 0.006; vel[i3 + 1] += rnd[i3 + 1] * 0.006; vel[i3 + 2] += rnd[i3 + 2] * 0.006;
    }
  }
};

/* ---------- layout ---------- */
function layout() {
  W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2); aspect = W / H;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  for (let i = 0; i < D; i++) {
    dust[i * 3] = (rand() * 2 - 1) * aspect * 1.05;
    dust[i * 3 + 1] = (rand() * 2 - 1) * 1.7;
    dust[i * 3 + 2] = -2 + rand() * 2.4;
  }
  forms = {};
}

/* ---------- WebGL ---------- */
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  return p;
}
const pointProg = program(`
attribute vec3 aPos; attribute vec2 aDyn; attribute vec3 aStat;
uniform float uTime, uAspect, uCam, uPx, uPulse, uTwinkle, uScroll, uWrap;
uniform vec2 uTilt, uDark;
uniform vec3 uRed, uInk, uMute, uInkD, uMuteD;
varying vec4 vCol;
void main(){
  vec3 p = aPos;
  p.y += uScroll;
  if (uWrap > 0.5) p.y = mod(p.y + 1.7, 3.4) - 1.7;
  float c = cos(uTilt.x), s = sin(uTilt.x);
  p = vec3(p.x*c + p.z*s, p.y, -p.x*s + p.z*c);
  c = cos(uTilt.y); s = sin(uTilt.y);
  p = vec3(p.x, p.y*c - p.z*s, p.y*s + p.z*c);
  float w = max((uCam - p.z) / uCam, 0.08);
  gl_Position = vec4(p.x / uAspect, p.y, 0.0, w);
  float ny = p.y / w;
  float dark = step(uDark.y, ny) * step(ny, uDark.x);
  vec3 ink = mix(uInk, uInkD, dark), mute = mix(uMute, uMuteD, dark);
  float t = aDyn.x, vis = 1.0;
  vec3 col;
  if (t > 3.9) { col = uRed; vis = 1.0 - clamp(t - 4.0, 0.0, 1.0); }
  else if (t > 3.0) { col = mute; vis = 0.0; }
  else if (t > 2.0) { col = mute; vis = 3.0 - t; }
  else if (t > 1.0) { col = mix(ink, mute, t - 1.0); }
  else { col = mix(uRed, ink, max(t, 0.0)); }
  float tw = 1.0 - uTwinkle * 0.22 * (0.5 + 0.5 * sin(uTime * (1.0 + aStat.x * 2.5) + aStat.x * 61.0));
  float d = abs(fract(aDyn.y - uTime * 0.22 + 0.5) - 0.5);
  float pl = smoothstep(0.07, 0.0, d) * uPulse;
  gl_PointSize = aStat.y * uPx / w * (1.0 + pl * 0.5);
  float fog = clamp(1.25 - w * 0.3, 0.3, 1.0);
  vCol = vec4(col, aStat.z * tw * fog * vis * (1.0 + pl * 0.6));
}`, `
precision mediump float;
varying vec4 vCol;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float a = max(1.0 - dot(q, q) * 4.0, 0.0);
  float al = clamp(vCol.a * a, 0.0, 1.0);
  gl_FragColor = vec4(vCol.rgb * al, al);
}`, ['aPos', 'aDyn', 'aStat']);

const fadeProg = program(
  'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }',
  'precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor = uCol; }', ['aPos']);

const U = {};
['uTime', 'uAspect', 'uCam', 'uPx', 'uPulse', 'uTwinkle', 'uScroll', 'uWrap', 'uTilt', 'uDark', 'uRed', 'uInk', 'uMute', 'uInkD', 'uMuteD']
  .forEach(n => U[n] = gl.getUniformLocation(pointProg, n));
const uFade = gl.getUniformLocation(fadeProg, 'uCol');

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const posBuf = gl.createBuffer(), dynBuf = gl.createBuffer(), statBuf = gl.createBuffer();
gl.disable(gl.DEPTH_TEST);
gl.enable(gl.BLEND);

function draw(fadeA) {
  // Fade the previous frame toward transparent (short trails); the page background shows through.
  gl.useProgram(fadeProg);
  gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  gl.uniform4f(uFade, 0, 0, 0, fadeA);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.useProgram(pointProg);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf); gl.bufferData(gl.ARRAY_BUFFER, dyn, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, statBuf);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
  gl.uniform1f(U.uTime, time); gl.uniform1f(U.uAspect, aspect); gl.uniform1f(U.uCam, CAM);
  gl.uniform1f(U.uPx, Math.max(H, 700) * dpr / 900);   // dot size; kept readable on short (landscape) screens gl.uniform1f(U.uPulse, pulse); gl.uniform1f(U.uTwinkle, RM ? 0 : 1);
  gl.uniform2f(U.uTilt, tilt[0], tilt[1]);
  let dTop = -9, dBot = -9;
  if (darkSec) { const r = darkSec.getBoundingClientRect(); dTop = 1 - r.top / H * 2; dBot = 1 - r.bottom / H * 2; }
  gl.uniform2f(U.uDark, dTop, dBot);
  gl.uniform3f(U.uRed, 0.78, 0.086, 0.016);       // #C71604
  gl.uniform3f(U.uInk, 0.04, 0.04, 0.05);         // black ink on Bone
  gl.uniform3f(U.uMute, 0.54, 0.52, 0.5);         // #8A8480
  gl.uniform3f(U.uInkD, 0.969, 0.953, 0.925);     // Bone on the black band
  gl.uniform3f(U.uMuteD, 0.54, 0.52, 0.5);
  const sw = scrollW();
  gl.uniform1f(U.uScroll, sw * 0.25); gl.uniform1f(U.uWrap, 1);
  gl.drawArrays(gl.POINTS, 0, D);
  gl.uniform1f(U.uScroll, sw); gl.uniform1f(U.uWrap, 0);
  if (heroP.on && HN) { gl.uniform1f(U.uTwinkle, 0); gl.drawArrays(gl.POINTS, HO, HN); gl.uniform1f(U.uTwinkle, RM ? 0 : 1); }
  gl.drawArrays(gl.POINTS, SO, M);
}

/* ---------- simulation ---------- */
function simulate(s) {
  const damp = Math.pow(0.84, s), wander = RM ? 0 : 0.00004 * s, tl = Math.min(1, 0.09 * s);
  const sv = scrollKick; scrollKick = 0;
  const env = {s, damp, wander, tl, sv, sw: scrollW(), mOn: mouse.on, mx: mouse.x, my: mouse.y, R2: 0.05, mStr: 0.005 * s};
  for (let i = 0; i < D; i++) {                       // ambient dust
    const i3 = i * 3, seed = stat[i3];
    let tx = dust[i3], ty = dust[i3 + 1];
    if (!RM) { tx += Math.sin(time * 0.07 + seed * 40) * 0.05; ty += Math.cos(time * 0.05 + seed * 31) * 0.05; }
    const k = kArr[i] * s;
    let vx = (vel[i3] + (tx - pos[i3]) * k) * damp, vy = (vel[i3 + 1] + (ty - pos[i3 + 1]) * k) * damp;
    pos[i3] += vx * s; pos[i3 + 1] += vy * s; vel[i3] = vx; vel[i3 + 1] = vy;
    dyn[i * 2] += (tintT[i] - dyn[i * 2]) * tl;
  }
  if (heroP.form && heroP.on) stepPool(heroP, env);
  if (sceneP.form) stepPool(sceneP, env);
  pulse += (pulseT - pulse) * Math.min(1, 0.06 * s);
  tilt[0] += ((RM ? 0 : mouse.nx * 0.04) - tilt[0]) * 0.05 * s;
  tilt[1] += ((RM ? 0 : mouse.ny * 0.03) - tilt[1]) * 0.05 * s;
}
function stepPool(P, e) {
  const F = P.form, o = P.from, n = P.n, s = e.s;
  const [fi, local] = RM ? [F.rmFrame, 2.5] : frameAt(F, P.t);
  const fr = F.frames[fi];
  if (fi !== P.fi) {
    P.fi = fi;
    if (F.onFrame) F.onFrame(fi);
    for (let j = 0; j < n; j++) { tintT[o + j] = fr.tint[j]; dyn[(o + j) * 2 + 1] = fr.aux[j]; }
  }
  const tq = RM ? 2.5 : P.t;
  if (fr.update) fr.update(tq, tintT, o, local);
  const base = fr.pos, grp = fr.grp, G = fr.groups, ng = G.length;
  const gc = new Array(ng), gs = new Array(ng), gk = new Array(ng), gx = new Array(ng), gy = new Array(ng);
  for (let g = 0; g < ng; g++) {
    const v = G[g].fn(tq);
    gc[g] = Math.cos(v[0]); gs[g] = Math.sin(v[0]); gx[g] = v[1]; gy[g] = v[2]; gk[g] = v[3];
  }
  const sway = P.sway;
  const angY = RM ? 0 : Math.sin(time * 0.35) * sway, angX = RM ? 0 : Math.sin(time * 0.23) * sway * 0.3;
  const cyA = Math.cos(angY), syA = Math.sin(angY), cxA = Math.cos(angX), sxA = Math.sin(angX);
  const pvx = F.pivot[0], pvy = F.pivot[1];
  const {damp, tl, sw, mOn, mx, my, R2} = e;
  const calm = P === heroP;                                   // the headline: no drift, no scroll jiggle, softer cursor
  const wander = calm ? 0 : e.wander, sv = calm ? 0 : e.sv, mStr = calm ? e.mStr * 0.45 : e.mStr;
  const wv = fr.wave;
  for (let j = 0; j < n; j++) {
    const i = o + j, i3 = i * 3, j3 = j * 3, seed = stat[i3];
    let bx = base[j3], by = base[j3 + 1];
    const bz = base[j3 + 2], g = grp[j];
    if (g >= 0 && g < ng) {
      const Gg = G[g], dx = (bx - Gg.cx) * gk[g], dy = (by - Gg.cy) * gk[g];
      bx = Gg.cx + dx * gc[g] - dy * gs[g] + gx[g]; by = Gg.cy + dx * gs[g] + dy * gc[g] + gy[g];
    }
    let tx = bx, ty = by, tz = bz;
    if (wv && j >= wv.a && j < wv.b) ty += wv.amp * Math.sin(wv.k * (bx - wv.x0) - wv.w * tq);
    if (sway) {
      const lx = bx - pvx, ly = by - pvy;
      const x = lx * cyA + bz * syA, z0 = -lx * syA + bz * cyA;
      tx = x + pvx; ty = ly * cxA - z0 * sxA + pvy; tz = ly * sxA + z0 * cxA;
    }
    let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
    let vx = vel[i3], vy = vel[i3 + 1], vz = vel[i3 + 2];
    const k = kArr[i] * s;
    if (wander) {
      vx += Math.sin(py * 3.1 + time * 0.7 + seed * 6.28) * wander;
      vy += Math.cos(px * 2.7 + time * 0.6 + seed * 9.4) * wander;
    }
    vx += (tx - px) * k;
    vy += (ty - py) * k + sv * (0.3 + seed);
    vz += (tz - pz) * k;
    if (mOn) {
      const pr = CAM / (CAM - pz), dx = px * pr - mx, dy = (py + sw) * pr - my, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        let fo = 1 - d2 / R2; fo = fo * fo * mStr;
        const inv = 1 / Math.sqrt(d2 + 1e-4);
        vx += dx * inv * fo; vy += dy * inv * fo;
      }
    }
    vx *= damp; vy *= damp; vz *= damp;
    pos[i3] = px + vx * s; pos[i3 + 1] = py + vy * s; pos[i3 + 2] = Math.min(pz + vz * s, 2.4);
    vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
    dyn[i * 2] += (tintT[i] - dyn[i * 2]) * tl;
  }
}

/* ---------- input ---------- */
addEventListener('scroll', () => {
  const y = scrollY, d = (y - lastY) / (H * 0.5); lastY = y;
  if (!RM) scrollKick -= clamp(d, -0.15, 0.15) * 0.012;
}, {passive: true});
function point(e) {
  mouse.nx = e.clientX / W * 2 - 1; mouse.ny = -(e.clientY / H * 2 - 1);
  mouse.x = mouse.nx * aspect; mouse.y = mouse.ny; mouse.on = true;
}
addEventListener('pointermove', point, {passive: true});
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') mouse.on = false; }, {passive: true});
document.addEventListener('pointerleave', () => { mouse.on = false; });
addEventListener('blur', () => { mouse.on = false; });

function buildHero() {
  if (!heroDots || !ready) return;
  const f = sHeroDots();
  if (f) { heroP.form = f; heroP.fi = -1; root.classList.add('gl-on'); }
  else if (!heroP.form) root.classList.remove('gl-intro');      // could not draw it: show the HTML headline
}
function rebuild() {
  forms = {};
  if (ready && curId) applyScene(curId, false); else applyScene('void', false);
  buildHero();
}
let lastW = innerWidth, resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (innerWidth === lastW && Math.abs((canvas.clientHeight || innerHeight) - H) < 2) return;
    lastW = innerWidth;
    layout(); rebuild(); updateUI(true);
  }, 180);
});
// Fonts, images or text reveal can move the boxes: rebuild the graphics when the page layout changes.
if ('ResizeObserver' in window) {
  let roTimer, lastBodyH = 0;
  new ResizeObserver(() => {
    const bh = document.body.scrollHeight;
    if (bh === lastBodyH) return;
    lastBodyH = bh;
    clearTimeout(roTimer); roTimer = setTimeout(rebuild, 160);
  }).observe(document.body);
}

function loadFont(font, txt) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.race([document.fonts.load(font.replace('%', '120'), txt).catch(() => {}), new Promise(r => setTimeout(r, 1600))]);
}

/* ---------- boot ---------- */
layout();
for (let i = 0; i < N; i++) {
  const i3 = i * 3, isDust = i < D, r = rand();
  rnd[i3] = gauss(); rnd[i3 + 1] = gauss(); rnd[i3 + 2] = gauss();
  stat[i3] = rand();
  const isHero = i >= HO && i < SO;
  stat[i3 + 1] = isDust ? 1 + rand() * 1.2 : isHero ? 1.65 + r * r * 1.3 : 1.25 + r * r * r * 1.9;
  stat[i3 + 2] = isDust ? 0.08 + rand() * 0.12 : isHero ? 1 : 0.55 + rand() * 0.3;
  if (!isDust && !isHero && rand() < 0.03) stat[i3 + 1] *= 1.5;
  kArr[i] = RM ? 0.12 : isHero ? 0.016 + rand() * 0.022 : 0.016 + rand() * 0.03;
  tintT[i] = dyn[i * 2] = isDust ? 2 + rand() * 0.6 : isHero ? 3.5 : 2.5;
  dyn[i * 2 + 1] = rand();
}
function gauss() { return gr(rand); }
gl.bindBuffer(gl.ARRAY_BUFFER, statBuf); gl.bufferData(gl.ARRAY_BUFFER, stat, gl.STATIC_DRAW);

applyScene('void', false);
curId = null;
const hb = heroSec ? boxOf(heroSec) : null;
for (let i = 0; i < N; i++) {
  const i3 = i * 3;
  if (i < D) { pos[i3] = dust[i3]; pos[i3 + 1] = dust[i3 + 1]; pos[i3 + 2] = dust[i3 + 2]; }
  else if (i < SO) { pos[i3] = hb ? hb.x + (rand() - 0.5) * hb.w : 0; pos[i3 + 1] = hb ? hb.y + (rand() - 0.5) * hb.h : 0; pos[i3 + 2] = 0; }
  else { const j3 = (i - SO) * 3, fp = sceneP.form.frames[0].pos; pos[i3] = fp[j3] * 1.3; pos[i3 + 1] = fp[j3 + 1]; pos[i3 + 2] = fp[j3 + 2]; }
}
updateUI(true);

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 50); last = now;
  if (scrollDirty) updateUI(false);
  if (!document.hidden) {
    time += dt / 1000; sceneP.t += dt / 1000;
    if (heroSec) { const r = heroSec.getBoundingClientRect(); heroP.on = r.bottom > -150 && r.top < innerHeight + 150; }
    if (heroP.on && heroP.form) heroP.t += dt / 1000;
    simulate(dt / 16.667);
    const dy = Math.abs(scrollY - lastFrameY); lastFrameY = scrollY;
    draw(RM ? 1 : Math.min(1, 0.5 + dy * 0.06));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Promise.all([loadFont(FONT, '?')]).then(() => { ready = true; rebuild(); updateUI(true); });
})();
