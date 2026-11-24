// 각 장면을 "입자 목표 위치 + 색" 목록으로 만드는 곳.
// 모든 장면은 그려지는 순서대로 정렬되어 있어서, 혜성 꼬리가 앞에서부터 차례로 모양을 채웁니다.

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// 점 하나: {x,y,z,r,g,b,k}  (k = 그려지는 순서 키)
function pt(x, y, z, col, k, vary = 0.22) {
  const m = 1 - Math.random() * vary;
  return { x, y, z, r: col[0] * m, g: col[1] * m, b: col[2] * m, k };
}

// ── 기본 도형 ──────────────────────────────────────────────

function sphereSurface(n, cx, cy, cz, r, colorFn, keyFn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = rand(-1, 1), th = rand(0, TAU), s = Math.sqrt(1 - u * u);
    // 표면 근처에 살짝 두께
    const rr = r * (1 - Math.random() * Math.random() * 0.12);
    const x = s * Math.cos(th), y = u, z = s * Math.sin(th);
    out.push(pt(cx + x * rr, cy + y * rr, cz + z * rr, colorFn(x, y, z), keyFn(x, y, z)));
  }
  return out;
}

function polyline(n, pts, width, col, k0 = 0, k1 = 1) {
  // pts: [[x,y,z],...]  길이에 비례해 점을 뿌림
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    seg.push([a, b, L, total]);
    total += L;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = Math.random() * total;
    const s = seg.find((q) => d <= q[3] + q[2]) || seg[seg.length - 1];
    const t = (d - s[3]) / s[2];
    const [a, b] = s;
    out.push(pt(
      a[0] + (b[0] - a[0]) * t + rand(-width, width),
      a[1] + (b[1] - a[1]) * t + rand(-width, width),
      a[2] + (b[2] - a[2]) * t + rand(-width, width),
      col, k0 + (k1 - k0) * (d / total)));
  }
  return out;
}

// 캔버스에 그린 그림에서 점을 뽑음 (색은 픽셀 색 그대로)
// opts: {w,h, worldW, cx, cy, depth(x,y)->z, key(x,y)->k, vary}
function fromCanvas(n, draw, opts) {
  const w = opts.w || 512, h = opts.h || 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  draw(ctx, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const idx = [];
  for (let i = 0, p = 0; i < data.length; i += 4, p++) if (data[i + 3] > 140) idx.push(p);
  const out = [];
  if (!idx.length) return out;
  const sc = opts.worldW / w;
  for (let i = 0; i < n; i++) {
    const p = idx[(Math.random() * idx.length) | 0];
    const px = (p % w) + Math.random(), py = ((p / w) | 0) + Math.random();
    const o = (p * 4);
    const x = (px - w / 2) * sc + (opts.cx || 0);
    const y = -(py - h / 2) * sc + (opts.cy || 0);
    const z = opts.depth ? opts.depth(x, y) : rand(-0.04, 0.04);
    const col = [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255];
    out.push(pt(x, y, z, col, opts.key ? opts.key(x, y, col) : Math.random(), opts.vary ?? 0.25));
  }
  return out;
}

// 레이어 묶기: [{w:가중치, make:(n)=>points, order: 0..}] → 정확히 N개, 그리는 순서대로
function compose(N, layers) {
  const sumW = layers.reduce((s, l) => s + l.w, 0);
  let all = [];
  layers.forEach((l, li) => {
    const n = Math.max(1, Math.round((l.w / sumW) * N));
    const pts = l.make(n);
    const base = l.order ?? li;
    pts.forEach((p) => { p.k = base + Math.min(0.999, Math.max(0, p.k)) * (l.span ?? 1); });
    all = all.concat(pts);
  });
  all.sort((a, b) => a.k - b.k);
  // 정확히 N개로 맞춤 (순서 유지)
  const M = all.length;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let j = 0; j < N; j++) {
    const p = all[Math.min(M - 1, Math.floor((j * M) / N))];
    pos[j * 3] = p.x; pos[j * 3 + 1] = p.y; pos[j * 3 + 2] = p.z;
    col[j * 3] = p.r; col[j * 3 + 1] = p.g; col[j * 3 + 2] = p.b;
  }
  return { pos, col };
}

