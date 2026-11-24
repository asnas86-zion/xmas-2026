import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';
import { buildShapes } from './shapes.js';
import { startHands, countFingers } from './gesture.js';
import { Music } from './music.js';

const N = CONFIG.particles;
const T = CONFIG.timing;
const KMAX = 0.95;          // 혜성 꼬리 길이(초)
const TRAIL = [0.9, 0.93, 1.0];

// ── 렌더러 ────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = (() => { // 영상처럼 어두운 남회색 + 비네팅
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 230, 30, 256, 256, 380);
  grd.addColorStop(0, '#2a2b35'); grd.addColorStop(0.55, '#1b1c24'); grd.addColorStop(1, '#0a0b10');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);

const geo = new THREE.BufferGeometry();
const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('size', new THREE.BufferAttribute(size, 1));

const mat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 1 } },
  vertexShader: /* glsl */`
    attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
    void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`
    varying vec3 vC;
    void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.18, d); gl_FragColor = vec4(vC, a); }`,
  transparent: true, depthWrite: false, depthTest: false,
});
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.3, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let wide = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h;
  // 세로 화면에서도 장면이 잘리지 않게 거리 조절
  const needW = wide ? 4.0 : 2.9, needH = 3.4;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, 0, Math.max(needH / 2 / tanH, needW / 2 / tanH / camera.aspect));
  camera.updateProjectionMatrix();
  mat.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * tanH);
}
addEventListener('resize', resize);

// ── 입자 상태 ─────────────────────────────────────────────
const from = new Float32Array(N * 3), fromCol = new Float32Array(N * 3);
const baseSize = new Float32Array(N), fromSize = new Float32Array(N);
const jit = new Float32Array(N * 3), phase = new Float32Array(N), delay = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  const r = Math.cbrt(Math.random());
  jit[i * 3] = s * Math.cos(a) * r; jit[i * 3 + 1] = u * r; jit[i * 3 + 2] = s * Math.sin(a) * r;
  phase[i] = Math.random() * 6.28; delay[i] = Math.random();
  baseSize[i] = size[i] = 0.011 + Math.random() * 0.009;
  col.set(TRAIL, i * 3);
}

let shapes = null;
let current = null;     // 현재 장면 이름 (null = 혜성)
let S = 0;              // 장면 시작 시각
let orbitMix = 0;
// 손 위치 따라가기 (월드 좌표 오프셋)
const follow = { tx: 0, ty: 0, x: 0, y: 0 };

const clock = new THREE.Clock();

function setShape(name) {
  if (name === current) return;
  if (name && !shapes?.[name]) return;
  from.set(pos); fromCol.set(col); fromSize.set(size);
  current = name; S = clock.elapsedTime;
  wide = !!(name && shapes[name].wide); resize();
  ui.scene(name);
  guide.onShape(name);
}

// 혜성 머리 궤적
function headIdle(t, o) {
  o[0] = 1.3 * Math.sin(t * 1.05) + 0.3 * Math.sin(t * 2.3);
  o[1] = 0.6 * Math.sin(t * 1.9 + 1.0) + 0.15;
  o[2] = 0.45 * Math.cos(t * 0.95);
}
function headOrbit(t, c, o) {
  const r = 0.95 + 0.15 * Math.sin(t * 1.3);
  o[0] = c[0] + r * Math.cos(t * 3.2);
  o[1] = c[1] + r * 0.8 * Math.sin(t * 3.2);
  o[2] = c[2] + 0.35 * Math.sin(t * 2.1);
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const hA = [0, 0, 0], hB = [0, 0, 0];

function update() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  const shp = current ? shapes[current] : null;
  orbitMix += ((shp ? 1 : 0) - orbitMix) * Math.min(1, dt * 2.2);
  const fk = 1 - Math.pow(1 - CONFIG.follow.smooth, dt * 60);
  follow.x += (follow.tx - follow.x) * fk; follow.y += (follow.ty - follow.y) * fk;
  const fw = shp && shp.wide ? 0.35 : 1; // 마지막 장면은 글자가 잘리지 않게 조금만
  const fx = follow.x * fw, fy = follow.y * fw;
  const since = t - S;

  let rot = null, cy = 0, cx = 0, cz = 0, sc = 1;
  let cyaw = 1, syaw = 0, cp = 1, sp = 0, cr = 1, sr = 0;
  if (shp) {
    rot = shp.rot(t);
    cyaw = Math.cos(rot.yaw); syaw = Math.sin(rot.yaw);
    cp = Math.cos(rot.pitch || 0); sp = Math.sin(rot.pitch || 0);
    cr = Math.cos(rot.roll || 0); sr = Math.sin(rot.roll || 0);
    [cx, cy, cz] = shp.center; cy += rot.bob || 0; sc = shp.scale;
    cx += fx; cy += fy;
    // 손이 움직이는 방향으로 살짝 고개를 돌림
    cyaw = Math.cos(rot.yaw + fx * 0.35); syaw = Math.sin(rot.yaw + fx * 0.35);
  }
  const center = shp ? [shp.center[0] + fx, shp.center[1] + fy, shp.center[2]] : [0, 0, 0];

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const rank = i / N;
    // ① 혜성 꼬리 위치
    const k = rank * KMAX;
    const tt = t - k;
    headIdle(tt, hA);
    hA[0] += fx * 0.6; hA[1] += fy * 0.6;
    if (orbitMix > 0.001) headOrbit(tt, center, hB);
    const m = orbitMix;
    const w = 0.012 + 0.055 * Math.pow(1 - rank, 1.3);
    const wob = 1 + 0.35 * Math.sin(t * 2.3 + phase[i]);
    const tx = hA[0] + (hB[0] - hA[0]) * m + jit[i3] * w * wob;
    const ty = hA[1] + (hB[1] - hA[1]) * m + jit[i3 + 1] * w * wob;
    const tz = hA[2] + (hB[2] - hA[2]) * m + jit[i3 + 2] * w * wob;

    // ② 이전 모양 → 꼬리
    const g = ease((since - delay[i] * 0.25) / T.gather);
    let px = from[i3] + (tx - from[i3]) * g;
    let py = from[i3 + 1] + (ty - from[i3 + 1]) * g;
    let pz = from[i3 + 2] + (tz - from[i3 + 2]) * g;
    let r = fromCol[i3] + (TRAIL[0] - fromCol[i3]) * g;
    let gg = fromCol[i3 + 1] + (TRAIL[1] - fromCol[i3 + 1]) * g;
    let b = fromCol[i3 + 2] + (TRAIL[2] - fromCol[i3 + 2]) * g;
    let sz = fromSize[i] + (baseSize[i] - fromSize[i]) * g;

    // ③ 꼬리 → 새 모양 (그리는 순서대로)
    if (shp) {
      const q = ease((since - T.gather - rank * T.build) / T.fly);
      if (q > 0) {
        let lx = shp.pos[i3] * sc, ly = shp.pos[i3 + 1] * sc, lz = shp.pos[i3 + 2] * sc;
        // 살짝 반짝이는 흔들림
        lx += Math.sin(t * 1.7 + phase[i]) * 0.004; ly += Math.cos(t * 1.3 + phase[i]) * 0.004;
        // roll(z) → pitch(x) → yaw(y)
        let x1 = lx * cr - ly * sr, y1 = lx * sr + ly * cr, z1 = lz;
        const y2 = y1 * cp - z1 * sp, z2 = y1 * sp + z1 * cp;
        const x3 = x1 * cyaw + z2 * syaw, z3 = -x1 * syaw + z2 * cyaw;
        const wx = x3 + cx, wy = y2 + cy, wz = z3 + cz;
        px += (wx - px) * q; py += (wy - py) * q; pz += (wz - pz) * q;
        r += (shp.col[i3] - r) * q; gg += (shp.col[i3 + 1] - gg) * q; b += (shp.col[i3 + 2] - b) * q;
        sz += (baseSize[i] * shp.size[i] - sz) * q;
      }
    }
    pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
    col[i3] = r; col[i3 + 1] = gg; col[i3 + 2] = b;
    size[i] = sz;
  }
  geo.attributes.size.needsUpdate = true;
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
}

function frame() {
  update();
  composer.render();
  requestAnimationFrame(frame);
}

// ── UI ───────────────────────────────────────────────────
const LABEL = { snowman: '눈사람', tree: '트리', reindeer: '루돌프', gift: '선물상자', snowflake: '눈송이', sleigh: '산타 썰매' };
const $ = (s) => document.querySelector(s);
const ui = {
  scene(name) { $('#status-scene').textContent = name ? LABEL[name] : '혜성'; },
  fingers(n) { $('#status-fingers').textContent = n == null ? '손 없음' : `손가락 ${n}개`; },
  cam(msg) { $('#status-cam').textContent = msg; },
};

// 힌트(제스처 안내) 목록
const hint = $('#hint');
const EMO = { 0: '✊', 1: '☝️', 2: '✌️', 3: '🤟', 4: '🖖', 5: '🖐' };
hint.innerHTML = Object.entries(CONFIG.gestures)
  .map(([n, s]) => `<button data-n="${n}"><b>${EMO[n] || n}</b><span>${n}</span>${LABEL[s] || s}</button>`).join('');
hint.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) setShape(CONFIG.gestures[b.dataset.n]);
});

let idleTimer;
function wake() {
  document.body.classList.add('show-ui');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.remove('show-ui'), 3500);
}
addEventListener('mousemove', wake);
addEventListener('touchstart', wake);

addEventListener('keydown', (e) => {
  if (e.key >= '0' && e.key <= '9' && CONFIG.gestures[e.key]) setShape(CONFIG.gestures[e.key]);
  else if (e.key === 'i' || e.key === 'Escape') setShape(null);
  else if (e.key === 'c') document.body.classList.toggle('hide-cam');
  else if (e.key === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  else if (e.key === 'h') document.body.classList.toggle('hide-ui');
  else if (e.key === 'm') setMusic(!music.on);
  else if (e.key === 'g') guide.start();
});

// ── 가이드 (순서대로 안내) ─────────────────────────────────
const guide = (() => {
  const G = CONFIG.guide;
  const box = $('#guide'), textEl = $('#guide-text'), dots = $('#guide-dots');
  let step = -1, waiting = false, timer;
  const steps = G.steps.filter((s) => CONFIG.gestures[s.n]);
  dots.innerHTML = steps.map(() => '<i></i>').join('');

  function show(text, cls = '') {
    textEl.classList.remove('in');
    clearTimeout(show.t);
    show.t = setTimeout(() => { textEl.textContent = text; textEl.className = `in ${cls}`; }, 220);
  }
  function paint() {
    [...dots.children].forEach((d, i) => { d.className = i < step ? 'done' : i === step ? 'now' : ''; });
  }
  function go(i) {
    step = i; waiting = false; paint();
    if (step >= steps.length) {
      show(G.finish, 'finish');
      timer = setTimeout(() => box.classList.remove('on'), 6000);
      return;
    }
    show(steps[step].text);
  }
  return {
    start() {
      if (!G.enabled || !steps.length) return;
      clearTimeout(timer);
      box.classList.add('on');
      go(0);
    },
    onShape(name) {
      // 마지막 장면(글자)과 겹치지 않게 그동안은 숨김
      box.classList.toggle('away', !!(name && shapes[name].wide));
      if (step < 0 || step >= steps.length || waiting) return;
      const want = CONFIG.gestures[steps[step].n];
      if (name !== want) return;
      waiting = true;
      const s = steps[step];
      if (s.done) show(s.done, 'yay');
      // 모양이 다 그려질 즈음 다음 안내
      const wait = (T.gather + T.build + T.fly) * 1000 + 900;
      timer = setTimeout(() => go(step + 1), wait);
    },
  };
})();

// ── 음악 ─────────────────────────────────────────────────
const music = new Music(CONFIG.music);
const musicBtn = $('#music');
function setMusic(on) {
  if (on) music.start(); else music.stop();
  musicBtn.classList.toggle('off', !music.on);
  musicBtn.setAttribute('aria-label', music.on ? '음악 끄기' : '음악 켜기');
}
musicBtn.addEventListener('click', () => setMusic(!music.on));

// ── 손동작 → 장면 ─────────────────────────────────────────
const camCanvas = $('#cam-overlay');
const cctx = camCanvas.getContext('2d');
const LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
let cand = null, candSince = 0, lastSeen = 0;

function onHand(lm) {
  const now = performance.now();
  cctx.clearRect(0, 0, camCanvas.width, camCanvas.height);
  if (!lm) {
    ui.fingers(null);
    if (now - lastSeen > 600) { follow.tx = 0; follow.ty = 0; }
    if (current && now - lastSeen > CONFIG.lostMs) setShape(null);
    cand = null;
    return;
  }
  lastSeen = now;
  if (CONFIG.follow.enabled) {
    // 손바닥 중심 (손목 + 손가락 뿌리 평균). 카메라는 거울처럼 좌우 반전
    const ids = [0, 5, 9, 13, 17];
    const hx = ids.reduce((a, i) => a + lm[i].x, 0) / ids.length;
    const hy = ids.reduce((a, i) => a + lm[i].y, 0) / ids.length;
    const k = CONFIG.follow.strength;
    follow.tx = Math.max(-1.1, Math.min(1.1, (0.5 - hx) * 2.6 * k));
    follow.ty = Math.max(-0.6, Math.min(0.6, (0.55 - hy) * 1.6 * k));
  }
  // 미리보기 위에 손 뼈대
  cctx.strokeStyle = 'rgba(255,255,255,.8)'; cctx.lineWidth = 2;
  for (const [a, b] of LINKS) {
    cctx.beginPath();
    cctx.moveTo(lm[a].x * camCanvas.width, lm[a].y * camCanvas.height);
    cctx.lineTo(lm[b].x * camCanvas.width, lm[b].y * camCanvas.height);
    cctx.stroke();
  }
  const n = countFingers(lm, CONFIG.thumbRatio);
  ui.fingers(n);
  if (n !== cand) { cand = n; candSince = now; return; }
  if (now - candSince >= CONFIG.stableMs && CONFIG.gestures[n]) setShape(CONFIG.gestures[n]);
}

async function startCamera() {
  ui.cam('카메라 준비 중…');
  try {
    await startHands($('#cam'), onHand);
    document.body.classList.add('cam-on');
    ui.cam('손을 카메라에 보여주세요');
  } catch (err) {
    console.error(err);
    ui.cam('카메라를 쓸 수 없어요 · 숫자키 0~5로 조작');
  }
}

// ── 시작 ─────────────────────────────────────────────────
async function boot() {
  resize();
  requestAnimationFrame(frame);
  // 글꼴이 준비된 뒤 문구 입자 생성
  try {
    await Promise.all([
      document.fonts.load('124px "Great Vibes"', CONFIG.message.title),
      document.fonts.load('72px "Jua"', CONFIG.message.subtitle || 'a'),
    ]);
  } catch {}
  shapes = buildShapes(N, CONFIG.message);
  window.__xmas = { setShape, shapes, follow }; // 디버그용

  const begin = () => {
    $('#intro').classList.add('gone');
    document.body.classList.add('started');
    if (CONFIG.music.enabled) setMusic(true);
    setTimeout(() => guide.start(), 900);
    wake();
  };
  $('#start').addEventListener('click', () => { begin(); startCamera(); });
  $('#nocam').addEventListener('click', () => { begin(); ui.cam('키보드 모드 · 숫자키 0~5'); });
  $('#intro').classList.add('ready');
}
boot();
