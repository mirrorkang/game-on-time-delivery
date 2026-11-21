// world.js — 三幕世界：天空、光照、道路、路边生态、隧道、终点、氛围粒子
import * as THREE from 'three';
import { CFG, clamp, MVP } from './config.js';
import {
  C, mat, basicMat, boxMesh, cylMesh, coneMesh, sphereMesh, icoMesh, gableRoof, put,
  canvasTexture, facadeTexture, signTexture, signBoard, glowSprite, rng, contactShadow,
  STAGE_SKY, planeMesh,
} from './artkit.js';
import * as NATURE from './props_nature.js';
import * as TOWN from './props_town.js';
import * as CITY from './props_city.js';

const MODULES = { nature: NATURE, town: TOWN, city: CITY };

const TABLES = [
  {
    near: ['bambooCluster', 'broadleafTree', 'woodFence', 'scarecrow', 'utilityPole', 'rockSmall', 'stoneBridgeRail', 'bambooCluster', 'pineTree'],
    mid: ['mountainHouse', 'terraceField', 'bambooCluster', 'broadleafTree', 'mountainHouse', 'hayCart', 'terraceField'],
    far: ['pineTree', 'broadleafTree', 'mountainHouse', 'bambooCluster'],
  },
  {
    near: ['produceBasket', 'scooterParked', 'cat', 'woodFence', 'bambooCluster', 'laundryLine', 'fruitSign', 'gasStove'],
    mid: ['shopHouse', 'marketStall', 'broadleafTree', 'scooterParked', 'shopHouse', 'fruitSign', 'laundryLine'],
    far: ['shopHouse', 'broadleafTree', 'shopHouse'],
  },
  {
    near: ['flowerBed', 'streetLamp', 'pigeon', 'scooterParked', 'trafficLight', 'streetTree', 'busStop', 'roadSign', 'crosswalkSign'],
    mid: ['skyscraper', 'billboard', 'streetLamp', 'streetTree', 'flowerBed', 'busStop', 'skyscraper'],
    far: ['skyscraper', 'skyscraper', 'billboard'],
  },
];

const SUN_DIRS = [
  new THREE.Vector3(-0.45, 0.22, -0.865).normalize(),
  new THREE.Vector3(0.38, 0.64, -0.66).normalize(),
  new THREE.Vector3(-0.5, 0.2, -0.842).normalize(),
];

const STAGE_FOG = [0.0018, 0.0015, 0.0022];
const STAGE_ROAD = [0x9e9480, 0xb0a693, 0x989ba2];
const STAGE_GROUND = [0x7f8f5e, 0x8a9a63, 0x6b675f];

function moduleFor(kind) {
  for (const [name, mod] of Object.entries(MODULES)) {
    if (typeof mod?.[kind] === 'function') return { name, mod };
  }
  return null;
}

function ridgeMesh(width, height, seed, color, z, y = 0) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  const seg = 26;
  let h = height * (0.35 + r() * 0.25);
  for (let i = 0; i <= seg; i++) {
    const x = -width / 2 + (width * i) / seg;
    const n = Math.sin(i * 0.9 + seed) * 0.22 + (r() - 0.5) * 0.3;
    h = height * clamp(0.32 + Math.abs(n) + Math.sin(i * 0.31 + seed) * 0.22, 0.15, 1);
    if (i === 0) h *= 0.5;
    shape.lineTo(x, h);
  }
  shape.lineTo(width / 2, 0);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, fog: true }));
  mesh.position.set(0, y, z);
  return mesh;
}

function cloudTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const blobs = [
      [0.3, 0.6, 0.22], [0.48, 0.48, 0.28], [0.66, 0.58, 0.24], [0.78, 0.66, 0.16], [0.18, 0.68, 0.16],
    ];
    for (const [x, y, r] of blobs) {
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
      g.addColorStop(0, 'rgba(255,252,244,0.85)');
      g.addColorStop(0.55, 'rgba(255,248,238,0.45)');
      g.addColorStop(1, 'rgba(255,245,235,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x * w, y * h, r * w, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function dotTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export class World {
  constructor(scene, renderer, callbacks = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.onStage = callbacks.onStage || null;
    this.onArrival = callbacks.onArrival || null;
    this.stage = MVP.enabled ? MVP.stage : 0;
    this.distance = 0;
    this.scroll = 0;
    this.time = 0;
    this.stageFlags = [true, false, false];
    this.arrivalFired = false;
    this.milestones = [
      { d: 700, type: 'tunnel', spawned: false, stage: 1 },
      { d: 1400, type: 'underpass', spawned: false, stage: 2 },
      { d: 2100, type: 'arrival', spawned: false, stage: null },
    ];
    this.landmarks = [];
    this.overhead = [];
    this.pools = new Map();
    this.factories = new Map();
    this._collectFactories();
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildRoad();
    this._buildBackdrops();
    this._buildGrass();
    this._buildFields();
    this._buildClouds();
    this._buildMotes();
    this._buildSlots();
    this._buildOverhead();
    this._precache();
    this._applyStage(this.stage, true);
  }

  _collectFactories() {
    for (const [modName, mod] of Object.entries(MODULES)) {
      for (const [k, v] of Object.entries(mod || {})) {
        if (typeof v === 'function' && !this.factories.has(k)) this.factories.set(k, { mod, name: k });
      }
    }
  }

  _factory(kind) {
    const f = this.factories.get(kind);
    if (f) {
      try {
        const g = f.mod[f.name]();
        if (g && g.isObject3D) return g;
      } catch (e) { console.warn('[world] prop failed', kind, e); }
    }
    return this._fallbackProp(kind);
  }

  _fallbackProp(kind) {
    const g = new THREE.Group();
    const tree = (leaf = C.leaf2) => {
      put(g, cylMesh(0.14, 0.22, 2.4, C.woodDark, { segments: 7 }), 0, 1.2, 0);
      for (let i = 0; i < 3; i++) put(g, icoMesh(1 + i * 0.18, leaf, { detail: 0, flatShading: true }), (i - 1) * 0.55, 2.6 + i * 0.7, (i % 2 - 0.5) * 0.4);
    };
    if (/tree|bamboo/i.test(kind)) {
      if (/bamboo/i.test(kind)) {
        for (let i = 0; i < 4; i++) {
          put(g, cylMesh(0.08, 0.1, 5, C.leaf2, { segments: 5 }), (i - 1.5) * 0.5, 2.5, (i % 2) * 0.4);
          for (let j = 0; j < 3; j++) put(g, icoMesh(0.5, C.leaf3, { detail: 0 }), (i - 1.5) * 0.5, 3 + j * 0.9, (i % 2) * 0.4, 0, 0, 0);
        }
      } else tree();
    } else if (/house|shop/i.test(kind)) {
      put(g, boxMesh(4.2, 2.8, 3.4, C.plaster), 0, 1.4, 0);
      put(g, gableRoof(4.4, 3.6, 1.4, C.tile), 0, 2.8, 0);
      const sign = signBoard(kind === 'shopHouse' ? '老街小店' : '山居', { w: 2.2, h: 0.7, bg: C.signRed, fg: 0xfff4dc });
      put(g, sign, 0, 2.0, 1.74);
    } else if (/stall/i.test(kind)) {
      put(g, boxMesh(3, 0.9, 1.5, C.wood), 0, 0.45, 0);
      put(g, boxMesh(3.6, 0.1, 2.2, C.red), 0, 2.2, 0);
      for (let i = 0; i < 4; i++) put(g, cylMesh(0.06, 0.06, 2.2, C.metalDark, { segments: 5 }), -1.3 + i * 0.9, 1.1, -0.7);
    } else if (/skyscraper/i.test(kind)) {
      const h = 18 + Math.random() * 18;
      const w = 6 + Math.random() * 5;
      const tex = facadeTexture({ cols: 6, rows: 14, base: 0x8a9aa8, window: 0xb9c9d2, lit: 0xffd087, litRatio: 0.25 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 }));
      put(g, m, 0, h / 2, 0);
    } else if (/billboard/i.test(kind)) {
      put(g, cylMesh(0.1, 0.14, 5, C.steelDark, { segments: 6 }), 0, 2.5, 0);
      const tex = signTexture('准时送达', { width: 640, height: 320, bg: C.signBlue, fg: 0xfff4dc, sub: 'ON TIME', glow: true, glowColor: 0x9fd8ff });
      const b = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
      put(g, b, 0, 5.1, 0);
    } else if (/streetLamp|trafficLight/i.test(kind)) {
      put(g, cylMesh(0.09, 0.13, 5.5, C.steelDark, { segments: 7 }), 0, 2.75, 0);
      put(g, boxMesh(1.7, 0.1, 0.1, C.steelDark), 0.8, 5.4, 0);
      put(g, glowSprite(0xffd9a0, 1.4, 0.7), 1.6, 5.25, 0);
    } else if (/fence/i.test(kind)) {
      for (let i = 0; i < 4; i++) put(g, boxMesh(0.12, 1.1, 0.12, C.woodDark), -1.5 + i, 0.55, 0);
      put(g, boxMesh(3.4, 0.1, 0.08, C.wood), 0, 0.8, 0);
      put(g, boxMesh(3.4, 0.1, 0.08, C.wood), 0, 0.45, 0);
    } else if (/terrace/i.test(kind)) {
      for (let i = 0; i < 3; i++) {
        put(g, boxMesh(8 - i * 1.2, 0.5, 4 - i * 0.8, i % 2 ? C.rice1 : C.rice2), 0, i * 0.55 + 0.25, -i * 0.6);
      }
    } else if (/lantern/i.test(kind)) {
      put(g, cylMesh(0.05, 0.05, 12, C.woodDark, { segments: 4 }), 0, 5, 0).rotation.z = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        put(g, sphereMesh(0.25, C.red, { segments: 8 }), -5 + i * 1.4, 4.5, 0);
        put(g, glowSprite(0xff6a4a, 0.9, 0.5), -5 + i * 1.4, 4.5, 0);
      }
    } else if (/flowerBed/i.test(kind)) {
      put(g, boxMesh(2, 0.5, 2.4, C.concrete), 0, 0.25, 0);
      for (let i = 0; i < 8; i++) put(g, sphereMesh(0.2, i % 2 ? C.leaf2 : 0xe89a9a, { segments: 6 }), (Math.random() - 0.5) * 1.6, 0.55, (Math.random() - 0.5) * 2);
    } else if (/scooter/i.test(kind)) {
      put(g, boxMesh(0.55, 0.5, 1.7, C.mint, { radius: 0.12 }), 0, 0.5, 0);
      put(g, boxMesh(0.6, 0.75, 0.6, C.yellow, { radius: 0.1 }), 0, 1.05, -0.45);
      for (const z of [-0.65, 0.65]) {
        const wheel = cylMesh(0.27, 0.27, 0.12, C.tire, { segments: 10 });
        wheel.rotation.z = Math.PI / 2;
        put(g, wheel, 0, 0.27, z);
      }
    } else if (/produceBasket/i.test(kind)) {
      put(g, cylMesh(0.4, 0.3, 0.4, C.woodLight, { segments: 9 }), 0, 0.2, 0);
      for (let i = 0; i < 7; i++) put(g, sphereMesh(0.1, i % 2 ? C.orange : C.leaf2, { segments: 6 }), (Math.random() - 0.5) * 0.5, 0.42, (Math.random() - 0.5) * 0.5);
    } else if (/pigeon|cat|scarecrow/i.test(kind)) {
      if (/cat/i.test(kind)) {
        put(g, sphereMesh(0.22, 0xe3a25c, { segments: 8 }), 0, 0.28, 0);
        put(g, sphereMesh(0.15, 0xe3a25c, { segments: 8 }), 0, 0.48, 0.18);
      } else if (/scarecrow/i.test(kind)) {
        put(g, cylMesh(0.07, 0.09, 2.2, C.woodDark, { segments: 5 }), 0, 1.1, 0);
        put(g, boxMesh(1.6, 0.08, 0.08, C.wood), 0, 1.6, 0);
        put(g, sphereMesh(0.3, C.yellow, { segments: 8 }), 0, 2.1, 0);
        put(g, coneMesh(0.55, 0.45, C.woodLight, { segments: 8 }), 0, 2.45, 0);
      } else {
        put(g, sphereMesh(0.12, C.steel, { segments: 6 }), 0, 0.3, 0);
      }
    } else {
      put(g, boxMesh(1.2, 1.2, 1.2, C.wood, { radius: 0.1 }), 0, 0.6, 0);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return g;
  }

  /* --------------------------------- 天空 --------------------------------- */
  _buildSky() {
    this.skyUniforms = {
      uTop: { value: new THREE.Color(STAGE_SKY[0].top) },
      uMid: { value: new THREE.Color(STAGE_SKY[0].mid) },
      uHorizon: { value: new THREE.Color(STAGE_SKY[0].horizon) },
      uSunColor: { value: new THREE.Color(STAGE_SKY[0].sun) },
      uSunDir: { value: SUN_DIRS[0].clone() },
      uSunStrength: { value: 1 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
        uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uSunStrength;
        void main() {
          float h = vDir.y;
          vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, h));
          col = mix(col, uTop, smoothstep(0.22, 0.8, h));
          float cosA = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += uSunColor * pow(cosA, 220.0) * 1.6 * uSunStrength;
          col += uSunColor * pow(cosA, 9.0) * 0.22 * uSunStrength;
          col = mix(col, uHorizon * 1.04, smoothstep(0.07, -0.06, h) * 0.55);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(CFG.world.skyRadius, 32, 16), skyMat);
    this.sky.renderOrder = -100;
    this.scene.add(this.sky);

    this.sunSprite = glowSprite(0xfff3d6, 70, 0.9);
    this.sunSprite.material.depthTest = false;
    this.sunSprite.renderOrder = -90;
    this.sky.add(this.sunSprite);
    this.sunCore = glowSprite(0xfffdf2, 24, 1);
    this.sunCore.material.depthTest = false;
    this.sunCore.renderOrder = -89;
    this.sky.add(this.sunCore);
    const discTex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,246,1)');
      g.addColorStop(0.55, 'rgba(255,250,225,1)');
      g.addColorStop(0.8, 'rgba(255,235,185,0.7)');
      g.addColorStop(1, 'rgba(255,230,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.sunDisc.scale.set(26, 26, 1);
    this.sunDisc.renderOrder = -88;
    this.sky.add(this.sunDisc);

    this.scene.background = new THREE.Color(STAGE_SKY[0].horizon);
    this.scene.fog = new THREE.FogExp2(STAGE_SKY[0].fog, STAGE_FOG[0]);
  }

  _updateSky(camera) {
    if (!this.sky) return;
    this.sky.position.set(camera.position.x, 0, camera.position.z);
  }

  /* --------------------------------- 光照 --------------------------------- */
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(STAGE_SKY[0].amb, 0x6f7a55, 1.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(STAGE_SKY[0].light, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -34;
    this.sun.shadow.camera.right = 34;
    this.sun.shadow.camera.top = 34;
    this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    this.sun.target.position.set(0, 0, -8);
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x9fc4d8, 0.45);
    this.fill.position.set(30, 24, 40);
    this.scene.add(this.fill);
  }

  /* --------------------------------- 地面 --------------------------------- */
  _buildGround() {
    const r = rng(83);
    const tex = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#c7c8ac';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 130; i++) {
        const l = 0.82 + r() * 0.3;
        const cr = Math.round(184 * l), cg = Math.round(190 * l), cb = Math.round(150 * l);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.18 + r() * 0.26})`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 10 + r() * 55, 6 + r() * 35, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 5000; i++) {
        const l = r() > 0.5 ? 255 : 40;
        ctx.fillStyle = `rgba(${l},${l},${l},${0.02 + r() * 0.05})`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      for (let i = 0; i < 220; i++) {
        ctx.strokeStyle = `rgba(96,110,70,${0.06 + r() * 0.1})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const x = r() * w, y = r() * h;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 8, y - 4 - r() * 8);
        ctx.stroke();
      }
    }, { wrap: true, repeat: [70, 70], anisotropy: 4 });
    this.groundTex = tex;
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, color: STAGE_GROUND[0], roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(620, 620), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.06, -250);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
  }

  _buildRoad() {
    const asphalt = this._asphaltTexture();
    this.roadMat = new THREE.MeshStandardMaterial({ map: asphalt, color: STAGE_ROAD[0], roughness: 0.92, metalness: 0.02 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(CFG.roadWidth, 700), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -240);
    road.receiveShadow = true;
    this.scene.add(road);
    this.road = road;

    // 路肩（乡野）
    this.shoulderMat = new THREE.MeshStandardMaterial({ color: 0x9c8a68, roughness: 1 });
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 700), this.shoulderMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(s * (CFG.roadWidth / 2 + 1.6), -0.015, -240);
      sh.receiveShadow = true;
      this.scene.add(sh);
      (this.ruralShoulders ||= []).push(sh);
    }

    // 城市人行道
    this.sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.95 });
    this.curbMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 });
    for (const s of [-1, 1]) {
      const walk = boxMesh(3.6, 0.16, 700, 0xb9b3a6);
      walk.material = this.sidewalkMat;
      walk.position.set(s * (CFG.roadWidth / 2 + 1.9), 0.08, -240);
      walk.receiveShadow = true;
      this.scene.add(walk);
      (this.cityWalks ||= []).push(walk);
      const curb = boxMesh(0.22, 0.22, 700, 0xd8d2c4);
      curb.material = this.curbMat;
      curb.position.set(s * (CFG.roadWidth / 2 + 0.15), 0.11, -240);
      curb.receiveShadow = true;
      this.scene.add(curb);
      (this.cityWalks ||= []).push(curb);
    }

    // 车道虚线（实例化）
    this.markMat = new THREE.MeshStandardMaterial({ color: 0xf7efd8, roughness: 0.8, emissive: 0x2a2418, emissiveIntensity: 0.15 });
    const dashGeo = new THREE.BoxGeometry(0.14, 0.02, 3.2);
    const dashCount = 100;
    this.dashes = new THREE.InstancedMesh(dashGeo, this.markMat, dashCount);
    this.dashes.receiveShadow = true;
    this.dashes.castShadow = false;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const x of [-1.8, 1.8]) {
      for (let i = 0; i < 50; i++) {
        dummy.position.set(x, 0.022, 30 - i * 8);
        dummy.updateMatrix();
        this.dashes.setMatrixAt(idx++, dummy.matrix);
      }
    }
    this.dashes.instanceMatrix.needsUpdate = true;
    this.dashes.frustumCulled = false;
    this.scene.add(this.dashes);

    // 实线边线
    this.edgeLineMat = new THREE.MeshStandardMaterial({ color: 0xf7efd8, roughness: 0.8 });
    for (const s of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 700), this.edgeLineMat);
      line.position.set(s * (CFG.roadWidth / 2 - 0.25), 0.018, -240);
      this.scene.add(line);
      (this.edges ||= []).push(line);
    }
  }

  _asphaltTexture() {
    // 本地绘制沥青，避免依赖 artkit 的默认深色
    return canvasTexture(512, 512, (ctx, w, h) => {
      const r = rng(19);
      ctx.fillStyle = '#9b9a92';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const g = 130 + r() * 50;
        ctx.fillStyle = `rgba(${g},${g - 4},${g - 10},0.25)`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 15 + r() * 70, 8 + r() * 40, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 8000; i++) {
        const l = r() > 0.5 ? 255 : 20;
        ctx.fillStyle = `rgba(${l},${l},${l},${0.015 + r() * 0.04})`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      ctx.strokeStyle = 'rgba(45,45,45,0.12)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        let x = r() * w, y = r() * h;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 7; j++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }, { wrap: true, repeat: [1, 76], anisotropy: 8 });
  }

  /* -------------------------------- 远景 --------------------------------- */
  _buildBackdrops() {
    this.backMountain = new THREE.Group();
    this.backMountain.add(ridgeMesh(760, 65, 3, 0x9cbccd, -400));
    this.backMountain.add(ridgeMesh(640, 48, 7, 0x7fa6a2, -335));
    this.backMountain.add(ridgeMesh(540, 34, 11, 0x63896f, -282));
    this.scene.add(this.backMountain);

    this.backTown = new THREE.Group();
    const r = rng(51);
    this.backTown.add(ridgeMesh(620, 45, 23, 0xaabfae, -360));
    for (let i = 0; i < 26; i++) {
      const x = -160 + i * 12.5 + (r() - 0.5) * 6;
      const hh = 5 + r() * 9;
      const w = 6 + r() * 5;
      const box = boxMesh(w, hh, 5, r() > 0.5 ? 0xd9cfb8 : 0xcbbfa5);
      box.position.set(x, hh / 2, -280 + r() * 30);
      box.castShadow = false;
      this.backTown.add(box);
      const roof = gableRoof(w, 5, 1.8, 0xa8513e);
      roof.position.set(x, hh, -280 + r() * 30);
      roof.castShadow = false;
      this.backTown.add(roof);
    }
    this.scene.add(this.backTown);

    this.backCity = new THREE.Group();
    const r2 = rng(77);
    for (let i = 0; i < 30; i++) {
      const x = -190 + i * 13 + (r2() - 0.5) * 6;
      const hh = 22 + r2() * 58;
      const w = 7 + r2() * 8;
      const tex = facadeTexture({
        cols: 4 + Math.floor(r2() * 3), rows: 10, width: 256, height: 512,
        base: r2() > 0.5 ? 0x8f9fb0 : 0xa39aa8, window: 0x647888, lit: 0xffd087, litRatio: 0.25 + r2() * 0.2, seed: 100 + i,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, w), new THREE.MeshBasicMaterial({ map: tex, fog: true }));
      m.position.set(x, hh / 2, -300 + r2() * 40);
      this.backCity.add(m);
    }
    const bill = signTexture('晚霞里 · 准时送到', { width: 768, height: 256, bg: C.signOrange, fg: 0xfff6e2, sub: 'DELIVERED ON TIME', glow: true });
    const billMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 11), new THREE.MeshBasicMaterial({ map: bill, fog: true }));
    billMesh.position.set(-26, 34, -286);
    this.backCity.add(billMesh);
    this.scene.add(this.backCity);
    this.backTown.visible = false;
    this.backCity.visible = false;
  }

  /* -------------------------------- 草花 --------------------------------- */
  _buildGrass() {
    const geo = new THREE.ConeGeometry(0.07, 0.55, 4, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x86a35c, roughness: 1, flatShading: true });
    const count = 860;
    this.grass = new THREE.InstancedMesh(geo, material, count);
    this.grass.receiveShadow = true;
    this.grass.castShadow = false;
    this.grass.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const r = rng(29);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (CFG.roadWidth / 2 + 0.8 + r() * 3.4);
      const z = 24 - r() * 330;
      dummy.position.set(x, 0.26, z);
      dummy.rotation.y = r() * 6.28;
      const s = 0.75 + r() * 1.45;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.grass.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.23 + r() * 0.06, 0.38 + r() * 0.2, 0.28 + r() * 0.18);
      this.grass.setColorAt(i, col);
    }
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    this.scene.add(this.grass);

    const fgeo = new THREE.SphereGeometry(0.055, 5, 4);
    const fmat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, roughness: 1 });
    this.flowers = new THREE.InstancedMesh(fgeo, fmat, 160);
    this.flowers.castShadow = false;
    const rf = rng(31);
    const fcol = new THREE.Color();
    for (let i = 0; i < 160; i++) {
      const side = i % 2 ? 1 : -1;
      dummy.position.set(side * (CFG.roadWidth / 2 + 1 + rf() * 3), 0.35 + rf() * 0.25, 24 - rf() * 330);
      dummy.scale.setScalar(0.8 + rf() * 0.8);
      dummy.rotation.set(0, rf() * 6, 0);
      dummy.updateMatrix();
      this.flowers.setMatrixAt(i, dummy.matrix);
      fcol.setHSL(rf() > 0.5 ? 0.12 : 0.97, 0.65, 0.72);
      this.flowers.setColorAt(i, fcol);
    }
    this.flowers.instanceMatrix.needsUpdate = true;
    if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
    this.scene.add(this.flowers);

    // 低矮灌木团：填满路肩，增加层次（一个 InstancedMesh）
    const sgeo = new THREE.IcosahedronGeometry(0.55, 1);
    const smat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: false });
    this.shrubs = new THREE.InstancedMesh(sgeo, smat, 300);
    this.shrubs.castShadow = false;
    this.shrubs.receiveShadow = true;
    this.shrubs.frustumCulled = false;
    const rs = rng(37);
    const scol = new THREE.Color();
    for (let i = 0; i < 300; i++) {
      const side = i % 2 ? 1 : -1;
      const sc = 0.38 + rs() * 0.55;
      dummy.position.set(side * (CFG.roadWidth / 2 + 1.6 + rs() * 3.2), 0.26 * sc, 24 - rs() * 330);
      dummy.rotation.set(0, rs() * 6.28, 0);
      dummy.scale.set(sc * (1.0 + rs() * 0.8), sc * (0.7 + rs() * 0.5), sc);
      dummy.updateMatrix();
      this.shrubs.setMatrixAt(i, dummy.matrix);
      scol.setHSL(0.23 + rs() * 0.08, 0.42 + rs() * 0.2, 0.3 + rs() * 0.16);
      this.shrubs.setColorAt(i, scol);
    }
    this.shrubs.instanceMatrix.needsUpdate = true;
    if (this.shrubs.instanceColor) this.shrubs.instanceColor.needsUpdate = true;
    this.scene.add(this.shrubs);
  }

  /* --------------------------------- 稻田 --------------------------------- */
  _buildFields() {
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
      const r = rng(63);
      ctx.fillStyle = '#b9d6cd';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < 16; y++) {
        const yy = 10 + y * 15;
        ctx.strokeStyle = `rgba(90,130,80,${0.22 + r() * 0.2})`;
        ctx.lineWidth = 5 + r() * 3;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy + (r() - 0.5) * 3); ctx.stroke();
        for (let x = 4; x < w; x += 10) {
          ctx.fillStyle = `rgba(${110 + r() * 40},${150 + r() * 40},${80 + r() * 30},${0.35})`;
          ctx.fillRect(x + r() * 5, yy - 7 - r() * 4, 4, 7);
        }
      }
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 20 + r() * 30, 6 + r() * 10, r() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }, { anisotropy: 4 });
    const count = 84;
    const pGeo = new THREE.PlaneGeometry(1, 1);
    pGeo.rotateX(-Math.PI / 2);
    const pMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xb7c9ba, roughness: 0.95, metalness: 0.0 });
    const rGeo = new THREE.BoxGeometry(1, 0.16, 1);
    const rMat = new THREE.MeshStandardMaterial({ color: 0x8f7c56, roughness: 1, flatShading: true });
    const paddies = new THREE.InstancedMesh(pGeo, pMat, count);
    const rims = new THREE.InstancedMesh(rGeo, rMat, count);
    paddies.receiveShadow = true;
    rims.receiveShadow = true;
    paddies.frustumCulled = false;
    rims.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const rr = rng(67);
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (10.8 + rr() * 2.6);
      const z = 24 - rr() * 350;
      const sx = 2.4 + rr() * 3.4;
      const sz = 3.6 + rr() * 6.5;
      const rot = rr() * 0.35;
      dummy.position.set(x, 0.09, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(sx + 0.7, 1, sz + 0.7);
      dummy.updateMatrix();
      rims.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.18;
      dummy.scale.set(sx, 1, sz);
      dummy.updateMatrix();
      paddies.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.3 + rr() * 0.05, 0.16 + rr() * 0.1, 0.56 + rr() * 0.1);
      paddies.setColorAt(i, col);
    }
    paddies.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    if (paddies.instanceColor) paddies.instanceColor.needsUpdate = true;
    this.fields = new THREE.Group();
    this.fields.add(paddies, rims);
    this.scene.add(this.fields);
    this.paddiesCount = count;
  }

  /* ------------------------------- 云与粒子 ------------------------------- */
  _buildClouds() {
    this.cloudGroup = new THREE.Group();
    const tex = cloudTexture();
    const r = rng(61);
    this.cloudMats = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.72, depthWrite: false, fog: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      const scale = 55 + r() * 65;
      s.scale.set(scale, scale * 0.42, 1);
      s.position.set(-260 + r() * 520, 62 + r() * 40, -300 + r() * 80);
      this.cloudGroup.add(s);
      this.cloudMats.push(m);
    }
    this.scene.add(this.cloudGroup);
  }

  _buildMotes() {
    const tex = dotTexture();
    const count = 200;
    this.moteData = [];
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = {
        x: (Math.random() - 0.5) * 30,
        y: 0.3 + Math.random() * 8,
        z: -3 - Math.random() * 92,
        vy: 0.05 + Math.random() * 0.18,
        phase: Math.random() * 6.28,
        sp: 0.2 + Math.random() * 0.6,
      };
      this.moteData.push(p);
      positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.moteMat = new THREE.PointsMaterial({
      map: tex, size: 0.13, transparent: true, opacity: 0.4, depthWrite: false,
      color: 0xffe8b0, sizeAttenuation: true, alphaTest: 0.01, toneMapped: false,
    });
    this.motes = new THREE.Points(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
    this.moteGeo = geo;
  }

  /* -------------------------------- 路边槽位 ------------------------------- */
  _buildSlots() {
    this.slots = [];
    const layers = [
      { name: 'near', count: 17, gap: 14, start: 26, xBase: CFG.roadWidth / 2 + 0.9, xVar: 1.4 },
      { name: 'mid', count: 12, gap: 25, start: 12, xBase: 12.8, xVar: 4.2 },
      { name: 'far', count: 7, gap: 38, start: 0, xBase: 22, xVar: 8 },
    ];
    for (const layer of layers) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < layer.count; i++) {
          const e = {
            layer: layer.name, side, span: layer.count * layer.gap,
            z: layer.start - i * layer.gap,
            x: side * (layer.xBase + Math.random() * layer.xVar),
            scale: 1, rot: 0, kind: null, group: null,
            layerMeta: layer,
          };
          this._assignEntry(e);
          this.slots.push(e);
        }
      }
    }
  }

  _buildOverhead() {
    // 乡镇的跨街灯笼串
    this.overhead = [];
    for (let i = 0; i < 4; i++) {
      this.overhead.push({ z: 10 - i * 70, span: 280, group: null, kind: 'lanternString' });
    }
  }

  _precache() {
    const kinds = new Set();
    const tables = MVP.enabled ? [TABLES[MVP.stage]] : TABLES;
    for (const t of tables) for (const l of Object.keys(t)) for (const k of t[l]) kinds.add(k);
    if (!MVP.enabled) kinds.add('lanternString');
    for (const kind of kinds) {
      for (let i = 0; i < 2; i++) {
        let g;
        try { g = this._factory(kind); } catch { g = this._fallbackProp(kind); }
        g.visible = false;
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.scene.add(g);
        if (!this.pools.has(kind)) this.pools.set(kind, []);
        this.pools.get(kind).push(g);
      }
    }
  }

  _acquire(kind) {
    const arr = this.pools.get(kind);
    if (arr && arr.length) {
      const g = arr.pop();
      g.visible = true;
      return g;
    }
    const g = this._factory(kind);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g);
    return g;
  }

  _releaseGroup(kind, group) {
    if (!group) return;
    group.visible = false;
    if (!this.pools.has(kind)) this.pools.set(kind, []);
    this.pools.get(kind).push(group);
  }

  _pickKind(layer) {
    const table = TABLES[this.stage]?.[layer] || [];
    if (!table.length) return null;
    return table[Math.floor(Math.random() * table.length)];
  }

  _orient(kind, side) {
    if (/woodFence|stoneBridgeRail|laundryLine/i.test(kind)) return Math.PI / 2;
    if (/streetLamp|trafficLight|crosswalkSign/i.test(kind)) return side < 0 ? 0 : Math.PI;
    if (/scooterParked|pigeon/i.test(kind)) return Math.random() < 0.5 ? 0 : Math.PI;
    if (/pineTree|broadleafTree|bambooCluster|cat|produceBasket|flowerBed|scarecrow|waterfall|gasStove/i.test(kind)) return Math.random() * Math.PI * 2;
    if (/mountainHouse|shopHouse|marketStall|billboard|skyscraper|terraceField|hayCart|fruitSign|busStop|roadSign|streetTree/i.test(kind)) return side < 0 ? Math.PI / 2 : -Math.PI / 2;
    return Math.random() < 0.5 ? 0 : Math.PI;
  }

  _assignEntry(e) {
    const kind = this._pickKind(e.layer);
    if (!kind) {
      if (e.group) { this._releaseGroup(e.kind, e.group); e.group = null; e.kind = null; }
      return;
    }
    if (e.kind !== kind || !e.group) {
      if (e.group) this._releaseGroup(e.kind, e.group);
      e.kind = kind;
      e.group = this._acquire(kind);
    }
    const meta = e.layerMeta;
    e.x = e.side * (meta.xBase + Math.random() * meta.xVar);
    e.rot = this._orient(kind, e.side);
    e.scale = /skyscraper/i.test(kind) ? 1.0 + Math.random() * 0.6 : 0.85 + Math.random() * 0.35;
    e.group.position.set(e.x, 0, e.z);
    e.group.rotation.set(0, e.rot, 0);
    e.group.scale.setScalar(e.scale);
    e.group.visible = true;
  }

  _rebuildSlots() {
    for (const e of this.slots) {
      if (e.group) { this._releaseGroup(e.kind, e.group); e.group = null; e.kind = null; }
    }
    for (const e of this.slots) this._assignEntry(e);
    for (const o of this.overhead) {
      if (o.group) { this._releaseGroup(o.kind, o.group); o.group = null; o.kind = null; }
    }
    if (this.stage === 1) {
      for (const o of this.overhead) {
        o.kind = 'lanternString';
        o.group = this._acquire(o.kind);
        o.group.position.set(0, 0, o.z);
        o.group.rotation.set(0, 0, 0);
        o.group.scale.setScalar(1);
      }
    }
  }

  _updateSlots(dt, speed) {
    for (const e of this.slots) {
      e.z += speed * dt;
      if (e.z > 34) {
        e.z -= e.span;
        this._assignEntry(e);
      }
      if (e.group) {
        e.group.position.z = e.z;
        const tick = e.group.userData?.tick;
        if (tick) tick(this.time, dt);
      }
    }
    for (const o of this.overhead) {
      o.z += speed * dt;
      if (o.z > 34) {
        o.z -= o.span;
        if (o.group) o.group.position.z = o.z;
      }
      if (o.group) o.group.position.z = o.z;
    }
  }

  /* ------------------------------- 地标隧道 ------------------------------- */
  _portal(width, height, openW, openH, color, z, signText) {
    const g = new THREE.Group();
    const matW = mat(color, { roughness: 0.95 });
    const side = (openW - width) / 2; // 负
    const pillarW = (width - openW) / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pillarW, height, 2.2), matW);
      m.position.set(s * (openW / 2 + pillarW / 2), height / 2, z);
      m.castShadow = true;
      g.add(m);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, height - openH, 2.2), matW);
    beam.position.set(0, openH + (height - openH) / 2, z);
    beam.castShadow = true;
    g.add(beam);
    // 内框描边
    const trim = mat(0xd8cdb6, { roughness: 0.9 });
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, openH, 2.4), trim);
      t.position.set(s * openW / 2, openH / 2, z);
      g.add(t);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(openW + 1, 0.5, 2.4), trim);
    top.position.set(0, openH, z);
    g.add(top);
    if (signText) {
      const sign = signBoard(signText, { w: openW * 0.55, h: 1.15, bg: C.signGreen, fg: 0xfff4dc, sub: 'TUNNEL', glow: false });
      sign.position.set(0, openH + (height - openH) * 0.55, z + 1.2);
      g.add(sign);
    }
    return g;
  }

  _makeTunnel(type) {
    const city = type === 'underpass';
    const g = new THREE.Group();
    const L = 74, W = 19, H = 8.4;
    const wallColor = city ? 0x9a978f : 0x6b625a;
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.96 });
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.9, H, L), wallMat);
      wall.position.set(s * (W / 2), H / 2, 0);
      wall.receiveShadow = true;
      g.add(wall);
      // 亮灯带
      for (let i = 0; i < 9; i++) {
        const z = -L / 2 + 6 + i * 8;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 1.5), basicMat(0xffd9a0, { toneMapped: false }));
        strip.position.set(s * (W / 2 - 0.62), 5.6, z);
        g.add(strip);
        const glow = glowSprite(0xffc982, 1.4, 0.45);
        glow.position.set(s * (W / 2 - 0.7), 5.5, z);
        g.add(glow);
      }
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.5, L), wallMat);
    ceil.position.set(0, H, 0);
    g.add(ceil);
    // 地面深色带
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ color: 0x555651, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    g.add(floor);

    g.add(this._portal(W + 9, H + 5.2, W - 1.2, H - 0.5, city ? 0xb7b2a7 : 0x8d8273, L / 2 + 1.1, city ? '城市下穿' : '南山隧道'));
    g.add(this._portal(W + 9, H + 5.2, W - 1.2, H - 0.5, city ? 0xb7b2a7 : 0x8d8273, -L / 2 - 1.1, null));

    // 隧道顶灯（两侧 + 中央），让内部可读
    for (let i = 0; i < 7; i++) {
      const z = -L / 2 + 7 + i * 9;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), basicMat(0xffd9a0, { toneMapped: false }));
      panel.position.set(0, H - 0.28, z);
      g.add(panel);
      const gl = glowSprite(0xffc27a, 3.2, 0.42);
      gl.position.set(0, H - 0.6, z);
      g.add(gl);
    }
    const lightA = new THREE.PointLight(0xffc27a, 22, 46, 2);
    lightA.position.set(0, 6.6, -12);
    g.add(lightA);
    const lightB = new THREE.PointLight(0xffc27a, 18, 40, 2);
    lightB.position.set(0, 6.6, 16);
    g.add(lightB);
    if (!city) {
      // 隧道顶上的山体：整体抬高到天花板之上，绝不侵入隧道内部
      for (let i = 0; i < 3; i++) {
        const hill = icoMesh(1, i % 2 ? 0x5f7f4c : 0x6e8f58, { detail: 1, flatShading: true });
        hill.scale.set(27 + i * 4, 10 + i * 2, 44);
        hill.position.set(-10 + i * 10, H + 0.2 + (10 + i * 2), -4 + i * 5);
        hill.castShadow = true;
        g.add(hill);
      }
      for (const sx of [-1, 1]) {
        const sideHill = icoMesh(1, sx > 0 ? 0x5a7a49 : 0x658553, { detail: 1, flatShading: true });
        sideHill.scale.set(10, 12, 42);
        sideHill.position.set(sx * 22, 4, -4);
        sideHill.castShadow = true;
        g.add(sideHill);
      }
      for (let i = 0; i < 9; i++) {
        const tree = this._factory(i % 2 ? 'pineTree' : 'broadleafTree');
        tree.scale.setScalar(0.7 + Math.random() * 0.5);
        tree.position.set(-16 + Math.random() * 32, 18 + Math.random() * 7, -24 + Math.random() * 40);
        g.add(tree);
      }
    } else {
      // 高架桥面与人行道
      const deck = new THREE.Mesh(new THREE.BoxGeometry(64, 1.5, 16), mat(0xb0aa9c, { roughness: 0.9 }));
      deck.position.set(0, H + 3.2, 8);
      deck.castShadow = true;
      g.add(deck);
      for (const x of [-26, 26]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.6, H, 1.6), mat(0xa39c8e));
        col.position.set(x, H / 2, 8);
        g.add(col);
      }
    }
    return g;
  }

  _makeArrival() {
    const g = new THREE.Group();
    // 主楼
    const tex = facadeTexture({ cols: 8, rows: 18, width: 512, height: 1024, base: 0xcfc5b2, window: 0x8a9aa8, lit: 0xffd087, litRatio: 0.45, seed: 7 });
    const towerMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissiveMap: tex, emissive: 0x3a2a18, emissiveIntensity: 0.22 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 34, 14), towerMat);
    tower.position.set(0, 17, -18);
    tower.castShadow = true;
    g.add(tower);
    // 两侧裙楼
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 18, 12), towerMat);
      wing.position.set(sx * 17, 9, -20);
      g.add(wing);
    }
    // 顶部招牌
    const roofSign = signBoard('幸福里', { w: 7, h: 1.6, bg: C.signCream, fg: 0x24372f, sub: 'HAPPY GARDEN', glow: false });
    roofSign.position.set(0, 33.5, -10.9);
    g.add(roofSign);

    // 入口门厅
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(9.2, 4.6, 2.2), mat(0x3c4641, { roughness: 0.6, metalness: 0.1 }));
    lobby.position.set(0, 2.3, -10.6);
    g.add(lobby);
    const glassTex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#2b3532';
      ctx.fillRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#ffe3ae');
      grad.addColorStop(0.55, '#f6b45e');
      grad.addColorStop(1, '#a96537');
      ctx.fillStyle = grad;
      ctx.fillRect(14, 18, w - 28, h - 36);
      // 门框
      ctx.fillStyle = '#27312e';
      for (let i = 1; i < 4; i++) ctx.fillRect(14 + (w - 28) * i / 4 - 3, 18, 6, h - 36);
      ctx.fillRect(14, h * 0.52, w - 28, 5);
      // 内部人物与反光
      ctx.fillStyle = 'rgba(36,55,47,0.55)';
      ctx.beginPath(); ctx.arc(w * 0.72, h * 0.5, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(w * 0.7, h * 0.56, 20, 46);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(40, h - 20); ctx.lineTo(150, 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(190, h - 20); ctx.lineTo(300, 20); ctx.stroke();
    }, { anisotropy: 4 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 3.9), new THREE.MeshBasicMaterial({ map: glassTex, toneMapped: false }));
    glass.position.set(0, 2.25, -9.46);
    g.add(glass);
    // 雨棚与门柱
    const canopy = boxMesh(9.8, 0.32, 2.6, C.signRed, { radius: 0.06 });
    canopy.position.set(0, 4.5, -8.8);
    g.add(canopy);
    const canopyTrim = boxMesh(9.9, 0.08, 2.7, C.cream, { radius: 0.02 });
    canopyTrim.position.set(0, 4.68, -8.8);
    g.add(canopyTrim);
    for (const sx of [-1, 1]) {
      put(g, boxMesh(0.42, 4.5, 0.42, C.plaster, { radius: 0.05 }), sx * 4.35, 2.25, -8.6);
    }
    // 入口暖光
    const entryLight = new THREE.PointLight(0xffb768, 7, 22, 2);
    entryLight.position.set(0, 3.2, -8.2);
    g.add(entryLight);
    for (let i = 0; i < 3; i++) {
      const gl = glowSprite(0xffb768, 2.4, 0.38);
      gl.position.set(-2.6 + i * 2.6, 3.6, -8.7);
      g.add(gl);
    }
    // 红地毯 + 台阶
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 11.5), basicMat(0xb4403a, { toneMapped: false }));
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, 0.022, -4.4);
    g.add(carpet);
    const carpetTrim = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 11.5), basicMat(0xf2d06b, { toneMapped: false }));
    carpetTrim.rotation.x = -Math.PI / 2;
    carpetTrim.position.set(0, 0.018, -4.4);
    g.add(carpetTrim);
    // 门牌
    const sign1 = signBoard('幸福里 · 3栋', { w: 7.4, h: 1.5, bg: C.signCream, fg: 0x24372f, sub: 'HAPPY GARDEN · 3', glow: false });
    sign1.position.set(0, 5.8, -9.4);
    g.add(sign1);
    const plaque = signBoard('已送达', { w: 2.2, h: 0.9, bg: C.signRed, fg: 0xfff4dc, glow: false });
    plaque.position.set(0, 1.0, -9.4);
    g.add(plaque);

    // 迎宾小人
    const greeter = new THREE.Group();
    put(greeter, cylMesh(0.18, 0.22, 0.8, C.mint, { segments: 8 }), 0, 0.85, 0);
    put(greeter, sphereMesh(0.2, 0xf0c49d, { segments: 10 }), 0, 1.42, 0);
    put(greeter, sphereMesh(0.22, 0x5a3b2b, { segments: 10 }), 0, 1.48, -0.03).scale.set(1, 0.8, 1);
    put(greeter, boxMesh(0.42, 0.5, 0.36, C.cream, { radius: 0.08 }), 0, 0.9, 0.02);
    put(greeter, cylMesh(0.06, 0.06, 0.7, C.mint, { segments: 6 }), -0.28, 1.18, 0).rotation.z = 0.7;
    put(greeter, cylMesh(0.06, 0.06, 0.7, C.mint, { segments: 6 }), 0.28, 1.18, 0).rotation.z = -1.15;
    put(greeter, cylMesh(0.06, 0.06, 0.55, C.white, { segments: 6 }), 0, 0.55, 0).rotation.z = 0.6;
    greeter.position.set(2.7, 0, -7.7);
    greeter.rotation.y = -0.6;
    g.add(greeter);
    // 盆栽
    for (const sx of [-1, 1]) {
      const pot = new THREE.Group();
      put(pot, cylMesh(0.36, 0.28, 0.5, C.terracotta, { segments: 9 }), 0, 0.25, 0);
      for (let i = 0; i < 3; i++) put(pot, icoMesh(0.36, i % 2 ? C.leaf2 : C.leaf3, { detail: 0 }), (i - 1) * 0.2, 0.75 + i * 0.12, (i % 2) * 0.18);
      pot.position.set(sx * 5.4, 0, -7.9);
      g.add(pot);
    }
    // 气球
    const balloonColors = [C.signRed, C.mint, C.yellowBright, 0x9fb8d9];
    for (let i = 0; i < 4; i++) {
      const b = sphereMesh(0.28, balloonColors[i], { segments: 10 });
      b.position.set(-3.4 + i * 1.6, 5.2 + (i % 2) * 0.5, -9.1);
      g.add(b);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 3), basicMat(0xffffff, { transparent: true, opacity: 0.45 }));
      str.position.set(b.position.x, b.position.y - 1.0, b.position.z);
      g.add(str);
    }
    // 气拱门
    const arch = new THREE.Group();
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 5.4, 8), mat(C.mint, { roughness: 0.7 }));
      p.position.set(s * 4.7, 2.7, -5.6);
      arch.add(p);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.52, 8, 6), mat(C.mintLight, { roughness: 0.7 }));
      top.position.set(s * 4.7, 5.4, -5.6);
      arch.add(top);
    }
    const banner = signBoard('奶茶已送达', { w: 8.6, h: 1.1, bg: C.signRed, fg: 0xfff4dc, sub: 'THANK YOU · ON TIME', glow: false });
    banner.position.set(0, 5.4, -5.6);
    arch.add(banner);
    g.add(arch);
    // 路障锥放两侧
    for (let i = 0; i < 4; i++) {
      const cone = this._factory('cone');
      cone.position.set((i % 2 ? 1 : -1) * 5.2, 0, -2.5 - Math.floor(i / 2) * 2.4);
      cone.scale.setScalar(1);
      g.add(cone);
    }
    return g;
  }

  _spawnLandmark(m) {
    let g;
    if (m.type === 'tunnel') g = this._makeTunnel('tunnel');
    else if (m.type === 'underpass') g = this._makeTunnel('underpass');
    else g = this._makeArrival();
    g.position.set(0, 0, this.distance - m.d);
    g.userData.landmark = m;
    this.scene.add(g);
    this.landmarks.push({ group: g, m });
    m.spawned = true;
  }

  _updateLandmarks(dt, speed) {
    for (let i = this.landmarks.length - 1; i >= 0; i--) {
      const l = this.landmarks[i];
      l.group.position.z += speed * dt;
      if (l.group.position.z > 90) {
        this.scene.remove(l.group);
        this.landmarks.splice(i, 1);
      }
    }
  }

  _checkMilestones(distance) {
    if (MVP.enabled) return;
    for (const m of this.milestones) {
      if (!m.spawned && distance >= m.d - 200) this._spawnLandmark(m);
    }
    if (!this.stageFlags[1] && distance >= 700) {
      this.stageFlags[1] = true;
      this._setStage(1);
      this.onStage?.(1);
    }
    if (!this.stageFlags[2] && distance >= 1400) {
      this.stageFlags[2] = true;
      this._setStage(2);
      this.onStage?.(2);
    }
    if (!this.arrivalFired && distance >= 2094) {
      this.arrivalFired = true;
      this.onArrival?.();
    }
  }

  /* --------------------------------- 阶段 --------------------------------- */
  setStage(index) {
    this._setStage(clamp(index, 0, 2));
  }

  _setStage(index, silent = false) {
    const changed = this.stage !== index;
    this.stage = index;
    this._applyStage(index, silent);
    if (changed) this._rebuildSlots();
    if (changed && !silent) {
      // 由 _checkMilestones 触发 onStage；QA 手动切换也要有小反馈
      if (!this._manualStage) this._manualStage = true;
    }
  }

  _applyStage(index, silent) {
    const sky = STAGE_SKY[index];
    this.skyUniforms.uTop.value.set(sky.top);
    this.skyUniforms.uMid.value.set(sky.mid);
    this.skyUniforms.uHorizon.value.set(sky.horizon);
    this.skyUniforms.uSunColor.value.set(sky.sun);
    this.skyUniforms.uSunDir.value.copy(SUN_DIRS[index]);
    this.skyUniforms.uSunStrength.value = [1.15, 0.95, 1.3][index];
    this.scene.background.set(sky.horizon);
    this.scene.fog.color.set(sky.fog);
    this.scene.fog.density = STAGE_FOG[index];
    this.sunSprite.position.copy(SUN_DIRS[index]).multiplyScalar(CFG.world.skyRadius * 0.92);
    this.sunCore.position.copy(SUN_DIRS[index]).multiplyScalar(CFG.world.skyRadius * 0.915);
    this.sunDisc.position.copy(SUN_DIRS[index]).multiplyScalar(CFG.world.skyRadius * 0.905);
    this.sunSprite.material.opacity = [0.72, 0.65, 0.8][index];
    this.sunCore.material.opacity = [0.9, 0.75, 0.9][index];

    this.hemi.color.set(sky.amb);
    this.hemi.groundColor.set(STAGE_GROUND[index]);
    this.hemi.intensity = [1.12, 1.45, 1.22][index];
    this.sun.color.set(sky.light);
    this.sun.intensity = [3.2, 3.35, 2.6][index];
    const dir = SUN_DIRS[index];
    this.sun.position.copy(dir).multiplyScalar(85);
    this.sun.position.y = Math.max(18, this.sun.position.y);
    this.sun.target.position.set(0, 0, -8);
    this.fill.intensity = [0.34, 0.42, 0.6][index];
    this.fill.color.set([0x9fc4d8, 0xbfe0ee, 0xd8a9a0][index]);
    this.renderer.toneMappingExposure = [0.95, 0.99, 0.93][index];

    this.groundMat.color.set(STAGE_GROUND[index]);
    this.roadMat.color.set(STAGE_ROAD[index]);
    this.shoulderMat.color.set([0x93845f, 0xa08b67, 0x817a70][index]);
    this.markMat.color.set(index === 2 ? 0xffffff : 0xfff0c8);
    this.edgeLineMat.color.set(index === 2 ? 0xffffff : 0xf6e8c4);
    this.sidewalkMat.color.set(index === 2 ? 0xb9b3a6 : 0xa39a89);

    for (const s of this.ruralShoulders || []) s.visible = index !== 2;
    for (const s of this.cityWalks || []) s.visible = index === 2;
    this.grass.visible = index !== 2;
    this.flowers.visible = index !== 2;
    this.shrubs.visible = index !== 2;
    this.fields.visible = index !== 2;

    this.backMountain.visible = index !== 2;
    this.backTown.visible = index === 1;
    this.backCity.visible = index === 2;

    for (const m of this.cloudMats) {
      m.color.set([0xfff8ee, 0xffffff, 0xffe0d6][index]);
      m.opacity = [0.42, 0.5, 0.35][index];
    }
    this.moteMat.color.set([0xffe8b0, 0xffd7e2, 0xffd08a][index]);
    this.moteMat.size = [0.16, 0.18, 0.13][index];
    this.moteMat.opacity = [0.45, 0.5, 0.4][index];
  }

  /* --------------------------------- 更新 --------------------------------- */
  update(dt, { distance, speed, time, camera }) {
    this.time = time;
    this.distance = distance;
    this.scroll += speed * dt;
    this._updateSlots(dt, speed);
    this._updateLandmarks(dt, speed);
    this._checkMilestones(distance);

    this.dashes.position.z = this.scroll % 8;
    if (this.grass.visible) this.grass.position.z = this.scroll % 16;
    if (this.flowers.visible) this.flowers.position.z = this.scroll % 16;
    if (this.shrubs.visible) this.shrubs.position.z = this.scroll % 18;
    if (this.fields.visible) this.fields.position.z = this.scroll % 22;

    // 云轻微漂移
    this.cloudGroup.children.forEach((s, i) => {
      s.position.x += Math.sin(this.time * 0.05 + i) * dt * 0.4;
    });

    // 氛围粒子
    const pos = this.moteGeo.attributes.position.array;
    for (let i = 0; i < this.moteData.length; i++) {
      const p = this.moteData[i];
      p.z += speed * dt * 0.9;
      p.x += Math.sin(this.time * 0.7 + p.phase) * dt * 0.35;
      p.y += Math.cos(this.time * 0.5 + p.phase) * dt * 0.12;
      if (p.z > -2) { p.z -= 100; p.x = (Math.random() - 0.5) * 30; p.y = 0.3 + Math.random() * 8; }
      if (p.y < 0.2) p.y = 0.2;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    }
    this.moteGeo.attributes.position.needsUpdate = true;

    this._updateSky(camera);
  }

  reset() {
    for (const l of this.landmarks) this.scene.remove(l.group);
    this.landmarks = [];
    for (const m of this.milestones) m.spawned = false;
    this.stageFlags = [true, false, false];
    this.arrivalFired = false;
    this.scroll = 0;
    this.distance = 0;
    this.time = 0;
    this.stage = MVP.enabled ? MVP.stage : 0;
    this._applyStage(this.stage, true);
    this._rebuildSlots();
    for (const o of this.overhead) { o.z = 10 - this.overhead.indexOf(o) * 70; if (o.group) o.group.position.z = o.z; }
  }
}
