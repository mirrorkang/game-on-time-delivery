// config.js — 全局配置与关卡数据
export const CFG = {
  laneX: [-3.6, 0, 3.6],
  roadWidth: 13,
  stageStarts: [0, 700, 1400],
  stageEnds: [700, 1400, 2100],
  stageDists: [700, 700, 700],
  arrival: 2100,
  stageNames: ['01 · 山区晨光', '02 · 乡镇集市', '03 · 城市送达'],
  stageShorts: ['山区', '乡镇', '城市'],
  stageFullNames: ['山区晨光', '乡镇集市', '城市送达'],
  baseSpeed: [13, 15.5, 18],
  maxSpeed: [20, 23, 26],
  speedRamp: [0.0045, 0.0052, 0.006],
  tunnelDist: [700, 1400],
  player: {
    width: 0.95,
    standHeight: 1.95,
    slideHeight: 0.85,
    jumpV: 8.7,
    gravity: 22.5,
    laneLerp: 14,
  },
  comboWindow: 5.5,
  boost: { max: 100, drain: 28, speedMul: 1.3, duration: 4.0, pickupGain: 9, nearMissGain: 7 },
  spawn: { far: -150, recycle: 16 },
  maxHealth: 3,
  world: { skyRadius: 420, fogDensity: [0.0042, 0.0038, 0.0048] },
};

// v2 三幕 / 双角色已恢复。保留 MVP 开关，便于后续做单场景演示。
export const MVP = { enabled: false, stage: 2, rider: 'xiaoman' };

export function stageAt(distance) {
  if (distance < CFG.stageStarts[1]) return 0;
  if (distance < CFG.stageStarts[2]) return 1;
  return 2;
}

export function stageProgress(distance, stage) {
  const s = CFG.stageStarts[stage], e = CFG.stageEnds[stage];
  return Math.max(0, Math.min(1, (distance - s) / (e - s)));
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const formatNum = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
