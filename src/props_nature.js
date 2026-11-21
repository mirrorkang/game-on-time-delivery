// props_nature.js — 山区 + 乡镇自然/建筑道具（prop-nature 独占文件）
// 契约：每个导出函数返回 THREE.Group，原点=底面中心，单位米，默认朝向 +Z。
// 只写本文件；不改 artkit.js。所有随机数使用工厂内部独立种子，不污染 artkit 的全局 rand，
// 同一 seed 多次调用结果一致，方便 world 做实例化/预生成。
// 微动画放在 group.userData.tick = (t, dt) => {}，只动内层 group，不碰外层摆放变换。
// 预览：http://127.0.0.1:8788/tools/prop-lab.html?module=nature

import * as THREE from 'three';
import {
  C, rng, mat, put, boxMesh, cylMesh, coneMesh, icoMesh, sphereMesh, gableRoof,
  planeMesh, canvasTexture, signBoard, glowSprite, cylGeo, circleGeo,
} from './artkit.js';

const PI = Math.PI;
const TAU = PI * 2;
const HALF_PI = PI / 2;

/* ------------------------------- 本地柔和色板 ------------------------------ */
// 偏暖的南方山野：绿里带黄、灰里带暖，避免纯黑/纯白/高饱和。
const N = {
  // 竹
  bamboo: 0xa9bd7d, bambooDark: 0x83995a, bambooLeaf: 0x83a957,
  bambooLeafLt: 0xa9c879, bambooLeafDk: 0x678d47,
  // 树
  pine: 0x55805c, pineLt: 0x709a70, pineDk: 0x416a4c,
  leaf: 0x7aa354, leafLt: 0x9cc06c, leafWarm: 0x8eae5f, leafDk: 0x5a8443,
  trunk: 0x8a6348, trunkDk: 0x6b4a35, trunkLt: 0xa9825f,
  // 建筑
  plaster: 0xf4ead6, plasterShade: 0xe7d9bf,
  tile: 0x646b6b, tileDk: 0x484f50, tileWarm: 0x74746a,
  wood: 0x9a6b4a, woodDk: 0x6f4a33, woodLt: 0xc08f63, woodPale: 0xd8b98e,
  stone: 0x9c9484, stoneLt: 0xb9af9a, stoneDk: 0x7a7364,
  // 土 / 草 / 水
  soil: 0x9a7b57, soilLt: 0xbea179, soilDk: 0x7a5d41,
  grass: 0x84a456, grassLt: 0xaec97b, grassDk: 0x638647,
  water: 0xcbe0d9, waterLt: 0xe6f1e7, mud: 0x7b6a52,
  // 干草 / 作物
  straw: 0xd9ac5f, strawLt: 0xeacb85, strawDk: 0xa87c42,
  // 点缀
  lantern: 0xd9534f, chili: 0xc4453a, corn: 0xe8c15c,
  cloth: 0x9fb8be, clothDk: 0x7b959c,
  dogFur: 0xd6a86c, dogFurDk: 0xb9894f, dogCream: 0xf3e6cc,
  goat: 0xe9e1cd, goatGray: 0xbdb49f,
  cloud: 0xf8f4e9, cloudWarm: 0xf6e6d2,
  ridgeFar: 0xb8c9d4, ridgeMid: 0xa7bbbe, ridgeNear: 0x92a89b,
  butterflyA: 0xf3c785, butterflyB: 0xe79a70, butterflyDk: 0xb9714f,
};

/* -------------------------------- 基础小工具 ------------------------------- */
const localCache = new Map();
const texCache = {};

// 本地 gableRoof 修正：artkit.gableRoof 的三角形绕序朝内（从外面看会被背面剔除）。
// 这里逐面翻转 index 并重算法线，得到朝外的实心三棱柱（用于山墙填充）。
function fixedGable(width, depth, height, color, overhang = 0) {
  const m = gableRoof(width, depth, height, color, overhang);
  const idx = m.geometry.getIndex();
  if (idx) {
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
    m.geometry.computeVertexNormals();
  }
  return m;
}

// 双坡屋顶：只建两片屋面（没有端盖），两端由山墙填住；双面渲染保证檐下不漏空。
function pitchedRoof(span, ridgeLen, rise, color, opts = {}) {
  const hw = ridgeLen / 2, hd = span / 2;
  const pos = new Float32Array([
    -hw, 0, hd, hw, 0, hd, hw, 0, -hd, -hw, 0, -hd, -hw, rise, 0, hw, rise, 0,
  ]);
  const idx = [0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(color, {
    flatShading: true, side: THREE.DoubleSide, roughness: opts.roughness ?? 0.86,
  }));
  m.castShadow = true;
  return m;
}

// 两点之间的圆木/藤条
function strut(parent, ax, ay, az, bx, by, bz, radius, color, segs = 5) {
  const a = new THREE.Vector3(ax, ay, az);
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 1e-4) return null;
  const m = cylMesh(radius * 0.72, radius, len, color, { segments: segs });
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

// 带中脊的叶片（单位尺寸：底在原点，叶尖 +Y），用 scale 调大小。
function leafGeometry() {
  let g = localCache.get('leaf');
  if (g) return g;
  const pos = new Float32Array([
    0, 0, 0,
    0, 1, 0.04,
    -0.5, 0.36, 0,
    0.5, 0.36, 0,
    0, 0.4, -0.06,
  ]);
  const idx = [
    0, 3, 4, 0, 4, 2, 2, 4, 1, 4, 3, 1,
  ];
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  localCache.set('leaf', g);
  return g;
}

function leafCard(parent, x, y, z, w, h, color, tilt = 0.9, turn = 0, opts = {}) {
  const m = new THREE.Mesh(leafGeometry(), mat(color, {
    side: THREE.DoubleSide, flatShading: true, roughness: 0.92,
  }));
  m.position.set(x, y, z);
  m.scale.set(w, h, w);
  m.rotation.order = 'YXZ';
  m.rotation.set(tilt, turn, opts.roll || 0);
  m.castShadow = false;
  parent.add(m);
  return m;
}

function grassTuft(parent, x, y, z, color, scale = 1, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const a = r() * TAU;
    leafCard(parent, x, y, z, 0.16 * scale, (0.26 + r() * 0.2) * scale, color,
      0.55 + r() * 0.5, a, { roll: (r() - 0.5) * 0.5 });
  }
}

function icoRock(parent, x, y, z, r, color, sx = 1, sy = 1, sz = 1, rot = null) {
  const m = icoMesh(r, color, { detail: 0, flatShading: true });
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function blobPath(ctx, cx, cy, rx, ry, pts, rnd, wobble = 0.3) {
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * TAU;
    const k = 1 + (rnd() - 0.5) * wobble;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ---------------------------------- 贴图 ---------------------------------- */
function bambooStalkTexture() {
  if (texCache.bamboo) return texCache.bamboo;
  texCache.bamboo = canvasTexture(64, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#93a76b');
    g.addColorStop(0.3, '#b2c684');
    g.addColorStop(0.68, '#a0b374');
    g.addColorStop(1, '#839a5d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 竹节：暗线 + 下方高光
    const nodes = 10;
    for (let i = 0; i <= nodes; i++) {
      const y = (i / nodes) * h + (i % 3) * 2;
      ctx.fillStyle = 'rgba(88,106,60,0.7)';
      ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = 'rgba(214,226,176,0.5)';
      ctx.fillRect(0, y + 3, w, 2);
      ctx.fillStyle = 'rgba(78,96,54,0.22)';
      ctx.fillRect(0, y - 4, w, 2);
    }
    const r = rng(77);
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = `rgba(${(58 + r() * 40) | 0},${(76 + r() * 40) | 0},${(42 + r() * 30) | 0},0.16)`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 3);
    }
  }, { anisotropy: 4 });
  return texCache.bamboo;
}

function bambooMaterial(tint = 0xffffff) {
  const key = 'bambooMat' + tint;
  if (localCache.has(key)) return localCache.get(key);
  const m = mat(tint, { map: bambooStalkTexture(), roughness: 0.78 });
  localCache.set(key, m);
  return m;
}

// 竹叶簇：一张透明贴图里画十几片细长竹叶，插在竹秆节点上，比逐片建模省面数也更蓬松。
function bambooSprayTexture() {
  if (texCache.spray) return texCache.spray;
  texCache.spray = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const r = rng(909);
    const ox = w * 0.5, oy = h * 0.9;
    const cols = ['#6f9549', '#87ab5a', '#9cbd6b', '#5f8642', '#7da050'];
    // 细枝
    ctx.strokeStyle = 'rgba(100,122,70,0.92)';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 11; i++) {
      const a = -1.4 + (i / 10) * 2.8 + (r() - 0.5) * 0.14;
      const len = 46 + r() * 58;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.sin(a) * len, oy - Math.cos(a) * len);
      ctx.stroke();
    }
    // 叶片（加粗，远看能成团）
    for (let i = 0; i < 34; i++) {
      const baseA = -1.5 + r() * 3.0;
      const rad = 34 + r() * 104;
      const bx = ox + Math.sin(baseA) * rad;
      const by = oy - Math.cos(baseA) * rad;
      const lean = baseA + (r() - 0.5) * 1.05;
      const len = 30 + r() * 48;
      const wid = 6 + r() * 5;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(lean);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(wid, -len * 0.42, 0, -len);
      ctx.quadraticCurveTo(-wid, -len * 0.42, 0, 0);
      ctx.fillStyle = cols[(r() * cols.length) | 0];
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#4f6f3c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -len * 0.93);
      ctx.stroke();
      ctx.restore();
    }
  }, { anisotropy: 8 });
  return texCache.spray;
}

function bambooSprayMaterial() {
  if (localCache.has('sprayMat')) return localCache.get('sprayMat');
  const m = new THREE.MeshStandardMaterial({
    map: bambooSprayTexture(), transparent: true, alphaTest: 0.2,
    side: THREE.DoubleSide, roughness: 0.92, depthWrite: true,
  });
  localCache.set('sprayMat', m);
  return m;
}

