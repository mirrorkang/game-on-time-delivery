// entities.js — 障碍、奶茶、道具的模型、对象池、生成与碰撞
import * as THREE from 'three';
import { C, glowSprite, shadowTexture, basicMat, mat, canvasTexture, put, cylMesh, sphereMesh, torusMesh, boxMesh, signTexture, signBoard, icoMesh } from './artkit.js';
import * as NATURE from './props_nature.js';
import * as TOWN from './props_town.js';
import * as CITY from './props_city.js';
import { CFG, clamp } from './config.js';

const PROP_MODULES = { nature: NATURE, town: TOWN, city: CITY };

// 障碍定义：尺寸用于碰撞；prop 指向道具模块；harmful=是否扣头盔；
const DEFS = {
  rock:        { w: 1.35, d: 1.3, y0: 0, y1: 0.95, prop: ['nature', 'rockLarge'] },
  rockSmall:   { w: 0.95, d: 0.95, y0: 0, y1: 0.6, prop: ['nature', 'rockSmall'] },
  branch:      { w: 12.2, d: 0.55, y0: 1.32, y1: 2.7, prop: ['nature', 'branchGate'], gate: true },
  fence:       { w: 3.0, d: 0.4, y0: 0, y1: 1.05, prop: ['nature', 'woodFence'] },
  hayCart:     { w: 2.4, d: 1.8, y0: 0, y1: 1.55, prop: ['nature', 'hayCart'] },
  chicken:     { w: 0.55, d: 0.65, y0: 0, y1: 0.55, prop: ['nature', 'chicken'], critter: true },
  dog:         { w: 0.7, d: 1.0, y0: 0, y1: 0.75, prop: ['nature', 'dog'], critter: true },
  pothole:     { w: 1.9, d: 2.0, y0: 0, y1: 0.06, prop: ['nature', 'pothole'], hazard: true },
  puddle:      { w: 2.2, d: 2.3, y0: 0, y1: 0.05, prop: ['nature', 'mudPuddle'], hazard: true },
  awning:      { w: 11.5, d: 1.4, y0: 1.3, y1: 2.6, prop: ['town', 'awningGate'], gate: true },
  tricycle:    { w: 1.85, d: 3.0, y0: 0, y1: 1.65, prop: ['town', 'tricycle'] },
  basket:      { w: 0.75, d: 0.75, y0: 0, y1: 0.6, prop: ['town', 'produceBasket'] },
  cone:        { w: 0.62, d: 0.62, y0: 0, y1: 0.75, prop: ['city', 'cone'] },
  barrier:     { w: 2.4, d: 0.5, y0: 0, y1: 1.2, prop: ['city', 'constructionBarrier'] },
  car:         { w: 1.95, d: 4.4, y0: 0, y1: 1.55, prop: ['city', 'car'] },
  taxi:        { w: 1.95, d: 4.4, y0: 0, y1: 1.55, prop: ['city', 'taxi'] },
  bus:         { w: 2.7, d: 10.0, y0: 0, y1: 3.2, prop: ['city', 'bus'] },
  scooter:     { w: 0.95, d: 2.0, y0: 0, y1: 1.2, prop: ['city', 'deliveryScooter'] },
  flowerBed:   { w: 1.5, d: 2.6, y0: 0, y1: 0.6, prop: ['city', 'flowerBed'] },
  gantry:      { w: 12.2, d: 0.6, y0: 1.3, y1: 2.7, prop: null, gate: true },
  parcel:      { w: 1.1, d: 0.9, y0: 0, y1: 1.0, prop: null },
  roadSign:    { w: 1.0, d: 0.8, y0: 0, y1: 1.15, prop: null },
  barrel:      { w: 0.8, d: 0.8, y0: 0, y1: 0.95, prop: null },
  log:         { w: 1.9, d: 0.7, y0: 0, y1: 0.65, prop: null },
};

const FALLBACK_COLORS = {
  rock: C.rock, rockSmall: C.rockLight, branch: C.wood, fence: C.wood, hayCart: C.woodLight,
  chicken: 0xf4efe2, dog: 0xb98a55, pothole: 0x2e3132, puddle: 0x9fc4c0, awning: C.red,
  tricycle: C.mintDark, basket: C.orange, cone: C.orange, barrier: C.red, car: C.red, taxi: C.yellow,
  bus: C.blue, scooter: C.mint, flowerBed: C.leaf1,
};

