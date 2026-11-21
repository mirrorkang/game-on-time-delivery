// main.js — 引导、输入、游戏循环、碰撞与计分、镜头、整合
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG, MVP, stageProgress, clamp, damp, lerp, stageAt } from './config.js';
import { World } from './world.js';
import { Rider } from './rider.js';
import { Entities } from './entities.js';
import { FX } from './fx.js';
import { UI } from './ui.js';

const silent = () => {};
const SILENT_AUDIO = {
  ready: false, muted: true,
  init: async () => {}, setMuted: silent, setPaused: silent,
  startMusic: silent, setStage: silent, setIntensity: silent, stopMusic: silent,
  startEngine: silent, setSpeed: silent, stopEngine: silent,
  playJump: silent, playLand: silent, playSlide: silent, playPickup: silent,
  playPowerup: silent, playHit: silent, playNearMiss: silent, playBoostStart: silent,
  playBoostLoop: silent, playHeartbeat: silent, playClick: silent, playCountdown: silent,
  playStageIntro: silent, playGameOver: silent, playVictory: silent,
};
let audio = SILENT_AUDIO;

let renderer, scene, camera, composer, bloomPass;
let world, rider, entities, fx, ui;
let state = 'loading';
let ready = false;
let audioStarted = false;
let isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
let last = 0;
let globalTime = 0;
let rafId = 0;
let fpsSamples = [];
let toastFlags = {};

const cameraPos = new THREE.Vector3();
const cameraLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();

const mount = document.querySelector('#scene-mount');
const touchEl = document.querySelector('#touch-ui');

const run = {
  distance: 0, speed: 0, score: 0, cups: 0, combo: 1, comboTime: 0, health: 3,
  boost: 100, boosting: false, boostTimer: 0, shield: 0, magnet: 0, double: 0, nitroFlash: 0,
  invincible: 0, elapsed: 0, maxCombo: 1, nearMisses: 0, slowT: 0,
  speedPenalty: 1, crashT: 0, arriveT: 0, arriveFired: false,
  nextSpawn: 80, nextPower: 210, dustT: 0, sparkT: 0, autoplay: false, stage: 0,
  endless: false, stageBonus: [false, false, false], healMilestone: 0,
};

/* ============================================================ 启动 */
boot();

async function boot() {
  ui = new UI();
  if (MVP.enabled) {
    ui.rider = MVP.rider;
    document.querySelector('.rider-card[data-rider="alan"]')?.remove();
    document.querySelectorAll('.rider-card').forEach((c) => c.classList.toggle('is-active', c.dataset.rider === MVP.rider));
    const rs = document.querySelector('#route-strip');
    if (rs) rs.style.display = 'none';
    const sb = document.querySelector('.stage-bar');
    if (sb) sb.style.display = 'none';
    const sp = document.querySelector('#stage-progress');
    if (sp) sp.style.display = 'none';
  }
  setupUiHandlers();
  ui.setLoading(0.03, '正在系好头盔…');
  await nextFrame();

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    ui.setFatal('浏览器没能创建 WebGL 画布。换个 Chrome / Edge / Safari 最新版试试。');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.filter = 'saturate(1.18) contrast(1.06) brightness(0.99)';
  mount.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 700);
  camera.position.set(2.8, 2.4, 5.6);
  cameraLook.set(-1.2, 1.0, 0);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.62, 0.86);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);

  ui.setLoading(0.08, '正在铺路、种竹子和点亮晚霞…');
  await nextFrame();

  try {
    world = new World(scene, renderer, { onStage: handleStage, onArrival: handleArrival });
  } catch (e) {
    console.error('[world]', e);
    ui.setFatal('场景搭建失败了：' + e.message);
    return;
  }
  ui.setLoading(0.22, '骑手正在赶来…');
  await nextFrame();

  try {
    rider = new Rider(scene);
    await rider.load((p) => ui.setLoading(0.22 + p * 0.62, p < 0.6 ? '正在给电驴充电…' : '骑手戴好头盔了…'), MVP.enabled ? { only: MVP.rider } : {});
  } catch (e) {
    console.error('[rider]', e);
    ui.setFatal('骑手模型加载失败：' + e.message);
    return;
  }

  fx = new FX(scene, camera, renderer);
  entities = new Entities(scene, fx);
  bindEntities();
  rider.setRider(MVP.enabled ? MVP.rider : ui.rider);
  rider.setStage(MVP.enabled ? MVP.stage : 0);
  ui.setLoading(0.9, '正在把奶茶放进车筐…');
  await nextFrame();

  await loadAudio();
  ui.setLoading(0.98, '接单成功，准备出发');
  await nextFrame();

  window.addEventListener('resize', onResize);
  setupInput();
  ui.setTouch(isTouch);
  if (isTouch) touchEl.classList.add('is-hidden');
  camera.position.set(2.6, 2.28, 5.9);
  cameraLook.set(-1.15, 1.0, -0.1);
  cameraPos.copy(camera.position);
  camera.lookAt(cameraLook);
  ui.doneLoading();
  ui.showStart();
  ui.setLoadingTip('今天也要准时送达呀。');
  ui.setStage(MVP.enabled ? MVP.stage : 0, 0);
  if (MVP.enabled) document.body.dataset.stage = String(MVP.stage + 1);
  state = 'start';
  if (MVP.enabled) ui.setStage(MVP.stage, 0);
  ready = true;
  window.__NEON.ready = true;
  last = performance.now();
  rafId = requestAnimationFrame(loop);
  setTimeout(() => { if (ui) ui.checkOrientation(); }, 1200);
}

