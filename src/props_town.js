// props_town.js — 乡镇集市道具（prop-town 独占文件）
// 契约：每个导出函数返回 THREE.Group；原点=底面中心；单位米；默认正面朝 +Z；
// 不设置世界位置、不使用全局可变状态；材质/几何尽量走 artkit 缓存；单个物件约 30–300 三角面。
// 预览：http://127.0.0.1:8788/tools/prop-lab.html?module=town
//
// 约定：
//  · shopHouse / marketStall / fruitSign 支持 opts.seed 做确定性变体；不给 seed 时每次随机一套，
//    方便 Lead 直接铺一条不重样的街。可选 opts.sign / opts.wall / opts.awning 覆写。
//  · townBackdrop 的远景内容向 -Z 延伸（原点在近端），请放在街道后方（约 z=-30~-60）并配合雾。
import * as THREE from 'three';
import {
  C, rng, mat, boxMesh, cylMesh, coneMesh, icoMesh, sphereMesh, planeMesh,
  gableRoof, signBoard, canvasTexture, contactShadow, put, catenary,
  noiseTexture, circleGeo,
} from './artkit.js';

const TAU = Math.PI * 2;
const CN_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
const css = (hex) => '#' + new THREE.Color(hex).getHexString();

/* ================================= 缓存工具 ================================= */

const TEX = new Map();
function tex(key, w, h, draw, opts = {}) {
  let t = TEX.get(key);
  if (!t) {
    t = canvasTexture(w, h, draw, opts);
    TEX.set(key, t);
  }
  return t;
}

const MATS = new Map();
// artkit.mat 不支持 alphaTest / emissiveMap，镂空布片、窗、招牌走这个缓存。
function texMat(key, texture, opts = {}) {
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture,
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      side: opts.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      alphaTest: opts.alphaTest ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      emissiveMap: opts.emissiveMap ?? null,
      depthWrite: opts.depthWrite ?? true,
    });
    MATS.set(key, m);
  }
  return m;
}

// signBoard 每次都会新建 CanvasTexture；缓存模板 Mesh，克隆复用贴图/材质。
const SIGN_CACHE = new Map();
function signPlane(text, opts = {}) {
  const w = opts.w ?? 2.4;
  const h = opts.h ?? 0.8;
  const texW = opts.texW ?? 512;
  const texH = opts.texH ?? Math.max(72, Math.round((texW * h) / w));
  const key = [text, w, h, texW, texH, opts.bg, opts.fg, opts.sub, opts.vertical ? 1 : 0, opts.glow ? 1 : 0].join('|');
  let tpl = SIGN_CACHE.get(key);
  if (!tpl) {
    tpl = signBoard(text, { ...opts, w, h, texW, texH });
    SIGN_CACHE.set(key, tpl);
  }
  const m = tpl.clone();
  m.castShadow = false;
  return m;
}