function fallbackModel(kind) {
  const g = new THREE.Group();
  const color = FALLBACK_COLORS[kind] || 0xffffff;
  const def = DEFS[kind] || { w: 1, d: 1, y1: 1 };
  if (kind === 'pothole') {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), new THREE.MeshBasicMaterial({ color: 0x2b2c2e, transparent: true, opacity: 0.8 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.02; g.add(m);
    return g;
  }
  if (kind === 'puddle') {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.0, 18), new THREE.MeshBasicMaterial({ color: 0x9fc4c0, transparent: true, opacity: 0.75 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.025; g.add(m);
    return g;
  }
  if (kind === 'branch' || kind === 'awning') {
    const h = kind === 'branch' ? 1.4 : 1.3;
    const beam = boxMesh(def.w * 0.82, 0.28, def.d + 0.4, color);
    put(g, beam, 0, h + 0.2, 0);
    for (const s of [-1, 1]) {
      const post = boxMesh(0.16, h, 0.16, C.woodDark);
      put(g, post, s * (def.w / 2 - 0.4), h / 2, 0);
    }
    return g;
  }
  if (kind === 'car' || kind === 'taxi' || kind === 'bus' || kind === 'tricycle' || kind === 'scooter') {
    const body = boxMesh(def.w * 0.9, def.y1 * 0.55, def.d * 0.9, color, { radius: 0.16 });
    put(g, body, 0, def.y1 * 0.42, 0);
    const cabin = boxMesh(def.w * 0.7, def.y1 * 0.35, def.d * 0.45, C.glassDark, { radius: 0.12 });
    put(g, cabin, 0, def.y1 * 0.78, -def.d * 0.05);
    const wheelR = Math.min(0.34, def.y1 * 0.22);
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const wheel = cylMesh(wheelR, wheelR, 0.16, C.tire, { segments: 10 });
      wheel.rotation.z = Math.PI / 2;
      put(g, wheel, x * def.w * 0.42, wheelR, z * def.d * 0.3);
    }
    return g;
  }
  if (kind === 'cone') {
    put(g, boxMesh(0.55, 0.06, 0.55, color), 0, 0.03, 0);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 10), mat(color));
    put(g, cone, 0, 0.4, 0);
    const stripe = cylMesh(0.21, 0.25, 0.12, C.white, { segments: 10 });
    put(g, stripe, 0, 0.42, 0);
    return g;
  }
  if (kind === 'chicken' || kind === 'dog') {
    const r = kind === 'dog' ? 0.3 : 0.2;
    const body = kind === 'dog' ? boxMesh(0.32, 0.35, 0.75, color, { radius: 0.1 }) : sphereMesh(r, color, { segments: 8 });
    put(g, body, 0, kind === 'dog' ? 0.45 : 0.24, 0);
    const head = sphereMesh(kind === 'dog' ? 0.18 : 0.11, color, { segments: 8 });
    put(g, head, 0, kind === 'dog' ? 0.62 : 0.4, 0.16);
    return g;
  }
  if (kind === 'basket' || kind === 'flowerBed') {
    put(g, cylMesh(def.w * 0.5, def.w * 0.38, def.y1, color, { segments: 9 }), 0, def.y1 / 2, 0);
    for (let i = 0; i < 4; i++) put(g, sphereMesh(0.1, C.leaf2, { segments: 6 }), (Math.random() - 0.5) * def.w * 0.5, def.y1 + 0.06, (Math.random() - 0.5) * def.d * 0.5);
    return g;
  }
  const body = boxMesh(def.w * 0.8, def.y1, def.d * 0.7, color, { radius: 0.1 });
  put(g, body, 0, def.y1 / 2, 0);
  return g;
}

function getProp(kind, def) {
  if (!def.prop) return null;
  const [modName, fn] = def.prop;
  const mod = PROP_MODULES[modName];
  if (mod && typeof mod[fn] === 'function') {
    try {
      const g = mod[fn]();
      if (g && g.isObject3D) return g;
    } catch (e) { console.warn('prop build failed', kind, e); }
  }
  return fallbackModel(kind);
}

