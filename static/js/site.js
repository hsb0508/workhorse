// Workhorse project page. Three small things: clips load and play only when they are on screen,
// the nav marks the section you are in, and the BibTeX copies.

// --- clips: nothing downloads until it is nearly in view, and nothing plays off screen ---
// The autoplay attribute overrides preload="none": a browser given both starts fetching at once,
// and ten clips fetching at once on a slow line means none of them arrives. So the page marks
// them data-autoplay instead and this decides, one approach at a time. A poster is fetched the
// moment it is an attribute, so those wait in data-poster too; the width and height on each tag
// hold the box in shape until one arrives.
const clips = document.querySelectorAll('video[data-autoplay], video[data-poster]');
const plays = (v) => v.dataset.autoplay !== undefined;
const seen = new WeakSet();

const watcher = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting) {
      if (v.dataset.poster) {
        v.poster = v.dataset.poster;
        delete v.dataset.poster;
      }
      if (plays(v)) {
        if (!seen.has(v)) {                     // first sight: let it fetch
          seen.add(v);
          v.preload = 'auto';
          v.load();
        }
        v.play().catch(() => {});               // a refused play leaves the poster up, which is fine
      }
    } else if (plays(v)) {
      v.pause();
    }
  }
}, { rootMargin: '200px 0px', threshold: 0.1 });

clips.forEach((v) => watcher.observe(v));

// The hero reel is fetched after the rest of the page, since its own still stands in for it --
// but on a slow line the load event can be minutes away or never come, and the hero would sit
// frozen, so a timer starts it either way.
let started = false;
const startHero = () => {
  if (started) return;
  started = true;
  for (const v of document.querySelectorAll('video[data-src]')) {
    v.src = v.dataset.src;
    delete v.dataset.src;
    v.play().catch(() => {});
  }
};
addEventListener('load', startHero);
setTimeout(startHero, 2500);

// --- nav: a border once you leave the hero, and the current section marked ---
const nav = document.getElementById('nav');
const links = [...document.querySelectorAll('#nav .links a')];
const sections = links
  .map((a) => document.querySelector(a.getAttribute('href')))
  .filter(Boolean);

const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }
}, { rootMargin: '-45% 0px -50% 0px' });

sections.forEach((s) => spy.observe(s));

const heroEl = document.getElementById('top');          // not `top`: that name is already window.top
new IntersectionObserver(([e]) => nav.classList.toggle('stuck', !e.isIntersecting), { threshold: 0.02 })
  .observe(heroEl);

// --- things rise into place the first time they are seen ---
const rise = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    rise.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

