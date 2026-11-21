// fx.js — 粒子、速度线、冲击波、震屏、彩带
import * as THREE from 'three';
import { canvasTexture, clamp } from './artkit.js';

const MAX = 420;

function makePointsMaterial(renderer, additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uPR: { value: Math.min(2, renderer.getPixelRatio()) } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uPR;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPR * (320.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.02, d);
        gl_FragColor = vec4(vColor, a * vAlpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

class ParticlePool {
  constructor(scene, renderer, additive) {
    this.max = MAX;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.data = new Array(MAX);
    for (let i = 0; i < MAX; i++) this.data[i] = { alive: false };
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.points = new THREE.Points(geo, makePointsMaterial(renderer, additive));
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
    this.cursor = 0;
  }
  spawn(o) {
    const i = this.cursor = (this.cursor + 1) % this.max;
    const d = this.data[i];
    d.alive = true;
    d.life = d.maxLife = o.life;
    d.vx = o.vx; d.vy = o.vy; d.vz = o.vz;
    d.gravity = o.gravity ?? 0;
    d.drag = o.drag ?? 0.6;
    d.size = o.size;
    d.grow = o.grow ?? 0;
    d.color = o.color;
    d.alpha0 = o.alpha ?? 1;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.col[i * 3] = o.color.r; this.col[i * 3 + 1] = o.color.g; this.col[i * 3 + 2] = o.color.b;
    this.size[i] = o.size;
    this.alpha[i] = d.alpha0;
  }
  update(dt, worldSpeed) {
    const { pos, size, alpha, data } = this;
    for (let i = 0; i < this.max; i++) {
      const d = data[i];
      if (!d.alive) { alpha[i] = 0; continue; }
      d.life -= dt;
      if (d.life <= 0) { d.alive = false; alpha[i] = 0; continue; }
      const t = Math.max(0, d.life / d.maxLife);
      d.vz += worldSpeed * dt * 0.65;
      d.vx *= Math.exp(-d.drag * dt);
      d.vy *= Math.exp(-d.drag * dt);
      d.vz *= Math.exp(-0.15 * dt);
      d.vy += d.gravity * dt;
      pos[i * 3] += d.vx * dt;
      pos[i * 3 + 1] += d.vy * dt;
      pos[i * 3 + 2] += d.vz * dt;
      if (pos[i * 3 + 1] < 0.01) { pos[i * 3 + 1] = 0.01; d.vy *= -0.25; d.vx *= 0.6; d.vz *= 0.6; }
      size[i] = d.size + d.grow * (1 - t);
      alpha[i] = d.alpha0 * Math.min(1, t * 3.2) * Math.min(1, (1 - t) * 9 + 0.1);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.time = 0;
    this.worldSpeed = 0;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeR = 0;
    this.speed01 = 0;
    this.boosting = false;
    this.dust = new ParticlePool(scene, renderer, false);
    this.spark = new ParticlePool(scene, renderer, true);

    // 速度线
    this.canvas = document.querySelector('#speed-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.lines = Array.from({ length: 26 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.2 + Math.random() * 0.8,
      len: 0.12 + Math.random() * 0.3,
      spd: 0.55 + Math.random() * 0.9,
      w: 1 + Math.random() * 2.2,
    }));
    this.resize();

    // 冲击波
    this.ringTex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.22, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.88, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 4;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, dur: 1, max: 1 });
    }
    this.stars = null;
  }

  setWorldSpeed(v) { this.worldSpeed = v; }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.floor(innerWidth * dpr);
    this.canvas.height = Math.floor(innerHeight * dpr);
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.dpr = dpr;
    this.w = innerWidth;
    this.h = innerHeight;
  }

  addShake(v = 0.3) { this.trauma = clamp(this.trauma + v, 0, 1); }

  updateShake(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const t = this.trauma * this.trauma;
    const tt = this.time * 34;
    this.shakeX = Math.sin(tt * 1.3) * 0.36 * t;
    this.shakeY = Math.cos(tt * 1.7) * 0.25 * t;
    this.shakeR = Math.sin(tt * 0.9) * 0.025 * t;
  }

  dustBurst(pos, count = 8, color = 0xd9c9a8, power = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.2) * power;
      this.dust.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + Math.random() * 0.2, z: pos.z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * s * 0.6, vy: 0.4 + Math.random() * 1.1, vz: Math.sin(a) * s * 0.5 + 1.2,
        size: 0.22 + Math.random() * 0.3, grow: 0.5, life: 0.5 + Math.random() * 0.4, color: c, alpha: 0.32 + Math.random() * 0.25, gravity: -0.7, drag: 1.8,
      });
    }
  }

  sparkBurst(pos, count = 14, color = 0xffc247, power = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const s = (1.4 + Math.random() * 3.6) * power;
      this.spark.spawn({
        x: pos.x, y: pos.y + Math.random() * 0.2, z: pos.z,
        vx: Math.cos(a) * s, vy: up * s * 0.8, vz: Math.sin(a) * s * 0.8 + 1,
        size: 0.05 + Math.random() * 0.09, life: 0.35 + Math.random() * 0.5, color: c, alpha: 1, gravity: -6.5, drag: 0.4,
      });
    }
  }

  sparks(pos, count = 8, color = 0xffd28a) { this.sparkBurst(pos, count, color, 0.7); }

  pickup(pos, color = 0xf2d06b) {
    this.sparkBurst(pos, 16, color, 0.9);
    const c2 = Math.random() > 0.5 ? 0xffffff : 0xffe0a0;
    this.sparkBurst(pos, 6, c2, 0.45);
    this.ring(pos, 0xffe0a0, 1.6, 0.4);
  }

  powerup(pos, color = 0x6fc7b4) {
    this.sparkBurst(pos, 26, color, 1.2);
    this.ring(pos, color, 3.2, 0.6);
  }

  splash(pos) {
    const c = new THREE.Color(0xcfe6e2);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.dust.spawn({
        x: pos.x, y: 0.08, z: pos.z, vx: Math.cos(a) * (0.5 + Math.random() * 1.7), vy: 1 + Math.random() * 2.2, vz: Math.sin(a) * 0.8 + 1.4,
        size: 0.08 + Math.random() * 0.12, grow: 0.15, life: 0.35 + Math.random() * 0.3, color: c, alpha: 0.85, gravity: -9, drag: 0.2,
      });
    }
  }

  ring(pos, color = 0xffffff, max = 2, dur = 0.5) {
    const r = this.rings.find((r) => r.life <= 0) || this.rings[0];
    r.life = r.dur = dur;
    r.max = max;
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, 0.04, pos.z);
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.9;
    r.mesh.scale.setScalar(0.3);
  }

  confetti(center) {
    const colors = [0xe4574c, 0xf2d06b, 0x6fc7b4, 0xf7f2e7, 0xef9d4d, 0x8fa3d9];
    for (let i = 0; i < 140; i++) {
      const c = new THREE.Color(colors[i % colors.length]);
      const a = Math.random() * Math.PI * 2, rad = Math.random() * 6;
      this.spark.spawn({
        x: center.x + Math.cos(a) * rad, y: center.y + 2 + Math.random() * 3, z: center.z - 3 + Math.sin(a) * rad,
        vx: (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 3.5, vz: (Math.random() - 0.5) * 3,
        size: 0.12 + Math.random() * 0.12, life: 2.2 + Math.random() * 1.6, color: c, alpha: 1, gravity: -6, drag: 0.8,
      });
    }
  }

  update(dt, speed01 = 0, boosting = false) {
    this.time += dt;
    this.speed01 = speed01;
    this.boosting = boosting;
    this.dust.update(dt, this.worldSpeed);
    this.spark.update(dt, this.worldSpeed);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life / r.dur);
      r.mesh.scale.setScalar(0.3 + t * r.max);
      r.mesh.material.opacity = 0.85 * Math.pow(1 - t, 1.6);
      if (r.life <= 0) r.mesh.visible = false;
    }
    this.updateShake(dt);
  }

  drawSpeedLines() {
    if (!this.ctx) return;
    const { ctx, w, h, dpr } = this;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    if (this.speed01 < 0.22 && !this.boosting) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = 'lighter';
    const cx = w * 0.5, cy = h * 0.44;
    const intensity = clamp((this.speed01 - 0.22) / 0.78, 0, 1);
    const boost = this.boosting ? 1 : 0;
    const dt = 1 / 60;
    for (const l of this.lines) {
      l.r += (0.7 + l.spd * 1.5 + intensity * 2.2) * dt * (0.2 + l.r);
      if (l.r > 1.6) { l.r = 0.16 + Math.random() * 0.1; l.a = Math.random() * Math.PI * 2; }
      const r0 = Math.max(0.12, l.r);
      const r1 = r0 + l.len * (0.4 + intensity * 1.5);
      const x0 = cx + Math.cos(l.a) * r0 * w * 0.62;
      const y0 = cy + Math.sin(l.a) * r0 * h * 0.62;
      const x1 = cx + Math.cos(l.a) * r1 * w * 0.7;
      const y1 = cy + Math.sin(l.a) * r1 * h * 0.7;
      const a = (0.055 + intensity * 0.22) * Math.min(1, l.r * 1.25);
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(255,245,220,0)`);
      grad.addColorStop(0.35, `rgba(255,248,232,${(a * (1 + boost * 0.5)).toFixed(3)})`);
      grad.addColorStop(1, `rgba(255,220,160,0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = l.w * (1 + intensity);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  clearSpeedLines() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
