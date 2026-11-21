// props_city.js — 第三幕「城市黄昏」：玻璃高楼 / 中文广告屏 / 交通 / 障碍 / 远景
// 契约：每个导出函数返回 THREE.Group，原点=物件底面中心，单位米，默认正面朝 +Z；
//       工厂不设置世界位置、无全局副作用；大量共享 artkit 缓存材质/几何/Canvas 贴图。
// 可选微动画：group.userData.tick = (t, dt) => {}
// 预览：http://127.0.0.1:8788/tools/prop-lab.html?module=city&bg=sunset
//
// 变体参数（给 Lead 摆城市用）：
//   skyscraper({ variant: 0|1|2|3 })          0 蓝玻璃塔 / 1 香槟双段塔+大屏 / 2 圆角玻璃楼 / 3 暖色公寓
//   billboard({ variant: 0|1|2|3, day: false }) 奶茶 / 准时送达 / 生鲜 / 影院；day=true 时自发光减弱
//   car({ color: 0xe4735f })  taxi({ color })  bus()  —— 车身颜色可换
//   pigeon({ flying: false })
// 颜色走「明亮金色黄昏」：暖金、奶油、薄荷、珊瑚红、天空蓝；避免大面积黑玻璃与霓虹紫。
import * as THREE from 'three';
import {
  C, mat, boxMesh, boxGeo, cylMesh, coneMesh, icoMesh, signBoard, glowSprite,
  put, planeGeo, circleGeo, facadeTexture, canvasTexture, basicMat, wheel, darken,
} from './artkit.js';

const TAU = Math.PI * 2;
const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';

/* ══════════════════════════════ 内部工具 ══════════════════════════════ */

function addTicker(group, fn) {
  const prev = group.userData.tick;
  group.userData.tick = prev
    ? (t, dt) => { prev(t, dt); fn(t, dt); }
    : fn;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ——— 中文招牌：signBoard 生成材质后缓存，避免同一招牌反复生成 Canvas ——— */
const _signMats = new Map();
function signMaterial(text, opts = {}) {
  const vertical = !!opts.vertical;
  const texW = opts.texW || (vertical ? 256 : 512);
  const texH = opts.texH || (vertical ? 1024 : 192);
  const chars = Math.max(2, [...text].length);
  const fontSize = opts.fontSize || Math.round(
    Math.min(texH * (opts.sub ? 0.46 : 0.56), (texW * 0.84) / chars),
  );
  const o = { ...opts, texW, texH, fontSize };
  const key = [
    text, o.bg, o.fg, o.sub, vertical ? 1 : 0, o.border,
    o.glow ? 1 : 0, o.glowIntensity, o.glowColor, texW, texH, fontSize, o.seed,
  ].join('|');
  let m = _signMats.get(key);
  if (!m) {
    m = signBoard(text, o).material;
    _signMats.set(key, m);
  }
  return m;
}

/** 平面招牌（材质缓存，不投影）。 */
function signPanel(w, h, text, opts = {}) {
  const m = new THREE.Mesh(planeGeo(w, h), signMaterial(text, opts));
  m.castShadow = false;
  return m;
}

/* ——— 大楼玻璃幕墙：facadeTexture 缓存 ——— */
const FACADES = {
  glassA: { base: 0xc6dee4, window: 0x6fa3ba, lit: 0xffd08a, litRatio: 0.38, cols: 7, rows: 16, seed: 11, glow: 0.26 },
  glassB: { base: 0xe6d6b8, window: 0x9aa8b8, lit: 0xffc46e, litRatio: 0.40, cols: 6, rows: 20, seed: 23, glow: 0.28 },
  glassC: { base: 0xd2e7e0, window: 0x7fb8a9, lit: 0xffd28a, litRatio: 0.34, cols: 8, rows: 12, seed: 37, glow: 0.24 },
  home:   { base: 0xecdcc2, window: 0x8fb0c0, lit: 0xffce87, litRatio: 0.48, cols: 7, rows: 9,  seed: 51, glow: 0.22 },
  skyFar: { base: 0x9ba3c6, window: 0x8b93b8, lit: 0xffc98a, litRatio: 0.24, cols: 4, rows: 10, seed: 71, glow: 0.30 },
  skyMid: { base: 0xc9a9b8, window: 0x9f8ea9, lit: 0xffc07a, litRatio: 0.40, cols: 4, rows: 12, seed: 83, glow: 0.26 },
  skyNear:{ base: 0xd8b9a8, window: 0xa88e94, lit: 0xffcf87, litRatio: 0.46, cols: 5, rows: 8,  seed: 97, glow: 0.24 },
};

const _facadeMats = new Map();
function facadeMaterial(key) {
  let m = _facadeMats.get(key);
  if (!m) {
    const c = FACADES[key];
    const tex = facadeTexture({
      cols: c.cols, rows: c.rows, width: 512, height: 768,
      base: c.base, window: c.window, lit: c.lit, litRatio: c.litRatio, seed: c.seed,
    });
    m = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0xffc48c),
      emissiveIntensity: c.glow,
      roughness: 0.58,
      metalness: 0.08,
    });
    _facadeMats.set(key, m);
  }
  return m;
}

function towerMesh(w, h, d, key, radius = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d, radius), facadeMaterial(key));
  m.castShadow = true;
  return m;
}

/* ——— 广告屏 Canvas（比单纯文字牌更像真实广告） ——— */
const ADS = {
  tea: {
    text: '茶小满', sub: '鲜果茶 · 第二杯半价', badge: '新品尝鲜', mark: '茶',
    kicker: 'CITY TEA · 手作鲜果茶', c1: '#f78fb3', c2: '#e2566f', fg: '#fff8e8', accent: '#ffd9a0',
  },
  delivery: {
    text: '准时送达', sub: '30 分钟 · 热乎到家', badge: '准时必达', mark: '达',
    kicker: 'ON TIME · 城市即时配送', c1: '#ffbd6b', c2: '#e4574c', fg: '#fff8e8', accent: '#ffe3a3',
  },
  fresh: {
    text: '生鲜到家', sub: '今日现采 · 送菜上门', badge: '满 39 减 10', mark: '鲜',
    kicker: 'FRESH MARKET · 社区生鲜', c1: '#8cc98f', c2: '#3c7a58', fg: '#f7fbea', accent: '#f2d06b',
  },
  cinema: {
    text: '城市影院', sub: '今夜首映 · 19:30', badge: '热映中', mark: '影',
    kicker: 'CITY CINEMA · IMAX 厅', c1: '#86a8d9', c2: '#3f6f99', fg: '#fff8e8', accent: '#f7b267',
  },
  city: {
    text: '城市广场', sub: '夜游 · 灯光秀', badge: '每晚 20:00', mark: '城',
    kicker: 'CITY PLAZA · 晚风市集', c1: '#f2a03d', c2: '#d9534f', fg: '#fff8e8', accent: '#ffd9a0',
  },
};

