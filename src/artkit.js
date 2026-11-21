// artkit.js — 道具共用美术工具（材质/几何缓存、Canvas 贴图、中文招牌、接地影、光晕）
// 供 props_*.js / world.js / entities.js 使用。所有工厂返回“有光照即可用”的物件。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ---------------------------------- 调色板 --------------------------------- */
export const C = {
  // 自然
  leaf1: 0x6f9a4e, leaf2: 0x8fb75f, leaf3: 0xa9c97a, leafDark: 0x4f713d,
  rice1: 0x9fbf72, rice2: 0xc2d492, water: 0xbcd4d0, soil: 0x9a7b57, dirt: 0xb89a72,
  rock: 0x8e8a80, rockLight: 0xb5b0a4, stone: 0xa9a396,
  // 木/建筑
  wood: 0x9a6b4a, woodDark: 0x6f4a33, woodLight: 0xc79a6b,
  plaster: 0xe8dcc4, plaster2: 0xd9c9ab, cream: 0xf6ecd8,
  terracotta: 0xb85b42, tile: 0x7c4b3c, tileDark: 0x643a2f,
  concrete: 0xbdb7ab, concreteDark: 0x8e897e, asphalt: 0x5b5f63,
  // 城市
  glass: 0x9cb6c9, glassDark: 0x5c7284, steel: 0x9aa4ab, steelDark: 0x6c767d,
  cityBlue: 0x8fa3d9, cityPurple: 0xb9a6cf, billboard: 0xff8a5c,
  // 点缀
  red: 0xd9534f, redDark: 0xa83a37, orange: 0xef9d4d, yellow: 0xf2d06b,
  yellowBright: 0xffd45e, mint: 0x88d0bb, mintLight: 0xb9e6d8, mintDark: 0x5aa892,
  blue: 0x6aa8d8, blueDark: 0x3f6f99, white: 0xf7f2e7, offwhite: 0xe8e2d4,
  black: 0x2b2c2e, tire: 0x39393b, metal: 0xb9c0c4, metalDark: 0x787f83,
  skin: 0xf0c49d, hair: 0x5a3b2b,
  windowWarm: 0xffd087, windowCool: 0xbfe0ef,
  // 招牌背景
  signRed: 0xc53f34, signBlue: 0x2f6f8f, signGreen: 0x3c7a58, signCream: 0xf3e6c8,
  signOrange: 0xe07b3c, signMint: 0x5aa892,
  // UI / 特效配色（fx 也会用）
  sun: 0xffd9a0, sunWarm: 0xffb65c, shadow: 0x24372f,
};

export const STAGE_SKY = [
  // 1 山区晨光
  { top: 0x5a9dcc, mid: 0x9dcfe4, horizon: 0xffd49b, sun: 0xffcf8d, fog: 0xbfd7d4, light: 0xffdcaa, amb: 0x9fc6e0, ground: 0x7f8f5e },
  // 2 乡镇晴日
  { top: 0x4fa6e0, mid: 0xa9d9ed, horizon: 0xffe2b3, sun: 0xffeec2, fog: 0xc5dedc, light: 0xffefcc, amb: 0xaed6ec, ground: 0x8a9a63 },
  // 3 城市黄昏
  { top: 0x495d9a, mid: 0xc07496, horizon: 0xff9446, sun: 0xffbd6d, fog: 0xbd8b90, light: 0xffa65c, amb: 0x8a8ab4, ground: 0x6b675f },
];

/* ---------------------------------- 随机 ---------------------------------- */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rand = rng(20261121);
export const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length) % arr.length];
export const range = (r, a, b) => a + (b - a) * r();
export function darken(hex, k = 0.85) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}
export function lighten(hex, k = 1.15) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}
export function tint(hex, mix, k = 0.5) {
  return new THREE.Color(hex).lerp(new THREE.Color(mix), k).getHex();
}

/* ------------------------------- 材质与几何缓存 ------------------------------ */
const matCache = new Map();
const geoCache = new Map();

export function mat(color, opts = {}) {
  const { roughness = 0.88, metalness = 0, flatShading = false, emissive = 0x000000, emissiveIntensity = 0, transparent = false, opacity = 1, side = THREE.FrontSide, map = null, emissiveMap = null, vertexColors = false } = opts;
  const key = [color, roughness, metalness, flatShading, emissive, emissiveIntensity, transparent, opacity, side, map?.uuid || 0, emissiveMap?.uuid || 0, vertexColors].join('|');
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    flatShading,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    side,
    map,
    emissiveMap,
    vertexColors,
  });
  matCache.set(key, m);
  return m;
}