async function loadAudio() {
  try {
    const mod = await import('./audio.js');
    if (mod?.audio) {
      audio = mod.audio;
      audio.setMuted?.(!ui.soundOn);
    }
  } catch (e) {
    console.warn('[audio] 模块尚未就绪，本次使用静音模式：', e.message);
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

/* ============================================================ 界面事件 */
function setupUiHandlers() {
  ui.bind({
    start: startFromUser,
    pause: togglePause,
    resume: togglePause,
    restart: startFromUser,
    home: goHome,
    endless: continueEndless,
    sound: onSoundClick,
    rider: ({ id }) => { if (rider) rider.setRider(id); },
  });
}

function startFromUser() {
  ensureAudioGesture();
  if (state === 'start' || state === 'gameover' || state === 'victory' || state === 'paused') startRun();
}

function ensureAudioGesture() {
  if (audioStarted) return;
  audioStarted = true;
  Promise.resolve(audio.init?.()).then(() => {
    audio.setMuted?.(!ui.soundOn);
    if (state === 'playing') {
      audio.startMusic?.(world?.stage + 1 || 1);
      audio.startEngine?.();
    }
  }).catch(() => {});
}

function onSoundClick() {
  const on = !ui.soundOn;
  ui.setSound(on);
  audio.setMuted?.(!on);
  if (on) {
    audioStarted = false;
    ensureAudioGesture();
    audio.setMuted?.(false);
  }
  ui.toast(on ? '声音已开启' : '静音了，专心送单', { duration: 1000 });
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    ui.hideRotateHint();
    ui.showPause(true);
    audio.setPaused?.(true);
  } else if (state === 'paused') {
    state = 'playing';
    ui.showPause(false);
    audio.setPaused?.(false);
    last = performance.now();
  }
}

/* ============================================================ 开局 / 重置 */
function startRun() {
  resetRun();
  world.reset();
  entities.reset();
  rider.reset();
  rider.setRider(MVP.enabled ? MVP.rider : ui.rider);
  rider.setStage(MVP.enabled ? MVP.stage : 0);
  ui.resetGame();
  ui.beginGame();
  ui.setHearts(run.health);
  ui.setScore(0);
  ui.setCups(0);
  ui.setDistance(0);
  ui.setTime(0);
  ui.setCombo(1, 0);
  ui.setBoost(100, true, false);
  ui.setPowerupsAll({});
  const startStage = MVP.enabled ? MVP.stage : 0;
  ui.setStage(startStage, 0);
  if (MVP.enabled) document.body.dataset.stage = String(startStage + 1);
  ui.setNewBest(false);
  ui.hideStart();
  if (isTouch) touchEl.classList.remove('is-hidden');
  else touchEl.classList.add('is-hidden');
  ui.hideRotateHint();
  state = 'playing';
  run.stage = startStage;
  run.arriveFired = false;
  const portraitNow = innerHeight > innerWidth;
  camera.position.set(rider.x * 0.3, portraitNow ? 3.7 : 3.35, portraitNow ? 8.2 : 6.9);
  cameraLook.set(rider.x * 0.2, 1.15, portraitNow ? -10.4 : -10.2);
  camera.fov = portraitNow ? 56 : 52;
  camera.updateProjectionMatrix();
  bloomPass.strength = MVP.enabled ? 0.48 : 0.26;
  fx.clearSpeedLines();
  fx.setWorldSpeed(0);
  fx.trauma = 0;
  ensureAudioGesture();
  Promise.resolve(audio.init?.()).then(() => {
    if (state !== 'playing' && state !== 'arriving') return;
    audio.setMuted?.(!ui.soundOn);
    audio.startMusic?.(world.stage + 1);
    audio.setStage?.(world.stage + 1);
    audio.startEngine?.();
    audio.setPaused?.(false);
  }).catch(() => {});
  if (MVP.enabled) {
    // 单场景 MVP 的开局教学节奏：奶茶 → 轿车 → 锥桶线 → 门架
    for (let i = 0; i < 6; i++) entities.spawnCup(1, -30 - i * 3.2, 1.05 + Math.sin((i / 5) * Math.PI) * 0.35);
    entities.spawnObstacle('car', 1, -92);
    for (const l of [0, 1, 2]) entities.spawnObstacle('cone', l, -168);
    entities.spawnObstacle('gantry', 1, -245);
    run.nextSpawn = 280;
    run.nextPower = 320;
  }
  last = performance.now();
  ui.setLoadingTip('');
  const token = (run.tutorialToken = (run.tutorialToken || 0) + 1);
  setTimeout(() => {
    if (state === 'playing' && run.tutorialToken === token) ui.stageBanner(MVP.enabled ? MVP.stage : 0);
  }, 650);
  if (MVP.enabled) {
    const hint = (text, sub, delay) => setTimeout(() => {
      if (state === 'playing' && run.tutorialToken === token) ui.toast(text, { sub, type: 'info', duration: 1400 });
    }, delay);
    hint(isTouch ? '左右滑动 · 变道' : 'A / D · 变道', '躲开前方的轿车', 3300);
    hint(isTouch ? '上滑 · 跳跃' : '空格 · 跳跃', '越过整排锥桶', 6800);
    hint(isTouch ? '下滑 · 滑铲' : 'S · 滑铲', '钻过施工门架', 10200);
  }
}

function resetRun() {
  Object.assign(run, {
    distance: 0, speed: 4.2, score: 0, cups: 0, combo: 1, comboTime: 0, health: 3,
    boost: 100, boosting: false, boostTimer: 0, shield: 0, magnet: 0, double: 0, nitroFlash: 0,
    invincible: 0, elapsed: 0, maxCombo: 1, nearMisses: 0, slowT: 0,
    speedPenalty: 1, crashT: 0, arriveT: 0, arriveFired: false,
    nextSpawn: 70, nextPower: 210, dustT: 0, sparkT: 0, stage: 0,
    endless: false, stageBonus: [false, false, false], healMilestone: 0,
  });
  toastFlags = {};
}

function goHome() {
  state = 'start';
  resetRun();
  world.reset();
  entities.reset();
  rider.reset();
  rider.setRider(MVP.enabled ? MVP.rider : ui.rider);
  rider.setStage(MVP.enabled ? MVP.stage : 0);
  ui.resetGame();
  ui.showStart();
  ui.setHearts(3);
  ui.setDistance(0);
  ui.setScore(0);
  ui.setCups(0);
  ui.setTime(0);
  ui.setCombo(1, 0);
  ui.setBoost(100, true, false);
  ui.setPowerupsAll({});
  ui.setStage(MVP.enabled ? MVP.stage : 0, 0);
  bloomPass.strength = MVP.enabled ? 0.48 : 0.26;
  camera.position.set(2.8, 2.4, 5.6);
  cameraLook.set(-1.15, 1.0, 0);
  if (isTouch) touchEl.classList.add('is-hidden');
  ui.hideRotateHint();
  fx.clearSpeedLines();
  audio.stopMusic?.();
  audio.stopEngine?.();
  audio.playBoostLoop?.(false);
  audio.setPaused?.(false);
}

function continueEndless() {
  ui.beginGame();
  state = 'playing';
  run.endless = true;
  run.health = 3;
  run.boost = 100;
  run.cups = run.cups;
  run.nextSpawn = run.distance + 70;
  run.nextPower = run.distance + 180;
  run.speed = Math.max(24, run.speed);
  run.invincible = 1.2;
  ui.setHearts(3);
  ui.setPowerupsAll({});
  if (isTouch) touchEl.classList.remove('is-hidden');
  audio.startMusic?.(3);
  audio.startEngine?.();
  audio.setStage?.(3);
  audio.setPaused?.(false);
  ui.toast('加时赛 · 继续送！', { type: 'stage', sub: '速度会越来越快', duration: 2200 });
}

/* ============================================================ 输入 */
function setupInput() {
  mount.addEventListener('pointerdown', onPointerDown);
  mount.addEventListener('pointerup', onPointerUp);
  mount.addEventListener('pointercancel', () => { drag = null; });
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
  });
  document.querySelectorAll('#touch-ui .touch-btn').forEach((btn) => {
    const act = btn.dataset.action;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state !== 'playing') return;
      ensureAudioGesture();
      if (act === 'left') rider.setLane(-1);
      else if (act === 'right') rider.setLane(1);
      else if (act === 'jump') doJump();
      else if (act === 'slide') doSlide();
      else if (act === 'boost') doBoost();
    });
    if (act === 'jump') btn.addEventListener('pointerup', () => rider?.releaseJump());
  });
}