document.querySelectorAll('.reveal').forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 4, 3) * 70}ms`;   // a short stagger inside a group
  rise.observe(el);
});

// --- the teaser gives way to the page: its text fades and it drifts as the first screen scrolls ---
const hero = document.querySelector('.hero');
const onScroll = () => {
  const p = Math.min(1, scrollY / Math.max(1, innerHeight * 0.85));
  hero.style.setProperty('--lift', p.toFixed(3));
  hero.style.setProperty('--fade', (1 - Math.min(1, p * 1.35)).toFixed(3));
  const bg = hero.querySelector('.hero-bg');                 // once it is covered, stop playing it
  if (p > 0.99) bg.pause(); else if (bg.paused) bg.play().catch(() => {});
};
addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });
onScroll();

// The teaser has no resting place halfway: when the scrolling stops inside the handover, it
// settles on whichever end is nearer.
const mainTop = () => document.querySelector('main').offsetTop;
let settle;
addEventListener('scroll', () => {
  clearTimeout(settle);
  settle = setTimeout(() => {
    const end = mainTop();
    if (scrollY <= 4 || scrollY >= end - 4) return;
    scrollTo({ top: scrollY < end * 0.5 ? 0 : end, behavior: 'smooth' });
  }, 140);
}, { passive: true });

// A pointer drag that survives the pointer leaving the box and the press landing on a video:
// the move and the release are listened for on the window, so nothing depends on pointer capture
// or on which child the press happened to hit.
function onDrag(stage, at) {
  const send = (e) => {
    const r = stage.getBoundingClientRect();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    at(clamp((e.clientX - r.left) / r.width), e.type, clamp((e.clientY - r.top) / r.height));
    e.preventDefault();
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    send(e);
    const move = (m) => send(m);
    const up = (u) => {
      send(u);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// --- the wipe: the same file plays twice, each copy clipped to its own half of the frame, and
//     the divider is a clip-path the pointer moves ---
document.querySelectorAll('.wipe').forEach((fig) => {
  const stage = fig.querySelector('.stage');
  const [after, before] = stage.querySelectorAll('video');

  onDrag(stage, (p) => stage.style.setProperty('--split', `${(p * 100).toFixed(1)}%`));

  before.addEventListener('timeupdate', () => {                    // two decoders of one file drift; nudge
    if (Math.abs(after.currentTime - before.currentTime) > 0.12) after.currentTime = before.currentTime;
  });
});

// --- the warp: locoman's own training-time augmentation, run here as you drag.
//     For a point at normalised (x, y) and depth Z the interaction matrix gives
//       x' = -vx/Z + x vz/Z + x y wx - (1 + x^2) wy + y wz
//       y' = -vy/Z + y vz/Z + (1 + y^2) wx - x y wy - x wz
//     and the perturbed frame is the original sampled at q - (fx x', fy y').  Depth appears
//     only against the translation, so a camera that merely turns needs no depth map at all:
//     the whole thing is one fragment shader over the recorded frame. ---
document.querySelectorAll('.warp').forEach((fig) => {
  const stage = fig.querySelector('.stage');
  const cvs = stage.querySelector('canvas.gl');
  const svg = stage.querySelector('svg.frustum');
  const read = stage.querySelectorAll('.angle span');
  const gl = cvs.getContext('webgl2', { antialias: false, alpha: false });
  const MAX = 20 * Math.PI / 180;                       // as far as the camera may be turned
  const K = { fx: 91.6465, fy: 91.6465, cx: 192, cy: 108, w: 384, h: 216 };
  let w = [0, 0, 0];                                    // the twist's rotation, camera frame

  if (!gl) { fig.classList.add('no-gl'); return; }

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, `#version 300 es
    in vec2 p; out vec2 uv;
    void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec2 uv; out vec4 col;
    uniform sampler2D src; uniform vec3 om; uniform vec4 k; uniform vec2 wh;
    void main(){
      vec2 q = vec2(uv.x, 1.0 - uv.y) * wh;            // pixel, origin top left
      float x = (q.x - k.z) / k.x, y = (q.y - k.w) / k.y;
      float dx = x * y * om.x - (1.0 + x * x) * om.y + y * om.z;
      float dy = (1.0 + y * y) * om.x - x * y * om.y - x * om.z;
      vec2 s = (q - vec2(k.x * dx, k.y * dy)) / wh;    // the scene point moved by the flow
      s = clamp(s, vec2(0.5) / wh, 1.0 - vec2(0.5) / wh);
      col = texture(src, s);   // the image was uploaded top row first, so t runs down with y
    }`));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.uniform4f(gl.getUniformLocation(prog, 'k'), K.fx, K.fy, K.cx, K.cy);
  gl.uniform2f(gl.getUniformLocation(prog, 'wh'), K.w, K.h);
  const uOm = gl.getUniformLocation(prog, 'om');

  // the inset: the recorded camera in grey, where it now points in orange, drawn as the deck does
  const FR = [[0, 0, 0], [-0.2, -0.1125, 0.25], [0.2, -0.1125, 0.25], [0.2, 0.1125, 0.25], [-0.2, 0.1125, 0.25]];
  const EDGES = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]];
  const eye = [-0.75, -0.45, -0.55], tgt = [0, 0, 0.12], fv = 420;
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const norm = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fwd = norm(sub(tgt, eye));
  const right = norm(cross(fwd, [0, -1, 0]));
  const Rv = [right, cross(fwd, right), fwd];
  const proj = (P) => {
    const c = Rv.map((r) => r.reduce((s, v, i) => s + v * (P[i] - eye[i]), 0));
    return [fv * c[0] / c[2] + 165, fv * c[1] / c[2] + 125];
  };
  const rot = (P, o) => {                               // Rodrigues, for the small angles here
    const th = Math.hypot(...o);
    if (th < 1e-9) return P;
    const a = o.map((v) => v / th), c = Math.cos(th), s = Math.sin(th);
    const d = a.reduce((t, v, i) => t + v * P[i], 0);
    const x = cross(a, P);
    return P.map((v, i) => v * c + x[i] * s + a[i] * d * (1 - c));
  };
  const poly = (pts, cls) =>
    EDGES.map(([a, b]) => `<line class="${cls}" x1="${pts[a][0].toFixed(1)}" y1="${pts[a][1].toFixed(1)}" x2="${pts[b][0].toFixed(1)}" y2="${pts[b][1].toFixed(1)}"/>`).join('');

  const draw = () => {
    gl.uniform3f(uOm, w[0], w[1], w[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    svg.innerHTML = poly(FR.map(proj), 'was') + poly(FR.map((P) => proj(rot(P, w))), 'now');
    const deg = (r) => `${(r * 180 / Math.PI).toFixed(0)}°`;
    read[0].textContent = deg(w[0]);
    read[1].textContent = deg(w[1]);
  };

  const img = new Image();
  img.onload = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, cvs.width, cvs.height);
    draw();
  };
  img.src = './static/images/warp_source.png';

  onDrag(stage, (px, type, py) => {
    // The pointer holds the picture, not the camera: drag right and the scene comes right, which
    // means the camera turned the other way.
    let wx = (0.5 - py) * 2 * MAX, wy = (0.5 - px) * 2 * MAX;
    const m = Math.hypot(wx, wy);
    if (m > MAX) { wx *= MAX / m; wy *= MAX / m; }                // turned in any direction, 20 deg at most
    w = [wx, wy, 0];
    draw();
  });
});

// --- BibTeX ---
const copy = document.getElementById('copy');
copy?.addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.getElementById('bib').textContent);
  copy.textContent = 'Copied';
  setTimeout(() => (copy.textContent = 'Copy'), 1400);
});