export function basicMat(color, opts = {}) {
  const { map = null, transparent = false, opacity = 1, side = THREE.FrontSide, toneMapped = false, blending = THREE.NormalBlending, depthWrite = true } = opts;
  const key = ['basic', color, map?.uuid || 0, transparent, opacity, side, toneMapped, blending, depthWrite].join('|');
  let m = matCache.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color, map, transparent, opacity, side, toneMapped, blending, depthWrite });
  matCache.set(key, m);
  return m;
}

export function getMat(color, opts = {}) {
  return mat(color, opts);
}

export function boxGeo(w, h, d, radius = 0) {
  const key = radius > 0 ? `rbox:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${radius.toFixed(3)}` : `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    if (radius > 0) g = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, Math.min(w, h, d) / 2 - 0.001));
    else g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}
export function sphereGeo(r, segments = 10) {
  const key = `sph:${r}:${segments}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.SphereGeometry(r, segments, Math.max(4, Math.round(segments * 0.7))); geoCache.set(key, g); }
  return g;
}
export function icoGeo(r, detail = 0) {
  const key = `ico:${r}:${detail}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.IcosahedronGeometry(r, detail); geoCache.set(key, g); }
  return g;
}
export function cylGeo(rTop, rBottom, h, segments = 10) {
  const key = `cyl:${rTop}:${rBottom}:${h}:${segments}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.CylinderGeometry(rTop, rBottom, h, segments); geoCache.set(key, g); }
  return g;
}
export function coneGeo(r, h, segments = 10) {
  const key = `cone:${r}:${h}:${segments}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.ConeGeometry(r, h, segments); geoCache.set(key, g); }
  return g;
}
export function torusGeo(r, tube, seg = 8, radSeg = 16) {
  const key = `tor:${r}:${tube}:${seg}:${radSeg}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.TorusGeometry(r, tube, seg, radSeg); geoCache.set(key, g); }
  return g;
}
export function planeGeo(w, h) {
  const key = `pl:${w}:${h}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.PlaneGeometry(w, h); geoCache.set(key, g); }
  return g;
}
export function circleGeo(r, seg = 16) {
  const key = `ci:${r}:${seg}`;
  let g = geoCache.get(key);
  if (!g) { g = new THREE.CircleGeometry(r, seg); geoCache.set(key, g); }
  return g;
}

/* --------------------------------- 网格工具 -------------------------------- */
export function shade(obj, cast = true, receive = false) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return obj;
}

export function put(parent, obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  parent.add(obj);
  return obj;
}

export function boxMesh(w, h, d, color, opts = {}) {
  const { radius = 0, ...rest } = opts;
  const m = new THREE.Mesh(boxGeo(w, h, d, radius), mat(color, rest));
  m.castShadow = true;
  return m;
}
export function sphereMesh(r, color, opts = {}) {
  const m = new THREE.Mesh(sphereGeo(r, opts.segments || 10), mat(color, opts));
  m.castShadow = true;
  return m;
}
export function icoMesh(r, color, opts = {}) {
  const m = new THREE.Mesh(icoGeo(r, opts.detail || 0), mat(color, opts));
  m.castShadow = true;
  return m;
}
export function cylMesh(rTop, rBottom, h, color, opts = {}) {
  const m = new THREE.Mesh(cylGeo(rTop, rBottom, h, opts.segments || 10), mat(color, opts));
  m.castShadow = true;
  return m;
}
export function coneMesh(r, h, color, opts = {}) {
  const m = new THREE.Mesh(coneGeo(r, h, opts.segments || 10), mat(color, opts));
  m.castShadow = true;
  return m;
}
export function torusMesh(r, tube, color, opts = {}) {
  const m = new THREE.Mesh(torusGeo(r, tube, opts.seg || 8, opts.radSeg || 16), mat(color, opts));
  m.castShadow = true;
  return m;
}
export function planeMesh(w, h, mtlOrColor, opts = {}) {
  const m = new THREE.Mesh(planeGeo(w, h), mtlOrColor?.isMaterial ? mtlOrColor : mat(mtlOrColor, { side: THREE.DoubleSide, ...opts }));
  return m;
}

export function gableRoof(width, depth, height, color, overhang = 0.25) {
  const w = width + overhang * 2, d = depth + overhang * 2;
  const hw = w / 2, hd = d / 2;
  const positions = new Float32Array([
    -hw, 0, -hd, hw, 0, -hd, 0, height, -hd,
    -hw, 0, hd, hw, 0, hd, 0, height, hd,
  ]);
  const idx = [0, 1, 2, 3, 5, 4, 0, 2, 5, 0, 5, 3, 1, 4, 5, 1, 5, 2, 0, 3, 4, 0, 4, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(color, { flatShading: true }));
  m.castShadow = true;
  return m;
}

export function curveLine(points, color = 0x3a3a3a, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new THREE.Line(g, m);
}

export function catenary(p1, p2, sag = 1, color = 0x3a3a3a, segs = 16, opacity = 1) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = new THREE.Vector3().lerpVectors(p1, p2, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    pts.push(p);
  }
  return curveLine(pts, color, opacity);
}

/* -------------------------------- Canvas 贴图 ------------------------------ */
const CN_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

export function canvasTexture(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = opts.colorSpace ?? THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 8;
  if (opts.wrap) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.needsUpdate = true;
  return tex;
}

export function noiseTexture(base, opts = {}) {
  const size = opts.size || 256;
  const amt = opts.amount ?? 14;
  const seed = opts.seed || 7;
  const r = rng(seed);
  return canvasTexture(size, size, (ctx) => {
    const col = new THREE.Color(base);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5000; i++) {
      const a = r() * 0.09;
      const c = col.clone().offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.05, (r() - 0.5) * (amt / 100));
      ctx.fillStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a.toFixed(3)})`;
      const s = 1 + r() * 3;
      ctx.fillRect(r() * size, r() * size, s, s);
    }
    if (opts.extra) opts.extra(ctx, size);
  }, { wrap: true, repeat: opts.repeat || [1, 1] });
}