let drag = null;
function onPointerDown(e) {
  if (state !== 'playing') return;
  drag = { x: e.clientX, y: e.clientY, t: performance.now() };
}
function onPointerUp(e) {
  if (!drag || state !== 'playing') { drag = null; return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
  if (Math.abs(dx) > Math.abs(dy)) rider.setLane(Math.sign(dx));
  else if (dy < 0) doJump();
  else doSlide();
}

function onKeyDown(e) {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') { onSoundClick(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing' || state === 'paused') togglePause();
    return;
  }
  if (state === 'start') {
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR') startFromUser();
    return;
  }
  if (state === 'gameover') {
    if (e.code === 'Enter' || e.code === 'KeyR' || e.code === 'Space') startFromUser();
    return;
  }
  if (state === 'victory') {
    if (e.code === 'Enter') continueEndless();
    if (e.code === 'KeyR') startFromUser();
    return;
  }
  if (state !== 'playing') return;
  switch (e.code) {
    case 'Space': case 'KeyW': case 'ArrowUp': doJump(); break;
    case 'KeyS': case 'ArrowDown': doSlide(); break;
    case 'KeyA': case 'ArrowLeft': rider.setLane(-1); break;
    case 'KeyD': case 'ArrowRight': rider.setLane(1); break;
    case 'ShiftLeft': case 'ShiftRight': doBoost(); break;
    default: break;
  }
}
function onKeyUp(e) {
  if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') rider?.releaseJump();
}

function doJump() {
  if (state !== 'playing') return;
  const res = rider.jump();
  if (res === 'jump') {
    audio.playJump?.();
    fx.dustBurst({ x: rider.x, y: 0.1, z: 0.2 }, 5, 0xe6d8b6, 0.8);
    fx.addShake(0.06);
  }
}
function doSlide() {
  if (state !== 'playing') return;
  const res = rider.slide();
  if (res === 'slide') audio.playSlide?.();
  if (res === 'slam') { audio.playSlide?.(); fx.addShake(0.12); }
}
function doBoost() {
  if (state !== 'playing') return;
  if (run.boosting || run.boost < 99.5) {
    if (run.boost < 99.5) ui.toast('氮气还不够，多收几杯奶茶', { duration: 1000 });
    return;
  }
  run.boosting = true;
  run.boostTimer = CFG.boost.duration;
  run.boost = 100;
  rider.setBoost(true);
  fx.ring({ x: rider.x, z: 0 }, 0xffc982, 3.4, 0.55);
  fx.sparkBurst({ x: rider.x, y: 0.6, z: 1.0 }, 24, 0xffa64a, 1.3);
  fx.addShake(0.3);
  audio.playBoostStart?.();
  audio.playBoostLoop?.(true);
  ui.toast('氮气加速！', { sub: '撞碎前面的障碍', type: 'good', duration: 1300 });
}

/* ============================================================ 实体回调 */
function bindEntities() {
  entities.onHit = handleHit;
  entities.onPickup = handlePickup;
  entities.onPowerup = handlePowerup;
  entities.onNearMiss = handleNearMiss;
  rider.onLand = (impact) => {
    audio.playLand?.(impact);
    fx.dustBurst({ x: rider.x, y: 0.05, z: 0.25 }, 6 + Math.round(impact * 6), 0xd9c9a8, 0.9 + impact);
    if (impact > 0.55) fx.addShake(0.16 * impact);
  };
  rider.onSlam = () => {
    const n = entities.clearZ(-7, 7, 1.5);
    fx.ring({ x: rider.x, z: 0.5 }, 0xffe0a0, 4.2, 0.5);
    fx.dustBurst({ x: rider.x, y: 0.05, z: 0.5 }, 14, 0xd9c9a8, 1.5);
    fx.addShake(0.4);
    audio.playLand?.(1);
    if (n > 0) {
      const gain = n * 20;
      run.score += gain;
      floatAt(`冲击波 +${gain}`, rider.x, 1.4, 0, 'is-good');
    }
  };
}

function handleStage(index) {
  run.stage = index;
  ui.setStage(index, 0);
  ui.stageBanner(index);
  audio.setStage?.(index + 1);
  audio.playStageIntro?.();
  rider.setStage(index);
  bloomPass.strength = [0.26, 0.32, 0.48][index];
  if (!run.stageBonus[index]) {
    run.stageBonus[index] = true;
    run.score += 250;
    floatAt('区域奖励 +250', 0, 2.2, -8, 'is-good');
  }
  document.body.classList.add('is-stage-flash');
  setTimeout(() => document.body.classList.remove('is-stage-flash'), 700);
}