const sweepKey = (x, y) => (Math.atan2(x, y) + Math.PI) / TAU; // 12시 방향부터 한 바퀴

// ── 장면들 ────────────────────────────────────────────────

function snowman(N) {
  const snow = [rgb('#eafaff'), rgb('#a8e4f2'), rgb('#7fd3e6'), rgb('#5cc0d6'), rgb('#3fa6c0'), rgb('#cdeff8')];
  const snowCol = () => pick(snow);
  const BOT = [0, -0.5, 0, 0.56], HEAD = [0, 0.3, 0, 0.32];
  const onBody = (yy) => [0, yy, Math.sqrt(Math.max(0, BOT[3] ** 2 - (yy - BOT[1]) ** 2))];
  const dot = (n, c, r, col) => sphereSurface(n, c[0], c[1], c[2], r, () => col, () => Math.random());
  return {
    ...compose(N, [
      { w: 52, make: (n) => sphereSurface(n, ...BOT, snowCol, sweepKey) },
      { w: 22, make: (n) => sphereSurface(n, ...HEAD, snowCol, sweepKey) },
      { w: 5, make: (n) => { // 목도리 고리
        const o = [];
        for (let i = 0; i < n; i++) {
          const a = rand(0, TAU), t = rand(-0.045, 0.045);
          o.push(pt(Math.cos(a) * 0.3, 0.02 + t + Math.sin(a) * 0.02, Math.sin(a) * 0.3, rgb('#ff3b4a'), a / TAU));
        }
        return o;
      } },
      { w: 2, make: (n) => polyline(n, [[0.15, 0.0, 0.27], [0.19, -0.18, 0.3], [0.2, -0.34, 0.28]], 0.035, rgb('#ff3b4a')) },
      { w: 1.2, make: (n) => [...dot(n / 2, [-0.11, 0.37, 0.28], 0.032, rgb('#14161c')), ...dot(n / 2, [0.11, 0.37, 0.28], 0.032, rgb('#14161c'))] },
      { w: 1.2, make: (n) => polyline(n, [[0, 0.3, 0.32], [0.09, 0.28, 0.36], [0.2, 0.27, 0.38]], 0.018, rgb('#ff9a2e')) },
      { w: 1.5, make: (n) => [-0.28, -0.44, -0.6].flatMap((yy) => dot(Math.ceil(n / 3), onBody(yy), 0.03, rgb('#2fd6f0'))) },
      { w: 6, make: (n) => [ // 나뭇가지 팔
        ...polyline(n * 0.35, [[-0.48, -0.25, 0], [-0.8, -0.05, 0], [-1.05, 0.12, 0]], 0.012, rgb('#a0703f')),
        ...polyline(n * 0.15, [[-0.82, -0.04, 0], [-0.88, 0.14, 0]], 0.01, rgb('#a0703f')),
        ...polyline(n * 0.35, [[0.48, -0.25, 0], [0.8, -0.05, 0], [1.05, 0.12, 0]], 0.012, rgb('#a0703f')),
        ...polyline(n * 0.15, [[0.82, -0.04, 0], [0.96, 0.1, 0]], 0.01, rgb('#a0703f')),
      ] },
    ]),
    rot: (t) => ({ yaw: Math.sin(t * 0.5) * 0.22, pitch: 0.05 }),
    center: [0, 0.05, 0], scale: 1,
  };
}