function adTexture(key) {
  const a = ADS[key] || ADS.tea;
  return canvasTexture(768, 384, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, a.c1);
    grad.addColorStop(1, a.c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 装饰圆 + 斜向光带
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#fff6e4';
    ctx.beginPath(); ctx.arc(w * 0.86, h * 0.24, 132, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.10;
    ctx.beginPath(); ctx.arc(w * 0.97, h * 0.92, 190, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(w * 0.48, 0); ctx.lineTo(w * 0.7, 0); ctx.lineTo(w * 0.22, h);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // 顶部小字
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = a.fg;
    ctx.globalAlpha = 0.78;
    ctx.font = `600 25px ${FONT}`;
    ctx.fillText(a.kicker, 48, 42);
    ctx.globalAlpha = 1;
    // 主标题
    const titleSize = Math.min(124, 610 / Math.max(2, [...a.text].length));
    ctx.font = `900 ${titleSize}px ${FONT}`;
    ctx.fillStyle = a.fg;
    ctx.fillText(a.text, 46, 158);
    // 副标题
    ctx.globalAlpha = 0.92;
    ctx.font = `600 40px ${FONT}`;
    ctx.fillText(a.sub, 50, 238);
    ctx.globalAlpha = 1;
    // 圆角徽章
    ctx.fillStyle = a.accent;
    roundRectPath(ctx, 48, 288, 252, 56, 28);
    ctx.fill();
    ctx.fillStyle = '#4a2a24';
    ctx.font = `800 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(a.badge, 174, 317);
    // 右下角品牌圆章
    ctx.fillStyle = 'rgba(255,248,232,0.93)';
    ctx.beginPath(); ctx.arc(w - 92, h - 78, 54, 0, TAU); ctx.fill();
    ctx.fillStyle = a.c2;
    ctx.font = `900 52px ${FONT}`;
    ctx.fillText(a.mark, w - 92, h - 76);
    // 底部细线
    ctx.fillStyle = 'rgba(255,248,232,0.35)';
    ctx.fillRect(48, h - 34, w - 96, 3);
  }, { anisotropy: 8 });
}

const _adMats = new Map();
function adMaterial(key, glow = 0.55) {
  const ck = `${key}|${glow}`;
  let m = _adMats.get(ck);
  if (!m) {
    const tex = adTexture(key);
    m = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: glow,
      roughness: 0.52,
      metalness: 0.05,
    });
    _adMats.set(ck, m);
  }
  return m;
}

function adPlane(w, h, key, glow) {
  const m = new THREE.Mesh(planeGeo(w, h), adMaterial(key, glow).clone());
  m.castShadow = false;
  return m;
}

/* ——— 共享材质 ——— */
const GLASS = mat(0x9cc4d0, { transparent: true, opacity: 0.6, roughness: 0.16, metalness: 0.25 });
GLASS.depthWrite = false;
function glassBox(w, h, d) {
  const m = new THREE.Mesh(boxGeo(w, h, d), GLASS);
  m.castShadow = false;
  return m;
}
const TIRE_DARK = C.tire;
const POLE = mat(0x7f8a8c, { roughness: 0.55, metalness: 0.35 });
const CREAM = C.cream;
const DEEP_TEAL = 0x35524c;

/* ——— 公交侧面车窗贴图（透明底，隔窗露车身色） ——— */
const _bandMats = new Map();
function windowBandMaterial(key = 'bus') {
  let m = _bandMats.get(key);
  if (m) return m;
  const tex = canvasTexture(1024, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const n = 7;
    const pad = 24;
    const gap = 16;
    const ww = (w - pad * 2 - gap * (n - 1)) / n;
    const y0 = 18;
    const hh = h - 36;
    const r = 14;
    for (let i = 0; i < n; i++) {
      const x = pad + i * (ww + gap);
      const g = ctx.createLinearGradient(0, y0, 0, y0 + hh);
      g.addColorStop(0, '#d6ebef');
      g.addColorStop(0.45, '#a9cbd6');
      g.addColorStop(1, '#7fa9b8');
      ctx.fillStyle = g;
      roundRectPath(ctx, x, y0, ww, hh, r);
      ctx.fill();
      // 暖色车厢内部
      if (i === 1 || i === 4 || i === 6) {
        ctx.fillStyle = 'rgba(255,204,130,0.42)';
        roundRectPath(ctx, x + ww * 0.18, y0 + hh * 0.4, ww * 0.64, hh * 0.52, r * 0.7);
        ctx.fill();
      }
      // 斜向天空反光
      ctx.save();
      roundRectPath(ctx, x, y0, ww, hh, r);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(x - 10, y0 + hh);
      ctx.lineTo(x + ww * 0.75, y0 - 10);
      ctx.stroke();
      ctx.restore();
      // 窗框
      ctx.strokeStyle = 'rgba(90,120,124,0.5)';
      ctx.lineWidth = 3;
      roundRectPath(ctx, x, y0, ww, hh, r);
      ctx.stroke();
    }
  }, { anisotropy: 8 });
  m = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(0xffcf9a),
    emissiveIntensity: 0.22,
    transparent: true,
    roughness: 0.22,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  _bandMats.set(key, m);
  return m;
}

/* ——— 红白施工斜纹 ——— */
let _stripeMat = null;
function stripeMaterial() {
  if (_stripeMat) return _stripeMat;
  const tex = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f7f2e7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e4574c';
    const sw = 34;
    for (let x = -h; x < w + h; x += sw * 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + sw, 0);
      ctx.lineTo(x + sw + h, h);
      ctx.lineTo(x + h, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(120,70,60,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }, { anisotropy: 4 });
  _stripeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  return _stripeMat;
}

/* ——— 外卖箱笑脸贴纸（黄箱 + 橙边 + 准时达） ——— */
let _smileyMat = null;
function smileyMaterial() {
  if (_smileyMat) return _smileyMat;
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2d06b';
    roundRectPath(ctx, 0, 0, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = '#e08a3c';
    ctx.lineWidth = 6;
    roundRectPath(ctx, 6, 6, w - 12, h - 12, 12);
    ctx.stroke();
    ctx.fillStyle = '#6b4b24';
    ctx.beginPath(); ctx.arc(w * 0.36, h * 0.4, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.64, h * 0.4, 6, 0, TAU); ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#6b4b24';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, 24, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.fillStyle = '#8a5a2a';
    ctx.font = `700 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('准时达', w / 2, h * 0.82);
  }, { anisotropy: 4 });
  _smileyMat = basicMat(0xffffff, { map: tex, transparent: true, toneMapped: false });
  return _smileyMat;
}

/* ——— 行人信号灯图标 ——— */
let _pedIcons = null;
function pedIcons() {
  if (_pedIcons) return _pedIcons;
  const draw = (color, walking) => canvasTexture(128, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    // 头
    ctx.beginPath(); ctx.arc(w * 0.52, 32, 14, 0, TAU); ctx.fill();
    // 身体
    ctx.save();
    ctx.translate(w * 0.52, 46);
    ctx.rotate(walking ? -0.08 : 0);
    ctx.fillRect(-11, 0, 22, 46);
    // 手臂
    ctx.fillRect(-26, 3, 15, 10);
    ctx.fillRect(11, 3, 15, 10);
    // 腿
    if (walking) {
      ctx.save(); ctx.translate(-2, 44); ctx.rotate(0.4); ctx.fillRect(-6, 0, 11, 52); ctx.restore();
      ctx.save(); ctx.translate(2, 44); ctx.rotate(-0.36); ctx.fillRect(-5, 0, 11, 50); ctx.restore();
    } else {
      ctx.fillRect(-11, 44, 9, 52);
      ctx.fillRect(3, 44, 9, 52);
    }
    ctx.restore();
  }, { anisotropy: 4 });
  _pedIcons = { stand: draw('#ff5a4a', false), walk: draw('#5fe08a', true) };
  return _pedIcons;
}