// 奶茶杯
function makeCup(rngSeed = 0) {
  const g = new THREE.Group();
  const body = cylMesh(0.16, 0.12, 0.34, 0xfff3dd, { segments: 12 });
  put(g, body, 0, 0.17, 0);
  const tea = cylMesh(0.135, 0.105, 0.19, 0xb47a4a, { segments: 12 });
  put(g, tea, 0, 0.14, 0.001);
  const lid = cylMesh(0.17, 0.17, 0.05, 0xf7e7c8, { segments: 12 });
  put(g, lid, 0, 0.355, 0);
  const straw = cylMesh(0.018, 0.018, 0.26, 0xe4574c, { segments: 6 });
  put(g, straw, 0.03, 0.45, 0.02, 0.12, 0, 0.05);
  const band = cylMesh(0.153, 0.153, 0.1, 0xf2d06b, { segments: 12 });
  put(g, band, 0, 0.2, 0);
  const glow = glowSprite(0xffd98a, 0.7, 0.5);
  glow.position.set(0, 0.25, 0);
  g.add(glow);
  g.userData.isCup = true;
  return g;
}

function makeGantry() {
  const g = new THREE.Group();
  const beam = boxMesh(9.4, 0.42, 0.5, C.white, { radius: 0.04 });
  put(g, beam, 0, 1.55, 0);
  for (let i = 0; i < 7; i++) put(g, boxMesh(0.6, 0.44, 0.52, C.red), -4 + i * 1.33, 1.55, 0);
  for (const s of [-1, 1]) {
    put(g, boxMesh(0.24, 1.55, 0.24, C.metalDark), s * 4.4, 0.78, 0);
    put(g, boxMesh(0.6, 0.18, 0.6, C.orange), s * 4.4, 0.09, 0);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: signTexture('施工慢行', { width: 512, height: 128, bg: C.signOrange, fg: 0x24372f }), transparent: true, side: THREE.DoubleSide }));
  sign.position.set(0, 1.98, 0.1);
  g.add(sign);
  return g;
}

function makeParcel() {
  const g = new THREE.Group();
  const paper = 0xc9a06a, paperLt = 0xd8b27a, tape = 0xf2d7a0;
  const b1 = boxMesh(1.02, 0.4, 0.74, paper, { radius: 0.04 });
  put(g, b1, 0, 0.2, 0);
  const b2 = boxMesh(0.82, 0.36, 0.62, paperLt, { radius: 0.04 });
  put(g, b2, 0.06, 0.58, 0.02, 0, 0.18, 0);
  const b3 = boxMesh(0.58, 0.3, 0.48, paper, { radius: 0.03 });
  put(g, b3, -0.1, 0.9, 0, 0, 0.3, 0.02);
  for (const [x, y, z, w, d] of [[0, 0.4, 0, 0.14, 0.76], [0.06, 0.58, 0.02, 0.12, 0.64], [-0.1, 0.9, 0, 0.1, 0.5]]) {
    put(g, boxMesh(w, 0.012, d, tape), x, y, z);
  }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), basicMat(0xfff8e8, { toneMapped: false }));
  put(g, label, 0.16, 0.58, 0.34);
  return g;
}

function makeRoadSign() {
  const g = new THREE.Group();
  const wood = 0x9a7a55, dark = 0x5d4938, orange = 0xe4713f;
  for (const s of [-1, 1]) {
    put(g, boxMesh(0.1, 1.05, 0.1, wood), s * 0.38, 0.52, 0, 0, 0, s * 0.16);
  }
  put(g, boxMesh(0.86, 0.1, 0.1, dark), 0, 1.0, 0, 0, 0, 0);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.62), new THREE.MeshBasicMaterial({
    map: signTexture('慢行', { width: 256, height: 192, bg: orange, fg: 0xfff4dc, fontSize: 76 }),
    transparent: true, side: THREE.DoubleSide, toneMapped: false,
  }));
  board.position.set(0, 0.78, 0.06);
  g.add(board);
  put(g, boxMesh(0.12, 0.06, 0.12, 0xffd45e, { emissive: 0xffb020, emissiveIntensity: 0.3 }), 0, 1.13, 0);
  return g;
}