function paddyTexture() {
  if (texCache.paddy) return texCache.paddy;
  texCache.paddy = canvasTexture(512, 512, (ctx, w, h) => {
    // 浅水底：偏青的田水
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#7fae9f');
    g.addColorStop(0.45, '#9cc6b9');
    g.addColorStop(1, '#74a396');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rng(515);
    // 大块天光/云影
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 3 === 0
        ? `rgba(226,240,235,${0.06 + r() * 0.1})`
        : `rgba(62,94,82,${0.05 + r() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 40 + r() * 130, 12 + r() * 40, (r() - 0.5) * 0.6, 0, TAU);
      ctx.fill();
    }
    // 天空反光条
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `rgba(240,249,245,${0.14 + r() * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 50 + r() * 140, 4 + r() * 12, (r() - 0.5) * 0.5, 0, TAU);
      ctx.fill();
    }
    // 秧苗行：每行一簇簇细叶（加粗，远看是一道道绿）
    const rows = 8;
    for (let row = 0; row < rows; row++) {
      const y = 28 + (row * (h - 52)) / (rows - 1) + (r() - 0.5) * 10;
      for (let x = 6 + r() * 8; x < w; x += 17 + r() * 7) {
        const hh = 11 + r() * 10;
        // 根的暗影
        ctx.fillStyle = 'rgba(48,82,58,0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + 2, 9 + r() * 4, 4, 0, 0, TAU);
        ctx.fill();
        for (let k = -1; k <= 1; k++) {
          ctx.strokeStyle = `rgba(${(44 + r() * 18) | 0},${(92 + r() * 30) | 0},${(38 + r() * 18) | 0},1)`;
          ctx.lineWidth = 3.2 + r() * 1.6;
          ctx.beginPath();
          ctx.moveTo(x + k * 3, y + 4);
          ctx.quadraticCurveTo(x + k * 8, y - hh * 0.5, x + k * 9, y - hh);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(158,196,104,0.5)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y + 3);
        ctx.lineTo(x + 1.5, y - hh * 0.8);
        ctx.stroke();
      }
      // 行底阴影
      ctx.fillStyle = 'rgba(48,80,64,0.14)';
      ctx.fillRect(0, y + 6, w, 7);
    }
    // 深色水纹
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(48,80,68,${0.05 + r() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 20 + r() * 60, 2 + r() * 6, 0, 0, TAU);
      ctx.fill();
    }
    // 田埂湿泥边
    ctx.strokeStyle = 'rgba(96,82,58,0.5)';
    ctx.lineWidth = 22;
    ctx.strokeRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(220,238,228,0.2)';
    ctx.lineWidth = 8;
    ctx.strokeRect(13, 13, w - 26, h - 26);
  }, { anisotropy: 8 });
  return texCache.paddy;
}

function paddyMaterial() {
  if (localCache.has('paddyMat')) return localCache.get('paddyMat');
  const m = new THREE.MeshStandardMaterial({ map: paddyTexture(), roughness: 0.32, metalness: 0 });
  localCache.set('paddyMat', m);
  return m;
}

function fogBandTexture() {
  if (texCache.fogBand) return texCache.fogBand;
  texCache.fogBand = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const g2 = ctx.createLinearGradient(0, 0, w, 0);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.16, 'rgba(255,255,255,1)');
    g2.addColorStop(0.84, 'rgba(255,255,255,1)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }, { anisotropy: 4 });
  return texCache.fogBand;
}

function fogBandMaterial(color = 0xdbe7e8, opacity = 0.7) {
  const key = `fogBand${color}${opacity}`;
  if (localCache.has(key)) return localCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    map: fogBandTexture(), color, transparent: true, opacity,
    depthWrite: false, roughness: 1, side: THREE.DoubleSide,
  });
  localCache.set(key, m);
  return m;
}

function potholeTexture() {
  if (texCache.pothole) return texCache.pothole;
  texCache.pothole = canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(913);
    ctx.clearRect(0, 0, w, h);
    // 沥青破损边
    blobPath(ctx, w / 2, h / 2, 104, 92, 12, r, 0.22);
    ctx.fillStyle = 'rgba(74,68,58,0.55)';
    ctx.fill();
    // 坑体
    blobPath(ctx, w / 2, h / 2 - 2, 84, 72, 12, r, 0.2);
    const g = ctx.createRadialGradient(w / 2, h / 2 - 6, 6, w / 2, h / 2, 92);
    g.addColorStop(0, '#262420');
    g.addColorStop(0.55, '#3a352d');
    g.addColorStop(0.88, '#574e40');
    g.addColorStop(1, '#6d6151');
    ctx.fillStyle = g;
    ctx.fill();
    // 边缘碎石子
    for (let i = 0; i < 46; i++) {
      const a = r() * TAU;
      const rad = 82 + r() * 26;
      ctx.fillStyle = `rgba(${(118 + r() * 40) | 0},${(110 + r() * 36) | 0},${(94 + r() * 30) | 0},${0.35 + r() * 0.4})`;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * rad, h / 2 + Math.sin(a) * rad, 1.5 + r() * 3.5, 0, TAU);
      ctx.fill();
    }
    // 裂缝
    ctx.strokeStyle = 'rgba(40,37,32,0.55)';
    for (let i = 0; i < 5; i++) {
      let x = w / 2 + (r() - 0.5) * 150;
      let y = h / 2 + (r() - 0.5) * 130;
      ctx.lineWidth = 1 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (r() - 0.5) * 46;
        y += (r() - 0.5) * 46;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { anisotropy: 4 });
  return texCache.pothole;
}

function mudTexture() {
  if (texCache.mud) return texCache.mud;
  texCache.mud = canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(731);
    ctx.clearRect(0, 0, w, h);
    // 深色湿边
    blobPath(ctx, w / 2, h / 2, 118, 92, 14, r, 0.22);
    ctx.fillStyle = 'rgba(72,64,48,0.55)';
    ctx.fill();
    blobPath(ctx, w / 2, h / 2, 108, 84, 14, r, 0.22);
    const g = ctx.createRadialGradient(w * 0.44, h * 0.4, 8, w / 2, h / 2, 114);
    g.addColorStop(0, '#949180');
    g.addColorStop(0.46, '#7f7b65');
    g.addColorStop(0.84, '#68634f');
    g.addColorStop(1, 'rgba(84,78,60,0.2)');
    ctx.fillStyle = g;
    ctx.fill();
    // 泥水反光（天光更亮更蓝，才像水洼）
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = `rgba(206,228,230,${0.2 + r() * 0.26})`;
      ctx.beginPath();
      ctx.ellipse(w * 0.18 + r() * w * 0.64, h * 0.18 + r() * h * 0.6,
        16 + r() * 48, 5 + r() * 14, (r() - 0.5) * 0.6, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(244,249,245,${0.22 + r() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(w * 0.24 + r() * w * 0.5, h * 0.28 + r() * h * 0.4,
        8 + r() * 26, 2 + r() * 6, 0, 0, TAU);
      ctx.fill();
    }
    // 深色湿泥斑
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(66,60,44,${0.1 + r() * 0.18})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 8 + r() * 26, 4 + r() * 12, r() * 3, 0, TAU);
      ctx.fill();
    }
    // 边沿草叶影子
    ctx.strokeStyle = 'rgba(90,110,62,0.4)';
    ctx.lineWidth = 6;
    blobPath(ctx, w / 2, h / 2, 112, 88, 14, r, 0.26);
    ctx.stroke();
  }, { anisotropy: 4 });
  return texCache.mud;
}