function tree(N) {
  const W = 512, worldW = 2.5;
  const depth = (x) => rand(-0.12, 0.12) * (1 - Math.min(1, Math.abs(x) / 1.1));
  const tierPath = (ctx) => {
    ctx.beginPath();
    const tiers = [[70, 175, 70], [130, 265, 120], [200, 360, 165], [280, 445, 205]];
    tiers.forEach(([top, bot, hw]) => {
      ctx.moveTo(256, top);
      ctx.lineTo(256 - hw, bot);
      const teeth = 6;
      for (let i = 1; i <= teeth; i++) {
        const x = 256 - hw + (2 * hw * i) / teeth;
        ctx.lineTo(x - hw / teeth, bot - 16);
        ctx.lineTo(x, bot);
      }
      ctx.closePath();
    });
  };
  const greens = ['#2fbf4f', '#1f9a3c', '#45d15f', '#178a34', '#5fe07a'];
  const key = (x, y) => (1.3 - y) / 2.6 * 0.85 + Math.random() * 0.15;
  return {
    ...compose(N, [
      { w: 62, make: (n) => fromCanvas(n, (ctx) => {
        tierPath(ctx);
        ctx.fillStyle = '#2fbf4f'; ctx.fill();
      }, { worldW, depth, key }).map((p) => { const c = rgb(pick(greens)); p.r = c[0]; p.g = c[1]; p.b = c[2]; return p; }) },
      { w: 9, order: 0.4, make: (n) => fromCanvas(n, (ctx) => { // 금색 갈란드
        tierPath(ctx); ctx.save(); ctx.clip();
        ctx.strokeStyle = '#ffd94a'; ctx.lineWidth = 5;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          const y0 = 120 + i * 72;
          for (let x = 40; x <= 472; x += 4) ctx.lineTo(x, y0 + (x - 40) * 0.28 + Math.sin(x / 40) * 8);
          ctx.stroke();
        }
        ctx.restore();
      }, { worldW, depth: (x) => depth(x) + 0.12, key }) },
      { w: 6, order: 1.2, make: (n) => fromCanvas(n, (ctx) => { // 장식 볼
        const balls = [[226, 150, '#ff3346'], [290, 205, '#ff3346'], [200, 240, '#ffcf3a'], [312, 300, '#ff3346'],
          [168, 320, '#ff3346'], [256, 335, '#ffcf3a'], [345, 395, '#ff3346'], [140, 410, '#ff3346'],
          [230, 410, '#ff3346'], [300, 252, '#ffcf3a'], [380, 430, '#ffcf3a'], [255, 255, '#ff3346']];
        balls.forEach(([x, y, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill(); });
      }, { worldW, depth: () => 0.16, key: () => Math.random() }) },
      { w: 4, order: 1.6, make: (n) => fromCanvas(n, (ctx) => { // 별
        ctx.fillStyle = '#ffd23a'; ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 14 : 34, a = -Math.PI / 2 + (i * Math.PI) / 5;
          ctx.lineTo(256 + Math.cos(a) * r, 52 + Math.sin(a) * r);
        }
        ctx.fill();
      }, { worldW, depth: () => rand(-0.03, 0.03), key: () => Math.random() }) },
      { w: 6, order: -0.2, make: (n) => fromCanvas(n, (ctx) => { // 기둥
        ctx.fillStyle = '#c8955a'; ctx.fillRect(228, 445, 56, 52);
        ctx.fillStyle = '#e8c48a'; for (let y = 452; y < 497; y += 12) ctx.fillRect(232, y, 48, 4);
      }, { worldW, depth: () => rand(-0.1, 0.1), key: () => Math.random() }), span: 0.2 },
    ]),
    rot: (t) => ({ yaw: Math.sin(t * 0.45) * 0.25, pitch: 0 }),
    center: [0, 0.05, 0], scale: 1,
  };
}