function makeBarrel() {
  const g = new THREE.Group();
  put(g, cylMesh(0.32, 0.36, 0.9, 0xe4713f, { segments: 10 }), 0, 0.45, 0);
  for (const y of [0.22, 0.55, 0.82]) put(g, cylMesh(0.34, 0.34, 0.09, 0xf7efe2, { segments: 10 }), 0, y, 0);
  put(g, cylMesh(0.26, 0.3, 0.08, 0x3e4143, { segments: 10 }), 0, 0.9, 0);
  put(g, boxMesh(0.5, 0.05, 0.5, 0x3e4143, { radius: 0.02 }), 0, 0.025, 0);
  return g;
}

function makeFallenLog() {
  const g = new THREE.Group();
  const trunk = cylMesh(0.28, 0.32, 1.8, 0x8a5d3f, { segments: 9 });
  put(g, trunk, 0, 0.32, 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    const cap = cylMesh(0.29, 0.29, 0.06, 0xd8b68a, { segments: 9 });
    put(g, cap, s * 0.92, 0.32, 0, 0, 0, Math.PI / 2);
  }
  put(g, cylMesh(0.06, 0.09, 0.42, 0x6f4a33, { segments: 5 }), 0.2, 0.6, 0.1, 0, 0, 0.7);
  put(g, icoMesh(0.3, 0x6f9a4e, { detail: 0, flatShading: true }), -0.45, 0.55, 0.06).scale.set(1.3, 0.5, 0.9);
  return g;
}

let padTexture = null;
function makeSpeedPad() {
  if (!padTexture) {
    padTexture = canvasTexture(256, 384, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, 'rgba(34,231,255,0.0)');
      g.addColorStop(0.18, 'rgba(34,231,255,0.22)');
      g.addColorStop(0.6, 'rgba(34,231,255,0.08)');
      g.addColorStop(1, 'rgba(34,231,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(18, 10, w - 36, h - 20, 28) : ctx.rect(18, 10, w - 36, h - 20);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,248,255,0.75)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210,255,255,0.95)';
      ctx.lineWidth = 24;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const y = 95 + i * 82;
        ctx.beginPath();
        ctx.moveTo(w * 0.2, y + 44);
        ctx.lineTo(w * 0.5, y - 22);
        ctx.lineTo(w * 0.8, y + 44);
        ctx.stroke();
      }
    }, { anisotropy: 4 });
  }
  const g = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.6), new THREE.MeshBasicMaterial({
    map: padTexture, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.035;
  g.add(plane);
  const glow = glowSprite(0x7fe8ff, 1.7, 0.22);
  glow.position.set(0, 0.15, 0);
  g.add(glow);
  g.userData.padPlane = plane;
  g.userData.padGlow = glow;
  return g;
}

const CUSTOM_OBSTACLES = {
  gantry: makeGantry,
  parcel: makeParcel,
  roadSign: makeRoadSign,
  barrel: makeBarrel,
  log: makeFallenLog,
};
const FACE_PLAYER = new Set(['roadSign', 'parcel', 'log']);

const POWER_ICONS = {
  shield: { color: 0x6fc7b4, label: '盾' },
  magnet: { color: 0xe4574c, label: '吸' },
  nitro: { color: 0xf2b34e, label: '氮' },
  double: { color: 0x8fa3d9, label: '×2' },
};

function makePowerup(kind) {
  const g = new THREE.Group();
  const info = POWER_ICONS[kind] || POWER_ICONS.shield;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshBasicMaterial({
    color: info.color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  g.add(orb);
  const iconTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff8e8';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#' + new THREE.Color(info.color).getHexString();
    ctx.lineWidth = 8; ctx.stroke();
    ctx.fillStyle = '#24372f';
    ctx.font = '900 54px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.label, w / 2, h / 2 + 4);
  });
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthWrite: false, depthTest: true }));
  icon.scale.set(0.6, 0.6, 1);
  g.add(icon);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 6, 30), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const glow = glowSprite(info.color, 1.8, 0.45);
  g.add(glow);
  g.userData.kind = kind;
  return g;
}