function handleArrival() {
  if (state !== 'playing' || run.arriveFired) return;
  run.arriveFired = true;
  state = 'arriving';
  run.arriveT = 0;
  run.boosting = false;
  rider.setBoost(false);
  audio.stopEngine?.();
  audio.playBoostLoop?.(false);
  audio.playVictory?.();
  entities.reset();
  fx.confetti(new THREE.Vector3(0, 1.5, -7));
  fx.addShake(0.35);
  ui.toast('幸福里 · 3栋 到了！', { sub: '最后一份奶茶，送到了', type: 'stage', duration: 2600 });
  if (isTouch) touchEl.classList.add('is-hidden');
  ui.hideRotateHint();
}

function handlePickup(cup) {
  run.cups += 1;
  run.combo = Math.min(8, run.combo + 1);
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.comboTime = CFG.comboWindow;
  const gain = 15 * run.combo * (run.double > 0 ? 2 : 1);
  run.score += gain;
  run.boost = Math.min(100, run.boost + CFG.boost.pickupGain);
  fx.pickup(new THREE.Vector3(cup.x, cup.y, cup.z));
  audio.playPickup?.(run.combo);
  floatAt(`+${gain}`, cup.x, cup.y + 0.35, cup.z, 'is-good');
  if (run.cups - run.healMilestone >= 15) {
    run.healMilestone = run.cups;
    if (run.health < 3) {
      run.health += 1;
      ui.setHearts(run.health);
      ui.toast('顾客打赏了一个头盔', { type: 'good', duration: 1200 });
    }
  }
}

function handlePowerup(item) {
  const kind = item.kind;
  run.score += 50;
  fx.powerup(new THREE.Vector3(item.x, item.y, item.z));
  audio.playPowerup?.(kind);
  switch (kind) {
    case 'shield':
      run.shield = 12;
      rider.setShield(true);
      ui.toast('头盔盾 · 12 秒', { sub: '能挡一次碰撞', type: 'good', duration: 1500 });
      break;
    case 'magnet':
      run.magnet = 10;
      rider.setMagnet(true);
      ui.toast('磁铁奶茶 · 10 秒', { sub: '附近的奶茶自己飞过来', type: 'good', duration: 1500 });
      break;
    case 'nitro':
      run.boost = 100;
      run.nitroFlash = 1.4;
      ui.toast('氮气满格！', { sub: '按 Shift / 氮气键冲刺', type: 'good', duration: 1500 });
      break;
    case 'double':
      run.double = 12;
      ui.toast('双倍小费 · 12 秒', { type: 'good', duration: 1500 });
      break;
    default: break;
  }
  floatAt('+50', item.x, item.y + 0.4, item.z, 'is-good');
}

function handleNearMiss(item, gap) {
  run.nearMisses += 1;
  const gain = 30;
  run.score += gain;
  run.comboTime = CFG.comboWindow;
  run.boost = Math.min(100, run.boost + CFG.boost.nearMissGain);
  run.slowT = 0.1;
  fx.sparks(new THREE.Vector3(item.x, 0.4, item.z), 8, 0xffe0a0);
  fx.addShake(0.08);
  audio.playNearMiss?.();
  floatAt(`擦身而过 +${gain}`, item.x, 1.5, item.z, 'is-near');
}

function handleHit(item) {
  if (state !== 'playing') return;
  if (run.boosting) {
    entities.smash(item);
    run.score += 40;
    fx.sparkBurst(new THREE.Vector3(item.x, Math.min(1, item.y1 * 0.6), item.z), 22, 0xffc247, 1.3);
    fx.addShake(0.18);
    audio.playLand?.(0.7);
    return;
  }
  if (run.invincible > 0) return;
  if (run.shield > 0) {
    run.shield = 0;
    rider.setShield(false);
    run.invincible = 0.9;
    entities.smash(item);
    fx.ring({ x: rider.x, z: 0 }, 0x9fe6d4, 3.2, 0.5);
    fx.sparkBurst(new THREE.Vector3(rider.x, 1.2, 0), 18, 0x9fe6d4, 1);
    audio.playPowerup?.('shield');
    ui.toast('头盔盾挡住了！', { type: 'good', duration: 1200 });
    return;
  }
  if (item.harmless) {
    run.speedPenalty = 0.72;
    run.combo = 1;
    run.comboTime = 0;
    run.score = Math.max(0, run.score - 20);
    fx.splash(new THREE.Vector3(item.x, 0.05, item.z));
    fx.addShake(0.16);
    audio.playLand?.(0.4);
    floatAt('打滑 -20', item.x, 1.1, item.z, 'is-bad');
    return;
  }
  if (item.critter) {
    run.speedPenalty = 0.75;
    run.combo = 1;
    run.comboTime = 0;
    fx.dustBurst(new THREE.Vector3(item.x, 0.2, item.z), 10, 0xf0e2c0, 1);
    fx.addShake(0.12);
    audio.playLand?.(0.4);
    ui.toast('鸡飞狗跳…', { sub: '小心小动物', type: 'warn', duration: 1100 });
    return;
  }
  applyDamage(false);
}

function applyDamage(force = false) {
  if (state !== 'playing') return false;
  if (!force && (run.invincible > 0 || run.shield > 0 || run.boosting)) return false;
  if (run.shield > 0) { run.shield = 0; rider.setShield(false); }
  run.health -= 1;
  ui.setHearts(run.health);
  run.invincible = 2.2;
  run.speedPenalty = 0.5;
  run.combo = 1;
  run.comboTime = 0;
  run.boost = 0;
  if (run.boosting) endBoost();
  rider.hit();
  fx.addShake(0.95);
  ui.setHit();
  fx.sparkBurst(new THREE.Vector3(rider.x, 1.1, 0), 24, 0xff7a5a, 1.2);
  fx.dustBurst(new THREE.Vector3(rider.x, 0.1, 0.4), 10, 0xd9c9a8, 1.2);
  audio.playHit?.();
  if (run.health <= 0) {
    triggerCrash();
  } else {
    ui.toast(`差评！头盔 -1`, { sub: '还有 ' + run.health + ' 个', type: 'bad', duration: 1400 });
  }
  return true;
}