/* ——— 人行横道蓝牌 ——— */
let _crossTex = null;
function crosswalkTexture() {
  if (_crossTex) return _crossTex;
  _crossTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#2f6f8f';
    roundRectPath(ctx, 4, 4, w - 8, h - 8, 26);
    ctx.fill();
    ctx.strokeStyle = '#fff8e8';
    ctx.lineWidth = 8;
    roundRectPath(ctx, 13, 13, w - 26, h - 26, 20);
    ctx.stroke();
    // 斑马线
    ctx.fillStyle = '#fff8e8';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(42 + i * 36, 188, 22, 42);
    }
    // 行人
    ctx.fillStyle = '#fff8e8';
    ctx.beginPath(); ctx.arc(128, 52, 18, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(128, 76);
    ctx.rotate(0.1);
    ctx.fillRect(-14, 0, 28, 54);
    ctx.save(); ctx.translate(-2, 50); ctx.rotate(0.42); ctx.fillRect(-7, 0, 13, 62); ctx.restore();
    ctx.save(); ctx.translate(4, 50); ctx.rotate(-0.34); ctx.fillRect(-6, 0, 13, 60); ctx.restore();
    ctx.restore();
    // 底部小字
    ctx.fillStyle = '#fff8e8';
    ctx.font = `700 21px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('人行横道', w / 2, 240);
  }, { anisotropy: 4 });
  return _crossTex;
}

/* ——— 广告牌顶灯 ——— */
function signLamp(parent, x, y, z, color = 0xffd9a0, size = 0.9, opacity = 0.5) {
  const s = glowSprite(color, size, opacity);
  put(parent, s, x, y, z);
  return s;
}

/* ——— 楼底商铺带：奶油骑楼 + 暖橱窗 + 中文招牌 + 小雨棚 ——— */
function shopFront(g, w, d, signs, accent = C.signRed) {
  const bandH = 2.7;
  put(g, boxMesh(w + 0.2, bandH, d + 0.2, CREAM, { roughness: 0.9 }), 0, bandH / 2, 0);
  put(g, boxMesh(w + 0.34, 0.16, d + 0.34, C.plaster2), 0, bandH + 0.02, 0);
  const zf = d / 2 + 0.11;
  for (const sx of [-w * 0.24, w * 0.24]) {
    put(g, boxMesh(1.52, 1.35, 0.1, DEEP_TEAL, { roughness: 0.6 }), sx, 1.35, zf);
    put(g, boxMesh(1.28, 1.1, 0.06, C.windowWarm, {
      emissive: C.windowWarm, emissiveIntensity: 0.7, roughness: 0.4,
    }), sx, 1.35, zf + 0.07);
  }
  for (const s of signs) {
    put(g, signPanel(s.w, 0.56, s.text, {
      texW: 512, texH: 160, bg: s.bg, fg: 0xfff6e6,
      glow: true, glowIntensity: 0.5, radius: 14,
    }), s.x, 2.42, zf + 0.04);
    const aw = boxMesh(s.w + 0.16, 0.06, 0.56, s.awning ?? accent, { roughness: 0.85 });
    put(g, aw, s.x, 2.0, zf + 0.26, -0.18, 0, 0);
  }
}

/* ══════════════════════════════ 建筑 ══════════════════════════════ */

/**
 * 玻璃摩天楼（8–30m）。variant 0/1/2/3 四种风格。
 * 楼顶带设备（水箱 / 空调机组 / 天线 / 红色航空灯）、可选楼顶霓虹字与竖招牌。
 */
export function skyscraper(opts = {}) {
  const variant = ((opts.variant ?? 0) % 4 + 4) % 4;
  const g = new THREE.Group();
  if (variant === 1) buildChampagneTower(g);
  else if (variant === 2) buildRoundGlassTower(g);
  else if (variant === 3) buildApartmentTower(g);
  else buildBlueTower(g);
  return g;
}

function buildBlueTower(g) {
  const w = 7.0, d = 6.4, h = 24;
  put(g, towerMesh(w, h, d, 'glassA'), 0, h / 2, 0);
  shopFront(g, w, d, [
    { text: '24H 便利店', bg: C.signMint, x: -1.35, w: 2.0 },
    { text: '鲜果茶', bg: 0xe2566f, x: 1.5, w: 1.5 },
  ], C.signRed);
  // 竖向白色壁柱（让玻璃塔不单调）+ 顶部暖灯带
  put(g, boxMesh(0.34, h - 3.4, 0.24, CREAM), -w / 2 + 0.24, (h + 3.4) / 2, d / 2);
  put(g, boxMesh(0.34, h - 3.4, 0.24, CREAM), w / 2 - 0.24, (h + 3.4) / 2, d / 2);
  put(g, boxMesh(w + 0.14, 0.16, d + 0.14, C.windowWarm, {
    emissive: C.windowWarm, emissiveIntensity: 0.45, roughness: 0.6,
  }), 0, h - 0.55, 0);
  // 中层 LED 大屏
  put(g, boxMesh(5.8, 3.0, 0.22, CREAM), 0, 13.6, d / 2 + 0.02);
  const screen = adPlane(5.4, 2.6, 'tea', 0.46);
  put(g, screen, 0, 13.6, d / 2 + 0.17);
  addTicker(g, (t) => {
    screen.material.emissiveIntensity = 0.46 + Math.sin(t * 2.4 + 0.4) * 0.05;
  });
  // 楼顶
  put(g, boxMesh(w + 0.2, 0.34, d + 0.2, CREAM), 0, h + 0.17, 0);
  put(g, cylMesh(0.62, 0.7, 1.25, 0xbcd8d2, { segments: 8 }), 1.45, h + 0.95, -1.4);
  put(g, cylMesh(0.24, 0.24, 1.25, C.steelDark, { segments: 6 }), 1.45, h + 0.62, -1.4);
  put(g, boxMesh(1.15, 0.66, 0.95, CREAM), -1.5, h + 0.67, 1.2);
  put(g, boxMesh(0.95, 0.46, 0.8, C.steel), -0.1, h + 0.57, -1.6);
  put(g, cylMesh(0.05, 0.07, 3.4, C.steelDark, { segments: 6 }), 2.3, h + 2.0, -2.2);
  // 楼顶霓虹字
  put(g, boxMesh(5.4, 1.3, 0.2, C.steelDark), 0, h + 1.32, d / 2 - 0.18);
  put(g, signPanel(5.1, 1.08, '云端大厦', {
    texW: 1024, texH: 256, bg: C.signRed, fg: 0xfff4dc, glow: true, glowIntensity: 0.85,
  }), 0, h + 1.32, d / 2 - 0.06);
  put(g, boxMesh(0.1, 1.0, 0.1, C.steelDark), -1.55, h + 0.51, d / 2 - 0.2);
  put(g, boxMesh(0.1, 1.0, 0.1, C.steelDark), 1.55, h + 0.51, d / 2 - 0.2);
  const beacon = glowSprite(0xff5a4a, 0.75, 0.8);
  put(g, beacon, 2.3, h + 3.75, -2.2);
  addTicker(g, (t) => {
    beacon.material.opacity = 0.22 + 0.62 * (0.5 + 0.5 * Math.sin(t * 2.3));
  });
}

function buildChampagneTower(g) {
  const w = 5.6, d = 5.6, hMain = 18, hUp = 7.2;
  put(g, towerMesh(w, hMain, d, 'glassB'), 0, hMain / 2, 0);
  put(g, towerMesh(3.8, hUp, 3.8, 'glassB'), 0, hMain + hUp / 2, 0);
  put(g, boxMesh(w + 0.3, 0.32, d + 0.3, CREAM), 0, hMain + 0.12, 0);
  shopFront(g, w, d, [
    { text: '安心药房', bg: C.signGreen, x: -1.2, w: 1.85 },
    { text: '快递驿站', bg: C.signOrange, x: 1.4, w: 1.7 },
  ], C.signMint);
  // 大面积 LED 广告屏（黄昏自发光 + 轻微闪烁）
  put(g, boxMesh(4.9, 2.6, 0.22, CREAM), 0, 12.4, d / 2 + 0.04);
  const screen = adPlane(4.5, 2.2, 'city', 0.5);
  put(g, screen, 0, 12.4, d / 2 + 0.17);
  addTicker(g, (t) => {
    screen.material.emissiveIntensity = 0.5 + Math.sin(t * 2.6) * 0.05 + (Math.sin(t * 15.1) > 0.985 ? -0.12 : 0);
  });
  // 竖向霓虹招牌
  put(g, boxMesh(1.2, 4.55, 0.12, CREAM), 1.05, hMain + 3.55, 1.95);
  put(g, signPanel(1.0, 4.3, '梧桐中心', {
    vertical: true, texW: 256, texH: 1024, bg: C.signRed, fg: 0xfff4dc,
    glow: true, glowIntensity: 0.8,
  }), 1.05, hMain + 3.55, 2.02);
  // 楼顶尖顶 + 天线
  put(g, coneMesh(0.22, 2.2, CREAM, { segments: 6 }), 0, hMain + hUp + 1.15, 0);
  put(g, cylMesh(0.035, 0.05, 2.4, C.steelDark, { segments: 5 }), 0, hMain + hUp + 3.3, 0);
  put(g, boxMesh(1.1, 0.6, 1.0, CREAM), 1.2, hMain + hUp + 0.45, -1.1);
  const beacon = glowSprite(0xff5a4a, 0.7, 0.8);
  put(g, beacon, 0, hMain + hUp + 4.55, 0);
  addTicker(g, (t) => {
    beacon.material.opacity = 0.2 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.0 + 1.7));
  });
}

function buildRoundGlassTower(g) {
  const w = 8, d = 8, h = 16;
  put(g, towerMesh(w, h, d, 'glassC', 0.8), 0, h / 2, 0);
  // 奶油横向腰线
  put(g, boxMesh(w + 0.16, 0.22, d + 0.16, CREAM), 0, 5.4, 0);
  put(g, boxMesh(w + 0.16, 0.22, d + 0.16, CREAM), 0, 11.0, 0);
  shopFront(g, w, d, [
    { text: '城市影院', bg: C.signBlue, x: -1.65, w: 2.1 },
    { text: '城市银行', bg: C.signRed, x: 1.5, w: 1.65 },
  ], C.signMint);
  // 门头大屏
  put(g, boxMesh(5.2, 2.8, 0.25, CREAM), 0, 4.4, d / 2 + 0.02);
  const screen = adPlane(4.8, 2.4, 'delivery', 0.48);
  put(g, screen, 0, 4.4, d / 2 + 0.16);
  addTicker(g, (t) => {
    screen.material.emissiveIntensity = 0.48 + Math.sin(t * 2.1 + 0.6) * 0.05;
  });
  // 楼顶
  put(g, boxMesh(w + 0.2, 0.32, d + 0.2, CREAM), 0, h + 0.16, 0);
  put(g, boxMesh(5.0, 1.18, 0.2, C.steelDark), 0, h + 1.35, d / 2 - 0.28);
  put(g, signPanel(4.7, 0.95, '新世界广场', {
    texW: 1024, texH: 256, bg: 0x3c7a58, fg: 0xfff4dc, glow: true, glowIntensity: 0.75,
  }), 0, h + 1.35, d / 2 - 0.16);
  put(g, boxMesh(1.35, 0.8, 1.1, CREAM), -1.9, h + 0.7, -1.3);
  put(g, cylMesh(0.05, 0.07, 3.0, C.steelDark, { segments: 5 }), 2.1, h + 1.8, -2.5);
  const beacon = glowSprite(0xffb45c, 0.65, 0.8);
  put(g, beacon, 2.1, h + 3.35, -2.5);
  addTicker(g, (t) => {
    beacon.material.opacity = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.6 + 2.4));
  });
}

function buildApartmentTower(g) {
  const w = 7, d = 6, h = 12;
  put(g, towerMesh(w, h, d, 'home'), 0, h / 2, 0);
  // 楼层线脚 + 花箱
  for (let i = 0; i < 3; i++) {
    const y = 4.0 + i * 2.5;
    put(g, boxMesh(w + 0.12, 0.12, 0.5, CREAM), 0, y, d / 2 + 0.2);
    put(g, boxMesh(1.2, 0.22, 0.34, C.leaf2), -2.0, y + 0.16, d / 2 + 0.4);
    put(g, boxMesh(1.0, 0.2, 0.3, 0x8fbf6a), 1.7, y + 0.15, d / 2 + 0.4);
  }
  shopFront(g, w, d, [
    { text: '张记烧烤', bg: C.signRed, x: -1.5, w: 1.9 },
    { text: '生鲜超市', bg: C.signGreen, x: 1.6, w: 1.85 },
  ], C.signOrange);
  // 竖招牌
  put(g, boxMesh(1.16, 4.2, 0.12, CREAM), 2.75, 8.4, d / 2 + 0.1);
  put(g, signPanel(0.96, 4.0, '梧桐公寓', {
    vertical: true, texW: 256, texH: 1024, bg: C.signBlue, fg: 0xfff4dc,
    glow: true, glowIntensity: 0.55,
  }), 2.75, 8.4, d / 2 + 0.18);
  // 楼顶：水箱 + 小锅盖
  put(g, boxMesh(w + 0.16, 0.3, d + 0.16, CREAM), 0, h + 0.15, 0);
  put(g, cylMesh(0.62, 0.7, 1.1, 0xc9dcd6, { segments: 8 }), 1.8, h + 0.85, -1.2);
  put(g, cylMesh(0.48, 0.55, 0.9, 0xc9dcd6, { segments: 8 }), 0.45, h + 0.75, -1.9);
  const dish = cylMesh(0.52, 0.52, 0.07, CREAM, { segments: 10 });
  put(g, dish, -1.9, h + 0.55, 0.6, 1.0, 0, 0);
  put(g, cylMesh(0.04, 0.04, 0.55, C.steelDark, { segments: 5 }), -1.9, h + 0.27, 0.6);
  const beacon = glowSprite(0xff5a4a, 0.6, 0.8);
  put(g, beacon, 1.8, h + 1.65, -1.2);
  addTicker(g, (t) => {
    beacon.material.opacity = 0.18 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2 + 3.1));
  });
}

/* ───────────────────────────── 广告牌 ───────────────────────────── */

/**
 * 大型中文广告牌，带双立柱、检修马道与顶灯。黄昏自发光，opts.day=true 时减弱。
 */
export function billboard(opts = {}) {
  const themes = ['tea', 'delivery', 'fresh', 'cinema'];
  const theme = opts.theme || themes[((opts.variant ?? 0) % 4 + 4) % 4];
  const day = !!opts.day;
  const g = new THREE.Group();
  const boardW = 6.2, boardH = 3.1, boardY = 5.6;

  // 双立柱 + 斜撑
  for (const sx of [-2.25, 2.25]) {
    put(g, cylMesh(0.15, 0.19, 5.85, POLE, { segments: 8 }), sx, 2.925, 0);
    put(g, boxMesh(0.7, 0.16, 0.7, C.steelDark), sx, 0.08, 0);
  }
  put(g, cylMesh(0.07, 0.07, 4.9, POLE, { segments: 6 }), 0, 4.5, -0.45, 0, 0, Math.PI / 2);
  // 牌面框
  put(g, boxMesh(boardW + 0.5, boardH + 0.45, 0.32, CREAM), 0, boardY, 0.02);
  put(g, boxMesh(boardW + 0.3, 0.24, 0.5, C.steelDark), 0, boardY - boardH / 2 - 0.36, 0.02);
  const screen = adPlane(boardW, boardH, theme, day ? 0.1 : 0.62);
  put(g, screen, 0, boardY, 0.21);
  addTicker(g, (t) => {
    if (day) return;
    screen.material.emissiveIntensity = 0.62 + Math.sin(t * 3.4) * 0.045
      + (Math.sin(t * 17.7) > 0.985 ? -0.14 : 0);
  });
  // 顶部 3 盏照明灯
  for (const sx of [-2.1, 0, 2.1]) {
    put(g, boxMesh(0.34, 0.12, 0.22, C.steelDark), sx, boardY + boardH / 2 + 0.42, 0.6);
    const lamp = signLamp(g, sx, boardY + boardH / 2 + 0.28, 0.78, 0xffd9a0, day ? 0.5 : 1.0, day ? 0.18 : 0.42);
    if (!day) addTicker(g, (t) => { lamp.material.opacity = 0.36 + 0.08 * Math.sin(t * 1.7 + sx); });
  }
  // 底部小字横条
  put(g, signPanel(3.2, 0.34, '城市生活 · 准时送达', {
    texW: 1024, texH: 128, bg: CREAM, fg: 0x9a5a3a, glow: false, radius: 12,
  }), 0, boardY - boardH / 2 - 0.36, 0.3);
  return g;
}

/* ───────────────────────────── 街道家具 ───────────────────────────── */

/** 6m 暖光路灯，挂「文明出行」双面道旗。 */
export function streetLamp(opts = {}) {
  const g = new THREE.Group();
  put(g, cylMesh(0.19, 0.25, 0.32, C.steelDark, { segments: 8 }), 0, 0.16, 0);
  put(g, cylMesh(0.085, 0.14, 5.7, POLE, { segments: 8 }), 0, 0.32 + 2.85, 0);
  // 弯臂 + 灯头
  const arm = boxMesh(1.7, 0.09, 0.11, POLE);
  put(g, arm, 0.78, 5.98, 0, 0, 0, 0.1);
  put(g, boxMesh(0.62, 0.16, 0.32, C.steelDark), 1.55, 5.85, 0);
  put(g, boxMesh(0.5, 0.06, 0.26, C.windowWarm, {
    emissive: C.windowWarm, emissiveIntensity: 1.0, roughness: 0.4,
  }), 1.55, 5.75, 0);
  const glow = glowSprite(0xffd9a0, 2.1, 0.6);
  put(g, glow, 1.55, 5.62, 0);
  const glowCore = glowSprite(0xfff0c8, 0.7, 0.85);
  put(g, glowCore, 1.55, 5.72, 0);
  addTicker(g, (t) => {
    glow.material.opacity = 0.54 + 0.04 * Math.sin(t * 2.1);
  });
  // 双面道旗
  put(g, boxMesh(0.06, 0.06, 0.5, C.steelDark), 0, 5.1, 0.0);
  put(g, signPanel(0.5, 1.5, '文明出行', {
    vertical: true, texW: 128, texH: 512, bg: C.signRed, fg: 0xfff4dc,
    glow: false, radius: 10,
  }), 0, 4.3, 0.16);
  // 路灯编号小牌
  put(g, signPanel(0.34, 0.26, 'C-12', {
    texW: 128, texH: 96, bg: CREAM, fg: 0x6c767d, glow: false, radius: 8,
  }), 0.02, 1.5, 0.15);
  return g;
}

/** 红绿灯横杆：立柱+悬臂+三色灯，绿→黄→红自动循环。 */
export function trafficLight(opts = {}) {
  const g = new THREE.Group();
  const poleX = -2.3;
  put(g, cylMesh(0.18, 0.24, 0.36, C.steelDark, { segments: 8 }), poleX, 0.18, 0);
  put(g, cylMesh(0.1, 0.16, 6.2, POLE, { segments: 8 }), poleX, 3.1, 0);
  put(g, cylMesh(0.08, 0.08, 5.3, POLE, { segments: 6 }), 0.2, 6.15, 0, 0, 0, Math.PI / 2);
  put(g, boxMesh(0.1, 0.48, 0.1, C.steelDark), 1.7, 5.92, 0);
  // 灯箱
  put(g, boxMesh(0.56, 1.28, 0.3, DEEP_TEAL, { roughness: 0.7 }), 1.7, 5.28, 0);
  put(g, boxMesh(0.62, 1.32, 0.04, CREAM), 1.7, 5.28, 0.16);
  put(g, boxMesh(0.64, 0.08, 0.36, C.steelDark), 1.7, 5.94, 0);
  const colors = {
    red: [0xff5a4a, 0x5c3834],
    yellow: [0xffd45e, 0x5c502f],
    green: [0x5fe08a, 0x30564a],
  };
  const lamps = [];
  const ys = [5.67, 5.28, 4.89];
  ['red', 'yellow', 'green'].forEach((name, i) => {
    const m = new THREE.MeshBasicMaterial({ color: colors[name][0], toneMapped: false });
    const c = new THREE.Mesh(circleGeo(0.155, 12), m);
    c.castShadow = false;
    put(g, c, 1.7, ys[i], 0.2);
    lamps.push({ m, bright: colors[name][0], dim: colors[name][1] });
  });
  const glow = glowSprite(0x5fe08a, 1.0, 0.6);
  put(g, glow, 1.7, ys[2], 0.4);
  addTicker(g, (t) => {
    const cycle = 9.5;
    const p = t % cycle;
    let idx = 0;
    if (p < 4.6) idx = 2;          // 绿
    else if (p < 5.6) idx = 1;     // 黄
    else idx = 0;                  // 红
    lamps.forEach((l, i) => {
      const lit = i === idx;
      l.m.color.setHex(lit ? l.bright : l.dim);
    });
    glow.material.color.setHex(idx === 0 ? 0xff5a4a : idx === 1 ? 0xffd45e : 0x5fe08a);
    glow.position.y = ys[idx];
    glow.material.opacity = 0.42 + 0.1 * Math.sin(t * 5.0);
  });
  // 行人过街按钮小牌
  put(g, signPanel(0.28, 0.42, '按', {
    texW: 96, texH: 144, bg: C.signMint, fg: 0x24372f, glow: false, radius: 8,
  }), poleX + 0.02, 3.0, 0.16);
  return g;
}

/** 蓝色中文路牌（梧桐大道 + 地铁口指引）。 */
export function roadSign(opts = {}) {
  const g = new THREE.Group();
  for (const sx of [-1.55, 1.55]) {
    put(g, cylMesh(0.07, 0.09, 3.55, POLE, { segments: 7 }), sx, 1.775, 0);
    put(g, boxMesh(0.34, 0.1, 0.34, C.steelDark), sx, 0.05, 0);
  }
  put(g, boxMesh(3.7, 1.14, 0.1, CREAM), 0, 3.42, 0);
  put(g, signPanel(3.5, 0.96, '梧桐大道', {
    texW: 1024, texH: 256, bg: C.signBlue, fg: 0xfff8e8, sub: 'WUTONG AVENUE',
    border: 0xf7f2e7, glow: false, radius: 12,
  }), 0, 3.45, 0.06);
  put(g, boxMesh(2.15, 0.7, 0.09, CREAM), 1.0, 2.45, 0);
  put(g, signPanel(2.0, 0.56, '地铁口 200m →', {
    texW: 768, texH: 192, bg: C.signBlue, fg: 0xfff8e8, border: 0xf7f2e7,
    glow: false, radius: 10,
  }), 1.0, 2.45, 0.055);
  // 小距离牌
  put(g, signPanel(0.86, 0.42, '1.2km', {
    texW: 256, texH: 128, bg: CREAM, fg: 0x2f6f8f, glow: false, radius: 10,
  }), -1.3, 2.55, 0.06);
  return g;
}

/** 斑马线行人灯：蓝底人行横道牌 + 红/绿小人循环。 */
export function crosswalkSign(opts = {}) {
  const g = new THREE.Group();
  put(g, cylMesh(0.12, 0.17, 0.3, C.steelDark, { segments: 8 }), 0, 0.15, 0);
  put(g, cylMesh(0.06, 0.1, 3.1, POLE, { segments: 7 }), 0, 1.7, 0);
  // 信号灯头
  put(g, boxMesh(0.5, 1.0, 0.3, DEEP_TEAL, { roughness: 0.7 }), 0, 2.85, 0);
  put(g, boxMesh(0.58, 0.1, 0.36, C.steelDark), 0, 3.4, 0);
  const icons = pedIcons();
  const standMat = basicMat(0xffffff, { map: icons.stand, transparent: true, toneMapped: false });
  const walkMat = basicMat(0xffffff, { map: icons.walk, transparent: true, toneMapped: false });
  const stand = new THREE.Mesh(planeGeo(0.38, 0.46), standMat);
  stand.castShadow = false;
  put(g, stand, 0, 3.04, 0.16);
  const walk = new THREE.Mesh(planeGeo(0.38, 0.46), walkMat);
  walk.castShadow = false;
  put(g, walk, 0, 2.68, 0.16);
  const glow = glowSprite(0xff5a4a, 0.9, 0.55);
  put(g, glow, 0, 3.04, 0.34);
  addTicker(g, (t) => {
    const p = t % 10;
    const red = p > 5.2;
    stand.visible = red;
    walk.visible = !red;
    glow.material.color.setHex(red ? 0xff5a4a : 0x5fe08a);
    glow.position.y = red ? 3.04 : 2.68;
    glow.material.opacity = 0.45 + 0.08 * Math.sin(t * 4.0);
  });
  // 蓝底人行横道牌（前移，避免立杆穿面）
  put(g, boxMesh(0.9, 0.9, 0.08, CREAM), 0, 1.9, 0.1);
  const sign = new THREE.Mesh(planeGeo(0.8, 0.8),
    basicMat(0xffffff, { map: crosswalkTexture(), transparent: true, toneMapped: false }));
  sign.castShadow = false;
  put(g, sign, 0, 1.9, 0.15);
  return g;
}

/** 公交站：奶白+H乌篷顶棚 + 长椅 + 奶茶候车灯箱 + 站牌。 */
export function busStop(opts = {}) {
  const g = new THREE.Group();
  // 顶棚
  const roof = boxMesh(4.5, 0.16, 1.8, CREAM);
  put(g, roof, 0, 2.62, 0.05, -0.045, 0, 0);
  put(g, boxMesh(4.5, 0.18, 0.3, C.signMint), 0, 2.53, -0.75);
  // 立柱
  for (const sx of [-1.9, 1.9]) {
    put(g, cylMesh(0.07, 0.09, 2.6, POLE, { segments: 7 }), sx, 1.3, -0.62);
    put(g, cylMesh(0.06, 0.08, 2.45, POLE, { segments: 7 }), sx, 1.225, 0.52);
  }
  // 顶棚前沿薄荷饰条
  put(g, boxMesh(4.6, 0.07, 0.12, C.signMint), 0, 2.55, 0.92);
  // 背板玻璃 + 端头玻璃
  put(g, glassBox(3.95, 1.7, 0.06), 0, 1.55, -0.67);
  put(g, glassBox(0.04, 1.7, 1.05), -1.95, 1.55, -0.12);
  // 长椅
  put(g, boxMesh(2.5, 0.12, 0.48, C.woodLight), 0.2, 0.52, -0.35);
  put(g, boxMesh(2.5, 0.4, 0.1, C.woodLight), 0.2, 0.78, -0.57);
  for (const sx of [-0.85, 0.9]) {
    put(g, boxMesh(0.12, 0.44, 0.44, C.steelDark), 0.2 + sx, 0.24, -0.35);
  }
  // 候车线路图
  put(g, signPanel(1.18, 0.86, '线路图', {
    texW: 384, texH: 288, bg: 0xf6ecd8, fg: 0x2f6f8f, sub: '52 · 88 · 106',
    glow: false, radius: 10,
  }), 0.95, 1.52, -0.62);
  // 候车灯箱（奶茶广告）
  put(g, boxMesh(1.3, 2.0, 0.26, CREAM), -1.55, 1.25, 0.55);
  const ad = adPlane(1.12, 1.76, 'tea', 0.45);
  put(g, ad, -1.55, 1.25, 0.69);
  addTicker(g, (t) => {
    ad.material.emissiveIntensity = 0.45 + Math.sin(t * 2.4 + 0.8) * 0.05;
  });
  // 站牌柱（抬高到顶棚上方，缩小尺寸）
  put(g, cylMesh(0.05, 0.075, 3.45, POLE, { segments: 7 }), 2.3, 1.725, 0.2);
  put(g, boxMesh(2.3, 0.84, 0.09, CREAM), 2.3, 3.1, 0.2);
  put(g, signPanel(2.16, 0.74, '梧桐大道站', {
    texW: 1024, texH: 320, bg: C.signBlue, fg: 0xfff8e8, sub: '52 路 · 88 路 · 106 路',
    border: 0xf7f2e7, glow: false, radius: 12,
  }), 2.3, 3.1, 0.26);
  put(g, signPanel(0.4, 0.58, '公交', {
    vertical: true, texW: 128, texH: 256, bg: C.signMint, fg: 0x24372f, glow: false, radius: 10,
  }), 2.3, 1.95, 0.27);
  return g;
}

/** 花坛：奶油花池 + 彩色小花 + 爱护花草小牌。 */
export function flowerBed(opts = {}) {
  const g = new THREE.Group();
  put(g, boxMesh(2.0, 0.44, 0.84, CREAM, { roughness: 0.9 }), 0, 0.22, 0);
  put(g, boxMesh(2.12, 0.12, 0.94, C.terracotta), 0, 0.5, 0);
  put(g, boxMesh(1.9, 0.06, 0.74, 0x6b4a33), 0, 0.55, 0);
  const greens = [C.leaf1, C.leaf2, C.leaf3];
  for (let i = 0; i < 4; i++) {
    const s = icoMesh(0.2 + (i % 2) * 0.04, greens[i % 3], { detail: 0, flatShading: true });
    s.scale.set(1, 0.8, 1);
    put(g, s, -0.7 + i * 0.47, 0.67, (i % 2 === 0 ? 0.08 : -0.08));
  }
  const petals = [0xf78fb3, 0xffd45e, 0xe4735f, 0xfff1e0, 0xd97ba8, 0xffb45c];
  for (let i = 0; i < 8; i++) {
    const f = icoMesh(0.055 + (i % 2) * 0.015, petals[i % petals.length], { detail: 0, flatShading: true });
    put(g, f, -0.86 + i * 0.245, 0.8 + (i % 3) * 0.03, (i % 2 ? 0.16 : -0.14) + Math.sin(i) * 0.04);
  }
  // 小告示牌
  put(g, boxMesh(0.035, 0.42, 0.035, C.woodDark), -0.82, 0.78, 0.28);
  put(g, signPanel(0.42, 0.21, '爱护花草', {
    texW: 256, texH: 128, bg: C.signMint, fg: 0x24372f, glow: false, radius: 8,
  }), -0.82, 0.95, 0.31);
  return g;
}

/** 城市行道树（带树池铁篦），黄昏里加一点金叶。 */
export function streetTree(opts = {}) {
  const g = new THREE.Group();
  put(g, boxMesh(1.5, 0.04, 1.5, 0x6c767d), 0, 0.02, 0);
  put(g, boxMesh(1.24, 0.06, 1.24, 0x8a6248), 0, 0.055, 0);
  put(g, cylMesh(0.15, 0.24, 2.7, C.wood, { segments: 7 }), 0, 1.4, 0);
  put(g, cylMesh(0.06, 0.1, 1.2, C.woodDark, { segments: 5 }), -0.35, 2.6, 0.1, 0, 0, 0.5);
  put(g, cylMesh(0.05, 0.09, 1.0, C.woodDark, { segments: 5 }), 0.32, 2.7, -0.05, 0, 0, -0.45);
  const green = [C.leaf1, C.leaf2, C.leaf3, 0x8fbf6a];
  const blobs = [
    [-0.85, 3.55, 0.15, 1.02],
    [0.75, 3.7, -0.1, 0.95],
    [0.0, 4.25, 0.2, 1.06],
    [-0.15, 3.75, -0.55, 0.8],
  ];
  blobs.forEach((b, i) => {
    const m = icoMesh(b[3], green[i % green.length], { detail: 0, flatShading: true });
    m.scale.set(1, 0.85, 1);
    put(g, m, b[0], b[1], b[2]);
  });
  // 金色小叶（黄昏观感）
  const gold = icoMesh(0.46, 0xd9b25e, { detail: 0, flatShading: true });
  gold.scale.set(1, 0.7, 1);
  put(g, gold, 1.15, 4.15, 0.35);
  return g;
}

/** 高架指路门架（可选主路牌）。 */
export function overpassSign(opts = {}) {
  const g = new THREE.Group();
  for (const sx of [-3.25, 3.25]) {
    put(g, cylMesh(0.15, 0.2, 6.2, POLE, { segments: 8 }), sx, 3.1, 0);
    put(g, boxMesh(0.75, 0.18, 0.75, C.steelDark), sx, 0.09, 0);
  }
  put(g, cylMesh(0.1, 0.1, 6.7, POLE, { segments: 6 }), 0, 6.12, 0, 0, 0, Math.PI / 2);
  put(g, boxMesh(0.12, 0.7, 0.12, POLE), -3.05, 5.72, 0, 0, 0, 0.5);
  put(g, boxMesh(0.12, 0.7, 0.12, POLE), 3.05, 5.72, 0, 0, 0, -0.5);
  // 绿色主路牌
  put(g, boxMesh(4.1, 1.85, 0.12, CREAM), -1.35, 5.15, 0);
  put(g, signPanel(3.9, 1.65, '城市广场', {
    texW: 1024, texH: 448, bg: 0x2f7a55, fg: 0xfff8e8, sub: 'CITY PLAZA · 1.2km',
    border: 0xf7f2e7, glow: false, radius: 14,
  }), -1.35, 5.15, 0.08);
  // 蓝色附牌
  put(g, boxMesh(2.3, 1.0, 0.12, CREAM), 2.25, 4.72, 0);
  put(g, signPanel(2.12, 0.82, '中山路 ↖', {
    texW: 768, texH: 256, bg: C.signBlue, fg: 0xfff8e8, border: 0xf7f2e7, glow: false, radius: 10,
  }), 2.25, 4.72, 0.08);
  // 顶灯
  signLamp(g, 0, 6.0, 0.35, 0xffd9a0, 0.8, 0.35);
  return g;
}

/* ══════════════════════════════ 车辆 ══════════════════════════════ */

/**
 * 圆润小轿车 4.4×1.8×1.5m，opts.color 可换车色；正面朝 +Z。
 * 前灯为暖色 glowSprite，司机为简单剪影。
 */
export function car(opts = {}) {
  return buildCar(opts);
}

/** 出租车：黄+薄荷双色车身，车顶「出租」灯箱。 */
export function taxi(opts = {}) {
  return buildCar({ ...opts, taxi: true, color: opts.color ?? 0xf2d06b });
}

function buildCar(opts = {}) {
  const g = new THREE.Group();
  const taxiCab = !!opts.taxi;
  const color = opts.color ?? 0xe4735f;
  const bodyDark = darken(color, 0.72);
  const glassCol = 0x6f9fae;
  const wheelR = 0.35;
  // 主车身：胖胖的圆角盒子
  put(g, boxMesh(1.84, 0.64, 4.32, color, { radius: 0.3, roughness: 0.46, metalness: 0.1 }), 0, 0.61, 0);
  put(g, boxMesh(1.7, 0.22, 4.0, taxiCab ? C.mint : bodyDark), 0, 0.34, 0);
  // 座舱：车身色圆角盒子（车顶一体），再贴青蓝车窗
  put(g, boxMesh(1.64, 0.58, 2.08, taxiCab ? C.cream : color, {
    radius: 0.26, roughness: 0.5, metalness: 0.08,
  }), 0, 1.2, -0.14);
  const win = { roughness: 0.18, metalness: 0.3 };
  put(g, boxMesh(1.34, 0.34, 0.04, glassCol, win), 0, 1.25, 0.915);
  put(g, boxMesh(1.22, 0.3, 0.04, glassCol, win), 0, 1.25, -1.195);
  for (const side of [-1, 1]) {
    put(g, boxMesh(0.04, 0.32, 1.32, glassCol, win), side * 0.825, 1.25, -0.1);
    put(g, boxMesh(0.025, 0.035, 0.16, CREAM), side * 0.93, 0.92, 0.18);
  }
  // 车轮
  wheel(g, -0.87, wheelR, 1.34, wheelR, 0.2);
  wheel(g, 0.87, wheelR, 1.34, wheelR, 0.2);
  wheel(g, -0.87, wheelR, -1.34, wheelR, 0.2);
  wheel(g, 0.87, wheelR, -1.34, wheelR, 0.2);
  // 保险杠 / 格栅 / 车牌
  put(g, boxMesh(1.86, 0.15, 0.22, bodyDark), 0, 0.31, 2.1);
  put(g, boxMesh(1.86, 0.15, 0.22, bodyDark), 0, 0.31, -2.1);
  put(g, boxMesh(0.48, 0.13, 0.05, C.cream), 0, 0.5, 2.16);
  put(g, boxMesh(0.36, 0.12, 0.04, C.cream), 0, 0.54, -2.17);
  // 圆头灯 + 暖光晕；尾灯
  for (const sx of [-0.55, 0.55]) {
    const lens = new THREE.Mesh(circleGeo(0.12, 12), mat(0xfff0c8, {
      emissive: 0xffd9a0, emissiveIntensity: 1.2, roughness: 0.3,
    }));
    lens.castShadow = false;
    put(g, lens, sx, 0.72, 2.165);
    const hs = glowSprite(0xffe3a8, 0.6, 0.55);
    put(g, hs, sx, 0.72, 2.24);
    put(g, boxMesh(0.26, 0.12, 0.05, 0xd9534f, {
      emissive: 0xe4574c, emissiveIntensity: 0.8, roughness: 0.4,
    }), sx, 0.79, -2.16);
  }
  // 后视镜
  for (const sx of [-0.96, 0.96]) {
    put(g, boxMesh(0.16, 0.09, 0.12, color), sx, 1.1, 0.4);
  }
  // 出租车顶灯箱
  if (taxiCab) {
    put(g, boxMesh(0.74, 0.27, 0.2, C.cream), 0, 1.65, -0.16);
    put(g, signPanel(0.62, 0.21, '出租', {
      texW: 256, texH: 96, bg: 0xf6ecd8, fg: 0xd9534f, glow: true, glowIntensity: 0.35, radius: 8,
    }), 0, 1.65, -0.055);
    put(g, signPanel(0.62, 0.21, 'TAXI', {
      texW: 256, texH: 96, bg: 0xf6ecd8, fg: 0x2f6f8f, glow: false, radius: 8,
    }), 0, 1.65, -0.265, 0, Math.PI, 0);
    const gl = glowSprite(0xffe3a8, 0.45, 0.3);
    put(g, gl, 0, 1.6, 0.0);
  }
  return g;
}

/**
 * 城市公交 10×2.6×3.2m：奶油车身穿薄荷腰带，侧面暖窗，前门上方 52 路。
 */
export function bus(opts = {}) {
  const g = new THREE.Group();
  const bodyColor = opts.color ?? 0xf3ead6;
  const len = 9.8;
  const body = boxMesh(2.55, 2.5, len, bodyColor, { radius: 0.28, roughness: 0.55, metalness: 0.08 });
  put(g, body, 0, 1.62, 0);
  // 底部薄荷腰带 + 暖橙细条
  put(g, boxMesh(2.58, 0.52, len + 0.04, C.mint), 0, 0.62, 0);
  put(g, boxMesh(2.57, 0.07, len - 0.1, C.orange), 0, 0.94, 0);
  put(g, boxMesh(2.5, 0.24, len - 0.2, C.steel), 0, 0.42, 0);
  // 顶棚
  put(g, boxMesh(2.45, 0.12, len - 0.4, CREAM), 0, 2.9, 0);
  // 侧窗（贴图玻璃）
  const bandMat = windowBandMaterial();
  const bandR = new THREE.Mesh(planeGeo(8.5, 1.02), bandMat);
  put(g, bandR, 1.282, 2.08, 0, 0, Math.PI / 2, 0);
  const bandL = new THREE.Mesh(planeGeo(8.5, 1.02), bandMat);
  put(g, bandL, -1.282, 2.08, 0, 0, -Math.PI / 2, 0);
  // 前后风挡
  put(g, boxMesh(2.2, 0.96, 0.06, 0x9cc4d0, {
    transparent: true, opacity: 0.64, roughness: 0.15, metalness: 0.25,
  }), 0, 2.0, len / 2 + 0.01);
  put(g, boxMesh(2.0, 0.8, 0.06, 0x9cc4d0, {
    transparent: true, opacity: 0.64, roughness: 0.15, metalness: 0.25,
  }), 0, 2.05, -len / 2 - 0.01);
  // 司机剪影
  put(g, icoMesh(0.14, C.skin, { detail: 0 }), 0.62, 1.82, 4.05);
  put(g, boxMesh(0.4, 0.5, 0.28, 0x3f6f99), 0.62, 1.5, 3.9);
  // 路牌 + 前灯
  put(g, boxMesh(2.6, 0.62, 0.1, DEEP_TEAL), 0, 2.62, len / 2 + 0.03);
  put(g, signPanel(2.45, 0.5, '52路 城市广场', {
    texW: 1024, texH: 256, bg: 0x2f4a44, fg: 0xffd45e, glow: true, glowIntensity: 0.55, radius: 8,
  }), 0, 2.62, len / 2 + 0.09);
  for (const sx of [-0.85, 0.85]) {
    put(g, boxMesh(0.36, 0.22, 0.06, C.windowWarm, {
      emissive: 0xffe0a8, emissiveIntensity: 1.0, roughness: 0.3,
    }), sx, 0.95, len / 2 + 0.04);
    const hs = glowSprite(0xffe3a8, 0.7, 0.55);
    put(g, hs, sx, 0.93, len / 2 + 0.14);
    put(g, boxMesh(0.22, 0.28, 0.05, 0xd9534f, {
      emissive: 0xe4574c, emissiveIntensity: 0.85, roughness: 0.4,
    }), sx * 1.35, 1.05, -len / 2 - 0.02);
  }
  // 车门（浅薄荷色块 + 玻璃）
  for (const sz of [2.35, -1.55]) {
    for (const sx of [-1.283, 1.283]) {
      put(g, boxMesh(0.03, 1.55, 0.95, C.mintLight), sx, 1.25, sz);
      put(g, glassBox(0.035, 0.72, 0.7), sx * 1.005, 1.62, sz);
    }
  }
  // 车顶空调
  put(g, boxMesh(1.5, 0.26, 2.2, CREAM), 0, 3.0, -0.7);
  put(g, boxMesh(1.2, 0.14, 1.6, C.steel), 0, 3.19, -0.7);
  // 后视镜
  for (const sx of [-1.34, 1.34]) {
    put(g, boxMesh(0.2, 0.16, 0.3, C.steelDark), sx, 2.35, 4.45);
  }
  // 侧面路号
  put(g, signPanel(0.66, 0.4, '52', {
    texW: 192, texH: 128, bg: CREAM, fg: 0xd9534f, glow: false, radius: 8,
  }), 1.29, 1.25, 4.05, 0, Math.PI / 2, 0);
  // 车侧广告条（奶茶 / 城市生活），给车身加点烟火气
  for (const side of [-1, 1]) {
    put(g, signPanel(2.9, 0.38, '茶小满 · 好喝不贵', {
      texW: 1024, texH: 160, bg: 0xe2566f, fg: 0xfff4dc, glow: true, glowIntensity: 0.28, radius: 10,
    }), side * 1.292, 1.2, -1.2, 0, side * Math.PI / 2, 0);
  }
  wheel(g, -1.2, 0.42, 3.1, 0.42, 0.24);
  wheel(g, 1.2, 0.42, 3.1, 0.42, 0.24);
  wheel(g, -1.2, 0.42, -3.1, 0.42, 0.24);
  wheel(g, 1.2, 0.42, -3.1, 0.42, 0.24);
  return g;
}

/** 外卖同行：薄荷小电驴 + 黄色外卖箱（笑脸）+ 深青夹克骑手。可作障碍或路边装饰。 */
export function deliveryScooter(opts = {}) {
  const g = new THREE.Group();
  const r = 0.27;
  wheel(g, 0, r, 0.57, r, 0.13);
  wheel(g, 0, r, -0.57, r, 0.13);
  // 踏板 / 后车体 / 前围板
  put(g, boxMesh(0.34, 0.14, 1.1, C.mint), 0, 0.4, 0);
  put(g, boxMesh(0.36, 0.32, 0.42, C.mint), 0, 0.56, -0.38);
  put(g, boxMesh(0.4, 0.62, 0.16, C.mint, { roughness: 0.6 }), 0, 0.83, 0.42, -0.12, 0, 0);
  put(g, boxMesh(0.28, 0.2, 0.05, CREAM), 0, 0.88, 0.515);
  // 车把 + 握把 + 大灯
  put(g, boxMesh(0.54, 0.05, 0.05, C.steelDark), 0, 1.05, 0.53);
  for (const sx of [-0.24, 0.24]) {
    put(g, boxMesh(0.1, 0.06, 0.06, DEEP_TEAL), sx, 1.05, 0.53);
  }
  put(g, glowSprite(0xffe3a8, 0.32, 0.5), 0, 0.9, 0.6);
  put(g, icoMesh(0.055, 0xfff0c8, { detail: 0 }), 0, 0.89, 0.515).scale.set(1, 1, 0.4);
  // 座位
  put(g, boxMesh(0.32, 0.12, 0.5, CREAM), 0, 0.74, -0.28);
  // 后货架 + 黄色外卖箱（后 + 两侧笑脸）
  put(g, boxMesh(0.46, 0.05, 0.5, C.tire), 0, 0.72, -0.6);
  put(g, boxMesh(0.52, 0.5, 0.54, C.yellow, { roughness: 0.72 }), 0, 1.0, -0.78);
  put(g, boxMesh(0.54, 0.07, 0.56, C.orange), 0, 1.27, -0.78);
  const smileMat = smileyMaterial();
  const rear = new THREE.Mesh(planeGeo(0.4, 0.4), smileMat);
  rear.castShadow = false;
  put(g, rear, 0, 1.0, -1.06, 0, Math.PI, 0);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(planeGeo(0.4, 0.4), smileMat);
    m.castShadow = false;
    put(g, m, side * 0.265, 1.0, -0.78, 0, side * Math.PI / 2, 0);
  }
  // 骑手：深青夹克 + 黄色反光条 + 奶油头盔
  put(g, boxMesh(0.36, 0.46, 0.24, 0x3f6f99), 0, 1.26, -0.04, -0.08, 0, 0);
  put(g, boxMesh(0.3, 0.16, 0.22, 0x355f80), 0, 1.05, -0.1);
  put(g, boxMesh(0.38, 0.07, 0.26, C.yellow), 0, 1.22, -0.04);
  put(g, icoMesh(0.11, C.skin, { detail: 0 }), 0, 1.56, 0.03);
  put(g, icoMesh(0.135, CREAM, { detail: 0 }), 0, 1.6, 0.02);
  put(g, boxMesh(0.22, 0.05, 0.1, DEEP_TEAL), 0, 1.56, 0.13);
  // 手臂从肩部向下前伸到车把（肩 → 手把）
  for (const sx of [-0.2, 0.2]) {
    put(g, boxMesh(0.06, 0.06, 0.59, 0x3f6f99), sx, 1.215, 0.285, 0.594, 0, 0);
    put(g, boxMesh(0.06, 0.06, 0.08, C.skin), sx, 1.05, 0.52);
  }
  // 腿部收在车体后，不再露出大色块
  put(g, boxMesh(0.3, 0.2, 0.18, 0x355f80), 0, 0.86, -0.24);
  return g;
}

/* ══════════════════════════════ 障碍 ══════════════════════════════ */

/** 0.7m 锥桶（可跳），橙白反光带。 */
export function cone(opts = {}) {
  const g = new THREE.Group();
  put(g, boxMesh(0.5, 0.05, 0.5, 0xd9722f), 0, 0.025, 0);
  put(g, cylMesh(0.19, 0.25, 0.2, 0xef7b32, { segments: 8 }), 0, 0.15, 0);
  put(g, cylMesh(0.135, 0.19, 0.13, 0xfff1d6, { segments: 8 }), 0, 0.315, 0);
  put(g, coneMesh(0.14, 0.35, 0xef7b32, { segments: 8 }), 0, 0.555, 0);
  put(g, cylMesh(0.035, 0.04, 0.05, 0xf7f2e7, { segments: 6 }), 0, 0.71, 0);
  return g;
}

/** 1.2m 红白施工护栏（可跳/躲）：上横板 + 下横板 + 灯 + 施工牌。 */
export function constructionBarrier(opts = {}) {
  const g = new THREE.Group();
  const legH = 1.02;
  for (const sx of [-0.92, 0.92]) {
    put(g, boxMesh(0.09, legH, 0.09, C.steel), sx, legH / 2, 0);
    put(g, boxMesh(0.6, 0.08, 0.56, C.steelDark), sx, 0.04, 0);
  }
  // 上下红白横板
  for (const [y, h] of [[0.88, 0.28], [0.46, 0.22]]) {
    const plank = new THREE.Mesh(boxGeo(2.0, h, 0.07), stripeMaterial());
    plank.castShadow = true;
    put(g, plank, 0, y, 0.02);
  }
  // 斜撑
  put(g, boxMesh(0.06, 0.9, 0.06, C.steel), -0.92, 0.5, -0.26, 0.55, 0, 0);
  put(g, boxMesh(0.06, 0.9, 0.06, C.steel), 0.92, 0.5, -0.26, 0.55, 0, 0);
  // 顶灯
  put(g, cylMesh(0.05, 0.06, 0.12, C.steelDark, { segments: 6 }), 0.92, 1.08, 0);
  const lamp = glowSprite(0xff9d4d, 0.75, 0.72);
  put(g, lamp, 0.92, 1.18, 0);
  addTicker(g, (t) => {
    const on = Math.sin(t * 4.2) > -0.2;
    lamp.material.opacity = on ? 0.72 : 0.1;
  });
  // 施工小牌
  put(g, boxMesh(0.82, 0.28, 0.06, CREAM), -0.15, 1.08, 0);
  put(g, signPanel(0.74, 0.24, '施工中', {
    texW: 384, texH: 160, bg: C.signOrange, fg: 0x3a2a20, glow: true, glowIntensity: 0.35, radius: 8,
  }), -0.15, 1.08, 0.035);
  return g;
}

/** 锥桶+红白横杆组合，适合做单车道封路。 */
export function trafficConeBarrier(opts = {}) {
  const g = new THREE.Group();
  const c1 = cone();
  put(g, c1, -0.72, 0, 0);
  const c2 = cone();
  put(g, c2, 0.72, 0, 0);
  put(g, cylMesh(0.03, 0.03, 1.5, C.steelDark, { segments: 5 }), 0, 0.62, 0, 0, 0, Math.PI / 2);
  const bar = new THREE.Mesh(boxGeo(1.48, 0.26, 0.06), stripeMaterial());
  bar.castShadow = true;
  put(g, bar, 0, 0.62, 0);
  put(g, signPanel(0.42, 0.2, '施工', {
    texW: 192, texH: 96, bg: C.signOrange, fg: 0x3a2a20, glow: false, radius: 6,
  }), 0, 0.62, 0.05);
  return g;
}

/* ══════════════════════════════ 小鸟 ══════════════════════════════ */

/** 0.2m 城市鸽子，可飞（opts.flying=true），翅膀会扇、会点头。 */
export function pigeon(opts = {}) {
  const g = new THREE.Group();
  const flying = !!opts.flying;
  const bodyGroup = new THREE.Group();
  put(g, bodyGroup, 0, flying ? 0.12 : 0, 0);
  // 身体（椭圆，蓝灰 + 白胸）
  const body = icoMesh(0.085, 0x9fb0c2, { detail: 0, flatShading: true });
  body.scale.set(0.92, 0.8, 1.42);
  put(bodyGroup, body, 0, 0.095, 0);
  const chest = icoMesh(0.066, 0xe6e9ee, { detail: 0 });
  chest.scale.set(0.95, 0.85, 1.05);
  put(bodyGroup, chest, 0, 0.085, 0.045);
  // 头 / 喙 / 眼
  put(bodyGroup, icoMesh(0.048, 0x8a9cb0, { detail: 0 }), 0, 0.185, 0.095);
  put(bodyGroup, coneMesh(0.012, 0.04, 0xe8a04a, { segments: 5 }), 0, 0.182, 0.14, Math.PI / 2, 0, 0);
  for (const sx of [-0.022, 0.022]) {
    put(bodyGroup, icoMesh(0.0075, 0x30363d, { detail: 0 }), sx, 0.196, 0.126);
  }
  // 尾羽
  put(bodyGroup, boxMesh(0.075, 0.018, 0.11, 0x7d8fa4), 0, 0.11, -0.135, -0.3, 0, 0);
  put(bodyGroup, boxMesh(0.05, 0.014, 0.075, 0x8f9fb0), 0, 0.095, -0.2, -0.22, 0, 0);
  // 腿 / 脚
  for (const sx of [-0.024, 0.024]) {
    put(bodyGroup, cylMesh(0.008, 0.008, 0.035, 0xd98f96, { segments: 5 }), sx, 0.025, 0.025);
    put(bodyGroup, boxMesh(0.028, 0.008, 0.04, 0xd98f96), sx, 0.004, 0.04);
  }
  // 翅膀（枢轴在肩部，可折叠可扇动）
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    put(bodyGroup, pivot, side * 0.068, 0.125, 0.01);
    pivot.rotation.z = side * 0.16;
    const wing = icoMesh(0.062, 0x7d8fa4, { detail: 0 });
    wing.scale.set(0.34, 0.72, 1.35);
    put(pivot, wing, side * 0.006, -0.005, -0.035);
    const tip = icoMesh(0.036, 0x6b7d92, { detail: 0 });
    tip.scale.set(0.4, 0.6, 1.5);
    put(pivot, tip, side * 0.006, -0.008, -0.13);
    wings.push({ pivot, side });
  }
  addTicker(g, (t) => {
    if (flying) {
      const amp = 0.95 + 0.45 * Math.sin(t * 10.5);
      wings.forEach((w) => { w.pivot.rotation.z = w.side * (0.2 + amp); });
      bodyGroup.position.y = 0.12 + Math.sin(t * 2.4) * 0.025;
      bodyGroup.rotation.x = Math.sin(t * 4.8) * 0.04;
    } else {
      const amp = 0.03 * Math.sin(t * 4.2);
      wings.forEach((w) => { w.pivot.rotation.z = w.side * (0.16 + amp); });
      bodyGroup.rotation.x = 0.04 + Math.sin(t * 1.6) * 0.045;
    }
  });
  return g;
}

/* ══════════════════════════════ 城市远景 ══════════════════════════════ */

/**
 * 80m 宽 × 25m 高城市天际线：晚霞暖光带 + 远近三层低模楼群 + 电视塔剪影 + 楼顶航空灯。
 * 正面朝 +Z，中心低、两侧高，中间留给落日。
 */
export function cityBackdrop(opts = {}) {
  const g = new THREE.Group();
  // 晚霞暖光带（背景最远处）
  const hazeTex = canvasTexture(1024, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,180,120,0)');
    grad.addColorStop(0.55, 'rgba(255,186,126,0.32)');
    grad.addColorStop(0.82, 'rgba(255,202,140,0.62)');
    grad.addColorStop(1, 'rgba(255,216,160,0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 横向薄云
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#fff2d8';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(w * (0.2 + i * 0.17), h * (0.28 + (i % 2) * 0.12), w * 0.16, h * 0.035, 0, 0, TAU);
      ctx.fill();
    }
  }, { anisotropy: 4 });
  const haze = new THREE.Mesh(planeGeo(80, 13.5), new THREE.MeshBasicMaterial({
    map: hazeTex, transparent: true, opacity: 0.9, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  }));
  haze.castShadow = false;
  put(g, haze, 0, 6.75, -11.5);

  // ——— 远景：蓝紫剪影楼群 ———
  const far = [
    [-38, 4.0, 11, 4], [-33, 3.0, 15, 3], [-28, 5.0, 9, 5], [-22, 3.5, 17, 4],
    [-17, 4.0, 12, 3], [-12, 3.0, 19, 4], [-7, 4.2, 8, 5], [-2, 3.0, 6, 4],
    [3, 4.0, 7, 4], [8, 3.4, 9, 3], [13, 3.0, 16, 4], [18, 4.4, 12, 5],
    [24, 3.6, 20, 4], [29, 4.0, 10, 4], [34, 3.0, 14, 3], [39, 4.0, 9, 4],
  ];
  far.forEach(([x, w, h, d], i) => {
    const t = towerMesh(w, h, d, 'skyFar');
    put(g, t, x, h / 2, -8 + (i % 3) * 0.35);
  });
  // 远景天线
  for (const [x, h] of [[-22, 17], [-12, 19], [24, 20]]) {
    put(g, cylMesh(0.045, 0.065, 2.6, 0x7c85ad, { segments: 5 }), x, h + 1.3, -7.8);
  }

  // ——— 中景：暖色晚霞楼群 ———
  const mid = [
    [-34, 5.0, 15, 4], [-27, 4.2, 21, 5], [-20, 5.4, 13, 4], [-13, 4.0, 22, 4],
    [14, 4.4, 18, 4], [21, 5.0, 22, 5], [28, 4.2, 14, 4], [35, 4.8, 17, 5],
  ];
  mid.forEach(([x, w, h, d], i) => {
    const t = towerMesh(w, h, d, 'skyMid');
    put(g, t, x, h / 2, -4.2 + (i % 3) * 0.4);
    if (i === 3 || i === 5) {
      put(g, coneMesh(0.22, 2.4, 0xb9a6cf, { segments: 6 }), x, h + 1.2, -4);
    } else if (i === 1) {
      put(g, boxMesh(w * 0.42, 0.9, d * 0.42, 0xd0b6c4), x, h + 0.45, -4);
    }
  });
  // ——— 电视塔剪影（城市地标） ———
  const tvx = -32.5, tvz = -6.5;
  put(g, cylMesh(0.5, 0.7, 18, 0xa9a3c9, { segments: 8 }), tvx, 9, tvz);
  put(g, icoMesh(1.35, 0xc9b6d9, { detail: 0 }), tvx, 18.4, tvz);
  put(g, icoMesh(0.82, 0xc9b6d9, { detail: 0 }), tvx, 21.0, tvz);
  put(g, cylMesh(0.08, 0.12, 3.2, 0xa9a3c9, { segments: 5 }), tvx, 23.4, tvz);
  // 塔身暖窗
  for (let i = 0; i < 4; i++) {
    put(g, boxMesh(0.3, 0.5, 0.06, 0xffc46e, {
      emissive: 0xffb45c, emissiveIntensity: 0.8, roughness: 0.5,
    }), tvx, 3 + i * 3.2, tvz + 0.62);
  }

  // ——— 近景：两侧街角楼，带发光小招牌 ———
  const nearL = towerMesh(6, 9, 4, 'skyNear');
  put(g, nearL, -37, 4.5, -0.8);
  const nearR = towerMesh(6, 8, 4, 'skyNear');
  put(g, nearR, 37, 4, -0.8);
  put(g, boxMesh(3.2, 0.9, 0.16, 0x8a6b5a), -37, 9.42, 1.28);
  put(g, signPanel(3.0, 0.72, '城市影院', {
    texW: 512, texH: 160, bg: C.signBlue, fg: 0xfff4dc, glow: true, glowIntensity: 0.85, radius: 10,
  }), -37, 9.42, 1.38);
  put(g, boxMesh(3.0, 0.85, 0.16, 0x8a6b5a), 37, 8.42, 1.28);
  put(g, signPanel(2.8, 0.68, '茶小满', {
    texW: 512, texH: 160, bg: 0xe2566f, fg: 0xfff4dc, glow: true, glowIntensity: 0.85, radius: 10,
  }), 37, 8.42, 1.38);
  // 楼顶小天线
  for (const [x, h, z] of [[-37, 9.0, -0.8], [37, 8.0, -0.8]]) {
    put(g, cylMesh(0.04, 0.06, 1.7, 0x7c85ad, { segments: 5 }), x, h + 0.85, z);
  }

  // ——— 楼顶航空灯（闪烁） ———
  const beacons = [];
  for (const [x, y, z, phase] of [
    [-13, 24.7, -4.2, 0], [21, 24.7, -3.8, 1.6], [-32.5, 25.0, -6.5, 3.0], [24, 22.8, -7.6, 2.2],
  ]) {
    const s = glowSprite(0xff5a4a, 0.9, 0.7);
    put(g, s, x, y, z);
    beacons.push({ s, phase });
  }
  addTicker(g, (t) => {
    beacons.forEach((b) => {
      b.s.material.opacity = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.8 + b.phase));
    });
    haze.material.opacity = 0.82 + 0.05 * Math.sin(t * 0.6);
  });
  return g;
}

/* ══════════════════════════════ 尺寸表（米） ══════════════════════════════ */

export const META = {
  skyscraper: { w: 7.4, h: 28.2, d: 7.2 },
  billboard: { w: 6.7, h: 7.9, d: 1.3 },
  streetLamp: { w: 2.0, h: 6.2, d: 0.5 },
  trafficLight: { w: 5.4, h: 6.3, d: 0.7 },
  roadSign: { w: 3.9, h: 4.0, d: 0.4 },
  crosswalkSign: { w: 0.9, h: 3.5, d: 0.5 },
  busStop: { w: 5.8, h: 3.55, d: 1.9 },
  flowerBed: { w: 2.2, h: 1.05, d: 1.0 },
  streetTree: { w: 3.3, h: 5.0, d: 2.6 },
  overpassSign: { w: 7.25, h: 6.5, d: 0.8 },
  car: { w: 1.9, h: 1.55, d: 4.5 },
  taxi: { w: 1.9, h: 1.8, d: 4.5 },
  bus: { w: 2.7, h: 3.25, d: 10.0 },
  deliveryScooter: { w: 0.6, h: 1.75, d: 1.95 },
  cone: { w: 0.55, h: 0.74, d: 0.55 },
  constructionBarrier: { w: 2.5, h: 1.25, d: 0.6 },
  trafficConeBarrier: { w: 1.9, h: 0.75, d: 0.6 },
  pigeon: { w: 0.2, h: 0.23, d: 0.42 },
  cityBackdrop: { w: 80, h: 25, d: 13 },
};