export class Entities {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.active = [];
    this.pool = new Map();
    this.time = 0;
    this.cupGeoLock = false;
    this.onHit = null;
    this.onPickup = null;
    this.onPowerup = null;
    this.onNearMiss = null;
    this.onPass = null;
    this.onPad = null;
    this.magnet = false;
  }

  _take(key, factory) {
    const arr = this.pool.get(key);
    if (arr && arr.length) {
      const g = arr.pop();
      g.visible = true;
      return g;
    }
    const g = factory();
    this.scene.add(g);
    return g;
  }

  _release(item) {
    item.group.visible = false;
    item.group.position.set(0, -999, 0);
    const key = item.poolKey;
    if (!this.pool.has(key)) this.pool.set(key, []);
    this.pool.get(key).push(item.group);
  }

  spawnObstacle(kind, lane, z = CFG.spawn.far, opts = {}) {
    const def = DEFS[kind] || DEFS.rock;
    const g = this._take(kind, () => {
      const prop = CUSTOM_OBSTACLES[kind] ? CUSTOM_OBSTACLES[kind]() : getProp(kind, def);
      // 给车/障碍加接地影
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(def.w * 1.5, def.d * 1.35), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015; prop.add(sh);
      return prop;
    });
    const laneIdx = clamp(lane, 0, 2);
    const x = CFG.laneX[laneIdx];
    g.position.set(x, 0, z);
    g.rotation.set(0, (def.gate || FACE_PLAYER.has(kind) || opts.facePlayer) ? 0 : Math.PI, 0);
    if (def.gate) {
      // 门/树枝横跨车道：用道具 META 宽度精确拉伸到碰撞宽度，避免“看着有缝却撞上”
      const metaW = def.prop ? PROP_MODULES[def.prop[0]]?.META?.[def.prop[1]]?.w : null;
      const baseW = kind === 'gantry' ? 9.4 : (metaW || (kind === 'awning' ? 5.3 : 5.05));
      g.scale.set(1, 1, 1);
      g.scale.x = def.w / baseW;
    }
    if (opts.scale) g.scale.multiplyScalar(opts.scale);
    const item = {
      type: 'obstacle', kind, def, group: g, poolKey: kind,
      lane: laneIdx, x, z, w: def.w, d: def.d, y0: def.y0 ?? 0, y1: def.y1 ?? 1,
      hit: false, passed: false, phase: Math.random() * 6.28,
      harmless: !!def.hazard, critter: !!def.critter,
    };
    g.userData.entity = item;
    this.active.push(item);
    return item;
  }

  spawnCup(lane, z = CFG.spawn.far, y = 1.05) {
    const g = this._take('cup', makeCup);
    const laneIdx = clamp(lane, 0, 2);
    const x = CFG.laneX[laneIdx];
    g.position.set(x, y, z);
    g.rotation.set(0, Math.random() * 6, 0);
    const item = { type: 'cup', group: g, poolKey: 'cup', lane: laneIdx, x, baseY: y, y, z, phase: Math.random() * 6.28, w: 0.5, d: 0.5 };
    this.active.push(item);
    return item;
  }

  spawnPowerup(kind, lane, z = CFG.spawn.far) {
    const g = this._take('power_' + kind, () => makePowerup(kind));
    const laneIdx = clamp(lane, 0, 2);
    const x = CFG.laneX[laneIdx];
    g.position.set(x, 1.25, z);
    const item = { type: 'powerup', kind, group: g, poolKey: 'power_' + kind, lane: laneIdx, x, baseY: 1.25, y: 1.25, z, phase: Math.random() * 6.28, w: 0.9, d: 0.9 };
    this.active.push(item);
    return item;
  }

  spawnSpeedPad(lane, z = CFG.spawn.far) {
    const g = this._take('speedpad', makeSpeedPad);
    const laneIdx = clamp(lane, 0, 2);
    const x = CFG.laneX[laneIdx];
    g.position.set(x, 0, z);
    g.rotation.set(0, 0, 0);
    g.scale.set(1, 1, 1);
    g.visible = true;
    const item = { type: 'pad', group: g, poolKey: 'speedpad', lane: laneIdx, x, z, w: 2.6, d: 4.2, phase: Math.random() * 6.28 };
    this.active.push(item);
    return item;
  }

  smash(item, direction = 1) {
    if (!item || item.dead) return;
    item.dead = true;
    this.fx?.sparkBurst(new THREE.Vector3(item.x, Math.min(1, item.y1 * 0.6), item.z), 18, 0xffc247, 1.2);
    this.fx?.dustBurst(new THREE.Vector3(item.x, 0.2, item.z), 8, 0xd9c9a8, 1.3);
  }

  clearZ(minZ = -6, maxZ = 8, maxH = 1.5) {
    let n = 0;
    for (const it of this.active) {
      if (it.type === 'obstacle' && !it.dead && it.z > minZ && it.z < maxZ && (it.y1 ?? 1) <= maxH) {
        this.smash(it);
        n++;
      }
    }
    return n;
  }

  reset() {
    for (const it of this.active) this._release(it);
    this.active.length = 0;
  }

  update(dt, speed, rider, opts = {}) {
    this.time += dt;
    this.magnet = !!opts.magnet;
    const rb = rider.getBounds();
    const alive = [];
    for (const it of this.active) {
      if (it.dead) { this._release(it); continue; }
      it.z += speed * dt;
      if (it.z > 28) { this._release(it); continue; }

      if (it.type === 'obstacle') {
        const g = it.group;
        // 障碍必须跟随逻辑 z 滚动（此前只更新了逻辑坐标，模型停在生成点，是 P0！）
        g.position.z = it.z;
        // 小动物轻微摆动
        if (it.critter) {
          g.position.x = it.x + Math.sin(this.time * 3 + it.phase) * 0.18;
          g.rotation.y = Math.PI + Math.sin(this.time * 2 + it.phase) * 0.2;
        }
        if (!it.hit && Math.abs(it.z) < it.d / 2 + 0.95) {
          const dx = Math.abs(rb.x - it.x);
          const withinX = dx < (rb.width + it.w) / 2 - 0.12;
          const vOverlap = rb.y < it.y1 - 0.04 && rb.y + rb.height > it.y0 + 0.04;
          if (withinX && vOverlap) {
            it.hit = true;
            this.onHit?.(it, rb);
          }
        }
        if (!it.passed && it.z > it.d / 2 + 1.2) {
          it.passed = true;
          if (!it.hit) {
            const dx = Math.abs(rb.x - it.x);
            const gap = dx - (rb.width + it.w) / 2;
            const vOverlap = rb.y < it.y1 && rb.y + rb.height > it.y0;
            if (gap < 2.5 && gap > -0.05 && vOverlap) this.onNearMiss?.(it, gap);
            this.onPass?.(it);
          }
        }
      } else if (it.type === 'pad') {
        const g = it.group;
        g.position.set(it.x, 0, it.z);
        if (g.userData.padGlow) g.userData.padGlow.material.opacity = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(this.time * 5 + it.phase));
        if (g.userData.padPlane) g.userData.padPlane.material.opacity = 0.46 + 0.14 * (0.5 + 0.5 * Math.sin(this.time * 5 + it.phase));
        const dx = Math.abs(rb.x - it.x);
        if (it.z > -2.4 && it.z < 2.4 && dx < 1.5) {
          it.dead = true;
          this.onPad?.(it);
          this._release(it);
          continue;
        }
      } else if (it.type === 'cup') {
        const g = it.group;
        // 磁铁吸引
        if (this.magnet && it.z > -34 && it.z < 3 && Math.abs(it.x - rb.x) < 8) {
          it.x += (rb.x - it.x) * (1 - Math.exp(-4.5 * dt));
          it.z += (-0.4 - it.z) * (1 - Math.exp(-3.6 * dt));
          it.baseY += (rb.y + 1.0 - it.baseY) * (1 - Math.exp(-3 * dt));
        }
        it.y = it.baseY + Math.sin(this.time * 3.2 + it.phase) * 0.1;
        g.position.set(it.x, it.y, it.z);
        g.rotation.y += dt * 2.4;
        const dx = Math.abs(rb.x - it.x);
        const dy = Math.abs((rb.y + 1.0) - it.y);
        if (it.z > -1.7 && it.z < 1.8 && dx < 1.2 && dy < 1.9) {
          it.dead = true;
          this.onPickup?.(it);
          this._release(it);
          continue;
        }
      } else if (it.type === 'powerup') {
        const g = it.group;
        it.y = it.baseY + Math.sin(this.time * 2.4 + it.phase) * 0.14;
        g.position.set(it.x, it.y, it.z);
        g.rotation.y += dt * 1.5;
        g.children.forEach((c) => { if (c.isSprite) c.material.rotation += dt * 0.5; });
        const dx = Math.abs(rb.x - it.x);
        if (it.z > -1.9 && it.z < 1.9 && dx < 1.25) {
          it.dead = true;
          this.onPowerup?.(it);
          this._release(it);
          continue;
        }
      }
      alive.push(it);
    }
    this.active = alive;
  }
}