function triggerCrash() {
  if (state !== 'playing') return;
  state = 'crashing';
  run.crashT = 0;
  run.boosting = false;
  run.boost = 0;
  rider.setBoost(false);
  rider.hit();
  fx.addShake(1);
  fx.sparkBurst(new THREE.Vector3(rider.x, 1.2, 0), 30, 0xff8a5a, 1.4);
  fx.dustBurst(new THREE.Vector3(rider.x, 0.1, 0.3), 16, 0xd9c9a8, 1.5);
  audio.stopEngine?.();
  audio.playBoostLoop?.(false);
  audio.playGameOver?.();
  if (isTouch) touchEl.classList.add('is-hidden');
}

function endBoost() {
  run.boosting = false;
  run.boostTimer = 0;
  rider.setBoost(false);
  audio.playBoostLoop?.(false);
}

/* ============================================================ 生成器 */
const OBS = [
  { low: ['rockSmall', 'fence'], tall: ['rock', 'hayCart', 'pothole', 'puddle'], jump: 'rockSmall', gate: 'branch', critter: 'chicken' },
  { low: ['basket'], tall: ['tricycle', 'pothole', 'dog'], jump: 'basket', gate: 'awning', critter: 'chicken' },
  { low: ['cone', 'barrier'], tall: ['car', 'taxi', 'bus', 'scooter', 'flowerBed'], jump: 'cone', gate: 'gantry', critter: null },
];

function spawnPattern() {
  if (MVP.enabled) return spawnCityPattern();
  const s = world.stage;
  const table = OBS[s];
  const diff = clamp(run.distance / CFG.arrival, 0, 1);
  const z = -150;
  const r = Math.random();
  const free = [];
  const used = new Set();
  const randFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chooseLane = (exclude = used) => {
    const lanes = [0, 1, 2].filter((l) => !exclude.has(l));
    return lanes.length ? lanes[Math.floor(Math.random() * lanes.length)] : null;
  };

  if (r < 0.34) {
    // 单/双障碍，留一条活路
    const count = Math.random() < 0.28 + diff * 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const lane = chooseLane();
      if (lane === null) break;
      used.add(lane);
      const kind = Math.random() < 0.35 ? randFrom(table.low) : randFrom(table.tall);
      entities.spawnObstacle(kind, lane, z);
    }
    const lane = chooseLane();
    if (lane !== null && Math.random() < 0.55) spawnCupLine(lane, 4 + Math.floor(Math.random() * 4), false);
  } else if (r < 0.48) {
    // 全部车道低障碍：必须跳
    const kind = table.jump;
    for (const lane of [0, 1, 2]) entities.spawnObstacle(kind, lane, z);
    if (Math.random() < 0.65) spawnCupLine(1, 5, true, z - 6);
  } else if (r < 0.6) {
    // 低门：必须滑铲
    entities.spawnObstacle(table.gate, 1, z);
    if (Math.random() < 0.5) spawnCupLine(Math.random() < 0.5 ? 0 : 2, 4, false, z - 4);
  } else if (r < 0.73) {
    // 奶茶串
    const lane = chooseLane();
    spawnCupLine(lane, 6 + Math.floor(Math.random() * 4), Math.random() < 0.45);
    if (Math.random() < 0.5 + diff * 0.2) {
      const other = chooseLane(new Set([lane]));
      if (other !== null) entities.spawnObstacle(Math.random() < 0.5 ? randFrom(table.low) : randFrom(table.tall), other, z - 2);
    }
  } else if (r < 0.85) {
    // 小动物 / 路坑
    if (table.critter && Math.random() < 0.55) {
      const lane = chooseLane();
      entities.spawnObstacle(table.critter, lane, z);
    } else {
      const lane = chooseLane();
      entities.spawnObstacle(Math.random() < 0.5 ? 'pothole' : 'puddle', lane, z);
    }
    spawnCupLine(chooseLane() ?? 1, 5, false);
  } else {
    // 双车道卡位 + 空档奶茶
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const lane of lanes) {
      used.add(lane);
      entities.spawnObstacle(randFrom(table.tall), lane, z);
    }
    const open = [0, 1, 2].find((l) => !used.has(l));
    if (open !== undefined) spawnCupLine(open, 5, false, z - 2);
  }
}

function spawnCityPattern() {
  const z = -150;
  const lanes = [0, 1, 2];
  const shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);
  const r = Math.random();
  if (r < 0.44) {
    // 1–2 辆城市车辆，留一条活路
    const n = Math.random() < 0.38 ? 2 : 1;
    const chosen = shuffle(lanes).slice(0, n);
    for (const l of chosen) {
      const kind = ['car', 'taxi', 'car', 'bus', 'scooter'][Math.floor(Math.random() * 5)];
      entities.spawnObstacle(kind, l, z);
    }
    const free = lanes.find((l) => !chosen.includes(l));
    if (free !== undefined && Math.random() < 0.72) spawnCupLine(free, 6, false, z + 4);
  } else if (r < 0.6) {
    // 锥桶线：必须跳
    for (const l of lanes) entities.spawnObstacle('cone', l, z);
    spawnCupLine(1, 5, true, z - 6);
  } else if (r < 0.72) {
    // 施工门架：必须滑铲
    entities.spawnObstacle('gantry', 1, z);
    spawnCupLine(Math.random() < 0.5 ? 0 : 2, 5, false, z - 2);
  } else if (r < 0.88) {
    // 施工区：两条车道被封，留一条
    const chosen = shuffle(lanes).slice(0, 2);
    entities.spawnObstacle('barrier', chosen[0], z);
    entities.spawnObstacle('barrier', chosen[1], z - 5);
    const free = lanes.find((l) => !chosen.includes(l));
    if (free !== undefined) {
      spawnCupLine(free, 5, false, z + 2);
    }
  } else {
    // 纯奖励段
    spawnCupLine(Math.floor(Math.random() * 3), 7, Math.random() < 0.45, z);
    if (Math.random() < 0.5) entities.spawnObstacle('flowerBed', Math.floor(Math.random() * 3), z - 10);
  }
}