function reindeer(N) {
  const worldW = 2.4;
  const depth = (x, y) => {
    const d = 1 - Math.min(1, Math.hypot(x / 0.5, (y - 0.05) / 0.55));
    return Math.sqrt(Math.max(0, d)) * 0.25 + rand(-0.03, 0.03);
  };
  const draw = (ctx) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // 뿔
    ctx.strokeStyle = '#e8cf9e'; ctx.lineWidth = 13;
    [-1, 1].forEach((s) => {
      const X = (v) => 256 + s * v;
      ctx.beginPath(); ctx.moveTo(X(40), 150); ctx.quadraticCurveTo(X(70), 80, X(130), 40); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(68), 98); ctx.quadraticCurveTo(X(110), 90, X(150), 96); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(88), 70); ctx.quadraticCurveTo(X(90), 40, X(78), 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(55), 120); ctx.quadraticCurveTo(X(40), 90, X(30), 70); ctx.stroke();
    });
    // 귀
    ctx.fillStyle = '#9a5530';
    [-1, 1].forEach((s) => {
      ctx.save(); ctx.translate(256 + s * 92, 178); ctx.rotate(s * 0.6);
      ctx.beginPath(); ctx.ellipse(0, 0, 40, 18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e7b38a'; ctx.beginPath(); ctx.ellipse(s * 4, 0, 24, 8, 0, 0, TAU); ctx.fill();
      ctx.restore(); ctx.fillStyle = '#9a5530';
    });
    // 몸통 (아래쪽, 빨간 테두리)
    ctx.fillStyle = '#a65c32'; ctx.strokeStyle = '#e0303a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(256, 430, 72, 62, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e7b38a'; ctx.beginPath(); ctx.ellipse(256, 440, 40, 40, 0, 0, TAU); ctx.fill();
    // 머리
    ctx.fillStyle = '#a65c32'; ctx.strokeStyle = '#5a2c16'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(256, 250, 84, 98, 0, 0, TAU); ctx.fill(); ctx.stroke();
    // 주둥이
    ctx.fillStyle = '#e7b38a'; ctx.beginPath(); ctx.ellipse(256, 305, 60, 44, 0, 0, TAU); ctx.fill();
    // 목도리 + 방울
    ctx.fillStyle = '#e0303a'; ctx.fillRect(196, 352, 120, 22);
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(256, 388, 13, 0, TAU); ctx.fill();
    // 눈
    [-1, 1].forEach((s) => {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(256 + s * 34, 232, 17, 20, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#121216'; ctx.beginPath(); ctx.arc(256 + s * 32, 236, 9, 0, TAU); ctx.fill();
    });
    // 볼
    ctx.fillStyle = '#f07a7a';
    [-1, 1].forEach((s) => { ctx.beginPath(); ctx.ellipse(256 + s * 58, 290, 13, 8, 0, 0, TAU); ctx.fill(); });
    // 빨간 코
    ctx.fillStyle = '#ff2430'; ctx.beginPath(); ctx.ellipse(256, 286, 22, 18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb0b0'; ctx.beginPath(); ctx.arc(249, 280, 5, 0, TAU); ctx.fill();
    // 입
    ctx.strokeStyle = '#5a2c16'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 312, 16, 0.2, Math.PI - 0.2); ctx.stroke();
  };
  return {
    ...compose(N, [{ w: 1, make: (n) => fromCanvas(n, draw, {
      worldW, cy: 0.05, depth, key: (x, y) => 0.75 * ((1.3 - y) / 2.6) + 0.25 * Math.random(),
    }) }]),
    rot: (t) => ({ yaw: Math.sin(t * 0.5) * 0.22, pitch: 0 }),
    center: [0, 0, 0], scale: 1,
  };
}

function gift(N) {
  const S = 0.48, RW = 0.085;
  const red = ['#e0203e', '#ff3355', '#c4142f', '#ff4466'].map(rgb);
  const gold = ['#ffd04a', '#f0b43a', '#ffe27a'].map(rgb);
  const L = norm([0.4, 0.7, 0.8]);
  function norm(v) { const l = Math.hypot(...v); return v.map((a) => a / l); }
  const faces = [ // [축, 부호]
    [2, 1], [0, 1], [1, 1], [0, -1], [2, -1], [1, -1],
  ];
  const layers = faces.map(([ax, sg], fi) => ({
    w: fi < 3 ? 24 : 1.5,
    order: fi,
    make: (n) => {
      const o = [];
      const nrm = [0, 0, 0]; nrm[ax] = sg;
      const shade = 0.62 + 0.38 * Math.max(0, nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2]);
      for (let i = 0; i < n; i++) {
        const p = [rand(-S, S), rand(-S, S), rand(-S, S)];
        p[ax] = sg * S * (1 - Math.random() * 0.03);
        const ribbon = Math.abs(p[0]) < RW || Math.abs(p[1]) < RW;
        const c = pick(ribbon ? gold : red).map((v) => v * shade * (ribbon ? 1.1 : 1));
        const u = p[(ax + 1) % 3], v = p[(ax + 2) % 3];
        o.push(pt(p[0], p[1], p[2], c, (u / S + 1) * 0.35 + (v / S + 1) * 0.15 + Math.random() * 0.1, 0.15));
      }
      return o;
    },
  }));
  layers.push({ w: 9, order: 6, make: (n) => { // 리본 고리 두 개 + 매듭
    const o = [];
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), side = i % 2 ? 1 : -1;
      const t = rand(-0.02, 0.02);
      // 위로 솟은 고리 (기울어진 타원)
      const lx = Math.cos(a) * 0.17 + 0.18, ly = Math.sin(a) * 0.16 + 0.17;
      const x = side * (lx + t), y = S + 0.02 + ly + t, z = -side * lx * 0.35 + t;
      o.push(pt(x, y, z, pick(gold), a / TAU, 0.1));
    }
    for (let i = 0; i < n * 0.15; i++) {
      const u = rand(-1, 1), th = rand(0, TAU), s = Math.sqrt(1 - u * u);
      o.push(pt(s * Math.cos(th) * 0.06, S + 0.04 + u * 0.05, s * Math.sin(th) * 0.06, rgb('#ffe27a'), 1, 0.1));
    }
    return o;
  } });
  return {
    ...compose(N, layers),
    rot: (t) => ({ yaw: -0.5 + Math.sin(t * 0.4) * 0.25, pitch: 0.22 }),
    center: [0, -0.12, 0], scale: 1.12,
  };
}