export function asphaltTexture(base = 0x5b5f63, opts = {}) {
  const seed = opts.seed || 3;
  const r = rng(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    const col = new THREE.Color(base);
    ctx.fillStyle = `#${col.getHexString()}`;
    ctx.fillRect(0, 0, w, h);
    // 大块明暗
    for (let i = 0; i < 60; i++) {
      const c = col.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08);
      ctx.fillStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},0.35)`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 20 + r() * 70, 10 + r() * 40, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 颗粒
    for (let i = 0; i < 9000; i++) {
      const l = r();
      ctx.fillStyle = l > 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.05})` : `rgba(0,0,0,${0.02 + r() * 0.06})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // 裂缝
    ctx.strokeStyle = 'rgba(20,20,20,0.2)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      let x = r() * w, y = r() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, { wrap: true, repeat: opts.repeat || [1, 1], anisotropy: 8 });
}

export function facadeTexture(opts = {}) {
  const cols = opts.cols || 8, rows = opts.rows || 12;
  const w = opts.width || 512, h = opts.height || 768;
  const base = opts.base ?? 0x6f8495;
  const win = opts.window ?? 0x2f4654;
  const lit = opts.lit ?? 0xffd087;
  const litRatio = opts.litRatio ?? 0.35;
  const seed = opts.seed || 11;
  const r = rng(seed);
  return canvasTexture(w, h, (ctx) => {
    const c = new THREE.Color(base);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, 0, w, h);
    // 楼层横向分隔
    const mx = w / (cols * 2.2), my = h / (rows * 2.2);
    const cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const isLit = r() < litRatio;
        const cc = new THREE.Color(isLit ? lit : win).offsetHSL(0, 0, (r() - 0.5) * 0.08);
        ctx.fillStyle = `#${cc.getHexString()}`;
        ctx.fillRect(mx + x * cw + cw * 0.16, my + y * ch + ch * 0.14, cw * 0.68, ch * 0.62);
      }
    }
    // 竖向结构线
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let x = 1; x < cols; x++) { ctx.beginPath(); ctx.moveTo(mx + x * cw, 0); ctx.lineTo(mx + x * cw, h); ctx.stroke(); }
  });
}