function spawnCupLine(lane, n = 6, arc = false, z0 = -150) {
  const spacing = 3.3;
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const y = 1.05 + (arc ? Math.sin(t * Math.PI) * 1.0 : 0);
    entities.spawnCup(lane, z0 - i * spacing, y);
  }
  if (arc && Math.random() < 0.6) {
    const table = OBS[world.stage];
    entities.spawnObstacle(table.jump, lane, z0 - 2 * spacing);
  }
}

function spawnPowerup() {
  const kinds = ['shield', 'magnet', 'double', 'nitro'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const lane = Math.floor(Math.random() * 3);
  entities.spawnPowerup(kind, lane, -155);
}

/* ============================================================ 循环 */
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const dtReal = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
  last = now;
  globalTime += dtReal;

  fpsSamples.push(now);
  while (fpsSamples.length && fpsSamples[0] < now - 1000) fpsSamples.shift();

  if (state === 'start') {
    updateStart(dtReal);
  } else if (state === 'playing') {
    updatePlaying(dtReal);
  } else if (state === 'crashing') {
    updateCrashing(dtReal);
  } else if (state === 'arriving') {
    updateArriving(dtReal);
  } else if (state === 'gameover' || state === 'victory') {
    updateSettled(dtReal);
  } else if (state === 'paused') {
    // 暂停时冻结场景
  }

  if (state !== 'playing' && state !== 'crashing' && state !== 'arriving') {
    fx?.update(dtReal, 0, false);
    if (state !== 'paused') fx?.clearSpeedLines();
  }

  updateCamera(dtReal);
  renderFrame();
}

function updateStart(dt) {
  world.update(dt, { distance: 0, speed: 4.2, time: globalTime, camera });
  rider.updateIdle(dt, globalTime);
  fx.setWorldSpeed(4.2);
  fx.update(dt, 0, false);
  fx.clearSpeedLines();
}

function updatePlaying(dtReal) {
  let dt = dtReal;
  if (run.slowT > 0) { run.slowT -= dtReal; dt *= 0.55; }
  run.elapsed += dt;
  const stage = world.stage;
  const base = Math.min(
    CFG.maxSpeed[stage],
    CFG.baseSpeed[stage] + Math.max(0, run.distance - CFG.stageStarts[stage]) * CFG.speedRamp[stage]
  );
  let target = base;
  if (run.boosting) target *= CFG.boost.speedMul;
  target *= run.speedPenalty;
  if (run.endless) target = Math.min(40, target + 3 + Math.max(0, run.distance - 2100) * 0.002);
  run.speed = damp(run.speed, target, run.boosting ? 3.2 : 1.5, dt);
  run.speedPenalty = damp(run.speedPenalty, 1, 2.0, dt);
  run.distance += run.speed * dt;
  run.score += run.speed * dt * 0.55 * (run.double > 0 ? 2 : 1);

  run.invincible = Math.max(0, run.invincible - dt);
  run.shield = Math.max(0, run.shield - dt);
  run.magnet = Math.max(0, run.magnet - dt);
  run.double = Math.max(0, run.double - dt);
  run.nitroFlash = Math.max(0, run.nitroFlash - dt);
  if (run.shield <= 0) rider.setShield(false);
  if (run.magnet <= 0) rider.setMagnet(false);

  if (run.combo > 1) {
    run.comboTime -= dt;
    if (run.comboTime <= 0) { run.combo = 1; run.comboTime = 0; }
  }

  if (run.boosting) {
    run.boostTimer -= dt;
    run.boost = Math.max(0, (run.boostTimer / CFG.boost.duration) * 100);
    if (run.boostTimer <= 0 || run.boost <= 0) endBoost();
  }

  if (run.autoplay) doAutoplay();
  rider.invincible = Math.max(rider.invincible, run.invincible);
  rider.update(dt, run.speed);

  entities.magnet = run.magnet > 0;
  entities.update(dt, run.speed, rider, { magnet: run.magnet > 0 });
  if (state !== 'playing') return;

  if (run.distance > run.nextSpawn) {
    spawnPattern();
    const gap = Math.max(22, [42, 38, 31][world.stage] - Math.min(8, run.distance * 0.003) + Math.random() * 6);
    run.nextSpawn = run.distance + gap;
  }
  if (run.distance > run.nextPower) {
    spawnPowerup();
    run.nextPower = run.distance + 190 + Math.random() * 90;
  }

  world.update(dt, { distance: run.distance, speed: run.speed, time: globalTime, camera });
  if (state !== 'playing') return;

  fx.setWorldSpeed(run.speed);
  fx.update(dtReal, clamp(run.speed / 34, 0, 1), run.boosting);
  emitRideFx(dt);
  updateCamera(dtReal);
  updateHud();
  audio.setSpeed?.(clamp(run.speed / 38, 0, 1));
  audio.setIntensity?.(clamp(run.speed / 34, 0, 1));
  if (run.health <= 0) triggerCrash();
}

function updateCrashing(dtReal) {
  run.crashT += dtReal;
  run.speed = damp(run.speed, 0, 2.8, dtReal);
  run.distance += run.speed * dtReal;
  const dt = dtReal;
  rider.update(dt, run.speed);
  world.update(dt, { distance: run.distance, speed: run.speed * 0.7, time: globalTime, camera });
  fx.setWorldSpeed(run.speed);
  fx.update(dtReal, 0, false);
  updateHud();
  if (run.crashT > 1.55) finishGameOver();
}

function finishGameOver() {
  if (state !== 'crashing') return;
  state = 'gameover';
  const newBest = run.distance > ui.bestDistance || run.score > ui.bestScore;
  ui.setBest(run.distance, run.score);
  ui.setNewBest(newBest);
  ui.gameOver({
    distance: run.distance,
    cups: run.cups,
    combo: run.maxCombo,
    score: Math.round(run.score),
  });
  if (isTouch) touchEl.classList.add('is-hidden');
  ui.hideRotateHint();
  audio.stopMusic?.();
  audio.setPaused?.(false);
}