function snowflake(N) {
  const draw = (ctx) => {
    ctx.translate(256, 256);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const arm = () => {
      for (let i = 0; i < 6; i++) {
        ctx.save(); ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -44); ctx.lineTo(0, -214);
        [[-112, 58], [-162, 42]].forEach(([y, l]) => {
          ctx.moveTo(0, y); ctx.lineTo(-l * 0.87, y - l * 0.5);
          ctx.moveTo(0, y); ctx.lineTo(l * 0.87, y - l * 0.5);
        });
        ctx.moveTo(-12, -206); ctx.lineTo(0, -222); ctx.lineTo(12, -206);
        ctx.stroke(); ctx.restore();
      }
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46); }
      ctx.stroke();
    };
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 30; arm();
    ctx.strokeStyle = '#43b8ec'; ctx.lineWidth = 16; arm();
  };
  return {
    ...compose(N, [{ w: 1, make: (n) => fromCanvas(n, draw, {
      worldW: 2.3, depth: () => rand(-0.03, 0.03),
      key: (x, y) => Math.min(1, Math.hypot(x, y) / 1.0) * 0.85 + Math.random() * 0.15, vary: 0.12,
    }) }]),
    rot: (t) => ({ yaw: Math.sin(t * 0.5) * 0.3, pitch: Math.sin(t * 0.37) * 0.1, roll: t * 0.15 }),
    center: [0, 0.05, 0], scale: 1,
  };
}

