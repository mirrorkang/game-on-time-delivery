// rider.js — 两位骑手的模型、物理与动作表现
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CFG, clamp, damp } from './config.js';
import { glowSprite, shadowTexture } from './artkit.js';

export const RIDERS = {
  alan: { id: 'alan', name: '阿蓝', url: './assets/rider.glb', weight: 0.62 },
  xiaoman: { id: 'xiaoman', name: '小满', url: './assets/rider-girl.glb', weight: 0.38 },
};

export class Rider {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.tilt = new THREE.Group();
    this.group.add(this.tilt);
    scene.add(this.group);
    this.models = {};
    this.riderId = 'alan';
    this.time = 0;
    this.onLand = null;
    this.onSlam = null;
    this.shadowY = 0.02;
    this._buildShared();
    this.reset();
  }

  _buildShared() {
    // 接地影
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 3.0),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.62, depthWrite: false, toneMapped: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 3;
    this.scene.add(shadow);
    this.shadow = shadow;

    // 车头灯
    const head = new THREE.SpotLight(0xffd8a0, 0.5, 26, 0.5, 0.55, 1.2);
    head.position.set(0, 1.0, -1.0);
    head.target.position.set(0, 0.2, -10);
    this.group.add(head);
    this.group.add(head.target);
    this.headLight = head;
    const hg = glowSprite(0xffe4b0, 0.9, 0.55);
    hg.position.set(0, 0.86, -1.03);
    this.group.add(hg);
    this.headGlow = hg;

    // 尾灯
    const tg = glowSprite(0xff5b4a, 0.55, 0.5);
    tg.position.set(0, 0.6, 1.05);
    this.group.add(tg);
    this.tailGlow = tg;

    // 氮气火焰
    this.flames = new THREE.Group();
    this.flames.position.set(0, 0.55, 1.0);
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 1.5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    outer.rotation.x = Math.PI / 2;
    outer.position.z = 0.7;
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.9, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    inner.rotation.x = Math.PI / 2;
    inner.position.z = 0.42;
    this.flames.add(outer, inner);
    this.flames.visible = false;
    this.group.add(this.flames);
    this.boostLight = new THREE.PointLight(0xff8a3d, 0, 8, 2);
    this.boostLight.position.set(0, 0.6, 1.2);
    this.group.add(this.boostLight);

    // 护盾
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x9fe6d4, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    );
    this.shield.position.y = 1.0;
    this.shield.scale.set(1.05, 0.95, 1.3);
    this.shield.visible = false;
    this.group.add(this.shield);

    // 磁铁光环
    this.magnetRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.035, 6, 30),
      new THREE.MeshBasicMaterial({ color: 0x6fc7b4, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.magnetRing.rotation.x = -Math.PI / 2;
    this.magnetRing.position.y = 0.16;
    this.magnetRing.visible = false;
    this.group.add(this.magnetRing);
  }

  async load(onProgress, opts = {}) {
    const ids = opts.only && RIDERS[opts.only] ? [opts.only] : Object.keys(RIDERS);
    const loaded = {};
    const progress = {};
    const weight = ids.length === 1 ? 1 : 0.62;
    ids.forEach((id, i) => { progress[id] = 0; loaded[id] = null; });
    const report = () => {
      let p = 0;
      for (const id of ids) p += (progress[id] || 0) / ids.length;
      onProgress?.(Math.min(0.99, p));
    };
    const loadOne = (info) => new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(info.url, (gltf) => {
        progress[info.id] = 1;
        report();
        resolve(gltf);
      }, (ev) => {
        if (ev.lengthComputable && ev.total) progress[info.id] = ev.loaded / ev.total;
        report();
      }, reject);
    });
    const gltfs = await Promise.all(ids.map((id) => loadOne(RIDERS[id])));
    ids.forEach((id, i) => {
      this.models[id] = this._prepare(gltfs[i], 2.0);
      this.tilt.add(this.models[id]);
      this.models[id].visible = false;
    });
    const preferred = ids.includes('xiaoman') && ids.length === 1 ? 'xiaoman' : (this.riderId || ids[0]);
    this.riderId = ids.includes(preferred) ? preferred : ids[0];
    this.setRider(this.riderId);
    onProgress?.(1);
    return true;
  }

  _prepare(gltf, scale) {
    const root = gltf.scene;
    root.scale.setScalar(scale);
    root.rotation.y = Math.PI;
    root.position.y = 0;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if (o.material) {
          o.material.roughness = Math.min(1, (o.material.roughness ?? 0.9) + 0.02);
          o.material.envMapIntensity = 0.75;
          o.material.needsUpdate = true;
        }
      }
    });
    return root;
  }

  setRider(id) {
    if (!this.models[id]) return;
    this.riderId = id;
    for (const k of Object.keys(this.models)) this.models[k].visible = k === id;
    if (this._lastRider !== id) {
      this._lastRider = id;
      // 换人时的小庆祝：轻微弹一下
      this.squash = 0.08;
    }
  }

  reset() {
    this.lane = 1;
    this.targetLane = 1;
    this.x = 0;
    this.prevX = 0;
    this.y = 0;
    this.vy = 0;
    this.onGround = true;
    this.sliding = false;
    this.slideT = 0;
    this.lean = 0;
    this.pitch = 0;
    this.squash = 0;
    this.squashVel = 0;
    this.invincible = 0;
    this.hitTimer = 0;
    this.boosting = false;
    this.jumpHeld = false;
    this.slam = false;
    this.time = 0;
    this.airTime = 0;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.tilt.rotation.set(0, 0, 0);
    this.tilt.scale.set(1, 1, 1);
    this.flames.visible = false;
    this.shield.visible = false;
    this.magnetRing.visible = false;
    this.headLight.intensity = 0.5;
    this.headGlow.material.opacity = 0.45;
    this.tailGlow.material.opacity = 0.5;
  }

  setLane(dir) {
    const next = clamp(this.lane + dir, 0, 2);
    if (next !== this.lane) {
      this.lane = next;
      this.targetLane = next;
      this.leanImpulse = 0.2 * dir;
    }
  }

  jump() {
    if (this.onGround) {
      this.vy = CFG.player.jumpV;
      this.onGround = false;
      this.sliding = false;
      this.slideT = 0;
      this.slam = false;
      this.airTime = 0;
      this.squash = 0.1;
      return 'jump';
    }
    return false;
  }

  releaseJump() {
    // MVP 采用固定高度跳跃：轻点也能跳过锥桶，避免手感陷阱
    if (!this.onGround && this.vy > 1.2) this.vy *= 1.0;
  }

  slide() {
    if (this.onGround) {
      if (this.sliding) return 'slide';
      this.sliding = true;
      this.slideT = 0.95;
      return 'slide';
    }
    // 空中下压：快速落地
    this.vy = Math.min(this.vy, -19);
    this.slam = true;
    return 'slam';
  }

  setBoost(on) {
    this.boosting = on;
    this.flames.visible = on;
    this.boostLight.intensity = on ? 2.6 : 0;
  }

  setShield(on) { this.shield.visible = on; }
  setMagnet(on) { this.magnetRing.visible = on; }

  hit() {
    this.invincible = 2.1;
    this.hitTimer = 0.35;
    this.leanImpulse = (Math.random() > 0.5 ? 1 : -1) * 0.5;
    this.squash = -0.14;
  }

  get height() { return this.sliding ? CFG.player.slideHeight : CFG.player.standHeight; }
  get grounded() { return this.onGround; }

  getBounds() {
    return {
      x: this.x,
      y: this.y,
      height: this.height,
      width: CFG.player.width,
      z: 0,
    };
  }

  update(dt, speed, timeScale = 1) {
    this.time += dt;
    const p = CFG.player;
    // 滑铲计时
    if (this.sliding) {
      this.slideT -= dt;
      if (this.slideT <= 0) this.sliding = false;
    }
    // 变道
    this.prevX = this.x;
    this.x = damp(this.x, CFG.laneX[this.targetLane], p.laneLerp, dt);
    if (Math.abs(this.x - this.prevX) > 0.002) {
      this.targetTilt = clamp((this.prevX - this.x) / Math.max(dt, 1e-4) * 0.012, -0.34, 0.34);
    } else {
      this.targetTilt = 0;
    }
    this.lean = damp(this.lean, this.targetTilt + (this.leanImpulse || 0), 9, dt);
    this.leanImpulse = (this.leanImpulse || 0) * Math.exp(-7 * dt);

    // 跳跃
    if (!this.onGround) {
      this.airTime += dt;
      this.y += this.vy * dt;
      this.vy -= p.gravity * dt;
      if (this.y <= 0) {
        const impact = Math.min(1, Math.abs(this.vy) / 12);
        this.y = 0;
        this.vy = 0;
        this.onGround = true;
        this.squash = -0.13 - impact * 0.1;
        if (this.slam) { this.onSlam?.(impact); this.slam = false; }
        this.onLand?.(impact);
      }
    }

    // 目标俯仰
    let targetPitch = 0;
    if (!this.onGround) targetPitch = clamp(-this.vy * 0.012, -0.16, 0.2);
    if (this.sliding) targetPitch += 0.1;
    if (this.hitTimer > 0) targetPitch -= 0.18;
    this.pitch = damp(this.pitch, targetPitch, 10, dt);

    // squash 弹簧
    this.squashVel += (-this.squash * 90 - this.squashVel * 13) * dt;
    this.squash += this.squashVel * dt;
    if (this.squashVel > 30) this.squashVel = 30;

    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.invincible = Math.max(0, this.invincible - dt);

    // 位置与姿态
    const bob = this.onGround ? Math.sin(this.time * 18) * Math.min(0.02, speed * 0.0014) : 0;
    this.group.position.set(this.x, this.y + (this.sliding ? 0 : bob), 0);
    this.group.rotation.z = this.lean * 0.55;
    this.group.rotation.y = -this.lean * 0.18;
    this.tilt.rotation.x = this.pitch;
    const sy = 1 + this.squash;
    const sxz = 1 - this.squash * 0.45;
    // 滑铲时整体压低（视觉高度约 1.2m，才能从 1.3m 门架下钻过）
    this.tilt.scale.set(this.sliding ? sxz * 1.06 : sxz, sy * (this.sliding ? 0.6 : 1), this.sliding ? sxz * 1.06 : sxz);
    this.tilt.rotation.z = this.sliding ? 0.1 : 0;
    this.tilt.position.y = this.sliding ? -0.16 : 0;

    // 火焰抖动
    if (this.flames.visible) {
      const f = 0.8 + Math.sin(this.time * 42) * 0.22 + Math.random() * 0.12;
      this.flames.scale.set(1, f, 0.9 + Math.random() * 0.2);
      this.boostLight.intensity = 2.2 + Math.random() * 1.1;
    }
    if (this.shield.visible) {
      const t = this.time;
      this.shield.rotation.y += dt * 1.2;
      this.shield.material.opacity = 0.08 + 0.05 * (0.5 + 0.5 * Math.sin(t * 6));
    }
    if (this.magnetRing.visible) {
      this.magnetRing.rotation.z += dt * 2.2;
      this.magnetRing.position.y = 0.18 + Math.sin(this.time * 4) * 0.05;
    }
    // 无敌时保持可见（闪烁改为护盾/描边反馈，避免截图与可读性问题）
    for (const key of Object.keys(this.models)) this.models[key].visible = key === this.riderId;

    // 接地影
    this.shadow.position.set(this.x * 0.98, 0.015, 0.12);
    const h = Math.max(0, this.y);
    const s = 1 - Math.min(0.5, h * 0.16);
    this.shadow.scale.set(s, s, s);
    this.shadow.material.opacity = 0.6 * (1 - Math.min(0.75, h * 0.28));
  }

  updateIdle(dt, t) {
    this.time += dt;
    const bob = Math.sin(t * 1.6) * 0.012;
    this.group.position.set(this.x, bob, 0);
    this.group.rotation.z = Math.sin(t * 0.7) * 0.008;
    this.tilt.rotation.x = Math.sin(t * 1.2) * 0.004;
    this.tilt.scale.set(1, 1, 1);
    this.shadow.position.set(this.x, 0.015, 0.12);
    this.shadow.scale.set(1, 1, 1);
    this.shadow.material.opacity = 0.6;
  }

  setStage(index) {
    this.headLight.intensity = [0.35, 0.45, 1.5][index] ?? 0.4;
    this.headGlow.material.opacity = [0.3, 0.35, 0.8][index] ?? 0.4;
    this.tailGlow.material.opacity = [0.35, 0.4, 0.7][index] ?? 0.4;
  }
}