export function signTexture(text, opts = {}) {
  const w = opts.width || 512, h = opts.height || 192;
  const bg = opts.bg ?? C.signRed;
  const fg = opts.fg ?? 0xfff4dc;
  const border = opts.border ?? null;
  const vertical = !!opts.vertical;
  const font = opts.font || 900;
  const glowy = opts.glow ?? false;
  const sub = opts.sub || '';
  const r = rng(opts.seed || text.length + 17);
  return canvasTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    const bgc = new THREE.Color(bg);
    // 底板
    const pad = 6;
    ctx.fillStyle = `#${bgc.getHexString()}`;
    roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, opts.radius ?? 18);
    ctx.fill();
    // 轻微做旧
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + r() * 0.04})`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 5, 2 + r() * 5);
    }
    // 边框
    if (border !== null) {
      ctx.strokeStyle = `#${new THREE.Color(border).getHexString()}`;
      ctx.lineWidth = Math.max(4, w * 0.01);
      roundRect(ctx, pad + 6, pad + 6, w - pad * 2 - 12, h - pad * 2 - 12, opts.radius ?? 12);
      ctx.stroke();
    }
    const fgcol = new THREE.Color(fg);
    ctx.fillStyle = `#${fgcol.getHexString()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (glowy) {
      ctx.shadowColor = `#${new THREE.Color(opts.glowColor ?? fg).getHexString()}`;
      ctx.shadowBlur = 24;
    }
    if (vertical) {
      const chars = [...text];
      const size = Math.min(w * 0.68, (h - 40) / chars.length * 0.82);
      ctx.font = `${font} ${size}px ${CN_FONT}`;
      const start = h / 2 - ((chars.length - 1) * size * 1.08) / 2;
      chars.forEach((ch, i) => ctx.fillText(ch, w / 2, start + i * size * 1.08));
    } else {
      const size = opts.fontSize || Math.min(h * (sub ? 0.46 : 0.56), (w * 1.5) / Math.max(2, [...text].length));
      ctx.font = `${font} ${size}px ${CN_FONT}`;
      if (sub) {
        ctx.fillText(text, w / 2, h * 0.42);
        ctx.font = `600 ${size * 0.42}px ${CN_FONT}`;
        ctx.globalAlpha = 0.85;
        ctx.fillText(sub, w / 2, h * 0.76);
      } else {
        ctx.fillText(text, w / 2, h / 2 + size * 0.02);
      }
    }
  });
}

export function signBoard(text, opts = {}) {
  const w = opts.w || 2.4, h = opts.h || 0.8;
  const tex = signTexture(text, { ...opts, width: opts.texW || 512, height: opts.texH || 192 });
  const mtl = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(opts.emissive ?? 0xffffff),
    emissiveIntensity: opts.glow ? (opts.glowIntensity ?? 0.9) : 0,
    roughness: 0.7,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(planeGeo(w, h), mtl);
  return m;
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* --------------------------------- 光晕/影 -------------------------------- */
let glowTexCache = null;
export function glowTexture() {
  if (glowTexCache) return glowTexCache;
  glowTexCache = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: 2 });
  return glowTexCache;
}

export function glowSprite(color = 0xffffff, size = 1, opacity = 0.8, opts = {}) {
  const m = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: opts.additive ?? THREE.AdditiveBlending,
    toneMapped: opts.toneMapped ?? false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}

let shadowTexCache = null;
export function shadowTexture() {
  if (shadowTexCache) return shadowTexCache;
  shadowTexCache = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(30,40,30,0.55)');
    g.addColorStop(0.55, 'rgba(30,40,30,0.25)');
    g.addColorStop(1, 'rgba(30,40,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: 2 });
  return shadowTexCache;
}

export function contactShadow(w = 1, d = 1, opacity = 1) {
  const m = new THREE.Mesh(planeGeo(w, d), new THREE.MeshBasicMaterial({
    map: shadowTexture(), transparent: true, opacity, depthWrite: false, toneMapped: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  m.renderOrder = 2;
  return m;
}

/* -------------------------------- 小物件组合 ------------------------------- */
export function leafCluster(parent, x, y, z, r, color, opts = {}) {
  const m = icoMesh(r, color, { detail: 0, flatShading: true, ...opts });
  m.position.set(x, y, z);
  m.scale.set(1, 0.75 + rand() * 0.3, 1);
  m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  parent.add(m);
  return m;
}

export function wheel(parent, x, y, z, r, width = 0.16, color = C.tire) {
  const w = cylMesh(r, r, width, color, { segments: 14 });
  w.rotation.z = Math.PI / 2;
  w.position.set(x, y, z);
  parent.add(w);
  // 轮毂
  const hub = cylMesh(r * 0.45, r * 0.45, width + 0.02, C.metal, { segments: 10 });
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x, y, z);
  parent.add(hub);
  return w;
}

export function stickerFace(parent, x, y, z, r, color = C.yellow) {
  const s = new THREE.Mesh(circleGeo(r, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  s.position.set(x, y, z);
  parent.add(s);
  return s;
}

export function simpleSmileTexture(bg = C.yellow, face = 0x6b4b24) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = `#${new THREE.Color(bg).getHexString()}`;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `#${new THREE.Color(face).getHexString()}`;
    ctx.beginPath(); ctx.arc(w * 0.35, h * 0.42, w * 0.055, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.65, h * 0.42, w * 0.055, 0, 7); ctx.fill();
    ctx.lineWidth = w * 0.045; ctx.strokeStyle = ctx.fillStyle; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.52, w * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  });
}

/* ------------------------------- 动画/其它 -------------------------------- */
export function softOut(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 统一导出 THREE，方便道具模块少写 import
export { THREE };