function updateArriving(dtReal) {
  run.arriveT += dtReal;
  run.speed = damp(run.speed, 0, 2.3, dtReal);
  run.distance = Math.min(2100, run.distance + run.speed * dtReal);
  const dt = dtReal;
  rider.update(dt, run.speed);
  world.update(dt, { distance: run.distance, speed: run.speed, time: globalTime, camera });
  fx.setWorldSpeed(run.speed);
  fx.update(dtReal, 0, false);
  updateHud();
  if (run.arriveT > 2.6) finishVictory();
}

function finishVictory() {
  if (state !== 'arriving') return;
  state = 'victory';
  run.score += 500;
  const stars = clamp(run.health + 2, 3, 5);
  const newBest = run.distance > ui.bestDistance || run.score > ui.bestScore;
  ui.setBest(run.distance, run.score);
  ui.victory({
    distance: 2100,
    cups: run.cups,
    score: Math.round(run.score),
    stars,
  });
  if (newBest) ui.toast('新纪录！', { type: 'good', duration: 2000 });
  if (isTouch) touchEl.classList.add('is-hidden');
  ui.hideRotateHint();
  audio.stopMusic?.();
  audio.setPaused?.(false);
  bloomPass.strength = 0.5;
  fx.confetti(new THREE.Vector3(0, 2, -8));
}

function updateSettled(dtReal) {
  fx.update(dtReal, 0, false);
  if (world) world.update(dtReal, { distance: run.distance, speed: 0, time: globalTime, camera });
  rider.updateIdle(dtReal, globalTime);
}

function emitRideFx(dt) {
  const moving = run.speed > 6;
  run.dustT -= dt;
  run.sparkT -= dt;
  // 常速行驶不扬尘（避免近景颗粒遮挡），仅滑铲/氮气有火花
  if (run.sparkT <= 0 && (rider.sliding || run.boosting) && moving) {
    run.sparkT = rider.sliding ? 0.045 : 0.03;
    fx.sparkBurst({ x: rider.x + (Math.random() - 0.5) * 0.3, y: 0.12, z: 0.9 }, rider.sliding ? 1 : 2, run.boosting ? 0xffa64a : 0xffe0a0, 0.6);
  }
}

function doAutoplay() {
  if (!run.autoplay || !entities) return;
  const obs = entities.active.filter((o) => o.type === 'obstacle' && !o.hit && o.z > -26 && o.z < -0.5);
  if (!obs.length) return;
  const cur = rider.lane;
  const nearest = obs.filter((o) => o.lane === cur).sort((a, b) => b.z - a.z)[0];
  if (!nearest) return;
  if (nearest.def.gate) {
    if (nearest.z > -15 && rider.grounded) rider.slide();
    return;
  }
  if (nearest.z > -13 && nearest.y1 <= 1.3 && rider.grounded) {
    doJump();
    return;
  }
  if (nearest.z > -18) {
    const danger = new Set(obs.filter((o) => o.z > -22).map((o) => o.lane));
    const safe = [0, 1, 2].filter((l) => !danger.has(l) && Math.abs(l - cur) === 1);
    if (safe.length) rider.setLane(Math.sign(safe[0] - cur));
  }
}

/* ============================================================ UI / 音频 */
function updateHud() {
  ui.setDistance(run.distance);
  ui.setTime(run.elapsed);
  ui.setScore(run.score);
  ui.setCups(run.cups);
  ui.setHearts(Math.max(0, run.health));
  ui.setSpeed(run.speed * 3.6, clamp(run.speed / 38, 0, 1));
  ui.setBoost(run.boost / 100, run.boost >= 99.5 && !run.boosting, run.boosting);
  ui.setCombo(run.combo, run.comboTime / CFG.comboWindow);
  const stage = world?.stage ?? 0;
  ui.setStage(stage, MVP.enabled ? 0 : stageProgress(run.distance, stage));
  ui.setPowerup('shield', run.shield / 12);
  ui.setPowerup('magnet', run.magnet / 10);
  ui.setPowerup('double', run.double / 12);
  ui.setPowerup('nitro', run.nitroFlash / 1.4);
  document.body.classList.toggle('is-boostable', run.boost >= 99.5 && !run.boosting);
}

/* ============================================================ 镜头 */
function updateCamera(dt) {
  if (!camera) return;
  const speed01 = clamp(run.speed / 34, 0, 1);
  let targetFov = 54;
  if (state === 'start') {
    const t = globalTime;
    const portrait = innerHeight > innerWidth;
    const radius = portrait ? 8.4 : 5.2;
    const angle = (portrait ? 0.6 : 0.46) + Math.sin(t * 0.12) * 0.16;
    tmpV.set(Math.sin(angle) * radius + rider.x, (portrait ? 3.2 : 2.28) + Math.sin(t * 0.45) * 0.06, 0.9 + Math.cos(angle) * radius);
    tmpV2.set(portrait ? -0.6 : -1.15, 1.0, portrait ? -1.4 : -0.1);
    cameraPos.lerp(tmpV, 1 - Math.exp(-2.6 * dt));
    cameraLook.lerp(tmpV2, 1 - Math.exp(-3 * dt));
    targetFov = portrait ? 50 : 44;
  } else if (state === 'gameover' || state === 'victory') {
    const t = globalTime * 0.32;
    tmpV.set(2.4 + Math.sin(t) * 0.8, 2.3, 4.2 + Math.cos(t) * 0.45);
    tmpV2.set(0, 1.1, -4.5);
    cameraPos.lerp(tmpV, 1 - Math.exp(-2.2 * dt));
    cameraLook.lerp(tmpV2, 1 - Math.exp(-2.4 * dt));
    targetFov = 50;
  } else if (state === 'arriving') {
    tmpV.set(rider.x * 0.3 + 1.2, 3.45, 9.1);
    tmpV2.set(0, 2.1, -11.5);
    cameraPos.lerp(tmpV, 1 - Math.exp(-2 * dt));
    cameraLook.lerp(tmpV2, 1 - Math.exp(-2 * dt));
    targetFov = 50;
  } else {
    const portrait = innerHeight > innerWidth;
    tmpV.set(rider.x * 0.3, (portrait ? 3.7 : 3.35) + rider.y * 0.18, portrait ? 8.2 : 6.9);
    tmpV2.set(rider.x * 0.2, 1.15 + rider.y * 0.22, portrait ? -10.4 : -10.2);
    cameraPos.lerp(tmpV, 1 - Math.exp(-6.5 * dt));
    cameraLook.lerp(tmpV2, 1 - Math.exp(-9 * dt));
    targetFov = (portrait ? 56 : 52) + speed01 * 8 + (run.boosting ? 6 : 0);
  }
  camera.position.copy(cameraPos);
  camera.position.x += (fx?.shakeX || 0) * 0.55;
  camera.position.y += (fx?.shakeY || 0) * 0.55;
  camera.lookAt(cameraLook);
  camera.rotation.z += (fx?.shakeR || 0) + (rider?.lean || 0) * 0.1;
  if (Math.abs(camera.fov - targetFov) > 0.02) {
    camera.fov = damp(camera.fov, targetFov, 4, dt);
    camera.updateProjectionMatrix();
  }
}