function cascadeTexture() {
  if (texCache.cascade) return texCache.cascade;
  texCache.cascade = canvasTexture(64, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const r = rng(444);
    // 中间亮、两侧透明的水帘
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(226,242,240,0)');
    g.addColorStop(0.24, 'rgba(226,242,240,0.55)');
    g.addColorStop(0.5, 'rgba(248,252,248,0.94)');
    g.addColorStop(0.76, 'rgba(226,242,240,0.55)');
    g.addColorStop(1, 'rgba(226,242,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 竖向水纹
    for (let i = 0; i < 26; i++) {
      const x = r() * w;
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + r() * 0.22})`;
      ctx.lineWidth = 0.6 + r() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, r() * h * 0.3);
      ctx.lineTo(x + (r() - 0.5) * 5, h);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(200,224,226,${0.08 + r() * 0.16})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 10 + r() * 40);
    }
  }, { wrap: true, anisotropy: 4 });
  return texCache.cascade;
}

function tileEndTexture() {
  if (texCache.tileEnd) return texCache.tileEnd;
  texCache.tileEnd = canvasTexture(256, 32, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (w / n);
      ctx.fillStyle = '#4e5455';
      ctx.beginPath();
      ctx.arc(x, h * 0.5, h * 0.3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(196,202,196,0.35)';
      ctx.beginPath();
      ctx.arc(x - 1.5, h * 0.42, h * 0.14, 0, TAU);
      ctx.fill();
    }
  }, { anisotropy: 4 });
  return texCache.tileEnd;
}

function tileEndMaterial() {
  if (localCache.has('tileEndMat')) return localCache.get('tileEndMat');
  const m = new THREE.MeshStandardMaterial({
    map: tileEndTexture(), transparent: true, roughness: 0.85, side: THREE.DoubleSide,
  });
  localCache.set('tileEndMat', m);
  return m;
}

function windowTexture() {
  if (texCache.window) return texCache.window;
  texCache.window = canvasTexture(128, 128, (ctx, w, h) => {
    // 暖色纸窗 + 深木窗棂
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffe7b4');
    g.addColorStop(0.55, '#ffd08a');
    g.addColorStop(1, '#e8a86e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,248,226,0.55)';
    ctx.fillRect(w * 0.18, h * 0.14, w * 0.64, h * 0.26);
    ctx.fillStyle = '#4a3222';
    ctx.fillRect(0, 0, w, 9);
    ctx.fillRect(0, h - 9, w, 9);
    ctx.fillRect(0, 0, 9, h);
    ctx.fillRect(w - 9, 0, 9, h);
    ctx.fillRect(w / 2 - 3.5, 9, 7, h - 18);
    ctx.fillRect(9, h / 2 - 3.5, w - 18, 7);
    ctx.fillRect(9, h * 0.27, w - 18, 5);
    ctx.fillRect(9, h * 0.73, w - 18, 5);
  }, { anisotropy: 4 });
  return texCache.window;
}

function windowMaterial() {
  if (localCache.has('windowMat')) return localCache.get('windowMat');
  const tex = windowTexture();
  const m = new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffc987, emissiveMap: tex, emissiveIntensity: 0.5,
    roughness: 0.8, side: THREE.FrontSide,
  });
  localCache.set('windowMat', m);
  return m;
}

function doorTexture() {
  if (texCache.door) return texCache.door;
  texCache.door = canvasTexture(96, 160, (ctx, w, h) => {
    ctx.fillStyle = '#523725';
    ctx.fillRect(0, 0, w, h);
    // 木板竖纹
    for (let i = 0; i < 4; i++) {
      const x = 5 + i * (w - 10) / 4;
      ctx.fillStyle = i % 2 ? '#66452e' : '#5b3c28';
      ctx.fillRect(x + 1, 7, (w - 10) / 4 - 2, h - 14);
      ctx.fillStyle = 'rgba(36,24,16,0.35)';
      ctx.fillRect(x + 1, 7, 1.5, h - 14);
    }
    ctx.strokeStyle = '#3b2719';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    // 门环
    ctx.strokeStyle = '#d0a75e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w * 0.76, h * 0.52, 6, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,168,100,0.85)';
    ctx.beginPath();
    ctx.arc(w * 0.76, h * 0.48, 2.4, 0, TAU);
    ctx.fill();
  }, { anisotropy: 4 });
  return texCache.door;
}

function doorMaterial() {
  if (localCache.has('doorMat')) return localCache.get('doorMat');
  const m = new THREE.MeshStandardMaterial({ map: doorTexture(), roughness: 0.88 });
  localCache.set('doorMat', m);
  return m;
}

function warningTexture() {
  if (texCache.warning) return texCache.warning;
  texCache.warning = canvasTexture(96, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e8c15c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a3630';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    // 闪电
    ctx.fillStyle = '#3a3630';
    ctx.beginPath();
    ctx.moveTo(w * 0.58, h * 0.14);
    ctx.lineTo(w * 0.32, h * 0.56);
    ctx.lineTo(w * 0.5, h * 0.56);
    ctx.lineTo(w * 0.4, h * 0.88);
    ctx.lineTo(w * 0.7, h * 0.44);
    ctx.lineTo(w * 0.52, h * 0.44);
    ctx.closePath();
    ctx.fill();
  }, { anisotropy: 4 });
  return texCache.warning;
}

function warningMaterial() {
  if (localCache.has('warningMat')) return localCache.get('warningMat');
  const m = new THREE.MeshStandardMaterial({
    map: warningTexture(), transparent: true, roughness: 0.8, side: THREE.DoubleSide,
  });
  localCache.set('warningMat', m);
  return m;
}

function decalMaterial(kind) {
  const key = 'decal' + kind;
  if (localCache.has(key)) return localCache.get(key);
  const tex = kind === 'pothole' ? potholeTexture() : mudTexture();
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: kind === 'pothole' ? 0.95 : 0.24,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  localCache.set(key, m);
  return m;
}

/* ================================ 竹 丛 ================================== */
export function bambooCluster(opts = {}) {
  const r = rng(opts.seed ?? 1101);
  const g = new THREE.Group();
  const sway = new THREE.Group();
  g.add(sway);
  const phase = r() * TAU;

  // 根部土丘、竹叶枯草
  icoRock(sway, 0, 0.03, 0, 0.52, N.grassDk, 1.45, 0.3, 1.25);
  icoRock(sway, 0.38, 0.02, 0.3, 0.24, N.soilDk, 1.15, 0.45, 1.0);
  grassTuft(sway, -0.52, 0.02, 0.46, N.grass, 0.9, 7);
  grassTuft(sway, 0.52, 0.02, -0.5, N.grassDk, 0.8, 8);

  const culms = opts.culms ?? 5;
  const leafCols = [N.bambooLeaf, N.bambooLeafLt, N.bambooLeafDk];
  for (let i = 0; i < culms; i++) {
    const h = 4.9 + r() * 1.8;
    const rad = 0.062 + r() * 0.034;
    const x = (r() - 0.5) * 1.55;
    const z = (r() - 0.5) * 1.2;
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    // 向外倾斜成一丛
    c.rotation.set((r() - 0.5) * 0.14, r() * TAU,
      (x >= 0 ? 1 : -1) * (0.02 + r() * 0.075));
    sway.add(c);

    const stalk = new THREE.Mesh(cylGeo(rad * 0.42, rad, h, 5),
      bambooMaterial(i % 3 === 0 ? 0xd8e3b8 : 0xffffff));
    stalk.position.y = h / 2;
    stalk.castShadow = true;
    c.add(stalk);

    // 六张竹叶簇（透明贴图卡）从半高处铺到梢头，远看更蓬松
    for (let j = 0; j < 6; j++) {
      const ty = 0.44 + j * 0.095 + r() * 0.03;
      const size = 1.2 + r() * 0.4 + j * 0.04;
      const card = planeMesh(size, size, bambooSprayMaterial());
      card.position.set((r() - 0.5) * 0.18, h * ty + size * 0.4, (r() - 0.5) * 0.18);
      card.rotation.set((r() - 0.5) * 0.15, r() * TAU, (r() - 0.5) * 0.15);
      card.castShadow = false;
      c.add(card);
    }
    // 两片实体叶卡，补一点侧向体积
    for (let j = 0; j < 2; j++) {
      const turn = r() * TAU;
      leafCard(c, 0, h * (0.7 + j * 0.16), 0, 0.26, 0.7 + r() * 0.25,
        leafCols[(i + j) % 3], 1.05 + r() * 0.4, turn);
    }
    // 半数竹秆抽出一根侧枝，撑开轮廓，减少“光杆”感
    if (i % 2 === 0) {
      const side = i === 0 ? 1 : -1;
      strut(c, 0, h * 0.34, 0, side * 0.8, h * 0.5, 0.28, 0.022, N.bambooDark, 4);
      const bc = planeMesh(1.15, 1.15, bambooSprayMaterial());
      bc.position.set(side * 0.8, h * 0.5 + 0.5, 0.28);
      bc.rotation.set(0, r() * TAU, 0);
      bc.castShadow = false;
      c.add(bc);
    }
  }

  // 竹笋
  const shoot = coneMesh(0.1, 0.6, N.bambooDark, { segments: 5 });
  put(sway, shoot, 0.6, 0.3, -0.46);
  leafCard(sway, 0.6, 0.56, -0.46, 0.16, 0.4, N.bambooLeafDk, 0.65, 1.3);

  g.userData.tick = (t) => {
    sway.rotation.z = Math.sin(t * 0.9 + phase) * 0.009;
    sway.rotation.x = Math.cos(t * 0.72 + phase) * 0.005;
  };
  return g;
}

/* ================================ 松 树 ================================== */
export function pineTree(opts = {}) {
  const r = rng(opts.seed ?? 2207);
  const g = new THREE.Group();
  const H = 5.8 + r() * 1.3;
  const trunkH = H * 0.68;
  put(g, cylMesh(0.1, 0.2, trunkH, N.trunkDk, { segments: 5 }), 0, trunkH / 2, 0, 0, 0, 0.025);
  // 露出的侧枝
  strut(g, 0.05, trunkH * 0.52, 0, 0.7, trunkH * 0.64, 0.2, 0.05, N.trunkDk, 4);
  strut(g, -0.04, trunkH * 0.4, 0.02, -0.6, trunkH * 0.48, 0.32, 0.045, N.trunkDk, 4);

  // 4 层横向树冠，越上越小、越亮
  const tierSpec = [
    { y: 0.46, rad: 1.5, h: 1.65, col: N.pineDk },
    { y: 0.61, rad: 1.28, h: 1.4, col: N.pine },
    { y: 0.75, rad: 1.02, h: 1.15, col: N.pine },
    { y: 0.88, rad: 0.72, h: 0.95, col: N.pineLt },
  ];
  for (const t of tierSpec) {
    const cone = coneMesh(t.rad, t.h, t.col, { segments: 7 });
    put(g, cone, (r() - 0.5) * 0.18, H * t.y, (r() - 0.5) * 0.18, 0, r() * TAU, 0);
    cone.scale.set(1 + (r() - 0.5) * 0.2, 1, 1 + (r() - 0.5) * 0.2);
  }
  // 侧向团块，打断圆锥的呆板轮廓（低段球体平滑着色，圆润不扎眼）
  const clumps = [
    [1.0, 0.52, 0.3, 0.42, N.pine],
    [-0.95, 0.64, -0.2, 0.38, N.pine],
    [0.82, 0.76, -0.25, 0.34, N.pineLt],
    [-0.62, 0.87, 0.2, 0.27, N.pineLt],
  ];
  for (const [x, ty, z, rad, col] of clumps) {
    const m = sphereMesh(rad, col, { segments: 6, roughness: 1 });
    m.position.set(x, H * ty, z);
    m.scale.set(1.5, 0.55, 1.15);
    m.rotation.set(0, r() * TAU, 0);
    g.add(m);
  }
  grassTuft(g, 0.2, 0.02, 0.32, N.grassDk, 0.9, 19);
  return g;
}

/* ================================ 阔叶树 ================================= */
export function broadleafTree(opts = {}) {
  const r = rng(opts.seed ?? 3313);
  const g = new THREE.Group();
  const H = 5.2 + r() * 1.5;
  const trunkH = H * 0.44;
  const trunk = cylMesh(0.17, 0.28, trunkH, N.trunk, { segments: 5 });
  put(g, trunk, 0, trunkH / 2, 0, 0, 0, (r() - 0.5) * 0.06);
  // 主枝（伸进树冠里）
  strut(g, 0, trunkH * 0.8, 0, 0.8, H * 0.64, 0.35, 0.1, N.trunk, 4);
  strut(g, 0, trunkH * 0.86, 0, -0.72, H * 0.68, -0.28, 0.09, N.trunk, 4);

  // 树冠：5 团平滑低面数球咬合成圆润大冠（柔和、不显多边形碎面）
  const crowns = [
    [0, 0.85, 0, 1.42, N.leaf],
    [-0.86, 0.77, 0.24, 1.2, N.leafDk],
    [0.88, 0.78, 0.12, 1.22, N.leafWarm],
    [0.16, 0.94, -0.42, 1.06, N.leafLt],
    [-0.3, 0.71, 0.8, 1.0, N.leaf],
  ];
  for (const [x, ty, z, rad, col] of crowns) {
    const m = sphereMesh(rad, col, { segments: 6, roughness: 1 });
    m.position.set(x, H * ty, z);
    m.scale.set(1.04, 0.82 + r() * 0.12, 1.0);
    m.rotation.set(0, r() * TAU, 0);
    g.add(m);
  }
  // 一块硬边叶团，给平滑树冠加点低模质感
  icoRock(g, 0.92, H * 0.68, 0.62, 0.36, N.leafDk, 1.2, 0.7, 0.9);
  // 边缘叶卡，破一下球形轮廓
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + r();
    leafCard(g, Math.cos(a) * 1.35, H * (0.7 + r() * 0.18), Math.sin(a) * 1.3,
      0.45, 0.6, [N.leaf, N.leafLt, N.leafDk][i % 3], 0.35 + r() * 0.45, a);
  }
  grassTuft(g, 0.28, 0.02, 0.34, N.grassDk, 1.0, 23);
  return g;
}

/* ============================== 山间木屋 ================================= */
export function mountainHouse(opts = {}) {
  const r = rng(opts.seed ?? 4409);
  const g = new THREE.Group();
  const W = 4.3;      // 面宽 X
  const D = 3.4;      // 进深 Z
  const baseH = 0.34;
  const wallH = 2.3;
  const bandH = 0.52;
  const eaveY = baseH + wallH + bandH;   // 3.16
  const rise = 1.55;
  const span = 4.4;                      // 屋顶跨度 Z（前后各挑 0.5）
  const ridge = 4.7;                     // 屋脊长度 X

  // 石砌台基 + 门前台阶
  put(g, boxMesh(W + 0.4, baseH, D + 0.4, N.stone), 0, baseH / 2, 0);
  put(g, boxMesh(W + 0.3, 0.1, 1.0, N.stoneDk), 0, 0.05, D / 2 + 0.55);
  put(g, boxMesh(1.5, 0.14, 0.55, N.stoneLt), 0, 0.14, D / 2 + 0.75);

  // 白墙 + 木构腰檐
  put(g, boxMesh(W, wallH, D, N.plaster), 0, baseH + wallH / 2, 0);
  put(g, boxMesh(W + 0.08, bandH, D + 0.08, N.wood),
    0, baseH + wallH + bandH / 2, 0);
  // 木柱与横梁
  put(g, boxMesh(0.17, wallH, 0.17, N.woodDk), -W / 2 + 0.1, baseH + wallH / 2, D / 2 + 0.02);
  put(g, boxMesh(0.17, wallH, 0.17, N.woodDk), W / 2 - 0.1, baseH + wallH / 2, D / 2 + 0.02);
  put(g, boxMesh(W + 0.1, 0.14, 0.12, N.woodDk), 0, baseH + wallH - 0.05, D / 2 + 0.04);

  // 前廊：地台、两根廊柱、栏杆
  put(g, boxMesh(W - 0.2, 0.15, 0.72, N.woodLt), 0, baseH + 0.07, D / 2 + 0.36);
  put(g, boxMesh(0.14, 2.62, 0.14, N.wood), -1.78, baseH + 1.38, D / 2 + 0.56);
  put(g, boxMesh(0.14, 2.62, 0.14, N.wood), 1.78, baseH + 1.38, D / 2 + 0.56);
  put(g, boxMesh(3.3, 0.09, 0.1, N.woodLt), 0, baseH + 0.68, D / 2 + 0.6);

  // 门（贴图）与两扇暖光窗
  const door = planeMesh(0.95, 1.66, doorMaterial());
  put(g, door, 0, baseH + 0.83, D / 2 + 0.015);
  door.castShadow = false;
  for (const x of [-1.35, 1.35]) {
    const win = planeMesh(0.84, 0.78, windowMaterial());
    put(g, win, x, baseH + 1.62, D / 2 + 0.015);
    win.castShadow = false;
  }
  // 背面也开一扇小窗，避免从后侧看是死墙
  const backWin = planeMesh(0.7, 0.64, windowMaterial());
  put(g, backWin, 0.9, baseH + 1.62, -D / 2 - 0.015, 0, PI, 0);
  backWin.castShadow = false;

  // 屋顶：两坡 + 屋脊 + 正面瓦垄
  const roof = pitchedRoof(span, ridge, rise, N.tile);
  put(g, roof, 0, eaveY, 0);
  put(g, boxMesh(ridge + 0.16, 0.15, 0.34, N.tileDk),
    0, eaveY + rise + 0.05, 0);
  // 屋脊翘角
  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.5, 0.11, 0.3, N.tileDk), sx * (ridge / 2 - 0.06), eaveY + rise + 0.13, 0,
      0, 0, sx * 0.22);
  }
  // 檐口封檐板 + 瓦当
  const eaveZ = span / 2;
  put(g, boxMesh(ridge, 0.16, 0.12, N.woodDk), 0, eaveY + 0.03, eaveZ - 0.02);
  put(g, boxMesh(ridge, 0.16, 0.12, N.woodDk), 0, eaveY + 0.03, -eaveZ + 0.02);
  const tileTip = planeMesh(ridge - 0.2, 0.2, tileEndMaterial());
  put(g, tileTip, 0, eaveY + 0.16, eaveZ + 0.045);
  tileTip.castShadow = false;
  // 檐下木色望板（前）
  const soffit = planeMesh(ridge, 0.58, mat(N.woodDk, { side: THREE.DoubleSide }));
  put(g, soffit, 0, eaveY - 0.03, eaveZ - 0.31, -HALF_PI, 0, 0);
  soffit.castShadow = false;

  // 屋面瓦垄（正面）
  const slope = Math.atan2(rise, eaveZ);
  const slopeLen = Math.sqrt(rise * rise + eaveZ * eaveZ);
  for (const bx of [-1.7, -0.57, 0.57, 1.7]) {
    const tileRidge = boxMesh(0.12, 0.09, slopeLen, N.tileDk);
    put(g, tileRidge, bx, eaveY + rise / 2 + 0.07, eaveZ / 2 + 0.03, slope, 0, 0);
  }

  // 山墙（白灰三角，填住屋顶两端）
  for (const sx of [-1, 1]) {
    const gw = fixedGable(span - 0.04, 0.14, rise - 0.03, N.plasterShade, 0);
    put(g, gw, sx * (ridge / 2 - 0.06), eaveY, 0, 0, HALF_PI, 0);
    // 山墙腰线（深木色）
    put(g, boxMesh(0.1, 0.14, span - 0.2, N.woodDk), sx * (ridge / 2 - 0.02), eaveY + 0.06, 0);
  }

  // 门前红灯笼 + 门匾
  const lantern = icoMesh(0.16, C.red, { detail: 0, flatShading: true });
  put(g, lantern, 1.42, eaveY - 0.55, D / 2 + 0.34);
  lantern.scale.set(1, 1.25, 1);
  put(g, boxMesh(0.05, 0.28, 0.05, N.woodDk), 1.42, eaveY - 0.3, D / 2 + 0.34);
  put(g, icoMesh(0.03, N.straw, { detail: 0 }), 1.42, eaveY - 0.68, D / 2 + 0.34);
  const plaque = signBoard('山居', {
    w: 1.0, h: 0.34, texW: 384, texH: 128, bg: C.signCream, fg: 0x5a3b2a, radius: 10,
  });
  put(g, plaque, 0, baseH + wallH - 0.05, D / 2 + 0.075);
  plaque.castShadow = false;
  // 屋檐下挂的辣椒串
  put(g, boxMesh(0.1, 0.34, 0.08, N.chili), -1.42, eaveY - 0.5, D / 2 + 0.3);
  put(g, boxMesh(0.08, 0.2, 0.07, N.corn), -1.28, eaveY - 0.42, D / 2 + 0.3);

  // 屋旁柴垛，增加生活气
  for (let i = 0; i < 3; i++) {
    const log = cylMesh(0.09, 0.09, 1.1, i % 2 ? N.woodLt : N.wood, { segments: 5 });
    put(g, log, -W / 2 - 0.28, 0.11 + i * 0.17, 0.6 - i * 0.04, 0, 0, HALF_PI);
  }
  grassTuft(g, W / 2 + 0.12, 0.02, -0.5, N.grass, 0.9, 41);
  return g;
}

/* =============================== 梯田 / 水田 ============================== */
export function terraceField(opts = {}) {
  const r = rng(opts.seed ?? 5501);
  const g = new THREE.Group();
  const W = 6.0, D = 6.0, SOILH = 0.4;
  // 土体
  put(g, boxMesh(W, SOILH, D, N.soil), 0, SOILH / 2, 0);
  // 带秧苗纹样的水面（略高于土顶，避免被土体盖住）
  const water = planeMesh(W - 0.4, D - 0.4, paddyMaterial());
  put(g, water, 0, SOILH + 0.004, 0, -HALF_PI, 0, 0);
  water.castShadow = false;
  // 四周田埂（可拼接：埂压满整条边）
  const bh = 0.18, bw = 0.38;
  const grassCol = r() > 0.5 ? N.grass : 0x7d9e52;
  put(g, boxMesh(W, bh, bw, grassCol), 0, SOILH + bh / 2, D / 2 - bw / 2);
  put(g, boxMesh(W, bh, bw, grassCol), 0, SOILH + bh / 2, -D / 2 + bw / 2);
  put(g, boxMesh(bw, bh, D - bw * 2, grassCol), W / 2 - bw / 2, SOILH + bh / 2, 0);
  put(g, boxMesh(bw, bh, D - bw * 2, grassCol), -W / 2 + bw / 2, SOILH + bh / 2, 0);
  // 埂上露出的青草
  for (let i = 0; i < 5; i++) {
    grassTuft(g, -W / 2 + 0.5 + r() * (W - 1), SOILH + bh, (i % 2 ? 1 : -1) * (D / 2 - bw / 2),
      i % 2 ? N.grassLt : N.grass, 0.75, 60 + i);
  }
  // 水口小石与几束立体秧苗
  icoRock(g, W / 2 - 0.32, SOILH + 0.1, -1.1, 0.16, N.stoneDk, 1.2, 0.7, 1.0);
  icoRock(g, -W / 2 + 0.34, SOILH + 0.08, 1.3, 0.13, N.stone, 1.1, 0.6, 1.0);
  for (let i = 0; i < 3; i++) {
    grassTuft(g, -1.9 + i * 1.9, SOILH, D / 2 - 0.9, N.grassLt, 0.8, 71 + i);
  }
  return g;
}

/* ================================ 木栅栏 ================================= */
export function woodFence(opts = {}) {
  const r = rng(opts.seed ?? 6607);
  const g = new THREE.Group();
  const L = 2.5, H = 1.02;
  const posts = [-L / 2 + 0.06, 0, L / 2 - 0.06];
  for (const x of posts) {
    const p = boxMesh(0.12, H + (r() - 0.5) * 0.08, 0.12, r() > 0.5 ? N.woodDk : N.trunkDk);
    put(g, p, x, H / 2, 0, 0, 0, (r() - 0.5) * 0.05);
  }
  // 两道横杆 + 一根斜撑
  put(g, boxMesh(L, 0.1, 0.075, N.woodLt), 0, H * 0.92, 0.02, 0, 0, 0.008);
  put(g, boxMesh(L, 0.09, 0.07, N.wood), 0, H * 0.6, 0.02, 0, 0, -0.006);
  put(g, boxMesh(0.95, 0.07, 0.06, N.woodLt), -0.52, H * 0.64, 0.06, 0, 0, 0.62);
  // 野藤与草
  leafCard(g, 0.86, H * 0.94, 0.06, 0.2, 0.34, N.leafDk, 1.0, 1.7);
  leafCard(g, 0.98, H * 0.78, 0.02, 0.16, 0.26, N.leaf, 0.8, 2.4);
  leafCard(g, -0.8, H * 0.9, -0.03, 0.18, 0.3, N.leaf, 1.1, 0.6);
  grassTuft(g, -1.0, 0.02, 0.16, N.grass, 0.9, 17);
  grassTuft(g, 0.65, 0.02, -0.1, N.grassDk, 0.8, 21);
  return g;
}

/* ================================ 电线杆 ================================= */
export function utilityPole(opts = {}) {
  const g = new THREE.Group();
  const H = 8.2;
  // 根部石墩 + 水泥杆
  put(g, boxMesh(0.52, 0.26, 0.52, N.stoneDk), 0, 0.13, 0);
  put(g, cylMesh(0.085, 0.16, H, N.stone, { segments: 6 }), 0.02, H / 2, 0);
  // 两道横担
  const arms = [
    { y: 7.35, len: 1.9 },
    { y: 6.78, len: 1.4 },
  ];
  for (const a of arms) {
    put(g, boxMesh(a.len, 0.12, 0.13, N.stoneDk), 0, a.y, 0);
    put(g, boxMesh(0.1, 0.12, 0.1, N.stoneDk), 0, a.y - 0.18, 0, 0.5, 0, 0);
  }
  // 瓷瓶
  const insulCol = 0xe4dcc6;
  const insulX = [-0.85, -0.3, 0.3, 0.85];
  for (const x of insulX) {
    put(g, boxMesh(0.09, 0.18, 0.09, insulCol), x, 7.51, 0);
    put(g, boxMesh(0.12, 0.04, 0.12, N.stoneDk), x, 7.41, 0);
  }
  put(g, boxMesh(0.08, 0.16, 0.08, insulCol), -0.55, 6.94, 0);
  put(g, boxMesh(0.08, 0.16, 0.08, insulCol), 0.55, 6.94, 0);
  // 变压器
  put(g, boxMesh(0.38, 0.6, 0.32, 0x9aa09a), 0.28, 6.12, 0.04);
  put(g, boxMesh(0.44, 0.06, 0.38, N.stoneDk), 0.28, 6.45, 0.04);
  // 蹬杆脚钉
  put(g, boxMesh(0.3, 0.04, 0.05, N.stoneDk), 0.16, 3.6, 0, 0, 0, 0.15);
  put(g, boxMesh(0.3, 0.04, 0.05, N.stoneDk), -0.02, 4.5, 0, 0, 0, -0.15);
  // 警示牌
  const warn = planeMesh(0.28, 0.4, warningMaterial());
  put(g, warn, 0, 2.9, 0.14);
  warn.castShadow = false;
  // 给 world 用的挂线锚点（本地坐标）
  g.userData.wireAnchors = [
    new THREE.Vector3(-0.85, 7.62, 0),
    new THREE.Vector3(0.85, 7.62, 0),
    new THREE.Vector3(-0.55, 7.03, 0),
    new THREE.Vector3(0.55, 7.03, 0),
    new THREE.Vector3(0, H + 0.02, 0),
  ];
  g.userData.poleHeight = H;
  return g;
}

/* ============================== 石桥护栏 ================================ */
export function stoneBridgeRail(opts = {}) {
  const g = new THREE.Group();
  const L = 2.2;
  // 基座
  put(g, boxMesh(L, 0.2, 0.38, N.stoneDk), 0, 0.1, 0);
  // 望柱 + 柱头
  for (const x of [-0.98, 0, 0.98]) {
    put(g, boxMesh(0.18, 0.7, 0.26, N.stone), x, 0.53, 0);
    put(g, boxMesh(0.25, 0.08, 0.32, N.stoneLt), x, 0.9, 0);
  }
  // 栏板细柱（留空，读作护栏而不是石凳）
  for (const x of [-0.72, -0.48, -0.24, 0.24, 0.48, 0.72]) {
    put(g, boxMesh(0.07, 0.6, 0.13, N.stone), x, 0.5, 0);
  }
  // 压顶
  put(g, boxMesh(L, 0.15, 0.32, N.stoneLt), 0, 1.01, 0);
  // 青苔与草
  icoRock(g, -0.95, 1.06, 0.08, 0.09, N.leafDk, 1.6, 0.45, 0.8);
  icoRock(g, 0.55, 1.06, -0.06, 0.08, N.grassDk, 1.5, 0.4, 0.8);
  grassTuft(g, 0.88, 0.2, 0.12, N.grass, 0.7, 33);
  grassTuft(g, -0.9, 0.2, -0.08, N.grassDk, 0.6, 34);
  return g;
}

/* ================================ 瀑 布 ================================= */
export function waterfall(opts = {}) {
  const g = new THREE.Group();
  // 中央岩体：前后对称，从 +Z / -Z 看都有水帘，不会变成一整块灰绿岩背
  icoRock(g, 0, 2.45, 0, 1.6, 0x66725f, 1.35, 1.55, 0.55, [0.03, 0.3, 0.02]);
  icoRock(g, -1.55, 2.3, -0.12, 1.3, 0x6f7b67, 0.78, 1.7, 0.5, [0.08, 0.2, 0.06]);
  icoRock(g, 1.58, 2.55, -0.15, 1.25, 0x75816d, 0.75, 1.75, 0.5, [0.03, 0.7, -0.04]);
  icoRock(g, 0, 4.7, 0, 1.3, 0x64705d, 1.7, 0.42, 0.5, [0.04, 0.4, 0.02]);
  icoRock(g, -0.9, 4.75, 0.1, 0.35, N.leafDk, 1.3, 0.5, 1.0);
  // 崖脚大石，横向撑到 6m+
  icoRock(g, -2.5, 0.55, 0.15, 0.7, 0x5f6b58, 1.15, 0.9, 0.95);
  icoRock(g, 2.45, 0.48, 0.1, 0.65, 0x6a7662, 1.15, 0.85, 0.95);
  // 崖壁青苔
  icoRock(g, -1.95, 1.35, 0.42, 0.17, N.leafDk, 1.0, 1.8, 0.7);
  // 水帘材质（两面共用一张水纹，tick 里一起流）
  const tex = cascadeTexture();
  const cmat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, opacity: 0.97, roughness: 0.28,
    depthWrite: false, side: THREE.DoubleSide, color: 0xf7fdfb,
    emissive: 0xcfe6e4, emissiveIntensity: 0.12,
  });
  const recessMat = mat(0x4f5b4e, { roughness: 0.95, side: THREE.DoubleSide });
  // 前后两面各挂一道瀑布 + 水雾
  for (const dir of [1, -1]) {
    const recess = planeMesh(1.9, 4.4, recessMat);
    put(g, recess, 0, 2.35, dir * 0.9);
    recess.castShadow = false;
    const l1 = planeMesh(2.4, 4.5, cmat);
    put(g, l1, 0, 2.35, dir * 1.0);
    const l2 = planeMesh(0.9, 3.4, cmat);
    put(g, l2, -0.86, 1.95, dir * 1.06, 0, dir * 0.1, 0);
    const l3 = planeMesh(0.78, 3.0, cmat);
    put(g, l3, 0.88, 1.8, dir * 1.07, 0, -dir * 0.12, 0);
    // 落水口的石缝（一侧一块）
    icoRock(g, -0.6, 4.66, dir * 0.92, 0.28, 0x74806b, 1.1, 0.55, 0.7);
    // 底部泡沫
    icoRock(g, -0.1, 0.1, dir * 1.2, 0.38, 0xf0f7f2, 1.9, 0.32, 0.95);
    // 水雾（Sprite 始终面向相机）
    const mist = glowSprite(0xf2fbf6, dir > 0 ? 2.9 : 2.2, dir > 0 ? 0.2 : 0.15);
    put(g, mist, 0, 0.8, dir * 1.45);
    const mist2 = glowSprite(0xffffff, 1.8, 0.1);
    put(g, mist2, dir * 0.55, 2.4, dir * 1.1);
  }
  // 水潭：椭圆水体 + 深色湿石边，避免出现矩形平板边
  const rim = new THREE.Mesh(circleGeo(2.0, 18), mat(0x76836d, { roughness: 0.95 }));
  rim.rotation.x = -HALF_PI;
  rim.scale.set(1.35, 0.82, 1);
  rim.position.y = 0.012;
  rim.receiveShadow = false;
  g.add(rim);
  const pool = new THREE.Mesh(circleGeo(1.9, 18), mat(0x9ac6bf, { roughness: 0.12, metalness: 0 }));
  pool.rotation.x = -HALF_PI;
  pool.scale.set(1.35, 0.82, 1);
  pool.position.y = 0.022;
  pool.castShadow = false;
  g.add(pool);
  // 水纹缓慢下流
  g.userData.tick = (t, dt) => {
    tex.offset.y = (tex.offset.y - dt * 0.45) % 1;
  };
  // 崖脚草
  grassTuft(g, 2.65, 0.02, 0.55, N.grassDk, 1.1, 51);
  grassTuft(g, -2.65, 0.02, 0.5, N.grass, 1.0, 52);
  return g;
}

/* ================================ 干草车 ================================= */
export function hayCart(opts = {}) {
  const r = rng(opts.seed ?? 9901);
  const g = new THREE.Group();
  // 车轮（木轮 + 小轮毂）
  for (const sx of [-1, 1]) {
    const wheel = cylMesh(0.44, 0.44, 0.15, N.wood, { segments: 7 });
    put(g, wheel, sx * 0.95, 0.44, 0, 0, 0, HALF_PI);
    const hub = cylMesh(0.15, 0.15, 0.18, N.woodDk, { segments: 5 });
    put(g, hub, sx * 0.95, 0.44, 0, 0, 0, HALF_PI);
  }
  // 车斗
  put(g, boxMesh(1.8, 0.16, 1.15, N.woodLt), 0, 0.9, 0);
  put(g, boxMesh(1.8, 0.34, 0.07, N.wood), 0, 1.04, 0.58);
  put(g, boxMesh(1.8, 0.34, 0.07, N.wood), 0, 1.04, -0.58);
  put(g, boxMesh(0.07, 0.32, 1.15, N.wood), 0.9, 1.03, 0);
  put(g, boxMesh(0.07, 0.32, 1.15, N.wood), -0.9, 1.03, 0);
  // 干草堆
  const hay = [
    [0, 1.16, 0, 0.58, N.straw],
    [-0.4, 1.12, 0.05, 0.48, N.strawLt],
    [0.43, 1.1, -0.04, 0.46, N.straw],
    [0.05, 1.33, 0.02, 0.34, N.strawLt],
  ];
  for (const [x, y, z, rad, col] of hay) {
    const m = icoMesh(rad, col, { detail: 0, flatShading: true });
    m.position.set(x, y, z);
    m.scale.set(1.4, 0.68, 1.1);
    m.rotation.set(0, r() * TAU, 0);
    g.add(m);
  }
  // 草杆
  for (let i = 0; i < 5; i++) {
    leafCard(g, (r() - 0.5) * 1.4, 1.36, (r() - 0.5) * 0.8,
      0.08, 0.2 + r() * 0.12, N.strawDk, 0.55 + r() * 0.5, r() * TAU);
  }
  // 车把
  for (const sx of [-1, 1]) {
    const shaft = boxMesh(0.09, 0.09, 1.5, N.wood);
    put(g, shaft, sx * 0.52, 0.84, 1.25, -0.12, 0, 0);
  }
  // 绳结
  // （简化掉，控制面数）
  // 车边的散草
  grassTuft(g, -1.2, 0.02, 0.4, N.strawDk, 0.7, 61);
  return g;
}

/* ================================ 稻草人 ================================= */
export function scarecrow(opts = {}) {
  const r = rng(opts.seed ?? 10103);
  const g = new THREE.Group();
  const sway = new THREE.Group();
  g.add(sway);
  // 立杆 + 横臂
  put(sway, cylMesh(0.055, 0.07, 1.62, N.trunkDk, { segments: 5 }), 0, 0.81, 0);
  put(sway, boxMesh(1.22, 0.085, 0.085, N.wood), 0, 1.3, 0.01, 0, 0, 0.03);
  // 草衣（斗笠下的旧布衫）
  put(sway, coneMesh(0.36, 0.82, N.cloth, { segments: 7 }), 0, 0.9, 0);
  // 领口围巾
  put(sway, boxMesh(0.3, 0.08, 0.26, N.chili), 0, 1.33, 0.02);
  // 补丁
  put(sway, boxMesh(0.14, 0.14, 0.02, N.clothDk), 0.09, 0.82, 0.24, 0, 0.2, 0.12);
  // 头
  put(sway, icoMesh(0.2, N.strawLt, { detail: 0, flatShading: true }), 0, 1.58, 0);
  // 眼睛
  for (const sx of [-1, 1]) {
    put(sway, boxMesh(0.045, 0.055, 0.03, 0x3a3028), sx * 0.07, 1.62, 0.18);
  }
  // 草帽
  put(sway, coneMesh(0.38, 0.22, N.straw, { segments: 7 }), 0, 1.78, 0);
  put(sway, cylMesh(0.3, 0.34, 0.05, N.strawDk, { segments: 7 }), 0, 1.7, 0);
  // 袖子 + 草手
  for (const sx of [-1, 1]) {
    put(sway, boxMesh(0.34, 0.15, 0.18, N.clothDk), sx * 0.43, 1.29, 0.01);
    const hand = coneMesh(0.075, 0.28, N.straw, { segments: 4 });
    put(sway, hand, sx * 0.68, 1.29, 0.01, 0, 0, sx * HALF_PI);
  }
  // 草脚
  for (const sx of [-1, 1]) {
    const foot = coneMesh(0.06, 0.24, N.strawDk, { segments: 4 });
    put(sway, foot, sx * 0.08, 0.1, 0.06, 0.5, 0, sx * 0.25);
  }
  grassTuft(g, 0.16, 0.02, 0.16, N.grassDk, 0.9, 67);
  const phase = r() * TAU;
  g.userData.tick = (t) => {
    sway.rotation.z = Math.sin(t * 1.15 + phase) * 0.028;
    sway.rotation.x = Math.sin(t * 0.83 + phase * 0.5) * 0.015;
  };
  return g;
}

/* ================================= 鸡 =================================== */
export function chicken(opts = {}) {
  const r = rng(opts.seed ?? 11101);
  const g = new THREE.Group();
  const phase = r() * TAU;
  // 身体
  const body = icoMesh(0.155, 0xf2ecdc, { detail: 0, flatShading: true });
  put(g, body, 0, 0.22, 0);
  body.scale.set(1.05, 0.95, 1.35);
  // 尾羽
  const tail = coneMesh(0.1, 0.24, 0xe7dfcc, { segments: 5 });
  put(g, tail, 0, 0.29, -0.19, -1.0, 0, 0);
  // 头（可做啄米）
  const head = new THREE.Group();
  head.position.set(0, 0.3, 0.12);
  g.add(head);
  put(head, icoMesh(0.09, 0xf7f1e2, { detail: 0, flatShading: true }), 0, 0.045, 0.03);
  const beak = coneMesh(0.038, 0.09, C.orange, { segments: 5 });
  put(head, beak, 0, 0.035, 0.125, HALF_PI, 0, 0);
  put(head, boxMesh(0.035, 0.08, 0.09, C.red), 0, 0.135, 0.02);
  put(head, boxMesh(0.03, 0.05, 0.03, C.red), 0, -0.005, 0.105);
  // 翅膀
  const wingL = leafCard(g, -0.13, 0.22, 0, 0.1, 0.18, 0xe4dcc9, 1.2, 0.2);
  wingL.rotation.z = 0.4;
  const wingR = leafCard(g, 0.13, 0.22, 0, 0.1, 0.18, 0xe4dcc9, 1.2, -0.2);
  wingR.rotation.z = -0.4;
  // 腿
  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.028, 0.14, 0.028, C.orange), sx * 0.06, 0.07, 0.02);
    put(g, boxMesh(0.07, 0.02, 0.05, C.orange), sx * 0.06, 0.01, 0.05);
  }
  g.userData.tick = (t) => {
    const peck = Math.pow(Math.max(0, Math.sin(t * 2.6 + phase)), 7);
    head.rotation.x = 0.1 + peck * 0.95;
    tail.rotation.z = Math.sin(t * 2.1 + phase) * 0.12;
  };
  return g;
}

/* ================================= 狗 =================================== */
export function dog(opts = {}) {
  const r = rng(opts.seed ?? 12107);
  const g = new THREE.Group();
  const phase = r() * TAU;
  // 身体与胸脯
  const body = icoMesh(0.22, N.dogFur, { detail: 0, flatShading: true });
  put(g, body, 0, 0.4, -0.02);
  body.scale.set(1.0, 0.92, 1.7);
  put(g, icoMesh(0.16, N.dogCream, { detail: 0, flatShading: true }), 0, 0.36, 0.27);
  // 背脊深色
  const back = icoMesh(0.17, N.dogFurDk, { detail: 0, flatShading: true });
  put(g, back, 0, 0.5, -0.1);
  back.scale.set(0.85, 0.55, 1.5);
  // 四条腿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = boxMesh(0.075, 0.34, 0.085, sz > 0 ? N.dogFur : N.dogFurDk);
      put(g, leg, sx * 0.14, 0.18, sz * 0.2);
      put(g, boxMesh(0.08, 0.05, 0.1, N.dogCream), sx * 0.14, 0.03, sz * 0.21 + 0.02);
    }
  }
  // 头
  const head = new THREE.Group();
  head.position.set(0, 0.52, 0.34);
  g.add(head);
  put(head, icoMesh(0.155, N.dogFur, { detail: 0, flatShading: true }), 0, 0.03, 0.03);
  put(head, boxMesh(0.15, 0.11, 0.17, N.dogCream), 0, -0.02, 0.15);
  put(head, boxMesh(0.075, 0.055, 0.05, 0x4a3a2c), 0, -0.005, 0.24);
  // 立耳
  for (const sx of [-1, 1]) {
    const ear = coneMesh(0.065, 0.17, N.dogFurDk, { segments: 4 });
    put(head, ear, sx * 0.09, 0.16, 0.01, 0.1, 0, sx * 0.28);
  }
  // 眼睛
  for (const sx of [-1, 1]) {
    put(head, boxMesh(0.03, 0.035, 0.02, 0x3a2f26), sx * 0.06, 0.05, 0.155);
  }
  // 项圈
  put(g, boxMesh(0.2, 0.055, 0.2, N.chili), 0, 0.48, 0.3);
  // 尾巴（摇）
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.33);
  g.add(tail);
  const tm = cylMesh(0.03, 0.045, 0.32, N.dogFur, { segments: 5 });
  put(tail, tm, 0, 0.13, -0.1, -0.85, 0, 0);
  put(tail, icoMesh(0.05, N.dogCream, { detail: 0 }), 0, 0.28, -0.23);
  g.scale.setScalar(0.8);
  g.userData.tick = (t) => {
    tail.rotation.y = Math.sin(t * 7.2 + phase) * 0.55;
    tail.rotation.z = Math.sin(t * 7.2 + phase + 1) * 0.12;
    head.rotation.y = Math.sin(t * 0.65 + phase) * 0.16;
    head.rotation.x = Math.sin(t * 1.1 + phase) * 0.05;
  };
  return g;
}

/* ================================= 山羊 ================================= */
export function goat(opts = {}) {
  const r = rng(opts.seed ?? 13109);
  const g = new THREE.Group();
  const phase = r() * TAU;
  const body = icoMesh(0.24, N.goat, { detail: 0, flatShading: true });
  put(g, body, 0, 0.55, 0);
  body.scale.set(1.0, 0.85, 1.5);
  // 腿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(g, boxMesh(0.06, 0.42, 0.07, sz > 0 ? N.goat : N.goatGray),
        sx * 0.13, 0.21, sz * 0.28);
    }
  }
  // 脖子 + 头
  put(g, cylMesh(0.09, 0.12, 0.3, N.goat, { segments: 5 }), 0, 0.72, 0.26, 0.4, 0, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.84, 0.38);
  g.add(head);
  put(head, icoMesh(0.13, N.goat, { detail: 0, flatShading: true }), 0, 0.02, 0.02);
  put(head, boxMesh(0.12, 0.1, 0.15, N.goat), 0, -0.03, 0.14);
  put(head, boxMesh(0.075, 0.05, 0.04, 0x8a7a68), 0, -0.04, 0.225);
  // 耳朵
  for (const sx of [-1, 1]) {
    put(head, boxMesh(0.11, 0.03, 0.06, N.goatGray),
      sx * 0.13, 0.04, 0.01, 0, 0, sx * 0.25);
  }
  // 角
  for (const sx of [-1, 1]) {
    const horn = coneMesh(0.035, 0.2, N.goatGray, { segments: 4 });
    put(head, horn, sx * 0.07, 0.15, -0.02, -0.55, 0, sx * 0.3);
  }
  // 胡子 + 尾巴
  const beard = coneMesh(0.045, 0.17, N.goatGray, { segments: 4 });
  put(head, beard, 0, -0.15, 0.12, PI, 0, 0);
  put(g, coneMesh(0.05, 0.16, N.goatGray, { segments: 4 }), 0, 0.62, -0.34, -1.1, 0, 0);
  // 铃铛
  put(g, icoMesh(0.055, N.straw, { detail: 0, flatShading: true }), 0, 0.6, 0.34);
  put(g, boxMesh(0.15, 0.035, 0.16, N.chili), 0, 0.67, 0.3);
  g.userData.tick = (t) => {
    head.rotation.x = Math.sin(t * 0.8 + phase) * 0.1;
    head.rotation.y = Math.sin(t * 0.5 + phase) * 0.12;
  };
  return g;
}

/* =============================== 小石头 ================================= */
export function rockSmall(opts = {}) {
  const r = rng(opts.seed ?? 14107);
  const g = new THREE.Group();
  icoRock(g, 0, 0.26, 0, 0.38, N.stone, 1.15, 0.72, 1.0, [0.1, r() * 3, 0.05]);
  icoRock(g, 0.36, 0.16, 0.13, 0.21, N.stoneDk, 1.1, 0.8, 1.0, [0.2, r() * 3, 0.1]);
  icoRock(g, -0.3, 0.12, -0.2, 0.16, N.stoneLt, 1.2, 0.7, 1.0);
  // 苔与草
  const moss = icoRock(g, 0.02, 0.48, -0.04, 0.2, N.leafDk, 1.25, 0.3, 1.05);
  moss.rotation.y = 0.6;
  grassTuft(g, -0.34, 0.02, 0.2, N.grass, 0.8, 81);
  grassTuft(g, 0.16, 0.02, -0.32, N.grassDk, 0.7, 82);
  return g;
}

/* =============================== 大石头 ================================= */
export function rockLarge(opts = {}) {
  const r = rng(opts.seed ?? 15101);
  const g = new THREE.Group();
  icoRock(g, 0, 0.52, 0, 0.82, N.stone, 1.2, 0.82, 0.95, [0.05, r() * 3, 0.05]);
  icoRock(g, 0.78, 0.34, 0.18, 0.46, N.stoneDk, 1.05, 0.9, 1.0, [0.2, r() * 3, 0.1]);
  icoRock(g, -0.62, 0.72, -0.16, 0.36, N.stoneLt, 1.15, 0.8, 0.95);
  icoRock(g, 0.12, 0.95, 0.18, 0.3, N.stone, 1.2, 0.55, 0.9);
  // 苔
  const moss1 = icoRock(g, -0.15, 1.02, -0.05, 0.28, N.leafDk, 1.4, 0.22, 1.1);
  moss1.rotation.y = 0.4;
  const moss2 = icoRock(g, 0.5, 0.6, 0.42, 0.18, N.leaf, 1.5, 0.25, 1.0);
  moss2.rotation.y = 1.1;
  grassTuft(g, 0.8, 0.02, 0.4, N.grass, 0.9, 91);
  grassTuft(g, -0.85, 0.02, 0.25, N.grassDk, 0.8, 92);
  leafCard(g, 0.2, 0.1, 0.62, 0.22, 0.34, N.grass, 0.8, 1.2);
  return g;
}

/* ================================ 路 坑 ================================= */
export function pothole(opts = {}) {
  const r = rng(opts.seed ?? 16103);
  const g = new THREE.Group();
  const decal = planeMesh(1.75, 1.35, decalMaterial('pothole'));
  put(g, decal, 0, 0.018, 0, -HALF_PI, 0, 0);
  decal.castShadow = false;
  decal.renderOrder = 3;
  // 边上散落的碎沥青块
  for (const [x, z, s] of [[-0.82, 0.22, 0.11], [0.78, -0.18, 0.09], [0.55, 0.45, 0.07]]) {
    const chunk = boxMesh(s, 0.05, s * 0.8, 0x5a544a);
    put(g, chunk, x, 0.03, z, 0, r() * TAU, (r() - 0.5) * 0.3);
  }
  return g;
}

/* ================================ 泥水洼 ================================ */
export function mudPuddle(opts = {}) {
  const r = rng(opts.seed ?? 17107);
  const g = new THREE.Group();
  const decal = planeMesh(2.1, 1.5, decalMaterial('mud'));
  put(g, decal, 0, 0.016, 0, -HALF_PI, 0, 0);
  decal.castShadow = false;
  decal.renderOrder = 3;
  // 反光碎斑（很低的一层，避免完全靠贴图）
  const glint = planeMesh(0.7, 0.22, mat(N.waterLt, {
    transparent: true, opacity: 0.35, roughness: 0.2, depthWrite: false,
  }));
  put(g, glint, -0.28, 0.022, 0.1, -HALF_PI, r() * TAU, 0);
  glint.castShadow = false;
  glint.renderOrder = 4;
  // 泥边小石子
  icoRock(g, 0.86, 0.045, 0.4, 0.1, N.stone, 1.2, 0.6, 1.0);
  icoRock(g, -0.9, 0.04, -0.35, 0.08, N.stoneDk, 1.1, 0.5, 1.0);
  leafCard(g, 1.02, 0.02, -0.2, 0.18, 0.24, N.grassDk, 0.7, 2.1);
  return g;
}

/* ============================ 低树枝门（滑铲） =========================== */
export function branchGate(opts = {}) {
  const r = rng(opts.seed ?? 18109);
  const g = new THREE.Group();
  // 两侧树干
  for (const sx of [-1, 1]) {
    const post = cylMesh(0.085, 0.13, 2.6, N.trunkDk, { segments: 5 });
    put(g, post, sx * 2.2, 1.3, 0, 0, 0, -sx * 0.05);
    icoRock(g, sx * 2.24, 0.12, 0.06, 0.28, N.stoneDk, 1.2, 0.55, 1.0);
    grassTuft(g, sx * 2.25, 0.02, 0.28, N.grassDk, 0.9, 101 + sx);
  }
  // 横枝（微微拱起，下沿保 1.37m 以上）
  strut(g, -2.16, 1.52, 0, -0.72, 1.6, 0.03, 0.14, N.trunk, 5);
  strut(g, -0.72, 1.6, 0.03, 0.72, 1.62, 0.02, 0.14, N.trunk, 5);
  strut(g, 0.72, 1.62, 0.02, 2.16, 1.54, 0, 0.13, N.trunk, 5);
  // 枝上小杈
  strut(g, 0.2, 1.62, 0.02, 0.42, 2.15, 0.06, 0.045, N.trunk, 4);
  strut(g, -1.1, 1.58, 0, -1.3, 2.0, -0.08, 0.04, N.trunk, 4);
  // 叶团：沿横枝铺开的一整蓬，高低错落，压低在 1.5m 以上
  const clusters = [
    [-1.3, 2.18, 0.06, 0.46, N.leafDk, 1.2, 0.8, 1.0],
    [-0.68, 2.4, -0.02, 0.5, N.leaf, 1.3, 0.86, 1.05],
    [0.0, 2.28, -0.06, 0.56, N.leafLt, 1.25, 0.92, 1.1],
    [0.72, 2.42, 0.04, 0.44, N.leaf, 1.2, 0.82, 1.0],
    [1.32, 2.2, -0.03, 0.4, N.leafLt, 1.12, 0.76, 1.0],
  ];
  for (const [x, y, z, rad, col, sx, sy, sz] of clusters) {
    const m = icoMesh(rad, col, { detail: 0, flatShading: true });
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(r() * 2, r() * 2, r() * 2);
    g.add(m);
  }
  // 朝上/外向的叶卡
  for (let i = 0; i < 9; i++) {
    leafCard(g, -2.0 + i * 0.5, 2.0 + r() * 0.45, (r() - 0.5) * 0.4,
      0.36, 0.4 + r() * 0.24, [N.leaf, N.leafLt, N.leafDk][i % 3],
      0.35 + r() * 0.65, r() * TAU);
  }
  // 从横枝垂下的几片叶（仍高于 1.37m 的净空）
  for (let i = 0; i < 3; i++) {
    leafCard(g, -1.5 + i * 1.4, 1.72, 0.12, 0.26, 0.3,
      N.leafDk, 2.2 + r() * 0.3, r() * TAU);
  }
  // 红布条：山村路口的醒目标记
  const cloth = planeMesh(0.16, 0.42, mat(N.chili, { side: THREE.DoubleSide }));
  put(g, cloth, -1.55, 1.6, 0.1, 0.1, 0, 0.2);
  cloth.castShadow = false;
  g.userData.clearance = 1.37;
  return g;
}

/* ============================== 远景山脉 ================================ */
function ridgeGeometry(width, height, cols, seed, baseColor, topColor, fogColor, jag = 0, peakCount = 3) {
  const r = rng(seed);
  const pos = [];
  const col = [];
  const idx = [];
  const cBase = new THREE.Color(baseColor);
  const cTop = new THREE.Color(topColor);
  const cFog = new THREE.Color(fogColor);
  // 用几座高斯峰拼出山脊轮廓，比纯正弦更像中国山水的峰丛
  const peaks = [];
  for (let i = 0; i < peakCount; i++) {
    peaks.push({
      c: 0.1 + r() * 0.8,
      w: 0.075 + r() * 0.12,
      h: 0.5 + r() * 0.5,
    });
  }
  const hs = [];
  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    let v = 0.1;
    for (const p of peaks) v += p.h * Math.exp(-Math.pow((u - p.c) / p.w, 2));
    v *= 1 + (r() - 0.5) * 0.05;
    if (jag > 0) v += (r() - 0.5) * jag;
    hs.push(Math.max(0.05, v));
  }
  hs[0] = 0.03;
  hs[cols - 1] = 0.03;
  hs[1] = Math.min(hs[1], 0.22);
  hs[cols - 2] = Math.min(hs[cols - 2], 0.22);
  const maxH = Math.max(...hs);
  for (let i = 0; i < cols; i++) {
    const x = -width / 2 + (i / (cols - 1)) * width;
    const y = (hs[i] / maxH) * height;
    pos.push(x, 0, 0, x, y, 0);
    const bc = cBase.clone().lerp(cFog, 0.42);
    const tc = cTop.clone().lerp(cFog, 0.02);
    col.push(bc.r, bc.g, bc.b, tc.r, tc.g, tc.b);
  }
  for (let i = 0; i < cols - 1; i++) {
    const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
    idx.push(b0, b1, t1, b0, t1, t0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  // 法线统一朝 +Z（双面渲染）
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < nor.length; i += 3) { nor[i] = 0; nor[i + 1] = 0; nor[i + 2] = 1; }
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

export function mountainRidge(opts = {}) {
  const g = new THREE.Group();
  const layers = [
    { w: 60, h: 12, cols: 21, z: -7, color: 0xa2bccd, top: 0x8fadc2, seed: 311, jag: 0, peaks: 4 },
    { w: 52, h: 8.6, cols: 19, z: -2, color: 0x8fa9a8, top: 0x789a99, seed: 317, jag: 0.045, peaks: 5 },
    { w: 40, h: 5.8, cols: 17, z: 3.5, color: 0x7a957e, top: 0x5f7f68, seed: 323, jag: 0.1, peaks: 6 },
  ];
  for (const L of layers) {
    const geo = ridgeGeometry(L.w, L.h, L.cols, L.seed, L.color, L.top, 0xd8e4e6, L.jag, L.peaks);
    const m = new THREE.Mesh(geo, mat(0xffffff, {
      vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 1,
    }));
    m.position.z = L.z;
    m.castShadow = false;
    g.add(m);
  }
  // 层间雾带：软边渐变，让远山有空气透视（不用硬边矩形）
  const hazes = [
    { w: 64, h: 4.6, y: 2.0, z: -4.6, o: 0.55 },
    { w: 56, h: 3.8, y: 1.6, z: 1.0, o: 0.48 },
    { w: 48, h: 3.0, y: 1.3, z: 5.5, o: 0.62 },
  ];
  for (const H of hazes) {
    const hz = planeMesh(H.w, H.h, fogBandMaterial(0xdbe7e8, H.o));
    put(g, hz, 0, H.y, H.z);
    hz.castShadow = false;
  }
  g.userData.backdrop = true;
  return g;
}

/* ============================== 远景云团 ================================ */
export function cloudBank(opts = {}) {
  const r = rng(opts.seed ?? 19109);
  const g = new THREE.Group();
  const drift = new THREE.Group();
  g.add(drift);
  const parts = [];
  // 主云团：一排柔软的大团（低面数球体 + 平滑着色，避免变成白石头）
  const n = 6;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = -6.4 + u * 12.8 + (r() - 0.5) * 0.9;
    const y = 3.2 + Math.sin(u * PI) * 1.3 + (r() - 0.5) * 0.45;
    const rad = 1.35 + Math.sin(u * PI) * 1.1 + r() * 0.3;
    const ic = sphereMesh(rad, i % 4 === 3 ? N.cloudWarm : N.cloud, {
      segments: 6, transparent: true, opacity: 0.93, roughness: 1,
      emissive: 0xfff6e8, emissiveIntensity: 0.07,
    });
    ic.position.set(x, y, (r() - 0.5) * 2.2);
    ic.scale.set(1.55, 0.62, 1.05);
    ic.rotation.set(0, r() * TAU, 0);
    ic.castShadow = false;
    drift.add(ic);
    parts.push({ mesh: ic, x, phase: r() * TAU, amp: 0.25 + r() * 0.35 });
  }
  // 底部暖色薄云（晨光染色）
  for (let i = 0; i < 2; i++) {
    const ic = sphereMesh(1.6 + r() * 0.4, N.cloudWarm, {
      segments: 6, transparent: true, opacity: 0.62, roughness: 1,
      emissive: 0xffe9cf, emissiveIntensity: 0.08,
    });
    ic.position.set(-4 + i * 7.5, 2.3 + r() * 0.3, 0.8);
    ic.scale.set(2.3, 0.32, 1.0);
    ic.rotation.y = r() * TAU;
    ic.castShadow = false;
    drift.add(ic);
  }
  g.userData.tick = (t) => {
    for (const p of parts) {
      p.mesh.position.x = p.x + Math.sin(t * 0.11 + p.phase) * p.amp;
    }
  };
  return g;
}

/* ================================ 蝴 蝶 ================================= */
function wingGeometry() {
  let g = localCache.get('wing');
  if (g) return g;
  // 两片水平翅膀（前翅 + 后翅），顶点色做出翅缘深色
  const pos = new Float32Array([
    0.02, 0, 0.03,
    0.24, 0.02, 0.1,
    0.3, 0.03, -0.02,
    0.06, 0.01, -0.03,
    0.02, 0, -0.04,
    0.18, 0.015, -0.09,
    0.14, 0.02, -0.17,
    0.04, 0.005, -0.11,
  ]);
  const col = [];
  const light = new THREE.Color(N.butterflyA);
  const warm = new THREE.Color(N.butterflyB);
  const dark = new THREE.Color(N.butterflyDk);
  const cs = [light, warm, dark, light, light, warm, dark, light];
  for (const c of cs) col.push(c.r, c.g, c.b);
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  localCache.set('wing', g);
  return g;
}

export function butterfly(opts = {}) {
  const r = rng(opts.seed ?? 20101);
  const g = new THREE.Group();
  const phase = r() * TAU;
  const body = new THREE.Group();
  g.add(body);
  // 身体 + 触角
  put(body, boxMesh(0.02, 0.02, 0.1, 0x5d4a3c), 0, 0.09, 0);
  for (const sx of [-1, 1]) {
    put(body, boxMesh(0.006, 0.006, 0.06, 0x5d4a3c), sx * 0.012, 0.105, 0.055, 0.3, 0, sx * 0.5);
  }
  const wingMat = mat(0xffffff, {
    vertexColors: true, side: THREE.DoubleSide, flatShading: true, roughness: 0.85,
  });
  const wR = new THREE.Group();
  const wL = new THREE.Group();
  wL.scale.x = -1;
  body.add(wR, wL);
  for (const w of [wR, wL]) {
    const m = new THREE.Mesh(wingGeometry(), wingMat);
    m.position.y = 0.1;
    m.scale.setScalar(0.55);
    m.castShadow = false;
    w.add(m);
  }
  g.userData.tick = (t) => {
    const flap = 0.5 + Math.sin(t * 16 + phase) * 0.62;
    wR.rotation.z = flap;
    wL.rotation.z = -flap;
    body.position.y = 0.02 + Math.sin(t * 2.2 + phase) * 0.015;
  };
  return g;
}

/* ================================ META ================================== */
// 尺寸（米）：w=X 宽，h=Y 高，d=Z 深。供碰撞体积 / 摆放间距使用。
// 额外约定：
//  - branchGate.userData.clearance = 1.37（滑铲净空，必须低于骑手站立高度）
//  - utilityPole.userData.wireAnchors = 5 个本地坐标挂线点，world 用 localToWorld 连线
//  - mountainRidge / cloudBank.userData.backdrop = true（远景，不开阴影）
//  - pothole / mudPuddle 是贴地 decal（无阴影，y≈0.02）
//  - butterfly 是飞行小虫，模型悬在原点上方约 0.1m
export const META = {
  bambooCluster: { w: 3.45, h: 7.4, d: 3.25 },
  pineTree: { w: 3.8, h: 6.05, d: 3.8 },
  broadleafTree: { w: 4.9, h: 6.6, d: 3.7 },
  mountainHouse: { w: 5.55, h: 4.95, d: 5.0 },
  terraceField: { w: 6.0, h: 0.85, d: 6.1 },
  woodFence: { w: 2.5, h: 1.17, d: 0.8 },
  utilityPole: { w: 1.9, h: 8.2, d: 0.6 },
  stoneBridgeRail: { w: 2.2, h: 1.1, d: 0.45 },
  waterfall: { w: 6.3, h: 5.9, d: 3.3 },
  hayCart: { w: 2.35, h: 1.55, d: 2.9 },
  scarecrow: { w: 1.65, h: 1.95, d: 0.75 },
  chicken: { w: 0.43, h: 0.47, d: 0.62 },
  dog: { w: 0.3, h: 0.65, d: 0.97 },
  goat: { w: 0.41, h: 1.1, d: 1.06 },
  rockSmall: { w: 1.1, h: 0.6, d: 1.0 },
  rockLarge: { w: 2.25, h: 1.3, d: 1.65 },
  pothole: { w: 1.77, h: 0.06, d: 1.35 },
  mudPuddle: { w: 2.25, h: 0.26, d: 1.5 },
  branchGate: { w: 5.05, h: 3.2, d: 1.4 },
  mountainRidge: { w: 60, h: 12, d: 12.5 },
  cloudBank: { w: 17.9, h: 4.4, d: 10 },
  butterfly: { w: 0.34, h: 0.12, d: 0.2 },
};