function sleigh(N, message) {
  const W = 1024, H = 640, worldW = 3.6;
  const sceneDraw = (ctx) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const deer = (ox, oy, s, nose) => {
      ctx.save(); ctx.translate(ox, oy); ctx.scale(s, s);
      ctx.strokeStyle = '#b8672f'; ctx.lineWidth = 9;
      // 다리 (질주 자세)
      [[-50, 20, -95, 55], [-35, 20, -60, 70], [45, 18, 95, 40], [60, 15, 110, 60]].forEach(([a, b, c, d]) => {
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      });
      ctx.fillStyle = '#c4733a';
      ctx.beginPath(); ctx.ellipse(0, 0, 75, 30, -0.08, 0, TAU); ctx.fill(); // 몸
      ctx.beginPath(); ctx.moveTo(48, -12); ctx.lineTo(88, -60); ctx.lineTo(108, -48); ctx.lineTo(70, 10); ctx.fill(); // 목
      ctx.beginPath(); ctx.ellipse(110, -66, 30, 17, -0.25, 0, TAU); ctx.fill(); // 머리
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(-74, -8, 12, 9, 0, 0, TAU); ctx.fill(); // 꼬리
      ctx.strokeStyle = '#e8cf9e'; ctx.lineWidth = 6; // 뿔
      ctx.beginPath(); ctx.moveTo(98, -80); ctx.quadraticCurveTo(80, -120, 60, -128); ctx.moveTo(84, -104); ctx.lineTo(96, -128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(108, -82); ctx.quadraticCurveTo(110, -120, 96, -140); ctx.stroke();
      ctx.fillStyle = '#e0303a'; ctx.fillRect(40, -30, 34, 9); // 목걸이
      if (nose) { ctx.fillStyle = '#ff2430'; ctx.beginPath(); ctx.arc(140, -62, 9, 0, TAU); ctx.fill(); }
      ctx.restore();
    };
    deer(860, 300, 1.0, true);
    deer(640, 330, 1.0, false);
    // 고삐
    ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(330, 360); ctx.quadraticCurveTo(480, 300, 690, 312); ctx.lineTo(930, 252); ctx.stroke();
    // 선물 자루
    ctx.fillStyle = '#9b6a3c'; ctx.beginPath(); ctx.ellipse(130, 330, 62, 66, -0.3, 0, TAU); ctx.fill();
    // 산타
    ctx.fillStyle = '#e8233a'; ctx.beginPath(); ctx.ellipse(245, 345, 58, 64, 0, 0, TAU); ctx.fill(); // 몸
    ctx.fillStyle = '#f4c7a4'; ctx.beginPath(); ctx.arc(252, 262, 30, 0, TAU); ctx.fill(); // 얼굴
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(254, 296, 34, 32, 0, 0, Math.PI); ctx.fill(); // 수염
    ctx.beginPath(); ctx.ellipse(252, 238, 36, 9, 0, 0, TAU); ctx.fill(); // 모자 테
    ctx.fillStyle = '#e8233a'; ctx.beginPath(); ctx.moveTo(218, 236); ctx.quadraticCurveTo(250, 170, 300, 200); ctx.lineTo(286, 236); ctx.fill(); // 모자
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(302, 204, 10, 0, TAU); ctx.fill(); // 방울
    ctx.fillStyle = '#121216'; ctx.beginPath(); ctx.arc(262, 258, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e8233a'; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(270, 320); ctx.lineTo(330, 355); ctx.stroke(); // 팔
    // 썰매
    ctx.fillStyle = '#e01e36';
    ctx.beginPath(); ctx.moveTo(60, 360); ctx.quadraticCurveTo(50, 450, 150, 455); ctx.lineTo(360, 455);
    ctx.quadraticCurveTo(410, 450, 410, 380); ctx.quadraticCurveTo(420, 340, 450, 335); ctx.lineTo(450, 375);
    ctx.quadraticCurveTo(440, 400, 300, 395); ctx.lineTo(160, 395); ctx.quadraticCurveTo(110, 395, 95, 355); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(70, 400); ctx.quadraticCurveTo(80, 440, 150, 440); ctx.lineTo(380, 440); ctx.stroke();
    // 썰매 날
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(110, 460); ctx.lineTo(120, 490); ctx.moveTo(330, 460); ctx.lineTo(320, 490);
    ctx.moveTo(60, 490); ctx.lineTo(420, 490); ctx.quadraticCurveTo(470, 490, 465, 455); ctx.stroke();
  };
  const titleDraw = (ctx) => {
    ctx.fillStyle = '#ffcf4a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 124px "Great Vibes", "Snell Roundhand", cursive';
    ctx.fillText(message.title, W / 2, 110);
  };
  const subDraw = (ctx) => {
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '400 50px "Gowun Dodum", "Apple SD Gothic Neo", sans-serif';
    ctx.fillText(message.subtitle, W / 2, 580);
  };
  const opts = { w: W, h: H, worldW, depth: () => rand(-0.05, 0.05) };
  const layers = [
    { w: 60, make: (n) => fromCanvas(n, sceneDraw, { ...opts, key: (x) => 1 - (x + 1.8) / 3.6 }) },
    { w: 24, order: 1, make: (n) => fromCanvas(n, titleDraw, { ...opts, key: (x) => (x + 1.8) / 3.6, vary: 0.15 }) },
  ];
  if (message.subtitle) layers.push({ w: 13, order: 2, make: (n) => fromCanvas(n, subDraw, { ...opts, key: (x) => (x + 1.8) / 3.6, vary: 0.1 }) });
  return {
    ...compose(N, layers),
    rot: (t) => ({ yaw: Math.sin(t * 0.4) * 0.08, pitch: 0, bob: Math.sin(t * 1.6) * 0.03 }),
    center: [0, 0.05, 0], scale: 1, wide: true,
  };
}

export function buildShapes(N, message) {
  return {
    snowman: snowman(N),
    tree: tree(N),
    reindeer: reindeer(N),
    gift: gift(N),
    snowflake: snowflake(N),
    sleigh: sleigh(N, message),
  };
}