function renderFrame() {
  if (!composer) return;
  composer.render();
  if (state === 'playing' || state === 'crashing' || state === 'arriving') {
    fx.drawSpeedLines();
  } else if (state === 'start' || state === 'gameover' || state === 'victory') {
    fx.clearSpeedLines();
  }
}

function onResize() {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloomPass.setSize(innerWidth, innerHeight);
  fx?.resize();
  ui?.checkOrientation();
}

/* ============================================================ 工具 */
function floatAt(text, x, y, z, cls = '') {
  if (!camera) return;
  tmpV3.set(x, y, z).project(camera);
  const sx = (tmpV3.x * 0.5 + 0.5) * innerWidth;
  const sy = (-tmpV3.y * 0.5 + 0.5) * innerHeight;
  if (tmpV3.z > 1) return;
  ui.float(text, clamp(sx, 40, innerWidth - 40), clamp(sy, 70, innerHeight - 90), cls);
}

/* ============================================================ 调试 API */
const NeonAPI = {
  version: '1.0.0',
  ready: false,
  get state() { return state; },
  get fpsNow() { return fpsSamples.length; },
  snapshot() {
    return {
      state, distance: run.distance, score: Math.round(run.score), cups: run.cups,
      combo: run.combo, health: run.health, speed: run.speed, boost: run.boost,
      stage: world?.stage ?? 0, y: rider?.y ?? 0, lane: rider?.lane ?? 1, fps: fpsSamples.length,
      sliding: !!rider?.sliding, jumping: !!(rider && !rider.onGround), boosting: !!run.boosting, boostTimer: run.boostTimer,
    };
  },
  fps() { return fpsSamples.length; },
  start() {
    if (!ready) return false;
    ensureAudioGesture();
    if (state === 'start' || state === 'gameover' || state === 'victory') startRun();
    return true;
  },
  restart() { if (ready) startRun(); return ready; },
  pause() { if (state === 'playing') togglePause(); return state; },
  resume() { if (state === 'paused') togglePause(); return state; },
  damage() {
    if (state !== 'playing') return false;
    run.invincible = 0;
    run.shield = 0;
    run.boosting = false;
    rider.setShield(false);
    rider.setBoost(false);
    return applyDamage(true);
  },
  heal() { run.health = 3; ui.setHearts(3); return run.health; },
  setDistance(m) { run.distance = Math.max(0, m); return run.distance; },
  setSpeed(mps) { run.speed = Math.max(0, mps); return run.speed; },
  setBoost(v) { run.boost = Math.max(0, Math.min(100, v)); return run.boost; },
  setInvincible(b) { run.invincible = b ? 9999 : 0; rider.invincible = run.invincible; return !!b; },
  spawnAt(type, lane = 1, z = -18) {
    if (!entities) return false;
    if (type === 'cup') { entities.spawnCup(lane, z); return true; }
    if (['shield','magnet','nitro','double'].includes(type)) { entities.spawnPowerup(type, lane, z); return true; }
    entities.spawnObstacle(type, lane, z);
    return true;
  },
  spawnCups(lane = 1, z = -16, n = 6, arc = false) {
    if (!entities) return false;
    for (let i = 0; i < n; i++) entities.spawnCup(lane, z - i * 3.3, 1.05 + (arc ? Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 1.0 : 0));
    return true;
  },
  spawn(type) {
    if (!entities) return false;
    if (type === 'cup') { entities.spawnCup(1, -14); return true; }
    if (['shield', 'magnet', 'nitro', 'double'].includes(type)) { entities.spawnPowerup(type, 1, -14); return true; }
    entities.spawnObstacle(type || 'cone', 1, -14);
    return true;
  },
  setAutoplay(b) { run.autoplay = !!b; return run.autoplay; },
  debugEntities() {
    if (!entities) return [];
    return entities.active.map((it) => {
      let bw = null, bh = null;
      try {
        const b = new THREE.Box3().setFromObject(it.group);
        bw = b.max.x - b.min.x; bh = b.max.y - b.min.y;
      } catch (e) {}
      return { type: it.type, kind: it.kind, x: it.x, z: it.z, w: it.w, h: it.y1, scale: it.group.scale.toArray(), visW: bw, visH: bh, visible: it.group.visible, inScene: !!it.group.parent };
    });
  },
  debug3d() {
    const active = rider?.models?.[rider.riderId];
    return {
      state, riderPos: rider?.group.position.toArray(), riderScale: rider?.tilt.scale.toArray(),
      activeVisible: active?.visible, invincible: rider?.invincible, camera: camera?.position.toArray(), fov: camera?.fov,
      drawCalls: renderer?.info.render.calls, triangles: renderer?.info.render.triangles,
      worldSpeed: run.speed, stage: world?.stage,
    };
  },
  setStage(n) {
    if (!world) return false;
    if (MVP.enabled) n = MVP.stage;
    world.setStage(n);
    run.stage = world.stage;
    rider.setStage(world.stage);
    ui.setStage(world.stage, 0);
    bloomPass.strength = [0.26, 0.32, 0.48][world.stage];
    return world.stage;
  },
};
window.__NEON = NeonAPI;