// 竖幅/对联/侧招：自己画竖排汉字，字形能撑满牌面。
const BANNER_MATS = new Map();
function bannerPlane(text, opts = {}) {
  const w = opts.w ?? 0.42;
  const h = opts.h ?? 1.5;
  const bg = opts.bg ?? C.signRed;
  const fg = opts.fg ?? 0xffe6a8;
  const key = [text, bg, fg].join('|');
  let mtl = BANNER_MATS.get(key);
  if (!mtl) {
    const t = tex('banner:' + key, 160, 512, (ctx, cw, ch) => {
      ctx.fillStyle = css(bg);
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = css(fg);
      ctx.lineWidth = 6;
      ctx.strokeRect(11, 11, cw - 22, ch - 22);
      ctx.strokeStyle = 'rgba(255,240,195,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(22, 22, cw - 44, ch - 44);
      const chars = [...text];
      const size = Math.min(104, (ch - 150) / Math.max(1, chars.length));
      const gap = Math.min(size * 1.3, (ch - 130) / Math.max(1, chars.length));
      const start = ch / 2 - ((chars.length - 1) * gap) / 2;
      ctx.fillStyle = css(fg);
      ctx.font = `900 ${Math.round(size)}px ${CN_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chars.forEach((c, i) => ctx.fillText(c, cw / 2, start + i * gap));
      for (const cy of [30, ch - 30]) {
        ctx.beginPath();
        ctx.moveTo(cw / 2, cy - 16);
        ctx.lineTo(cw / 2 + 11, cy);
        ctx.lineTo(cw / 2, cy + 16);
        ctx.lineTo(cw / 2 - 11, cy);
        ctx.closePath();
        ctx.fill();
      }
    });
    mtl = texMat('banner:' + key, t, { side: THREE.DoubleSide, roughness: 0.86 });
    BANNER_MATS.set(key, mtl);
  }
  return planeMesh(w, h, mtl);
}

/* --------------------------------- 瓦顶 --------------------------------- */

// 素色瓦片贴图（乘材质颜色），加一圈深色给封檐板采样
function tileTexture() {
  return tex('roofTile', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d8d0c2';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      const g = ctx.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.55, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(40,33,27,0.34)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, 16);
      ctx.fillStyle = 'rgba(38,32,26,0.55)';
      ctx.fillRect(0, y + 15, w, 1);
      const off = (y / 16) % 2 ? 8 : 0;
      ctx.fillStyle = 'rgba(50,42,35,0.22)';
      for (let x = off; x < w; x += 16) ctx.fillRect(x, y, 1, 15);
    }
    // 封檐板采样用的深色角（UV 0.01,0.01）
    ctx.fillStyle = '#4a3628';
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillRect(0, h - 4, 4, 4);
  }, { wrap: true });
}

// 微凹弧面瓦顶（约 12 面）+ 可选的白色山墙（单独 mesh）
const ROOF_GEOS = new Map();
function roofGeometry(w, d, h) {
  const key = `${w.toFixed(2)}|${d.toFixed(2)}|${h.toFixed(2)}`;
  let geo = ROOF_GEOS.get(key);
  if (geo) return geo;
  const hw = w / 2;
  const hd = d / 2;
  const prof = [
    [0, h],
    [hd * 0.6, h * 0.55],
    [hd * 0.94, h * 0.14],
    [hd, h * 0.2],
  ];
  const dists = [0];
  for (let i = 1; i < prof.length; i++) {
    dists.push(dists[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  }
  const p = [];
  const uv = [];
  const tri = (ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv) => {
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    uv.push(au, av, bu, bv, cu, cv);
  };
  const US = 1 / 0.62;
  const VS = 1 / 0.62;
  for (const s of [1, -1]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [z0, y0] = prof[i];
      const [z1, y1] = prof[i + 1];
      const u0 = 0;
      const u1 = w * US;
      const v0 = dists[i] * VS;
      const v1 = dists[i + 1] * VS;
      tri(-hw, y0, z0 * s, u0, v0, hw, y0, z0 * s, u1, v0, hw, y1, z1 * s, u1, v1);
      tri(-hw, y0, z0 * s, u0, v0, hw, y1, z1 * s, u1, v1, -hw, y1, z1 * s, u0, v1);
    }
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  ROOF_GEOS.set(key, geo);
  return geo;
}

// 店铺两端的人字山墙（白色灰泥），填在瓦顶下方
const GABLE_GEOS = new Map();
function gableWallGeometry(w, d, h) {
  const key = `${w.toFixed(2)}|${d.toFixed(2)}|${h.toFixed(2)}`;
  let geo = GABLE_GEOS.get(key);
  if (geo) return geo;
  const x = w / 2;
  const hd = d / 2;
  const prof = [
    [0, h],
    [hd * 0.6, h * 0.55],
    [hd * 0.94, h * 0.14],
    [hd, h * 0.2],
  ];
  const pts = [prof[0], prof[1], prof[2], prof[3], [hd, 0], [0, 0], [-hd, 0], [-prof[3][0], prof[3][1]], [-prof[2][0], prof[2][1]], [-prof[1][0], prof[1][1]]];
  const p = [];
  for (const ex of [-x, x]) {
    for (let i = 0; i < pts.length - 1; i++) p.push(ex, 0, 0, ex, pts[i][1], pts[i][0], ex, pts[i + 1][1], pts[i + 1][0]);
    p.push(ex, 0, 0, ex, pts[pts.length - 1][1], pts[pts.length - 1][0], ex, pts[0][1], pts[0][0]);
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.computeVertexNormals();
  GABLE_GEOS.set(key, geo);
  return geo;
}

function gableWallMesh(w, d, h, color, seed) {
  const m = new THREE.Mesh(gableWallGeometry(w, d, h), mat(0xffffff, { map: plasterTexture(color, seed), side: THREE.DoubleSide, roughness: 0.96 }));
  m.castShadow = true;
  return m;
}

function roofMesh(w, d, h, color) {
  const m = new THREE.Mesh(
    roofGeometry(w, d, h),
    mat(color, { map: tileTexture(), flatShading: true, side: THREE.DoubleSide, roughness: 0.95 })
  );
  m.castShadow = true;
  return m;
}

/* --------------------------------- 小件 --------------------------------- */

// 车轮：胎 + 轮毂（6 段胎 24 + 5 段毂 20 = 44 面）
function wheels(parent, x, y, z, r, width, hubColor = C.metal) {
  const tire = cylMesh(r, r, width, C.tire, { segments: 6 });
  tire.rotation.z = Math.PI / 2;
  tire.position.set(x, y, z);
  parent.add(tire);
  const hub = cylMesh(r * 0.44, r * 0.44, width + 0.02, hubColor, { segments: 5 });
  hub.rotation.z = Math.PI / 2;
  hub.position.set(x, y, z);
  parent.add(hub);
  return tire;
}

// 红灯笼：纸灯笼身（圆柱 + 红绸金箍贴图）、上下金盖、流苏。
// 返回吊挂枢轴（动画绕枢轴摆）。lite=true 省略顶盖 + 薄片流苏，省面数。
function lanternSkinTexture() {
  return tex('lanternSkin', 64, 64, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#a8332b');
    g.addColorStop(0.22, '#dd4b3c');
    g.addColorStop(0.5, '#f06a52');
    g.addColorStop(0.78, '#dd4b3c');
    g.addColorStop(1, '#a8332b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 上下金箍
    ctx.fillStyle = '#f2cf6a';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillRect(0, h - 6, w, 6);
    // 竹骨
    ctx.strokeStyle = 'rgba(115,28,24,0.42)';
    ctx.lineWidth = 1.3;
    for (let x = 4; x < w; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h - 6);
      ctx.stroke();
    }
  }, { wrap: true });
}

const LANTERN_GEOS = new Map();
function lanternGeometry(r, h) {
  const key = `${r.toFixed(3)}|${h.toFixed(3)}`;
  let geo = LANTERN_GEOS.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(r * 0.78, r, h, 6, 1, true);
    LANTERN_GEOS.set(key, geo);
  }
  return geo;
}

function lanternMesh(parent, x, y, z, scale = 1, lite = false) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  parent.add(pivot);
  const r = 0.22 * scale;
  const h = 0.38 * scale;
  const body = new THREE.Mesh(lanternGeometry(r, h), texMat('lanternSkin', lanternSkinTexture(), { side: THREE.DoubleSide, roughness: 0.72 }));
  body.castShadow = true;
  body.position.y = -h / 2 - 0.03 * scale;
  pivot.add(body);
  const capMat = mat(C.yellow, { side: THREE.DoubleSide });
  const bottom = new THREE.Mesh(circleGeo(r * 0.82, 6), capMat);
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = body.position.y - h / 2;
  pivot.add(bottom);
  if (!lite) {
    const top = new THREE.Mesh(circleGeo(r * 0.82, 6), capMat);
    top.rotation.x = -Math.PI / 2;
    top.position.y = body.position.y + h / 2;
    pivot.add(top);
    const tassel = coneMesh(0.05 * scale, 0.18 * scale, C.yellow, { segments: 5 });
    tassel.rotation.x = Math.PI;
    tassel.position.y = -h - 0.13 * scale;
    pivot.add(tassel);
  } else {
    const p1 = planeMesh(0.08 * scale, 0.18 * scale, mat(C.yellow));
    p1.position.y = -h - 0.12 * scale;
    pivot.add(p1);
    const p2 = p1.clone();
    p2.rotation.y = Math.PI / 2;
    pivot.add(p2);
  }
  return pivot;
}

function addShadow(g, w, d, opacity = 0.5) {
  const s = contactShadow(w, d, opacity);
  s.castShadow = false;
  g.add(s);
  return s;
}

function steamTexture() {
  return tex('steam', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,253,246,0.95)');
    g.addColorStop(0.42, 'rgba(255,250,238,0.4)');
    g.addColorStop(1, 'rgba(255,250,238,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, TAU);
    ctx.fill();
  });
}

// 半透明蒸汽（两片交叉的透明面片；第三人称镜头下稳定可见）
function steamPuffMesh(size = 0.55, opacity = 0.34) {
  const g = new THREE.Group();
  const mtl = new THREE.MeshBasicMaterial({
    map: steamTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    color: 0xfffdf6,
  });
  const a = planeMesh(size, size, mtl);
  g.add(a);
  const b = planeMesh(size, size, mtl);
  b.rotation.y = Math.PI / 2;
  g.add(b);
  g.userData.mat = mtl;
  return g;
}

/* ================================= 贴图 ================================= */

function plasterTexture(color, seed) {
  const key = 'plaster:' + color + ':' + (seed % 4);
  let t = TEX.get(key);
  if (!t) {
    t = noiseTexture(color, {
      size: 256,
      amount: 11,
      seed: seed * 7 + 3,
      repeat: [1, 1],
      extra: (ctx, s) => {
        const r = rng(seed * 13 + 5);
        const g = ctx.createLinearGradient(0, s * 0.7, 0, s);
        g.addColorStop(0, 'rgba(96,88,72,0)');
        g.addColorStop(1, 'rgba(96,88,72,0.24)');
        ctx.fillStyle = g;
        ctx.fillRect(0, s * 0.7, s, s * 0.3);
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = `rgba(120,110,92,${(0.025 + r() * 0.04).toFixed(3)})`;
          ctx.fillRect(r() * s, 0, 1 + r() * 3, s * (0.12 + r() * 0.45));
        }
      },
    });
    TEX.set(key, t);
  }
  return t;
}

// 卷帘门：横条 + 做旧 + 小广告
function shutterTexture() {
  return tex('shutter', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b9b2a1';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.17)';
      ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = 'rgba(55,50,42,0.22)';
      ctx.fillRect(0, y + 6, w, 3);
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.45, 'rgba(80,65,45,0)');
    g.addColorStop(1, 'rgba(70,58,42,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w * 0.18, h * 0.3);
    ctx.rotate(-0.04);
    ctx.fillStyle = 'rgba(250,242,222,0.92)';
    ctx.fillRect(0, 0, 54, 64);
    ctx.fillStyle = '#b23c32';
    ctx.font = `900 36px ${CN_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('租', 27, 42);
    ctx.restore();
    ctx.fillStyle = 'rgba(246,236,214,0.75)';
    ctx.fillRect(w * 0.62, h * 0.55, 32, 44);
    ctx.strokeStyle = 'rgba(150,60,50,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.64, h * 0.62);
    ctx.lineTo(w * 0.78, h * 0.62);
    ctx.moveTo(w * 0.64, h * 0.68);
    ctx.lineTo(w * 0.75, h * 0.68);
    ctx.stroke();
  });
}

// 敞开店面内景：货架、暖灯、柜台
function shopInteriorTexture(variant) {
  return tex('interior' + variant, 256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2e241c');
    g.addColorStop(0.55, '#513b2b');
    g.addColorStop(1, '#6d4f35');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const goods = ['#c94c42', '#e5a13c', '#7fae5b', '#4e87a8', '#f1e2bd', '#c96a4a'];
    for (let s = 0; s < 3; s++) {
      const y = 70 + s * 44;
      ctx.fillStyle = 'rgba(28,19,13,0.78)';
      ctx.fillRect(26, y + 22, w - 52, 5);
      for (let i = 0; i < 8; i++) {
        const c = goods[(i + s + variant) % goods.length];
        const bw = 12 + ((i * 7 + variant * 3) % 10);
        const bh = 16 + ((i * 5 + s) % 8);
        ctx.fillStyle = c;
        ctx.fillRect(34 + i * 24, y + 22 - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(34 + i * 24, y + 22 - bh, bw, 3);
      }
    }
    ctx.strokeStyle = 'rgba(20,14,9,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.52, 0);
    ctx.lineTo(w * 0.52, 38);
    ctx.stroke();
    const lx = w * 0.52;
    const ly = 48;
    const rg = ctx.createRadialGradient(lx, ly, 2, lx, ly, 54);
    rg.addColorStop(0, 'rgba(255,236,184,0.95)');
    rg.addColorStop(0.3, 'rgba(255,209,135,0.55)');
    rg.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(lx, ly, 54, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff4cd';
    ctx.beginPath();
    ctx.arc(lx, ly, 7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(24,17,12,0.88)';
    ctx.fillRect(0, h - 46, w, 46);
    ctx.fillStyle = 'rgba(210,160,100,0.35)';
    ctx.fillRect(20, h - 46, w - 40, 4);
    ctx.strokeStyle = '#3b2a1d';
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.strokeStyle = 'rgba(255,222,170,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, w - 44, h - 44);
  });
}

// 二楼拱窗（透明角 + 暖玻璃 + 木窗棂）
function windowTexture() {
  return tex('window', 176, 208, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#eee2c8';
    ctx.beginPath();
    ctx.moveTo(10, h - 6);
    ctx.lineTo(10, 76);
    ctx.quadraticCurveTo(w / 2, -6, w - 10, 76);
    ctx.lineTo(w - 10, h - 6);
    ctx.closePath();
    ctx.fill();
    const g = ctx.createLinearGradient(0, 30, 0, h - 30);
    g.addColorStop(0, '#ffe9b8');
    g.addColorStop(0.6, '#f7cb7b');
    g.addColorStop(1, '#dca75e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(25, h - 24);
    ctx.lineTo(25, 82);
    ctx.quadraticCurveTo(w / 2, 16, w - 25, 82);
    ctx.lineTo(w - 25, h - 24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6b4a33';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w / 2, 22);
    ctx.lineTo(w / 2, h - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(25, 104);
    ctx.lineTo(w - 25, 104);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(25, 152);
    ctx.lineTo(w - 25, 152);
    ctx.stroke();
    ctx.fillStyle = '#dccdaa';
    ctx.fillRect(4, h - 22, w - 8, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(34, h - 30);
    ctx.lineTo(70, 88);
    ctx.lineTo(86, 88);
    ctx.lineTo(50, h - 30);
    ctx.closePath();
    ctx.fill();
  });
}

// 遮阳篷条纹布
function awningTexture(key, a, b, stripes = 9) {
  return tex('awn:' + key, 512, 256, (ctx, w, h) => {
    ctx.fillStyle = css(b);
    ctx.fillRect(0, 0, w, h);
    const sw = w / stripes;
    ctx.fillStyle = css(a);
    for (let i = 0; i < stripes; i += 2) ctx.fillRect(Math.floor(i * sw), 0, Math.ceil(sw), h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(56,42,26,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < stripes; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / stripes, 0);
      ctx.lineTo((i * w) / stripes, h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(252,244,224,0.6)';
    ctx.fillRect(0, h - 12, w, 12);
    const r = rng(key.length * 31 + 5);
    for (let i = 0; i < 22; i++) {
      ctx.fillStyle = `rgba(70,55,35,${(0.02 + r() * 0.035).toFixed(3)})`;
      ctx.fillRect(r() * w, r() * h, 4 + r() * 16, 2 + r() * 4);
    }
  });
}

// 扇贝形帷幔（带 alpha）
function valanceTexture(key, a, b, scallops = 10) {
  return tex('val:' + key, 512, 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const sw = w / scallops;
    for (let i = 0; i < scallops; i++) {
      ctx.fillStyle = css(i % 2 ? b : a);
      ctx.beginPath();
      ctx.moveTo(i * sw, 0);
      ctx.lineTo((i + 1) * sw, 0);
      ctx.lineTo((i + 1) * sw, h * 0.52);
      ctx.arc(i * sw + sw / 2, h * 0.52, sw / 2, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = 'rgba(60,45,30,0.12)';
    ctx.fillRect(0, h * 0.52 - 4, w, 4);
  });
}

// 竹编纹理
function basketTexture() {
  return tex('basket', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c49a62';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      ctx.fillStyle = y % 16 === 0 ? '#d2ab74' : '#b98d55';
      ctx.fillRect(0, y, w, 5);
      ctx.fillStyle = 'rgba(80,55,30,0.18)';
      ctx.fillRect(0, y + 5, w, 1);
    }
    for (let x = 0; x < w; x += 12) {
      ctx.fillStyle = 'rgba(95,65,35,0.16)';
      ctx.fillRect(x, 0, 2, h);
    }
    ctx.fillStyle = '#a67b48';
    ctx.fillRect(0, 0, w, 7);
    ctx.fillStyle = 'rgba(255,240,205,0.2)';
    ctx.fillRect(0, 0, w, 2);
  }, { wrap: true });
}

// 门边挂的辣椒串 / 玉米串
function chiliTexture(corn = false) {
  return tex(corn ? 'corn' : 'chili', 96, 384, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#8a6a45';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    for (let i = 0; i < 13; i++) {
      const y = 22 + i * 27;
      const x = w / 2 + (i % 2 ? 12 : -12);
      if (corn) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((i % 2 ? 0.22 : -0.22) + 0.1);
        ctx.fillStyle = i % 3 === 0 ? '#f2cf6a' : '#e9b94f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 17, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(150,100,30,0.35)';
        for (let k = -1; k <= 1; k++) ctx.fillRect(-6, k * 6, 12, 1);
        ctx.restore();
        ctx.fillStyle = '#7fa25a';
        ctx.beginPath();
        ctx.ellipse(x + 7, y - 15, 8, 4, 0.5, 0, TAU);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((i % 2 ? 0.55 : -0.55) + 0.1);
        ctx.fillStyle = i % 4 === 0 ? '#d14535' : i % 3 === 0 ? '#b83226' : '#e2593f';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 16, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#5f8a45';
        ctx.beginPath();
        ctx.ellipse(x + (i % 2 ? 8 : -8), y - 14, 7, 3.5, 0.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#6b4a33';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w / 2, 6, 8, 0, TAU);
    ctx.stroke();
  });
}

// 晾衣绳上的衣物（透明背景，alphaTest 裁切）
function clothTexture(kind, color) {
  return tex('cloth:' + kind + color, 160, 190, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const c = css(color);
    if (kind === 'quilt') {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 4;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(8 + ((w - 16) * i) / 5, 8);
        ctx.lineTo(8 + ((w - 16) * i) / 5, h - 8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(8, 8 + ((h - 16) * i) / 5);
        ctx.lineTo(w - 8, 8 + ((h - 16) * i) / 5);
        ctx.stroke();
      }
      const r = rng(color % 977 + 3);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(214,90,80,0.75)' : 'rgba(255,246,220,0.8)';
        ctx.beginPath();
        ctx.arc(16 + r() * (w - 32), 16 + r() * (h - 32), 2 + r() * 3, 0, TAU);
        ctx.fill();
      }
    } else if (kind === 'shirt') {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(46, 38, 68, 128, 10);
      ctx.fill();
      ctx.save();
      ctx.translate(46, 52);
      ctx.rotate(-0.55);
      ctx.beginPath();
      ctx.roundRect(-22, 0, 24, 62, 8);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(114, 52);
      ctx.rotate(0.55);
      ctx.beginPath();
      ctx.roundRect(-2, 0, 24, 62, 8);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,250,236,0.85)';
      ctx.beginPath();
      ctx.ellipse(80, 42, 15, 6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(80, 62 + i * 24, 2.6, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(46, 150, 68, 5);
    } else if (kind === 'pants') {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(44, 24, 72, 34, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(46, 54, 30, 116, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(84, 54, 30, 116, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(46, 54, 68, 4);
    } else {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(24, 30, 112, 100, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(24, 52, 112, 12);
      ctx.fillRect(24, 96, 112, 8);
      ctx.fillStyle = 'rgba(60,70,60,0.2)';
      ctx.fillRect(24, 120, 112, 2);
    }
  });
}

// 小黑板菜单（粉笔字）
function chalkTexture(line1, line2, line3) {
  return tex('chalk:' + line1 + line2 + line3, 256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#2f3e36';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b98a55';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#f4ead2';
    ctx.textAlign = 'center';
    ctx.font = `900 44px ${CN_FONT}`;
    ctx.fillText(line1, w / 2, 64);
    ctx.strokeStyle = 'rgba(244,234,210,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(52, 82);
    ctx.lineTo(w - 52, 82);
    ctx.stroke();
    ctx.font = `700 27px ${CN_FONT}`;
    ctx.fillText(line2, w / 2, 116);
    ctx.fillStyle = '#f2d06b';
    ctx.fillText(line3, w / 2, 154);
    const r = rng(line1.length * 7 + 1);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  });
}

// 远景民居立面
function villageFacadeTexture(variant) {
  return tex('village' + variant, 128, 160, (ctx, w, h) => {
    const walls = ['#e2c39a', '#d3d9c6', '#e6c49a'];
    ctx.fillStyle = walls[variant % walls.length];
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, 20);
    g.addColorStop(0, 'rgba(66,58,45,0.4)');
    g.addColorStop(1, 'rgba(66,58,45,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 20);
    ctx.fillStyle = 'rgba(120,115,100,0.4)';
    ctx.fillRect(0, h - 26, w, 26);
    ctx.fillStyle = '#5a3d2a';
    ctx.fillRect(w * 0.42, h * 0.6, w * 0.16, h * 0.32);
    ctx.fillStyle = '#384744';
    ctx.fillRect(w * 0.13, h * 0.36, w * 0.16, h * 0.15);
    ctx.fillRect(w * 0.7, h * 0.36, w * 0.16, h * 0.15);
    ctx.fillStyle = 'rgba(255,205,120,0.55)';
    ctx.fillRect(w * 0.71, h * 0.37, w * 0.14, h * 0.13);
    ctx.strokeStyle = 'rgba(240,230,210,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.13, h * 0.36, w * 0.16, h * 0.15);
    ctx.strokeRect(w * 0.7, h * 0.36, w * 0.16, h * 0.15);
  });
}

// 小三角彩旗
function pennantTexture(color) {
  return tex('pennant' + color, 64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.moveTo(3, 3);
    ctx.lineTo(w - 3, 3);
    ctx.lineTo(w / 2, h - 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(3, 3, w - 6, 5);
  });
}

// 菜筐手写价签
function priceTagTexture(text) {
  return tex('price:' + text, 128, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fbf3dc';
    ctx.fillRect(2, 2, w - 4, h - 4);
    ctx.strokeStyle = '#d9534f';
    ctx.lineWidth = 4;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#24372f';
    ctx.font = `900 30px ${CN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
}

// 炉火
function fireTexture() {
  return tex('fire', 64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h * 0.7, 2, w / 2, h * 0.7, w * 0.5);
    g.addColorStop(0, 'rgba(255,238,170,1)');
    g.addColorStop(0.35, 'rgba(255,170,60,0.95)');
    g.addColorStop(0.75, 'rgba(220,70,30,0.65)');
    g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.7, w * 0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(60,24,12,0.85)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(6 + i * 14, h - 12, 10, 8);
    }
  });
}

/* ================================= 招牌 ================================= */

const SHOP_SIGNS = [
  { t: '老街面馆', sub: '牛肉面 · 抄手', bg: C.signRed, fg: 0xfff2d6, side: '面馆' },
  { t: '王记烧烤', sub: '烤鱼 · 冰啤', bg: 0x2f3a35, fg: C.yellowBright, side: '烧烤' },
  { t: '24H便利店', sub: '冷饮 · 热食', bg: C.signBlue, fg: 0xf6f2e6, side: '便利' },
  { t: '姐妹理发', sub: '剪发 · 烫染', bg: C.signMint, fg: 0x1f4a3e, side: '理发' },
  { t: '农药种子', sub: '化肥 · 农具', bg: C.signGreen, fg: 0xf6edcf, side: '种子' },
  { t: '快递驿站', sub: '取件 · 寄件', bg: C.signOrange, fg: 0x3a2a16, side: '快递' },
  { t: '兴隆小卖部', sub: '烟酒 · 副食', bg: C.signCream, fg: 0x24372f, side: '小卖' },
  { t: '阿婆凉茶', sub: '龟苓膏 · 绿豆沙', bg: C.signBlue, fg: 0xfff1cf, side: '凉茶' },
];
const SHOP_WALLS = [C.plaster, C.plaster2, C.cream, 0xdfe3d0, 0xe6d9c2, 0xd9e0d3];
const SHOP_ROOFS = [C.terracotta, 0x6d7671, 0x8a5a45, 0x5f6b68, 0xb85b42];
const SHOP_AWNINGS = [
  [C.mint, 0xf7f2e7],
  [C.red, 0xf7e6cf],
  [C.blue, 0xf2ead8],
  [C.signMint, 0xfbf5e6],
];

/* ================================= 远景 ================================= */

/**
 * 远景屋顶群 + 山丘（80m 宽 × 约 12.4m 高，低模，配合雾使用）
 * 内容向 -Z 延伸约 22–56m：摆放时放在街道后方（例如 z = -40）。
 * opts: { seed }
 */
export function townBackdrop(opts = {}) {
  const seed = opts.seed ?? 17;
  const r = rng(seed * 131 + 7);
  const g = new THREE.Group();
  const W = 80;

  // 两层薄片远山（雾里做剪影）
  addRidge(g, W, 14.6, -64, 0x9ab8b0, seed + 1, 10);
  addRidge(g, W, 13.2, -54, 0x7fa892, seed + 2, 12);
  addRidge(g, W - 6, 9.8, -43, 0x97bda4, seed + 5, 10);

  // 屋顶群：前后两排
  const wallTex = [0, 1, 2].map((v) => villageFacadeTexture(v));
  const roofCols = [C.terracotta, 0x5f6a64, 0x9c5a3e, C.tile];
  for (let i = 0; i < 8; i++) {
    const back = i % 2 === 0;
    const x = -33 + i * 9.4 + (r() - 0.5) * 2.2;
    const z = back ? -35 - r() * 4 : -27 - r() * 2.5;
    const w = 5.4 + r() * 3.0;
    const d = 4.4 + r() * 2.2;
    const h = i === 3 ? 5.6 : i === 6 ? 2.9 : 3.2 + r() * 2.3;
    const wall = boxMesh(w, h, d, 0xffffff, { map: wallTex[(i + seed) % 3], roughness: 1 });
    put(g, wall, x, h / 2, z);
    const roof = gableRoof(w + 0.7, d + 1.0, 0.95 + r() * 0.4, roofCols[i % roofCols.length], 0.25);
    put(g, roof, x, h + 0.03, z);
    // 树影（两团，像竹林边）
    if (i === 2 || i === 6) {
      put(g, coneMesh(1.5 + r() * 0.4, 3.4 + r() * 0.8, C.leafDark, { segments: 5 }), x - 3.2, h + 1.7, z - 1.6);
      put(g, coneMesh(1.0 + r() * 0.3, 2.2 + r() * 0.5, C.leaf1, { segments: 5 }), x - 4.0, h + 0.6, z - 1.0);
    }
  }

  // 远处高架/渡槽剪影
  put(g, boxMesh(40, 0.7, 1.1, 0xa8b8ae, { roughness: 1 }), 12, 7.4, -54);
  put(g, boxMesh(1.3, 7.2, 1.3, 0xa2b2a8, { roughness: 1 }), 3, 3.6, -54);

  return g;
}

function addRidge(parent, width, height, z, color, seed, segs = 10) {
  const r = rng(seed * 53 + 11);
  const n = Math.max(6, segs);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = -width / 2 + t * width;
    const bell = Math.sin(t * Math.PI) ** 1.15;
    const y = height * (0.22 + 0.78 * bell) * (0.74 + r() * 0.32);
    pts.push([x, y]);
  }
  const p = [];
  const z0 = z;
  const z1 = z - 4.5;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    p.push(x0, 0, z0, x1, 0, z0, x1, y1, z1);
    p.push(x0, 0, z0, x1, y1, z1, x0, y0, z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(color, { flatShading: true, side: THREE.DoubleSide, roughness: 1 }));
  m.castShadow = false;
  parent.add(m);
  return m;
}

/* ================================= 骑楼店铺 ================================= */

/**
 * 两层骑楼店铺：敞开店面 + 卷帘门 + 条纹遮阳篷 + 中文招牌 + 二楼拱窗 + 弧面瓦顶。
 * opts: { seed, sign, sub, bg, fg, wall, roof, awning:[colorA,colorB], lanterns:false }
 */
export function shopHouse(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 100000);
  const info = opts.sign
    ? { t: opts.sign, sub: opts.sub ?? '', bg: opts.bg ?? C.signRed, fg: opts.fg ?? 0xfff2d6, side: opts.side ?? opts.sign.slice(0, 2) }
    : SHOP_SIGNS[seed % SHOP_SIGNS.length];
  const wallColor = opts.wall ?? SHOP_WALLS[(seed * 3 + 1) % SHOP_WALLS.length];
  const roofColor = opts.roof ?? SHOP_ROOFS[(seed * 7 + 2) % SHOP_ROOFS.length];
  const [awnA, awnB] = opts.awning ?? SHOP_AWNINGS[(seed * 5 + 3) % SHOP_AWNINGS.length];
  const g = new THREE.Group();

  const W = 5.2;
  const D = 3.4;
  const H1 = 2.9;
  const H2 = 2.25;
  const Y1 = 0.22;
  const Y2 = Y1 + H1;
  const front = D / 2;

  // 台基 + 一层墙（带灰泥颗粒）
  put(g, boxMesh(W + 0.14, 0.22, D + 0.14, C.concreteDark), 0, 0.11, 0);
  put(g, boxMesh(W, H1, D, 0xffffff, { map: plasterTexture(wallColor, seed), roughness: 0.96 }), 0, Y1 + H1 / 2, 0);

  // 店面：左敞开卖货，右卷帘门
  const shopX = -0.95;
  const interior = planeMesh(
    2.2,
    2.08,
    texMat('interior' + (seed % 3), shopInteriorTexture(seed % 3), {
      emissiveMap: shopInteriorTexture(seed % 3),
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
    })
  );
  put(g, interior, shopX, Y1 + 1.04, front + 0.012);

  const shutterTint = [0xffffff, 0xdfe7e2, 0xf0e2ca][seed % 3];
  const shutter = planeMesh(1.68, 2.14, texMat('shutter:' + (seed % 3), shutterTexture(), { color: shutterTint }));
  put(g, shutter, 1.34, Y1 + 1.07, front + 0.012);

  // 门口柜台（红布 + 两筐菜）
  put(g, boxMesh(2.0, 0.82, 0.5, C.woodLight), shopX, 0.41, front + 0.32);
  put(g, boxMesh(2.06, 0.05, 0.56, C.signRed), shopX, 0.845, front + 0.32);
  put(g, icoMesh(0.15, C.leaf2, { detail: 0 }), shopX - 0.32, 0.96, front + 0.33);
  // 柜台上手写价签
  put(
    g,
    planeMesh(0.34, 0.21, texMat('counterTag:' + (seed % 3), chalkTexture('今日青菜', '2元一把', ''), { side: THREE.DoubleSide })),
    shopX + 0.62,
    0.96,
    front + 0.6,
    -0.16
  );

  // 条纹遮阳篷 + 扇贝帷幔 + 檐杆
  const awnKey = `${awnA}|${awnB}|${seed}`;
  const awning = planeMesh(
    4.7,
    1.15,
    mat(0xffffff, { map: awningTexture(awnKey, awnA, awnB, 9), side: THREE.DoubleSide })
  );
  awning.castShadow = true;
  put(g, awning, 0, 2.92, 1.95, -0.3);
  const valance = planeMesh(
    4.7,
    0.3,
    texMat('val:' + awnKey, valanceTexture(awnKey, awnA, awnB, 10), {
      side: THREE.DoubleSide,
      alphaTest: 0.4,
    })
  );
  put(g, valance, 0, 2.37, 2.1);
  put(g, boxMesh(4.72, 0.07, 0.07, C.woodDark), 0, 2.37, 2.1);

  // 骑楼柱（撑起二层出檐）
  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.17, 3.1, 0.17, C.wood), sx * 2.33, 1.55, 2.02);
  }

  // 中式灯笼
  if (opts.lanterns !== false) {
    lanternMesh(g, -1.85, 2.35, 2.02, 0.8, false);
    lanternMesh(g, 1.85, 2.35, 2.02, 0.8, false);
  }

  // 二层墙 + 拱窗 + 招牌
  put(g, boxMesh(5.74, 0.2, 3.2, C.offwhite), 0, Y2 + 0.1, 0);
  put(g, boxMesh(5.7, H2, 3.0, 0xffffff, { map: plasterTexture(wallColor, seed), roughness: 0.96 }), 0, Y2 + 0.2 + H2 / 2, 0);
  const winMtl = texMat('win', windowTexture(), {
    side: THREE.DoubleSide,
    alphaTest: 0.35,
    emissiveMap: windowTexture(),
    emissive: 0xffffff,
    emissiveIntensity: 0.14,
  });
  put(g, planeMesh(1.12, 1.28, winMtl), -1.28, Y2 + 1.62, 1.512);
  put(g, planeMesh(1.12, 1.28, winMtl), 1.28, Y2 + 1.62, 1.512);
  // 门头招牌
  const sign = signPlane(info.t, {
    w: 3.6,
    h: 0.8,
    bg: info.bg,
    fg: info.fg,
    sub: info.sub,
    texW: 640,
    texH: 148,
    radius: 14,
  });
  put(g, sign, 0, Y2 + 0.73, 1.62);

  // 侧挂竖招
  const bannerBg = info.bg === C.signCream ? C.signRed : info.bg;
  const sideSign = bannerPlane(info.side ?? '小店', { w: 0.42, h: 1.5, bg: bannerBg, fg: info.fg });
  put(g, sideSign, 2.95, Y2 + 1.25, 1.9, 0, Math.PI / 2, 0);
  put(g, boxMesh(0.24, 0.05, 0.05, C.metalDark), 2.84, Y2 + 2.03, 1.9);

  // 墙面小物：辣椒串、玉米串、福字
  put(g, planeMesh(0.28, 1.05, texMat('chili', chiliTexture(false), { side: THREE.DoubleSide, alphaTest: 0.35 })), -2.34, 2.12, front + 0.03);
  put(g, planeMesh(0.28, 1.05, texMat('corn', chiliTexture(true), { side: THREE.DoubleSide, alphaTest: 0.35 })), 2.3, 2.1, front + 0.03);
  const fu = signPlane('福', { w: 0.32, h: 0.32, bg: C.signRed, fg: 0xffe2a1, texW: 128, texH: 128 });
  put(g, fu, 0.42, 2.3, front + 0.03, 0, 0, Math.PI / 4);

  // 弧面瓦顶
  const roofBase = Y2 + 0.2 + H2;
  put(g, gableWallMesh(5.7, 4.3, 0.95, wallColor, seed), 0, roofBase, 0);
  put(g, roofMesh(5.9, 4.3, 0.95, roofColor), 0, roofBase, 0);
  // 檐底米白望板（挡住瓦顶背面，避免侧面一片黑）
  put(g, planeMesh(5.86, 4.26, mat(C.cream, { side: THREE.DoubleSide, roughness: 0.92 })), 0, roofBase + 0.17, 0, Math.PI / 2);
  put(g, boxMesh(6.0, 0.16, 0.24, C.tileDark), 0, roofBase + 0.92, 0);
  put(g, boxMesh(5.95, 0.16, 0.14, C.offwhite), 0, roofBase + 0.06, 2.1);

  addShadow(g, 5.9, 4.4, 0.5);
  return g;
}

/* ================================= 菜摊 ================================= */

/**
 * 菜摊：木桌 + 竹筐蔬果 + 条纹遮阳棚 + 黑板价目。
 * opts: { seed, awning:[colorA,colorB] }
 */
export function marketStall(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 100000);
  const g = new THREE.Group();
  const [awnA, awnB] = opts.awning ?? SHOP_AWNINGS[(seed * 3 + 1) % SHOP_AWNINGS.length];
  const W = 2.6;
  const D = 1.15;

  // 桌面 + 侧板桌腿
  put(g, boxMesh(W, 0.1, D, C.woodLight), 0, 0.82, 0);
  put(g, boxMesh(0.09, 0.8, D - 0.12, C.woodDark), -W / 2 + 0.12, 0.4, 0);
  put(g, boxMesh(0.09, 0.8, D - 0.12, C.woodDark), W / 2 - 0.12, 0.4, 0);
  // 前挡布
  const clothKey = 'stall:' + awnA + ':' + awnB;
  put(
    g,
    planeMesh(
      W - 0.2,
      0.62,
      texMat('val:' + clothKey, valanceTexture(clothKey, awnA, awnB, 8), {
        side: THREE.DoubleSide,
        alphaTest: 0.4,
      })
    ),
    0,
    0.52,
    D / 2 + 0.02
  );

  // 四根竹柱 + 顶篷
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(g, cylMesh(0.04, 0.05, 2.05, C.woodDark, { segments: 5 }), sx * (W / 2 + 0.08), 1.025, sz * (D / 2 - 0.12));
    }
  }
  const cantKey = 'stall:' + awnA + ':' + awnB;
  const canopy = planeMesh(
    2.92,
    1.32,
    mat(0xffffff, { map: awningTexture(cantKey, awnA, awnB, 10), side: THREE.DoubleSide })
  );
  canopy.castShadow = true;
  put(g, canopy, 0, 1.98, 0.03, -0.22);
  const cval = planeMesh(
    2.92,
    0.26,
    texMat('val:' + cantKey, valanceTexture(cantKey, awnA, awnB, 10), {
      side: THREE.DoubleSide,
      alphaTest: 0.4,
    })
  );
  put(g, cval, 0, 1.69, 0.66);
  put(g, boxMesh(2.92, 0.05, 0.05, C.woodDark), 0, 1.77, 0.63);

  // 竹筐 + 蔬果
  const sets = [
    [C.leaf2, C.leaf1, C.leaf3],
    [C.red, C.redDark, C.orange],
    [C.orange, C.yellow, C.yellowBright],
  ];
  const bx = [-0.78, 0, 0.78];
  for (let i = 0; i < 3; i++) {
    put(g, cylMesh(0.3 - i * 0.015, 0.23, 0.3, 0xffffff, { segments: 5, map: basketTexture() }), bx[i], 0.98, 0.08);
    const n = i === 0 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const pr = icoMesh(0.115 + ((i + k) % 2) * 0.02, sets[i][k % 3], { detail: 0 });
      put(g, pr, bx[i] + (k - (n - 1) / 2) * 0.13, 1.16 + (k % 2) * 0.03, 0.08 + (k % 2) * 0.06);
    }
  }

  // 桌下杂物
  put(g, boxMesh(0.46, 0.28, 0.4, C.offwhite), 0.86, 0.14, -0.2, 0, 0.12, 0);

  // 黑板价目牌斜靠桌沿
  const boards = [
    ['本地青菜', '2元一把', '今早现摘'],
    ['沙瓤番茄', '3元一斤', '自家种的'],
    ['土鸡蛋', '2元一个', '散养土鸡'],
  ];
  const [l1, l2, l3] = boards[seed % boards.length];
  put(
    g,
    planeMesh(0.66, 0.48, texMat('chalk:' + l1, chalkTexture(l1, l2, l3), { side: THREE.DoubleSide })),
    1.08,
    0.6,
    0.71,
    -0.16
  );

  addShadow(g, 3.1, 1.7, 0.45);
  return g;
}

/* ================================= 低棚（滑铲） ================================= */

/**
 * 横跨车道的布篷低棚：下沿 1.35m，需要滑铲；宽 5.2m。
 * opts: { seed, color }
 */
export function awningGate(opts = {}) {
  const seed = opts.seed ?? 4;
  const r = rng(seed * 43 + 5);
  const g = new THREE.Group();
  const H = 1.35;
  const TOP = 2.38;
  const W = 5.2;

  for (const sx of [-1, 1]) {
    put(g, cylMesh(0.06, 0.075, TOP, C.woodDark, { segments: 6 }), sx * (W / 2 - 0.12), TOP / 2, 0);
    put(g, cylMesh(0.16, 0.19, 0.12, C.concreteDark, { segments: 6 }), sx * (W / 2 - 0.12), 0.06, 0);
    put(g, cylMesh(0.035, 0.035, 1.4, C.wood, { segments: 5 }), sx * (W / 2 - 0.3), 0.7, 0.06, 0, 0, -sx * 0.36);
  }
  // 顶杆（用 put 的 rz，别先转再 put）
  const bar = cylMesh(0.045, 0.045, W, C.woodDark, { segments: 6 });
  put(g, bar, 0, TOP, 0, 0, 0, Math.PI / 2);

  const a = opts.color ?? C.signRed;
  const b = 0xf7ead2;
  const key = 'gate:' + a;
  const cloth = planeMesh(
    W - 0.1,
    TOP - H,
    mat(0xffffff, { map: awningTexture(key, a, b, 11), side: THREE.DoubleSide })
  );
  cloth.castShadow = true;
  put(g, cloth, 0, (TOP + H) / 2, 0.02);
  const back = planeMesh(
    W - 0.5,
    0.84,
    mat(0xffffff, { map: awningTexture(key + 'b', 0xf3e6c8, 0xfff7e6, 8), side: THREE.DoubleSide })
  );
  back.castShadow = true;
  put(g, back, 0, (TOP + H) / 2 + 0.04, -0.14);

  // 下沿竹竿，让布看起来是张紧的
  const lower = cylMesh(0.025, 0.025, W - 0.2, C.wood, { segments: 5 });
  put(g, lower, 0, H, 0.02, 0, 0, Math.PI / 2);

  // 顶部三角彩旗（从顶杆垂下）
  const colors = [C.red, C.yellow, C.mint, C.blue, C.orange, C.red];
  for (let i = 0; i < 6; i++) {
    const flag = planeMesh(
      0.3,
      0.34,
      texMat('pennant' + colors[i], pennantTexture(colors[i]), { side: THREE.DoubleSide, alphaTest: 0.4 })
    );
    put(
      g,
      flag,
      -1.65 + i * 0.66,
      TOP - 0.19,
      0.075 + (r() - 0.5) * 0.02,
      0,
      (r() - 0.5) * 0.12,
      (r() - 0.5) * 0.08
    );
  }

  // 中间挂“小心碰头”小牌
  const sign = signPlane('小心碰头', {
    w: 1.3,
    h: 0.38,
    bg: C.yellowBright,
    fg: 0x24372f,
    texW: 512,
    texH: 150,
    radius: 10,
  });
  put(g, sign, 0, 1.86, 0.09);
  put(g, boxMesh(0.014, 0.32, 0.014, C.woodDark), -0.45, 2.17, 0.04);
  put(g, boxMesh(0.014, 0.32, 0.014, C.woodDark), 0.45, 2.17, 0.04);

  return g;
}

/* ================================= 三轮车 ================================= */

/**
 * 载货三轮车（障碍）：宽 1.8m × 长 2.8m × 高 1.6m，车头朝 +Z。
 * opts: { seed, cab: color }
 */
export function tricycle(opts = {}) {
  const seed = opts.seed ?? 6;
  const g = new THREE.Group();
  const cabColor = opts.cab ?? [0x3f6f5a, 0x2f5a72, 0x7a4a3a][seed % 3];

  // 车斗（略低的木箱）
  put(g, boxMesh(1.78, 0.4, 1.55, C.wood), 0, 0.72, -0.62);
  put(g, boxMesh(1.82, 0.07, 1.6, C.woodLight), 0, 0.94, -0.62);
  put(g, boxMesh(1.78, 0.32, 0.06, C.woodDark), 0, 0.86, -1.4);

  // 驾驶室：下箱 + 上箱 + 顶盖（阶梯形，不像大箱子）
  put(g, boxMesh(1.02, 0.72, 0.94, cabColor), 0, 0.52, 0.9);
  put(g, boxMesh(0.96, 0.62, 0.86, cabColor), 0, 1.19, 0.88);
  put(g, boxMesh(1.06, 0.1, 0.96, cabColor), 0, 1.55, 0.86);
  const glass = mat(0xcfe6ee, { transparent: true, opacity: 0.36, roughness: 0.2, metalness: 0.15 });
  put(g, planeMesh(0.84, 0.42, glass), 0, 1.2, 1.315, 0.08);
  put(g, planeMesh(0.56, 0.32, glass), 0.485, 1.2, 0.88, 0, Math.PI / 2, 0);
  put(g, planeMesh(0.56, 0.32, glass), -0.485, 1.2, 0.88, 0, Math.PI / 2, 0);
  // 前灯 + 保险杠 + 前叉
  const head = new THREE.Mesh(circleGeo(0.09, 8), mat(0xfff0c0, { emissive: 0xffd58a, emissiveIntensity: 0.6 }));
  put(g, head, 0, 0.62, 1.375);
  put(g, boxMesh(0.94, 0.12, 0.1, C.metalDark), 0, 0.26, 1.3);
  put(g, boxMesh(0.07, 0.6, 0.07, C.metalDark), 0, 0.52, 1.2, 0.3);

  // 三个轮子（前轮从车头下探出来）
  wheels(g, 0, 0.33, 1.12, 0.33, 0.16);
  wheels(g, -0.72, 0.33, -0.95, 0.33, 0.18);
  wheels(g, 0.72, 0.33, -0.95, 0.33, 0.18);

  // 车斗货物：木箱 + 两颗白菜
  put(g, boxMesh(0.58, 0.38, 0.52, C.woodLight), -0.42, 1.06, -0.6, 0, 0.12, 0);
  put(g, icoMesh(0.15, C.leaf2, { detail: 0 }), -0.42, 1.32, -0.6);
  put(g, icoMesh(0.13, C.leaf3, { detail: 0 }), 0.28, 1.1, -0.85);

  // 尾板红布条
  put(
    g,
    planeMesh(0.3, 0.2, texMat('pennant' + C.red, pennantTexture(C.red), { side: THREE.DoubleSide, alphaTest: 0.4 })),
    0.4,
    0.86,
    -1.44,
    0,
    0.12,
    0
  );

  addShadow(g, 1.84, 2.9, 0.55);
  return g;
}

/* ================================= 菜筐（跳跃） ================================= */

/**
 * 菜筐：0.5m 高，可跳；竹编筐 + 时令菜 + 手写价签。
 * opts: { seed, produce: color }
 */
export function produceBasket(opts = {}) {
  const seed = opts.seed ?? 2;
  const r = rng(seed * 19 + 7);
  const g = new THREE.Group();
  const colors = [C.leaf2, C.red, C.orange, C.yellow, C.leaf3];
  const main = opts.produce ?? colors[seed % colors.length];

  const bk = cylMesh(0.29, 0.22, 0.3, 0xffffff, { segments: 7, map: basketTexture() });
  put(g, bk, 0, 0.15, 0);
  // 提手（顶部条在 0.5m 内）
  put(g, boxMesh(0.03, 0.24, 0.03, C.woodDark), -0.2, 0.36, 0.02, 0, 0, 0.16);
  put(g, boxMesh(0.03, 0.24, 0.03, C.woodDark), 0.2, 0.36, 0.02, 0, 0, -0.16);
  put(g, boxMesh(0.43, 0.035, 0.035, C.woodDark), 0, 0.48, 0.02);
  // 菜
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + seed;
    put(g, icoMesh(0.09 + r() * 0.025, i === 0 ? main : colors[(i + seed) % colors.length], { detail: 0 }), Math.cos(a) * 0.13, 0.37 + (i % 2) * 0.04, Math.sin(a) * 0.13);
  }
  const leaf = icoMesh(0.09, C.leaf1, { detail: 0 });
  leaf.scale.set(0.75, 0.4, 1.15);
  put(g, leaf, 0.04, 0.42, 0.02, 0, 0.6, 0.2);
  // 手写价签挂在筐前
  put(
    g,
    planeMesh(0.25, 0.11, texMat('price:' + seed, priceTagTexture(seed % 2 ? '2元/把' : '3元/斤'), { side: THREE.DoubleSide })),
    0.02,
    0.22,
    0.275,
    0,
    0,
    -0.06
  );

  addShadow(g, 0.68, 0.68, 0.5);
  return g;
}

/* ================================= 灯笼串 ================================= */

/**
 * 跨街红灯笼串（灯笼拱）：宽 10m，挂 8–10 个灯笼，两端立杆；可轻摆。
 * 原点在路面，高约 5m；opts: { count: 8..10, span, sag, y, colors }
 */
export function lanternString(opts = {}) {
  const count = Math.max(8, Math.min(10, opts.count ?? 9));
  const span = opts.span ?? 10;
  const sag = opts.sag ?? 0.75;
  const topY = opts.y ?? 5.0;
  const g = new THREE.Group();
  const half = span / 2;

  // 两端立杆 + 石础
  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.3, 0.14, 0.3, C.concrete), sx * half, 0.07, 0);
    put(g, cylMesh(0.055, 0.09, topY + 0.12, C.wood, { segments: 6 }), sx * half, (topY + 0.12) / 2, 0);
    put(g, coneMesh(0.11, 0.18, C.redDark, { segments: 5 }), sx * half, topY + 0.2, 0);
  }

  // 绳子
  g.add(
    catenary(
      new THREE.Vector3(-half, topY, 0),
      new THREE.Vector3(half, topY, 0),
      sag,
      C.woodDark,
      20,
      1
    )
  );

  const colors = opts.colors ?? [C.red, C.red, 0xe4574c, C.orange];
  const pivots = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = -half + span * t;
    const y = topY - Math.sin(Math.PI * t) * sag - 0.01;
    const p = lanternMesh(g, x, y, 0, 1.0, true, colors[i % colors.length]);
    pivots.push({ p, phase: i * 0.8 });
    // 吊线
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y + 0.02, 0), new THREE.Vector3(x, y + 0.18, 0)]),
      new THREE.LineBasicMaterial({ color: C.woodDark })
    ));
  }
  // 两端小彩旗
  put(
    g,
    planeMesh(0.32, 0.36, texMat('pennant' + C.yellow, pennantTexture(C.yellow), { side: THREE.DoubleSide, alphaTest: 0.4 })),
    -half + 0.62,
    topY - 0.3,
    0,
    0,
    0,
    0.2
  );
  put(
    g,
    planeMesh(0.32, 0.36, texMat('pennant' + C.red, pennantTexture(C.red), { side: THREE.DoubleSide, alphaTest: 0.4 })),
    half - 0.62,
    topY - 0.36,
    0,
    0,
    0,
    -0.2
  );

  g.userData.tick = (t) => {
    for (const { p, phase } of pivots) {
      p.rotation.z = Math.sin(t * 1.15 + phase) * 0.055;
      p.rotation.x = Math.cos(t * 0.85 + phase * 1.3) * 0.03;
    }
  };
  return g;
}

/* ================================= 乡镇牌坊 ================================= */

/**
 * 乡镇牌坊：约 6.3m 高、跨 10m，红柱 + 瓦顶 + “清河镇”横匾 + 对联。
 * opts: { name, sub, seed }
 */
export function townGate(opts = {}) {
  const seed = opts.seed ?? 8;
  const g = new THREE.Group();
  const W = 10.2;
  const colX = 4.75;
  const beamY = 4.95;

  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.66, 0.5, 0.66, C.concrete), sx * colX, 0.25, 0);
    put(g, cylMesh(0.22, 0.25, 5.15, C.signRed, { segments: 6 }), sx * colX, 0.5 + 5.15 / 2, 0);
  }
  // 横梁
  put(g, boxMesh(W, 0.42, 0.5, C.redDark), 0, beamY, 0);
  put(g, boxMesh(W - 0.6, 0.22, 0.62, C.signRed), 0, beamY + 0.34, 0);
  // 横匾
  put(g, boxMesh(3.14, 1.06, 0.12, C.redDark), 0, beamY + 0.02, 0.28);
  put(
    g,
    signPlane(opts.name ?? '清河镇', {
      w: 2.9,
      h: 0.92,
      bg: C.signRed,
      fg: 0xffe0a0,
      sub: opts.sub ?? '欢迎您',
      texW: 640,
      texH: 204,
      radius: 10,
    }),
    0,
    beamY + 0.02,
    0.35
  );

  // 中间弧面瓦顶 + 屋脊翘角
  put(g, roofMesh(5.1, 1.9, 0.85, C.tile), 0, beamY + 0.52, 0);
  put(g, boxMesh(5.2, 0.16, 0.24, C.tileDark), 0, beamY + 1.32, 0);
  put(g, boxMesh(0.46, 0.13, 0.2, C.tileDark), -2.55, beamY + 1.36, 0, 0, 0, 0.55);
  put(g, boxMesh(0.46, 0.13, 0.2, C.tileDark), 2.55, beamY + 1.36, 0, 0, 0, -0.55);
  // 两侧小顶（旋转 90° 让屋脊顺桥）
  for (const sx of [-1, 1]) {
    put(g, boxMesh(2.3, 0.3, 0.42, C.redDark), sx * 3.55, 3.72, 0);
    put(g, roofMesh(2.6, 1.5, 0.55, C.tile), sx * 3.55, 3.87, 0);
  }

  // 灯笼
  lanternMesh(g, -2.2, 4.1, 0.32, 1.15, true);
  lanternMesh(g, 2.2, 4.1, 0.32, 1.15, true);

  // 对联
  put(g, bannerPlane('五谷丰登', { w: 0.4, h: 2.0, bg: C.signRed, fg: 0xffe6a8 }), -colX, 2.55, 0.236);
  put(g, bannerPlane('六畜兴旺', { w: 0.4, h: 2.0, bg: C.signRed, fg: 0xffe6a8 }), colX, 2.55, 0.236);

  addShadow(g, 3.0, 1.2, 0.35);
  return g;
}

/* ================================= 停放的小电驴 ================================= */

/**
 * 停放的小电驴：长 1.8m，薄荷绿车身 + 前车筐 + 后货箱，车头朝 +Z。
 * opts: { seed, color }
 */
export function scooterParked(opts = {}) {
  const seed = opts.seed ?? 5;
  const g = new THREE.Group();
  const bodyColor = opts.color ?? C.mint;

  wheels(g, 0, 0.23, 0.62, 0.23, 0.1);
  wheels(g, 0, 0.23, -0.62, 0.23, 0.1);
  put(g, boxMesh(0.34, 0.1, 0.78, bodyColor), 0, 0.34, -0.04);
  put(g, boxMesh(0.38, 0.34, 0.6, bodyColor), 0, 0.5, -0.48);
  put(g, boxMesh(0.36, 0.12, 0.58, C.offwhite), 0, 0.72, -0.44);
  put(g, boxMesh(0.34, 0.13, 0.55, C.tire), 0, 0.84, -0.42);
  put(g, boxMesh(0.4, 0.62, 0.16, bodyColor), 0, 0.62, 0.36, -0.18);
  put(g, boxMesh(0.3, 0.28, 0.05, C.offwhite), 0, 0.72, 0.45, -0.18);
  const lamp = new THREE.Mesh(circleGeo(0.055, 8), mat(0xfff0c0, { emissive: 0xffd58a, emissiveIntensity: 0.5 }));
  put(g, lamp, 0, 0.86, 0.455, -0.18);
  put(g, boxMesh(0.07, 0.46, 0.07, C.metalDark), 0, 0.88, 0.4, -0.16);
  put(g, boxMesh(0.58, 0.06, 0.06, C.metalDark), 0, 1.1, 0.34);
  // 镜子（薄片省面数）
  put(g, planeMesh(0.1, 0.14, mat(C.metalDark, { side: THREE.DoubleSide })), 0.26, 1.28, 0.33);
  put(g, boxMesh(0.02, 0.2, 0.02, C.metalDark), 0.26, 1.16, 0.33);
  // 前车筐 + 菜
  put(g, boxMesh(0.34, 0.24, 0.24, 0xffffff, { map: basketTexture() }), 0, 0.9, 0.56);
  put(g, icoMesh(0.09, C.leaf2, { detail: 0 }), 0.06, 1.03, 0.56);
  put(g, icoMesh(0.08, C.orange, { detail: 0 }), -0.07, 1.02, 0.57);
  // 后货箱
  put(g, boxMesh(0.36, 0.28, 0.34, C.yellow), 0, 0.99, -0.62);
  put(g, boxMesh(0.38, 0.04, 0.36, C.yellowBright), 0, 1.14, -0.62);
  // 脚撑
  put(g, boxMesh(0.04, 0.34, 0.04, C.metalDark), -0.16, 0.16, -0.28, 0, 0, 0.32);

  addShadow(g, 0.75, 1.9, 0.5);
  return g;
}

/* ================================= 晾衣绳 ================================= */

/**
 * 晾衣绳：两根木杆 + 麻绳 + 衬衫/被子/裤子/毛巾，可轻摆。
 * 宽约 3.5m，高约 2.5m；原点在底面中心。
 */
export function laundryLine(opts = {}) {
  const seed = opts.seed ?? 3;
  const r = rng(seed * 17 + 9);
  const g = new THREE.Group();
  const half = 1.7;
  const topY = 2.35;
  const sag = 0.28;

  for (const sx of [-1, 1]) {
    put(g, cylMesh(0.05, 0.065, topY + 0.12, C.wood, { segments: 6 }), sx * half, (topY + 0.12) / 2, 0);
    put(g, boxMesh(0.48, 0.05, 0.05, C.woodDark), sx * half, topY, 0);
    put(g, boxMesh(0.12, 0.08, 0.12, C.woodDark), sx * half, 0.04, 0);
  }
  g.add(
    catenary(
      new THREE.Vector3(-half, topY, 0),
      new THREE.Vector3(half, topY, 0),
      sag,
      C.woodDark,
      12,
      1
    )
  );

  const cloths = [
    { kind: 'shirt', color: C.mint, w: 0.72, h: 0.82, x: -1.18 },
    { kind: 'quilt', color: 0xd9a6a0, w: 0.9, h: 1.0, x: -0.28 },
    { kind: 'pants', color: C.blue, w: 0.52, h: 0.92, x: 0.62 },
    { kind: 'towel', color: 0xf2d06b, w: 0.6, h: 0.55, x: 1.28 },
  ];
  const pivots = [];
  for (const c of cloths) {
    const t = (c.x + half) / (half * 2);
    const ropeY = topY - Math.sin(Math.PI * t) * sag;
    const pivot = new THREE.Group();
    pivot.position.set(c.x, ropeY, 0);
    g.add(pivot);
    const mtl = texMat('cloth:' + c.kind + c.color, clothTexture(c.kind, c.color), {
      side: THREE.DoubleSide,
      alphaTest: 0.35,
    });
    const m = planeMesh(c.w, c.h, mtl);
    m.position.y = -c.h / 2;
    pivot.add(m);
    for (const sx of [-1, 1]) {
      put(pivot, boxMesh(0.035, 0.07, 0.03, C.woodLight), sx * Math.min(0.18, c.w * 0.28), 0.02, 0.012);
    }
    pivots.push({ p: pivot, phase: r() * TAU, amp: 0.03 + r() * 0.025 });
  }
  g.userData.tick = (t) => {
    for (const { p, phase, amp } of pivots) {
      p.rotation.x = Math.sin(t * 0.9 + phase) * amp;
      p.rotation.z = Math.cos(t * 0.7 + phase) * amp * 0.5;
    }
  };
  addShadow(g, 3.6, 0.45, 0.3);
  return g;
}

/* ================================= 猫 ================================= */

/**
 * 猫：约 0.3m 高，橘猫坐姿，尾巴会摆。
 * opts: { color, seed }
 */
export function cat(opts = {}) {
  const seed = opts.seed ?? 4;
  const fur = opts.color ?? C.orange;
  const cream = 0xf6e3c0;
  const g = new THREE.Group();

  const body = icoMesh(0.095, fur, { detail: 0 });
  body.scale.set(0.95, 1.2, 1.05);
  put(g, body, 0, 0.115, -0.01);
  const chest = icoMesh(0.06, cream, { detail: 0 });
  chest.scale.set(0.9, 1.15, 0.7);
  put(g, chest, 0, 0.125, 0.058);
  const head = icoMesh(0.073, fur, { detail: 0 });
  head.scale.set(1.05, 0.95, 0.95);
  put(g, head, 0, 0.235, 0.033);
  put(g, coneMesh(0.03, 0.056, fur, { segments: 4 }), -0.047, 0.292, 0.033, 0, 0, 0.12);
  put(g, coneMesh(0.03, 0.056, fur, { segments: 4 }), 0.047, 0.292, 0.033, 0, 0, -0.12);
  put(g, coneMesh(0.016, 0.03, 0xd98a6d, { segments: 4 }), -0.047, 0.288, 0.048, 0.2, 0, 0.12);
  put(g, coneMesh(0.016, 0.03, 0xd98a6d, { segments: 4 }), 0.047, 0.288, 0.048, 0.2, 0, -0.12);
  put(g, boxMesh(0.013, 0.019, 0.01, 0x24372f), -0.029, 0.24, 0.095);
  put(g, boxMesh(0.013, 0.019, 0.01, 0x24372f), 0.029, 0.24, 0.095);
  put(g, coneMesh(0.011, 0.017, 0xd98a6d, { segments: 4 }), 0, 0.219, 0.103, Math.PI / 2, 0, 0);
  put(g, sphereMesh(0.027, cream, { segments: 5 }), -0.04, 0.027, 0.072);
  put(g, sphereMesh(0.027, cream, { segments: 5 }), 0.04, 0.027, 0.072);

  const tail = new THREE.Group();
  tail.position.set(0, 0.095, -0.085);
  g.add(tail);
  put(tail, cylMesh(0.021, 0.017, 0.16, fur, { segments: 5 }), 0, 0.04, -0.02, -0.5, 0, 0);
  put(tail, cylMesh(0.017, 0.012, 0.13, fur, { segments: 5 }), 0, 0.135, -0.095, -1.2, 0, 0.2);
  g.userData.tick = (t) => {
    tail.rotation.y = Math.sin(t * 1.6 + seed) * 0.3;
    tail.rotation.z = Math.sin(t * 1.1 + seed) * 0.08;
  };
  addShadow(g, 0.32, 0.38, 0.45);
  return g;
}

/* ================================= 水果立牌 ================================= */

/**
 * 水果摊小立牌：A 字木架 + 粉笔价目，0.9m 高；菜摊/水果摊的生活化配角。
 * opts: { seed }
 */
export function fruitSign(opts = {}) {
  const seed = opts.seed ?? 9;
  const g = new THREE.Group();
  const boards = [
    ['砂糖橘', '十元三斤', '甜过初恋'],
    ['本地草莓', '十五元两斤', '现摘现卖'],
    ['赣南脐橙', '五元一斤', '包甜'],
    ['香蕉', '三元一斤', '产地直发'],
  ];
  const [a, b, c] = boards[seed % boards.length];
  const mtlA = texMat('chalk:' + a, chalkTexture(a, b, c), { side: THREE.DoubleSide });
  const front = planeMesh(0.6, 0.76, mtlA);
  put(g, front, 0, 0.5, 0.16, -0.22);
  const back = planeMesh(0.6, 0.76, mtlA);
  put(g, back, 0, 0.5, -0.16, 0.22);
  for (const sx of [-1, 1]) {
    put(g, boxMesh(0.05, 0.86, 0.05, C.wood), sx * 0.32, 0.43, 0.18, -0.22);
    put(g, boxMesh(0.05, 0.86, 0.05, C.wood), sx * 0.32, 0.43, -0.18, 0.22);
  }
  put(g, boxMesh(0.68, 0.04, 0.36, C.woodDark), 0, 0.03, 0);
  // 一篮橘子
  put(g, cylMesh(0.18, 0.14, 0.2, 0xffffff, { segments: 6, map: basketTexture() }), 0.42, 0.1, 0.05);
  for (let i = 0; i < 3; i++) {
    put(g, icoMesh(0.075, C.orange, { detail: 0 }), 0.42 + Math.cos(i * 2.1) * 0.07, 0.22, 0.05 + Math.sin(i * 2.1) * 0.07);
  }
  addShadow(g, 0.95, 0.6, 0.4);
  return g;
}

/* ================================= 街边煤炉 ================================= */

/**
 * 街边小吃炉：煤炉 + 炒锅 + 碗筷 + 蒸汽，约 1.0m 高（蒸汽到 ~1.7m）。
 * opts: { seed }
 */
export function gasStove(opts = {}) {
  const seed = opts.seed ?? 2;
  const g = new THREE.Group();

  // 炉体 + 红搪瓷腰带
  put(g, cylMesh(0.29, 0.32, 0.52, C.metalDark, { segments: 7 }), 0, 0.26, 0);
  put(g, cylMesh(0.33, 0.33, 0.1, C.red, { segments: 7 }), 0, 0.34, 0);
  // 炉门火光
  const fire = new THREE.Mesh(circleGeo(0.12, 8), new THREE.MeshBasicMaterial({ map: fireTexture(), transparent: true, toneMapped: false }));
  put(g, fire, 0, 0.17, 0.305);
  // 炒锅 + 菜
  put(g, cylMesh(0.34, 0.18, 0.18, 0x3a3a38, { segments: 8 }), 0, 0.67, 0);
  put(g, icoMesh(0.15, C.leaf2, { detail: 0 }), 0, 0.77, 0.02);
  put(g, icoMesh(0.09, C.orange, { detail: 0 }), 0.12, 0.75, 0.05);
  // 锅铲
  put(g, boxMesh(0.05, 0.5, 0.03, C.wood), 0.3, 0.86, 0.02, 0, 0, -0.5);
  // 小桌 + 碗
  put(g, boxMesh(0.78, 0.08, 0.5, C.woodLight), 0.86, 0.8, 0.02);
  put(g, boxMesh(0.06, 0.76, 0.06, C.woodDark), 0.55, 0.4, 0);
  put(g, boxMesh(0.06, 0.76, 0.06, C.woodDark), 1.17, 0.4, 0);
  put(g, cylMesh(0.09, 0.06, 0.07, C.white, { segments: 6 }), 0.72, 0.87, 0.02);
  put(g, icoMesh(0.05, C.leaf2, { detail: 0 }), 0.72, 0.92, 0.02);
  // 小凳
  put(g, boxMesh(0.3, 0.06, 0.3, C.red), -0.62, 0.4, 0.4);
  put(g, boxMesh(0.05, 0.38, 0.05, C.woodDark), -0.74, 0.19, 0.28);
  put(g, boxMesh(0.05, 0.38, 0.05, C.woodDark), -0.5, 0.19, 0.28);
  put(g, boxMesh(0.05, 0.38, 0.05, C.woodDark), -0.62, 0.19, 0.52);

  // 蒸汽（两团交叉面片）
  const steam = [];
  for (let i = 0; i < 2; i++) {
    const p = steamPuffMesh(0.55, 0.34);
    p.position.set((i - 0.5) * 0.18, 0.95, 0.02);
    g.add(p);
    steam.push({ s: p, phase: i * 0.44 + seed * 0.13 });
  }
  g.userData.tick = (t) => {
    for (const { s, phase } of steam) {
      const p = (t * 0.3 + phase) % 1;
      s.position.y = 0.92 + p * 0.8;
      const k = 0.55 + p * 1.0;
      s.scale.set(k, k, k);
      s.userData.mat.opacity = 0.18 + (1 - p) * 0.32;
    }
  };
  addShadow(g, 1.9, 0.9, 0.4);
  return g;
}

/* ================================= 蒸汽 ================================= */

/**
 * 独立蒸汽/锅气：3 团半透明 sprite，向上飘并淡出；原点在底面中心。
 * opts: { size, count, rise }
 */
export function steamPuff(opts = {}) {
  const g = new THREE.Group();
  const count = opts.count ?? 3;
  const rise = opts.rise ?? 1.15;
  const size = opts.size ?? 0.55;
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const p = steamPuffMesh(size, 0.34);
    p.position.set((i - (count - 1) / 2) * size * 0.32, 0.12, (i % 2 ? 0.08 : -0.08));
    g.add(p);
    puffs.push({ s: p, phase: i / count });
  }
  g.userData.tick = (t) => {
    for (const { s, phase } of puffs) {
      const p = (t * 0.28 + phase) % 1;
      s.position.y = 0.12 + p * rise;
      const k = 0.55 + p * 1.05;
      s.scale.set(k, k, k);
      s.userData.mat.opacity = 0.16 + (1 - p) * 0.3;
    }
  };
  return g;
}

/* ================================= META ================================= */

// 米制尺寸 { w 宽, h 高, d 深 }（供 Lead 定义碰撞/摆放；按包围盒取整）
export const META = {
  shopHouse: { w: 6.0, h: 6.57, d: 4.52 },
  marketStall: { w: 3.1, h: 2.62, d: 1.7 },
  awningGate: { w: 5.3, h: 2.45, d: 0.4 },
  tricycle: { w: 1.85, h: 1.62, d: 2.9 },
  produceBasket: { w: 0.68, h: 0.5, d: 0.68 },
  lanternString: { w: 10.3, h: 5.3, d: 0.45 },
  townGate: { w: 10.2, h: 6.5, d: 1.9 },
  scooterParked: { w: 0.75, h: 1.36, d: 1.9 },
  laundryLine: { w: 3.9, h: 2.47, d: 0.47 },
  townBackdrop: { w: 80, h: 12.9, d: 45.4 },
  cat: { w: 0.32, h: 0.32, d: 0.38 },
  fruitSign: { w: 1.05, h: 0.9, d: 0.6 },
  gasStove: { w: 2.2, h: 1.3, d: 1.0 },
  steamPuff: { w: 1.0, h: 1.75, d: 0.9 },
};
