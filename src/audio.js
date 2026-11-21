/* ============================================================================
 * src/audio.js — 《准时送达 · ON TIME》程序化音频引擎
 * ----------------------------------------------------------------------------
 * 纯 WebAudio 合成：无外部音频文件、无网络请求。
 * 108 BPM 三幕编曲（lookahead 调度、无缝循环、跨幕交叉淡化）：
 *   1 山区晨光  — 尼龙拨弦 / 轻沙锤 / 温暖 pad
 *   2 乡镇集市  — 弹跳贝斯 / 拍手 / 木管笛 lead
 *   3 城市黄昏  — City Pop 电钢和弦 / 鼓组 / 明亮 synth lead
 * 另有：引擎声（锯齿+滤波，随 speed 变调）、氮气喷流、全套游戏音效。
 *
 * 契约见 docs/CONTRACT.md「音频契约」。所有公开方法异常安全；
 * AudioContext 只在首次用户手势调用 init() 时创建，失败静默降级。
 * ========================================================================== */

const VERSION = '1.0.0';

/* ---------------------------------- 节拍 ---------------------------------- */
const BPM = 108;
const BEAT = 60 / BPM;          // 0.5556 s
const STEP = BEAT / 4;          // 16 分音符 0.1389 s
const BAR_STEPS = 16;           // 4/4 一小节
const LOOKAHEAD = 0.2;          // 调度提前量（秒）
const TICK_MS = 25;             // 调度器轮询间隔
const MUSIC_LEVEL = 0.95;       // 音乐总线目标增益（约 -19 ~ -20 LUFS 的听感）
const MASTER_LEVEL = 0.9;       // 限幅后的安全输出
const STAGE_TRIM = { 1: 1.25, 2: 2.5, 3: 2.0 }; // 三幕配器密度不同，做响度对齐

/* -------------------------------- 小工具 ---------------------------------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const nowOf = (ctx) => ctx.currentTime;
const stageOf = (s) => {
  const n = Number(s);
  return n === 2 ? 2 : n === 3 ? 3 : 1;
};
const jitter = (amount) => (Math.random() - 0.5) * amount;

const STAGE_NAMES = { 1: '山区晨光', 2: '乡镇集市', 3: '城市黄昏' };

/* -------------------------------- 和声库 ---------------------------------- */
/* notes 为琶音/旋律用音（MIDI），pad 为三音铺底，root 为贝斯根音。 */
const CHORDS = {
  A:      { root: 45, notes: [57, 61, 64, 69], pad: [57, 64, 69] }, // A
  E:      { root: 40, notes: [56, 59, 64, 68], pad: [56, 64, 68] }, // E
  'F#m':  { root: 42, notes: [54, 57, 61, 66], pad: [54, 61, 66] }, // F#m
  D:      { root: 38, notes: [50, 54, 57, 62], pad: [50, 57, 62] }, // D
  Bm:     { root: 47, notes: [59, 62, 66, 71], pad: [59, 66, 71] }, // Bm
  Dmaj7:  { root: 38, notes: [50, 54, 57, 61], pad: [50, 57, 61] }, // Dmaj7
  E7:     { root: 40, notes: [52, 56, 59, 62], pad: [52, 59, 62] }, // E7
  'C#m7': { root: 37, notes: [49, 52, 56, 59], pad: [49, 56, 59] }, // C#m7
  'F#m7': { root: 42, notes: [54, 57, 61, 64], pad: [54, 61, 64] }, // F#m7
};

/* 三幕各自的和弦走向（同一调性 A 大调 / 关系小调，切幕时和声尽量平滑）。 */
const PROGRESSIONS = {
  1: ['A', 'E', 'F#m', 'D'],            // I – V – vi – IV 晨光
  2: ['D', 'A', 'Bm', 'E'],             // IV – I – ii – V 集市
  3: ['Dmaj7', 'E7', 'C#m7', 'F#m7'],   // IV – V – iii – vi City Pop
};

/* 山区：8 分音符指弹型（-1 = 休止），数字为和弦 notes 下标。 */
const GUITAR1 = [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 3, -1, 2, -1];

/* 乡镇：木管旋律（s=16分音符位置, d=和弦音下标, l=时长秒）。 */
const FLUTE2 = [
  { s: 0, d: 2, l: 0.26 },
  { s: 2, d: 3, l: 0.16 },
  { s: 4, d: 2, l: 0.3 },
  { s: 7, d: 1, l: 0.16 },
  { s: 8, d: 2, l: 0.2 },
  { s: 10, d: 3, l: 0.24 },
  { s: 12, d: 2, l: 0.18 },
  { s: 14, d: 1, l: 0.4 },
];

/* 乡镇：弹跳贝斯（d=相对根音的半音数）。 */
const BASS2 = [
  { s: 0, d: 0, l: 0.16 },
  { s: 3, d: 12, l: 0.12 },
  { s: 6, d: 7, l: 0.12 },
  { s: 8, d: 0, l: 0.16 },
  { s: 11, d: 12, l: 0.12 },
  { s: 14, d: 7, l: 0.14 },
];

/* 城市：8 分音符贝斯音型。 */
const BASS3 = [0, null, 12, null, 0, null, 12, null, 7, null, 12, null, 0, null, 7, null];

/* 城市：明亮 synth lead 乐句（d=和弦音下标，+12 后使用）。 */
const LEAD3 = [
  { s: 0, d: 3, l: 0.1 },
  { s: 1, d: 2, l: 0.1 },
  { s: 3, d: 3, l: 0.12 },
  { s: 5, d: 2, l: 0.1 },
  { s: 6, d: 3, l: 0.16 },
  { s: 8, d: 2, l: 0.1 },
  { s: 9, d: 3, l: 0.1 },
  { s: 11, d: 2, l: 0.12 },
  { s: 12, d: 1, l: 0.1 },
  { s: 14, d: 3, l: 0.22 },
];

/* 拾取音随连单升调：A 大调五声音阶 + 八度（1..8 连单）。 */
const PICKUP_SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

/* ============================================================================
 * AudioEngine
 * ========================================================================== */
export class AudioEngine {
  constructor() {
    /* --- 上下文/图 --- */
    this.ctx = null;
    this._failed = false;
    this._initPromise = null;
    this._lastError = null;
    this._persistent = new Set();   // 常驻节点（用于自检节点数 < 40）
    this._noiseBuffer = null;
    this._waves = null;

    /* 总线 */
    this._masterIn = null;
    this._comp = null;
    this._masterOut = null;
    this._musicBus = null;
    this._musicTone = null;
    this._stageGains = null;
    this._sfxBus = null;
    this._sfxFilter = null;
    this._engineBus = null;
    this._delaySend = null;
    this._delay = null;

    /* 音乐 */
    this._musicWanted = false;
    this._musicPlaying = false;
    this._musicStage = 1;
    this._pendingStage = null;
    this._step = 0;
    this._bar = 0;
    this._nextTime = 0;
    this._timer = null;
    this._intensity = 0.55;
    this._lastIntensityAt = -1;
    this._lastSpeedAt = -1;
    this._pad = null;

    /* 引擎 / 氮气 */
    this._engineWanted = false;
    this._engine = null;
    this._speed = 0;
    this._boostWanted = false;
    this._boost = null;

    /* 状态 */
    this._muted = false;
    this._paused = false;
    this._hidden = false;
    this._visibilityBound = false;
  }

  /* ==========================================================================
   * 生命周期
   * ======================================================================== */

  /** 首次用户手势后调用；幂等，失败静默降级。返回是否可发声。 */
  async init() {
    if (this._failed) return false;
    if (this.ctx) {
      try {
        if (this.ctx.state !== 'running') await this._resumeCtx();
        this._applyWants();
      } catch (err) {
        this._noteError(err);
      }
      return this._isReady();
    }
    if (!this._initPromise) this._initPromise = this._doInit();
    try {
      return await this._initPromise;
    } catch {
      return false;
    }
  }

  async _doInit() {
    try {
      const Ctor = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!Ctor) {
        this._failed = true;
        return false;
      }
      let ctx;
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        ctx = new Ctor();
      }
      if (!ctx) {
        this._failed = true;
        return false;
      }
      this.ctx = ctx;
      this._buildGraph();
      this._noiseBuffer = this._makeNoiseBuffer();
      this._waves = this._makeWaves();
      this._bindVisibility();
      await this._resumeCtx();
      this._applyWants();
      return this._isReady();
    } catch (err) {
      this._fail(err);
      return false;
    }
  }

  _fail(err) {
    this._failed = true;
    this._noteError(err);
    try { this.ctx && this.ctx.close && this.ctx.close(); } catch { /* ignore */ }
    this.ctx = null;
    try {
      // 失败只提示一次，页面继续运行（静默降级）。
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[audio] WebAudio 不可用，已静默降级。');
      }
    } catch { /* ignore */ }
  }

  _noteError(err) {
    try {
      this._lastError = String((err && err.message) || err || 'unknown');
    } catch {
      this._lastError = 'unknown';
    }
  }

  async _resumeCtx() {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      const p = ctx.resume();
      if (p && p.then) await p;
    } catch { /* 自动播放策略可能拦截，下次手势再试 */ }
    return ctx.state === 'running';
  }

  _isReady() {
    return !!this.ctx && this.ctx.state === 'running' && !this._failed;
  }

  /* ==========================================================================
   * 音频图：master → compressor → out；music / sfx / engine 三条子总线
   * ======================================================================== */

  _buildGraph() {
    const ctx = this.ctx;

    /* ---- 主链（DynamicsCompressor 限幅防爆音） ---- */
    const masterIn = ctx.createGain();
    masterIn.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -9;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const masterOut = ctx.createGain();
    masterOut.gain.value = this._muted ? 0.0001 : MASTER_LEVEL;
    /* 安全软限幅：压缩器之后再过一层 tanh 软拐点，任何情况下输出不过 0dBFS。 */
    const limiter = ctx.createWaveShaper();
    try {
      limiter.curve = this._makeSoftClipCurve();
      limiter.oversample = '2x';
    } catch { /* 极老浏览器不支持 oversample 时保留默认 */ }
    masterIn.connect(comp);
    comp.connect(limiter);
    limiter.connect(masterOut);
    masterOut.connect(ctx.destination);
    this._masterIn = masterIn;
    this._comp = comp;
    this._limiter = limiter;
    this._masterOut = masterOut;
    this._track(masterIn, comp, limiter, masterOut);

    /* ---- 音乐总线（低通做整体柔和度 + 强度滤波） ---- */
    const musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    const musicTone = ctx.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 5000 + 11000 * this._intensity;
    musicTone.Q.value = 0.4;
    musicTone.connect(musicBus);
    musicBus.connect(masterIn);
    this._musicBus = musicBus;
    this._musicTone = musicTone;
    this._track(musicBus, musicTone);

    /* 三幕各自的层增益（极简 crossfade，不断拍） */
    const stageGains = [1, 2, 3].map(() => {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(musicTone);
      this._track(g);
      return g;
    });
    this._stageGains = stageGains;

    /* ---- 音效总线（轻度低通，避免刺耳） ---- */
    const sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.68;
    const sfxFilter = ctx.createBiquadFilter();
    sfxFilter.type = 'lowpass';
    sfxFilter.frequency.value = 12000;
    sfxFilter.Q.value = 0.5;
    sfxBus.connect(sfxFilter);
    sfxFilter.connect(masterIn);
    this._sfxBus = sfxBus;
    this._sfxFilter = sfxFilter;
    this._track(sfxBus, sfxFilter);

    /* ---- 引擎/氮气总线 ---- */
    const engineBus = ctx.createGain();
    engineBus.gain.value = 0.55;
    engineBus.connect(masterIn);
    this._engineBus = engineBus;
    this._track(engineBus);

    /* ---- 音乐空间感：附点八分延迟（反馈 + 低通） ---- */
    const delaySend = ctx.createGain();
    delaySend.gain.value = 1;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = BEAT * 0.75; // 0.4167s
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 2800;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.3;
    delaySend.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(delayWet);
    delayWet.connect(musicTone);
    delayFilter.connect(feedback);
    feedback.connect(delay);
    this._delaySend = delaySend;
    this._delay = delay;
    this._track(delaySend, delay, feedback, delayFilter, delayWet);

    /* ---- 山区暖 pad：3 支常驻三角波 + 低通（切 chord 用滑音） ---- */
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.6;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.0001;
    padFilter.connect(padGain);
    padGain.connect(stageGains[0]);
    const padOscs = [];
    const detunes = [-6, 5, -3];
    for (let i = 0; i < 3; i += 1) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.detune.value = detunes[i];
      o.connect(padFilter);
      try { o.start(); } catch { /* ignore */ }
      padOscs.push(o);
    }
    this._pad = { oscs: padOscs, filter: padFilter, gain: padGain };
    this._track(padFilter, padGain, ...padOscs);
  }

  _track(...nodes) {
    for (const n of nodes) if (n) this._persistent.add(n);
  }

  _untrack(...nodes) {
    for (const n of nodes) if (n) this._persistent.delete(n);
  }

  _makeNoiseBuffer() {
    const ctx = this.ctx;
    const seconds = 2;
    const len = Math.max(1024, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.86 + white * 0.14; // 略微粉噪化，听感更自然
      data[i] = clamp(white * 0.7 + last * 1.4, -1, 1);
    }
    return buf;
  }

  _makeWaves() {
    const ctx = this.ctx;
    const make = (partials) => {
      const real = new Float32Array(partials.length + 1);
      const imag = new Float32Array(partials.length + 1);
      for (let i = 0; i < partials.length; i += 1) imag[i + 1] = partials[i];
      try {
        return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      } catch {
        return ctx.createPeriodicWave(real, imag);
      }
    };
    return {
      // 木吉他/尼龙弦：基频 + 几条柔和谐波
      pluck: make([1, 0.42, 0.22, 0.12, 0.06, 0.03]),
      // 笛/木管：近乎正弦 + 一点空气感
      flute: make([1, 0.18, 0.08, 0.03, 0.015]),
      // 城市 lead：明亮但不尖锐
      lead: make([1, 0.62, 0.38, 0.24, 0.15, 0.1, 0.06]),
      // 电钢琴 / City Pop 和弦
      ep: make([1, 0.4, 0.24, 0.16, 0.1, 0.06, 0.04]),
      // 贝斯：圆润的锯齿感
      bass: make([1, 0.5, 0.22, 0.1, 0.04]),
      // 暖 pad（备用）
      pad: make([1, 0.3, 0.14, 0.06, 0.03]),
    };
  }

  /** 软限幅曲线：|x| <= 0.72 线性，超过后用 tanh 平滑压到 ±0.86（留足余量）。 */
  _makeSoftClipCurve() {
    const n = 4096;
    const curve = new Float32Array(n);
    const knee = 0.72;
    const ceiling = 0.86; // 不顶到 ±1，给 2x oversample 的滤波振铃留余量
    const range = 1 - knee;
    const span = ceiling - knee;
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      const a = Math.abs(x);
      if (a <= knee) {
        curve[i] = x;
      } else {
        const t = (a - knee) / range;
        curve[i] = Math.sign(x) * (knee + span * (Math.tanh(t * 2.2) / Math.tanh(2.2)));
      }
    }
    return curve;
  }

  /* ==========================================================================
   * 页面可见性：隐藏时暂停调度并 suspend，回来时恢复
   * ======================================================================== */

  _bindVisibility() {
    if (this._visibilityBound || typeof document === 'undefined') return;
    this._visibilityBound = true;
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this._onHidden();
        else this._onShown();
      });
    } catch { /* ignore */ }
  }

  _onHidden() {
    this._hidden = true;
    this._stopScheduler();
    try {
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        const p = ctx.suspend();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* ignore */ }
  }

  _onShown() {
    if (!this._hidden) return;
    this._hidden = false;
    if (!this.ctx || this._failed) return;
    try {
      const p = this.ctx.resume();
      const finish = () => { if (!this._hidden) this._applyWants(); };
      if (p && p.then) p.then(finish).catch(() => {});
      else finish();
    } catch { /* ignore */ }
  }

  /* ==========================================================================
   * 对外状态控制
   * ======================================================================== */

  get muted() { return this._muted; }
  set muted(v) { this.setMuted(v); }

  setMuted(value) {
    this._muted = !!value;
    if (!this._masterOut || !this.ctx) return;
    try {
      const t = nowOf(this.ctx);
      const g = this._masterOut.gain;
      g.cancelScheduledValues(t);
      g.setTargetAtTime(this._muted ? 0.0001 : MASTER_LEVEL, t, 0.03);
    } catch (err) { this._noteError(err); }
  }

  setPaused(value) {
    const p = !!value;
    if (this._paused === p) return;
    this._paused = p;
    if (!this.ctx) return;
    try {
      const t = nowOf(this.ctx);
      const bg = this._musicBus.gain;
      bg.cancelScheduledValues(t);
      bg.setTargetAtTime(p ? 0.0001 : MUSIC_LEVEL, t, 0.06);
      this._setEngineOutput(p ? 0.0001 : null);
      this._setBoostOutput(p ? 0.0001 : null);
      if (p) {
        this._stopScheduler();
      } else if (!this._hidden) {
        const finish = () => { if (!this._paused) this._applyWants(); };
        const r = this._resumeCtx();
        if (r && r.then) r.then(finish).catch(() => {});
        else finish();
      }
    } catch (err) { this._noteError(err); }
  }

  /* ==========================================================================
   * 音乐
   * ======================================================================== */

  startMusic(stage = 1) {
    try {
      this._musicWanted = true;
      const s = stageOf(stage == null ? this._musicStage : stage);
      if (!this._musicPlaying) {
        this._musicStage = s;
        this._pendingStage = null;
      } else if (s !== this._musicStage) {
        this._pendingStage = s;
      }
      this._applyWants();
    } catch (err) { this._noteError(err); }
  }

  setStage(stage) {
    try {
      const s = stageOf(stage);
      if (this._musicPlaying) {
        // 下一小节线切换；点到当前幕则取消尚未生效的切换。
        this._pendingStage = s !== this._musicStage ? s : null;
        return;
      }
      this._musicStage = s;
      if (this._musicWanted) this._applyWants();
    } catch (err) { this._noteError(err); }
  }

  setIntensity(value) {
    try {
      const n = Number(value);
      const v = clamp(Number.isFinite(n) ? n : 0.55, 0, 1);
      const prev = this._intensity;
      this._intensity = v;
      if (!this.ctx) return;
      const t = nowOf(this.ctx);
      // 游戏每帧都会调 setIntensity / setSpeed：限速写 AudioParam，避免自动化事件无限增长。
      if (t - this._lastIntensityAt < 0.06) return;
      if (Math.abs(v - prev) < 0.005 && t - this._lastIntensityAt < 0.2) return;
      this._lastIntensityAt = t;
      if (this._musicTone) {
        this._musicTone.frequency.setTargetAtTime(5000 + 11000 * this._intensity, t, 0.15);
      }
      if (this._pad) {
        this._pad.filter.frequency.setTargetAtTime(600 + 1100 * this._intensity, t, 0.2);
        if (this._musicStage === 1 && this._musicPlaying) {
          this._pad.gain.gain.setTargetAtTime(0.022 + 0.02 * this._intensity, t, 0.2);
        }
      }
    } catch (err) { this._noteError(err); }
  }

  stopMusic() {
    this._musicWanted = false;
    if (!this.ctx) return;
    try {
      this._stopScheduler();
      const t = nowOf(this.ctx);
      const bg = this._musicBus.gain;
      bg.cancelScheduledValues(t);
      bg.setTargetAtTime(0.0001, t, 0.05);
    } catch (err) { this._noteError(err); }
  }

  _applyWants() {
    if (!this.ctx || this._failed || this.ctx.state !== 'running') return;
    try {
      const t = nowOf(this.ctx);
      if (this._musicWanted && !this._paused) {
        this._rampMusicBus(MUSIC_LEVEL, t);
        this._startScheduler();
      } else {
        this._stopScheduler();
      }
      if (this._engineWanted && !this._paused) this._startEngine();
      else if (this._engine && this._paused) this._setEngineOutput(0.0001);
      if (this._boostWanted && !this._paused) {
        this._startBoost();
        if (this._boost) this._setBoostOutput(null);
      } else if (this._boost && this._paused) {
        this._setBoostOutput(0.0001);
      }
      if (this._engine) this._applyEngineParams(this._speed, t, false);
      if (this._muted) this.setMuted(true);
    } catch (err) { this._noteError(err); }
  }

  _rampMusicBus(level, t) {
    const bg = this._musicBus && this._musicBus.gain;
    if (!bg) return;
    bg.cancelScheduledValues(t);
    bg.setTargetAtTime(Math.max(0.0001, level), t, 0.06);
  }

  _startScheduler() {
    const ctx = this.ctx;
    if (!ctx || this._failed || this._musicPlaying || this._paused || this._hidden) return;
    if (ctx.state !== 'running') return;
    this._step = 0;
    this._bar = 0;
    if (this._pendingStage != null) {
      this._musicStage = stageOf(this._pendingStage);
      this._pendingStage = null;
    }
    const startAt = ctx.currentTime + 0.06;
    this._applyStage(this._musicStage, startAt, true);
    this._nextTime = ctx.currentTime + 0.09;
    this._musicPlaying = true;
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  _stopScheduler() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._musicPlaying = false;
  }

  _tick() {
    if (!this._musicPlaying || this._paused || this._hidden) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this._failed) return;
    try {
      if (this._nextTime < ctx.currentTime - 0.3) {
        this._nextTime = ctx.currentTime + 0.04;
      }
      const horizon = ctx.currentTime + LOOKAHEAD;
      let guard = 0;
      while (this._nextTime < horizon && guard < 32) {
        this._scheduleStep(this._step, this._nextTime, this._bar);
        this._nextTime += STEP;
        this._step += 1;
        if (this._step >= BAR_STEPS) {
          this._step = 0;
          this._bar += 1;
        }
        guard += 1;
      }
    } catch (err) {
      this._noteError(err);
      this._stopScheduler();
    }
  }

  _chordAt(bar, stage) {
    const prog = PROGRESSIONS[stage] || PROGRESSIONS[1];
    return CHORDS[prog[bar % prog.length]] || CHORDS.A;
  }

  _scheduleStep(step, t, bar) {
    if (step === 0 && this._pendingStage != null) {
      // 在小节线做层交叉淡化：旧层退、新层进，step 时钟不断。
      this._applyStage(this._pendingStage, t, false);
    }
    const stage = this._musicStage;
    const chord = this._chordAt(bar, stage);
    const k = this._intensity;
    if (stage === 1) this._scheduleStage1(step, t, chord, k);
    else if (stage === 2) this._scheduleStage2(step, t, chord, k);
    else this._scheduleStage3(step, t, chord, k);
  }

  _applyStage(stage, t, instant) {
    const s = stageOf(stage);
    const fadeIn = instant ? 0.02 : 0.18;
    const fadeOut = instant ? 0.02 : 0.3;
    for (let i = 0; i < 3; i += 1) {
      const g = this._stageGains[i].gain;
      const target = i + 1 === s ? (STAGE_TRIM[s] || 1) : 0.0001;
      try {
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.linearRampToValueAtTime(target, t + (target > 0.5 ? fadeIn : fadeOut));
      } catch { /* ignore */ }
    }
    this._musicStage = s;
    this._pendingStage = null;
    if (s === 1) this._setPad(this._chordAt(this._bar, 1), t, instant);
  }

  _setPad(chord, t, instant) {
    if (!this._pad || !chord) return;
    const notes = chord.pad || [57, 64, 69];
    const glide = instant ? 0.02 : 0.07;
    for (let i = 0; i < this._pad.oscs.length; i += 1) {
      const o = this._pad.oscs[i];
      const midi = notes[Math.min(i, notes.length - 1)];
      try {
        o.frequency.setTargetAtTime(mtof(midi), t, glide);
      } catch { /* ignore */ }
    }
    try {
      this._pad.filter.frequency.setTargetAtTime(600 + 1100 * this._intensity, t, 0.25);
      this._pad.gain.gain.setTargetAtTime(0.022 + 0.02 * this._intensity, t, 0.25);
    } catch { /* ignore */ }
  }

  /* --------------------------------------------------------------------------
   * 第一幕：山区晨光
   * ------------------------------------------------------------------------ */
  _scheduleStage1(step, t, chord, k) {
    const dest = this._stageGains[0];
    const h = jitter(0.004);

    /* 指弹拨弦 */
    const idx = GUITAR1[step];
    if (idx >= 0) {
      const accent = step === 0 || step === 8;
      this._pluck(
        mtof(chord.notes[idx]),
        t + h,
        accent ? 0.72 : 0.52,
        (accent ? 0.1 : 0.078) + 0.035 * k,
        dest,
        { pan: idx <= 1 ? -0.12 : 0.14, send: 0.14 },
      );
    }

    /* 高音泛音点缀，随强度出现 */
    if (k > 0.55 && (step === 7 || step === 15)) {
      this._bell(mtof(chord.notes[3] + 12), t + 0.01, 0.5, 0.024 + 0.018 * k, dest, 0.28);
    }

    /* 温暖 pad 每小节换和弦 */
    if (step === 0) this._setPad(chord, t, false);

    /* 柔和贝斯：半音符 */
    if (step === 0 || step === 8) {
      this._bass(mtof(chord.root), t, 1.15, 0.15 + 0.03 * k, dest, { soft: true });
    }

    /* 轻打击：软底鼓 + 沙锤 */
    if (step === 0) this._kick(t, 0.08 + 0.03 * k, dest, 'soft');
    if (step === 10 && k > 0.35) this._kick(t, 0.045 + 0.02 * k, dest, 'soft');
    if (step % 2 === 0) {
      const accent = step % 4 === 0;
      this._shaker(
        t,
        (accent ? 0.04 : 0.026) * (0.7 + 0.5 * k),
        accent,
        dest,
        accent ? -0.28 : 0.28,
      );
    }
    if (k > 0.5 && (step === 6 || step === 14)) this._wood(t, 0.022 + 0.012 * k, dest, -0.2);
  }

  /* --------------------------------------------------------------------------
   * 第二幕：乡镇集市
   * ------------------------------------------------------------------------ */
  _scheduleStage2(step, t, chord, k) {
    const dest = this._stageGains[1];

    /* 鼓：底鼓 + 拍手 + 沙锤/铃鼓 */
    if (step === 0 || step === 8) this._kick(t, 0.14 + 0.03 * k, dest, 'normal');
    if (k > 0.6 && step === 14) this._kick(t, 0.085, dest, 'normal');
    if (step === 4 || step === 12) this._clap(t, 0.085 + 0.03 * k, dest);
    if (step % 2 === 0) {
      const accent = step % 4 === 0;
      this._shaker(
        t,
        (accent ? 0.042 : 0.028) * (0.7 + 0.5 * k),
        accent,
        dest,
        accent ? 0.3 : -0.3,
      );
    }
    if (k > 0.5 && (step === 2 || step === 6 || step === 10)) {
      this._wood(t, 0.02 + 0.012 * k, dest, 0.22);
    }

    /* 弹跳贝斯 */
    for (const b of BASS2) {
      if (b.s === step) {
        this._bass(
          mtof(chord.root + b.d),
          t,
          b.l,
          0.15 + 0.04 * k,
          dest,
          { filter: 800 + 900 * k },
        );
        break;
      }
    }

    /* 木管/笛 lead（有条不紊地呼吸） */
    for (const n of FLUTE2) {
      if (n.s !== step) continue;
      const note = chord.notes[Math.min(3, n.d)] + 12;
      this._flute(mtof(note), t, n.l, 0.07 + 0.026 * k, dest, { pan: -0.06, send: 0.18 });
      if (k > 0.52) {
        const harmony = chord.notes[Math.min(3, n.d + 1)] + 12;
        this._flute(mtof(harmony), t + 0.008, n.l * 0.9, 0.03 + 0.018 * k, dest, {
          pan: 0.22,
          send: 0.24,
        });
      }
      break;
    }
  }

  /* --------------------------------------------------------------------------
   * 第三幕：城市黄昏
   * ------------------------------------------------------------------------ */
  _scheduleStage3(step, t, chord, k) {
    const dest = this._stageGains[2];

    /* 鼓组：四踩 + 军鼓 + 踩镲 */
    if (step % 4 === 0) this._kick(t, 0.135 + 0.03 * k, dest, 'tight');
    if (k > 0.62 && step === 14) this._kick(t, 0.07, dest, 'tight');
    if (step === 4 || step === 12) this._snare(t, 0.09 + 0.03 * k, dest);
    if (step % 2 === 0) {
      const accent = step % 4 === 0;
      this._hat(t, (accent ? 0.034 : 0.022) * (0.7 + 0.5 * k), false, dest, accent ? 0.22 : -0.22);
    }
    if (k > 0.55 && step === 14) this._hat(t, 0.026 + 0.012 * k, true, dest, 0.12);
    if (k > 0.82 && step % 2 === 1) this._hat(t, 0.012, false, dest, -0.3);

    /* 贝斯：八分音符律动 */
    const interval = BASS3[step];
    if (interval != null) {
      this._bass(
        mtof(chord.root + interval),
        t,
        0.13,
        0.15 + 0.04 * k,
        dest,
        { filter: 1100 + 1500 * k },
      );
    }

    /* City Pop 电钢和弦：反拍切分 */
    if (step === 2 || step === 6 || step === 10 || step === 14) {
      this._chordStab(
        chord.notes.map((n) => n + 12),
        t,
        0.46,
        0.03 + 0.018 * k,
        dest,
        { lp: 1500 + 1800 * k },
      );
    }

    /* 明亮 synth lead */
    for (const n of LEAD3) {
      if (n.s !== step) continue;
      const note = chord.notes[Math.min(3, n.d)] + 12;
      this._lead(mtof(note), t, n.l, 0.05 + 0.024 * k, dest, {
        pan: 0.18,
        send: 0.3,
        lp: 2200 + 2600 * k,
      });
      if (k > 0.7) {
        this._lead(mtof(note + 12), t + 0.006, n.l * 0.8, 0.018 + 0.014 * k, dest, {
          pan: -0.24,
          send: 0.22,
          lp: 3200 + 2600 * k,
        });
      }
      break;
    }
  }

  /* ==========================================================================
   * 乐器声部（全部为一次性节点，结束后自动断开）
   * ======================================================================== */

  /** 通用单音：包络 + 可选低通/高通/声像/延迟送出。 */
  _voice(cfg) {
    const ctx = this.ctx;
    if (!ctx || !this._isReady()) return;
    const t = cfg.t;
    if (!Number.isFinite(t)) return;
    const dur = Math.max(0.04, cfg.dur == null ? 0.2 : cfg.dur);
    const peak = Math.max(0.0002, cfg.gain == null ? 0.08 : cfg.gain);
    const attack = clamp(cfg.attack == null ? 0.006 : cfg.attack, 0.002, dur * 0.6);
    const dest = cfg.dest || this._sfxBus;
    if (!dest) return;

    const sources = [];
    const makeOsc = (ratio, detune) => {
      const o = ctx.createOscillator();
      if (cfg.wave && this._waves && this._waves[cfg.wave]) {
        o.setPeriodicWave(this._waves[cfg.wave]);
      } else {
        o.type = cfg.type || 'sine';
      }
      const f = Math.max(20, (cfg.freq || 440) * ratio);
      try { o.frequency.setValueAtTime(f, t); } catch { /* ignore */ }
      if (cfg.freqEnd != null && ratio === 1) {
        try {
          o.frequency.exponentialRampToValueAtTime(
            Math.max(20, cfg.freqEnd),
            t + Math.max(0.01, cfg.bendTime == null ? dur : cfg.bendTime),
          );
        } catch { /* ignore */ }
      }
      if (detune) {
        try { o.detune.setValueAtTime(detune, t); } catch { /* ignore */ }
      }
      return o;
    };

    sources.push(makeOsc(1, cfg.detune || 0));
    if (cfg.harmonic) sources.push(makeOsc(cfg.harmonic, (cfg.detune || 0) - 6));
    else if (cfg.detune2 != null) sources.push(makeOsc(1, cfg.detune2));

    let lp = null;
    if (cfg.lp != null) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.max(40, cfg.lp), t);
      if (cfg.lpEnd != null) {
        try {
          lp.frequency.exponentialRampToValueAtTime(Math.max(40, cfg.lpEnd), t + dur * 0.92);
        } catch { /* ignore */ }
      }
      lp.Q.value = cfg.lpQ == null ? 0.7 : cfg.lpQ;
    }
    let hp = null;
    if (cfg.hp != null) {
      hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(Math.max(20, cfg.hp), t);
      hp.Q.value = 0.6;
    }

    const g = ctx.createGain();
    try {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } catch { /* ignore */ }

    let pan = null;
    if (cfg.pan && ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(clamp(cfg.pan, -1, 1), t);
    }

    /* 连接：sources → lp → hp → gain → [pan] → dest；gain 另送 delay */
    let tail = null;
    if (lp) {
      for (const o of sources) o.connect(lp);
      tail = lp;
    }
    if (hp) {
      if (tail) tail.connect(hp);
      else for (const o of sources) o.connect(hp);
      tail = hp;
    }
    if (tail) tail.connect(g);
    else for (const o of sources) o.connect(g);
    let out = g;
    if (pan) {
      g.connect(pan);
      out = pan;
    }
    out.connect(dest);
    if (cfg.send && this._delaySend) {
      try { g.connect(this._delaySend); } catch { /* ignore */ }
    }

    const shared = [g, lp, hp, pan].filter(Boolean);
    let ended = 0;
    const stopAt = t + dur + 0.05;
    for (const o of sources) {
      try {
        o.start(t);
        o.stop(stopAt);
      } catch { /* ignore */ }
      o.onended = () => {
        try { o.disconnect(); } catch { /* ignore */ }
        ended += 1;
        if (ended >= sources.length) {
          for (const n of shared) {
            try { n.disconnect(); } catch { /* ignore */ }
          }
        }
      };
    }
  }

  /** 噪声音效：滤波 + 包络；用于风声、喷流、沙锤、拍手等。 */
  _noise(cfg) {
    const ctx = this.ctx;
    if (!ctx || !this._isReady() || !this._noiseBuffer) return;
    const t = cfg.t;
    if (!Number.isFinite(t)) return;
    const dur = Math.max(0.015, cfg.dur == null ? 0.1 : cfg.dur);
    const peak = Math.max(0.0002, cfg.gain == null ? 0.05 : cfg.gain);
    const attack = clamp(cfg.attack == null ? 0.004 : cfg.attack, 0.001, dur * 0.8);
    const dest = cfg.dest || this._sfxBus;
    if (!dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = cfg.filter || 'bandpass';
    filter.frequency.setValueAtTime(Math.max(30, cfg.freq || 1200), t);
    if (cfg.freqEnd != null) {
      try {
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(30, cfg.freqEnd),
          t + Math.max(0.01, cfg.bendTime == null ? dur : cfg.bendTime),
        );
      } catch { /* ignore */ }
    }
    filter.Q.value = cfg.q == null ? 1 : cfg.q;
    const g = ctx.createGain();
    try {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } catch { /* ignore */ }
    let pan = null;
    if (cfg.pan && ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(clamp(cfg.pan, -1, 1), t);
    }
    src.connect(filter);
    filter.connect(g);
    let out = g;
    if (pan) {
      g.connect(pan);
      out = pan;
    }
    out.connect(dest);
    const offset = Math.random() * Math.max(0, 1.85 - dur);
    try {
      src.start(t, offset);
      src.stop(t + dur + 0.05);
    } catch { /* ignore */ }
    src.onended = () => {
      try { src.disconnect(); } catch { /* ignore */ }
      try { filter.disconnect(); } catch { /* ignore */ }
      try { g.disconnect(); } catch { /* ignore */ }
      if (pan) {
        try { pan.disconnect(); } catch { /* ignore */ }
      }
    };
  }

  _pluck(freq, t, dur, gain, dest, opts = {}) {
    this._voice({
      t,
      freq,
      dur,
      gain,
      dest,
      wave: 'pluck',
      attack: 0.004,
      lp: 1600 + 2600 * this._intensity,
      lpEnd: 900 + 900 * this._intensity,
      pan: opts.pan || 0,
      send: opts.send || 0,
    });
  }

  _flute(freq, t, dur, gain, dest, opts = {}) {
    this._voice({
      t,
      freq,
      dur,
      gain,
      dest,
      wave: 'flute',
      attack: 0.03,
      lp: 3600,
      lpEnd: 2300,
      pan: opts.pan || 0,
      send: opts.send || 0,
    });
  }

  _lead(freq, t, dur, gain, dest, opts = {}) {
    this._voice({
      t,
      freq,
      dur,
      gain,
      dest,
      wave: 'lead',
      detune: 5,
      detune2: -6,
      attack: 0.008,
      lp: opts.lp || 3000,
      lpEnd: 1600,
      pan: opts.pan || 0,
      send: opts.send || 0,
    });
  }

  _bass(freq, t, dur, gain, dest, opts = {}) {
    this._voice({
      t,
      freq,
      dur,
      gain,
      dest,
      wave: opts.soft ? undefined : 'bass',
      type: opts.soft ? 'sine' : 'sine',
      attack: opts.soft ? 0.02 : 0.008,
      lp: opts.filter || 900,
      lpEnd: (opts.filter || 900) * 0.6,
      lpQ: 1.1,
    });
  }

  _bell(freq, t, dur, gain, dest, pan = 0) {
    this._voice({
      t,
      freq,
      dur,
      gain,
      dest,
      type: 'sine',
      harmonic: 2.76,
      attack: 0.003,
      lp: 9000,
      pan,
    });
  }

  _kick(t, level, dest, style = 'normal') {
    this._voice({
      t,
      freq: style === 'soft' ? 118 : 150,
      freqEnd: style === 'soft' ? 42 : 47,
      dur: style === 'soft' ? 0.22 : 0.18,
      gain: level,
      dest,
      type: 'sine',
      attack: 0.002,
      lp: 900,
      lpEnd: 180,
    });
    this._noise({
      t,
      dur: 0.018,
      gain: level * 0.18,
      dest,
      filter: 'highpass',
      freq: 1400,
      q: 0.7,
    });
  }

  _clap(t, level, dest) {
    const offsets = [0, 0.012, 0.026];
    for (let i = 0; i < offsets.length; i += 1) {
      this._noise({
        t: t + offsets[i],
        dur: i === 2 ? 0.13 : 0.035,
        gain: level * (i === 2 ? 0.85 : 0.5),
        dest,
        filter: 'bandpass',
        freq: 1550,
        q: 1.4,
        pan: 0.04,
      });
    }
  }

  _snare(t, level, dest) {
    this._noise({
      t,
      dur: 0.15,
      gain: level,
      dest,
      filter: 'bandpass',
      freq: 1800,
      q: 0.9,
      pan: 0.02,
    });
    this._voice({
      t,
      freq: 190,
      freqEnd: 120,
      dur: 0.09,
      gain: level * 0.4,
      dest,
      type: 'triangle',
      attack: 0.002,
      lp: 1200,
    });
  }

  _hat(t, level, open, dest, pan = 0) {
    this._noise({
      t,
      dur: open ? 0.2 : 0.042,
      gain: level,
      dest,
      filter: 'highpass',
      freq: 7600,
      q: 0.7,
      attack: 0.002,
      pan,
    });
  }

  _shaker(t, level, accent, dest, pan = 0) {
    this._noise({
      t,
      dur: accent ? 0.07 : 0.045,
      gain: level,
      dest,
      filter: 'bandpass',
      freq: accent ? 6400 : 7200,
      q: 0.8,
      attack: 0.012,
      pan,
    });
  }

  _wood(t, level, dest, pan = 0) {
    this._voice({
      t,
      freq: 760 + Math.random() * 60,
      dur: 0.06,
      gain: level,
      dest,
      type: 'triangle',
      attack: 0.002,
      lp: 3800,
      pan,
    });
  }

  /** City Pop 和弦 stab：共享包络/滤波，每个音一支电钢振荡器。 */
  _chordStab(notes, t, dur, gain, dest, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this._isReady() || !notes || !notes.length) return;
    const g = ctx.createGain();
    try {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } catch { /* ignore */ }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(opts.lp || 2400, t);
    try {
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, (opts.lp || 2400) * 0.55), t + dur);
    } catch { /* ignore */ }
    lp.Q.value = 0.5;
    lp.connect(g);
    g.connect(dest);

    const oscs = [];
    for (let i = 0; i < notes.length; i += 1) {
      const o = ctx.createOscillator();
      if (this._waves && this._waves.ep) o.setPeriodicWave(this._waves.ep);
      else o.type = 'triangle';
      o.frequency.setValueAtTime(mtof(notes[i]), t);
      o.detune.setValueAtTime(i % 2 === 0 ? -4 : 4, t);
      o.connect(lp);
      oscs.push(o);
    }
    let ended = 0;
    const stopAt = t + dur + 0.05;
    for (const o of oscs) {
      try {
        o.start(t);
        o.stop(stopAt);
      } catch { /* ignore */ }
      o.onended = () => {
        try { o.disconnect(); } catch { /* ignore */ }
        ended += 1;
        if (ended >= oscs.length) {
          try { lp.disconnect(); } catch { /* ignore */ }
          try { g.disconnect(); } catch { /* ignore */ }
        }
      };
    }
  }

  /* ==========================================================================
   * 引擎声 & 氮气
   * ======================================================================== */

  startEngine() {
    this._engineWanted = true;
    try {
      if (!this.ctx || this._paused || this._hidden) return;
      this._applyWants();
    } catch (err) { this._noteError(err); }
  }

  stopEngine() {
    this._engineWanted = false;
    try { this._stopEngine(); } catch (err) { this._noteError(err); }
  }

  setSpeed(value) {
    const n = Number(value);
    this._speed = clamp(Number.isFinite(n) ? n : 0, 0, 1);
    if (!this.ctx || !this._engine) return;
    try {
      const t = nowOf(this.ctx);
      if (t - this._lastSpeedAt < 0.05) return;
      this._lastSpeedAt = t;
      this._applyEngineParams(this._speed, t, false);
    } catch (err) {
      this._noteError(err);
    }
  }

  _engineLevel() {
    return 0.09 + this._speed * 0.055;
  }

  _engineNoiseLevel() {
    return 0.02 + this._speed * 0.03;
  }

  _startEngine() {
    const ctx = this.ctx;
    if (!ctx || this._engine || !this._isReady() || this._paused || this._hidden) return;

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 2.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(gain);
    gain.connect(this._engineBus);

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this._noiseBuffer;
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.0001;
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this._engineBus);

    const t = ctx.currentTime;
    try {
      o1.start(t);
      o2.start(t);
      noiseSrc.start(t, Math.random());
    } catch { /* ignore */ }

    this._engine = { o1, o2, filter, gain, noiseSrc, noiseFilter, noiseGain };
    this._track(o1, o2, filter, gain, noiseSrc, noiseFilter, noiseGain);
    // 先设音高/滤波，输出增益从 0 淡入，避免起播爆音。
    this._applyEngineParams(this._speed, t, true, false);
    try {
      gain.gain.linearRampToValueAtTime(this._engineLevel(), t + 0.22);
      noiseGain.gain.linearRampToValueAtTime(this._engineNoiseLevel(), t + 0.22);
    } catch { /* ignore */ }
  }

  _applyEngineParams(speed, t, instant, output = true) {
    const e = this._engine;
    if (!e) return;
    const s = clamp(speed, 0, 1);
    const set = (param, v) => {
      try {
        if (instant) param.setValueAtTime(v, t);
        else param.setTargetAtTime(v, t, 0.08);
      } catch { /* ignore */ }
    };
    const f = 42 + s * 80;
    set(e.o1.frequency, f);
    set(e.o2.frequency, f * 1.006 + 0.2);
    set(e.filter.frequency, 280 + s * 2400);
    set(e.filter.Q, 1.4 + s * 3.2);
    set(e.noiseFilter.frequency, 320 + s * 900);
    if (output) {
      set(e.gain.gain, this._paused ? 0.0001 : this._engineLevel());
      set(e.noiseGain.gain, this._paused ? 0.0001 : this._engineNoiseLevel());
    }
  }

  _setEngineOutput(level) {
    const e = this._engine;
    if (!e || !this.ctx) return;
    const t = nowOf(this.ctx);
    const target = level == null ? this._engineLevel() : level;
    try {
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setTargetAtTime(Math.max(0.0001, target), t, 0.05);
      const nTarget = level == null ? this._engineNoiseLevel() : level * 0.35;
      e.noiseGain.gain.cancelScheduledValues(t);
      e.noiseGain.gain.setTargetAtTime(Math.max(0.0001, nTarget), t, 0.05);
    } catch { /* ignore */ }
  }

  _stopEngine() {
    const e = this._engine;
    if (!e || !this.ctx) return;
    this._engine = null;
    const t = nowOf(this.ctx);
    try {
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setTargetAtTime(0.0001, t, 0.05);
      e.noiseGain.gain.cancelScheduledValues(t);
      e.noiseGain.gain.setTargetAtTime(0.0001, t, 0.05);
      e.o1.stop(t + 0.22);
      e.o2.stop(t + 0.22);
      e.noiseSrc.stop(t + 0.22);
    } catch { /* ignore */ }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      for (const n of [e.o1, e.o2, e.filter, e.gain, e.noiseSrc, e.noiseFilter, e.noiseGain]) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
      this._untrack(e.o1, e.o2, e.filter, e.gain, e.noiseSrc, e.noiseFilter, e.noiseGain);
    };
    e.o1.onended = cleanup;
  }

  playBoostLoop(on) {
    const want = !!on;
    this._boostWanted = want;
    try {
      if (want) {
        if (!this.ctx || this._paused || this._hidden) return;
        this._startBoost();
      } else {
        this._stopBoost();
      }
    } catch (err) { this._noteError(err); }
  }

  _startBoost() {
    const ctx = this.ctx;
    if (!ctx || this._boost || !this._isReady() || this._paused || this._hidden) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1050;
    bp.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this._engineBus);
    const t = nowOf(ctx);
    try {
      src.start(t, Math.random() * 1.5);
      gain.gain.linearRampToValueAtTime(0.07, t + 0.3);
    } catch { /* ignore */ }
    this._boost = { src, bp, gain };
    this._track(src, bp, gain);
  }

  _setBoostOutput(level) {
    const b = this._boost;
    if (!b || !this.ctx) return;
    try {
      const t = nowOf(this.ctx);
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setTargetAtTime(Math.max(0.0001, level == null ? 0.07 : level), t, 0.06);
    } catch { /* ignore */ }
  }

  _stopBoost() {
    const b = this._boost;
    if (!b || !this.ctx) return;
    this._boost = null;
    const t = nowOf(this.ctx);
    try {
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setTargetAtTime(0.0001, t, 0.06);
      b.src.stop(t + 0.28);
    } catch { /* ignore */ }
    b.src.onended = () => {
      for (const n of [b.src, b.bp, b.gain]) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
      this._untrack(b.src, b.bp, b.gain);
    };
  }

  /* ==========================================================================
   * 游戏音效（全部异常安全，未初始化时静默 no-op）
   * ======================================================================== */

  _safe(fn) {
    if (this._failed || !this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended' && !this._hidden && !this._paused) {
        try {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        } catch { /* ignore */ }
      }
      return;
    }
    try {
      fn(ctx);
    } catch (err) {
      this._noteError(err);
    }
  }

  playJump() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.005;
      this._voice({
        t,
        freq: 240,
        freqEnd: 560,
        dur: 0.16,
        gain: 0.085,
        type: 'triangle',
        attack: 0.006,
        lp: 3800,
        pan: -0.05,
      });
      this._noise({
        t,
        dur: 0.13,
        gain: 0.035,
        filter: 'highpass',
        freq: 1200,
        freqEnd: 3000,
        q: 0.8,
        pan: 0.1,
      });
    });
  }

  playLand(power = 0.6) {
    this._safe((ctx) => {
      const p = clamp(Number(power) || 0, 0, 1);
      const t = nowOf(ctx) + 0.004;
      this._voice({
        t,
        freq: 140,
        freqEnd: 46,
        dur: 0.22 + p * 0.1,
        gain: 0.12 + 0.09 * p,
        type: 'sine',
        attack: 0.003,
        lp: 620,
        lpEnd: 160,
      });
      this._noise({
        t,
        dur: 0.17,
        gain: 0.025 + 0.045 * p,
        filter: 'lowpass',
        freq: 1000,
        freqEnd: 260,
        q: 0.5,
      });
    });
  }

  playSlide() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      this._noise({
        t,
        dur: 0.36,
        gain: 0.07,
        filter: 'bandpass',
        freq: 2600,
        freqEnd: 880,
        q: 1.1,
        attack: 0.02,
        pan: -0.12,
      });
      this._voice({
        t,
        freq: 210,
        freqEnd: 128,
        dur: 0.3,
        gain: 0.022,
        type: 'sawtooth',
        attack: 0.02,
        lp: 900,
        lpEnd: 380,
      });
    });
  }

  playPickup(combo = 1) {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.006;
      const c = clamp(Math.floor(Number(combo)) || 1, 1, PICKUP_SCALE.length);
      const semi = PICKUP_SCALE[c - 1];
      const f = mtof(76 + semi); // E5 起，随连单上爬
      const pan = c % 2 === 0 ? 0.16 : -0.16;
      this._bell(f, t, 0.3, 0.085, this._sfxBus, pan);
      this._voice({
        t: t + 0.014,
        freq: f * 2,
        dur: 0.18,
        gain: 0.03,
        type: 'sine',
        attack: 0.003,
        pan: -pan,
      });
      this._noise({
        t,
        dur: 0.04,
        gain: 0.012,
        filter: 'highpass',
        freq: 5000,
        q: 0.7,
        pan,
      });
    });
  }

  playPowerup(kind) {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.006;
      const key = String(kind == null ? '' : kind).toLowerCase();
      /** @type {Record<string, {notes: number[], wave?: string, type?: string, whoosh?: boolean}>} */
      const map = {
        shield: { notes: [69, 76], wave: 'ep' },
        helmet: { notes: [69, 76], wave: 'ep' },
        magnet: { notes: [67, 74, 79], type: 'triangle' },
        nitro: { notes: [64, 71, 76, 83], wave: 'lead', whoosh: true },
        boost: { notes: [64, 71, 76, 83], wave: 'lead', whoosh: true },
        double: { notes: [72, 79, 84], wave: 'pluck' },
        tip: { notes: [74, 79], type: 'sine' },
      };
      const cfg = map[key] || { notes: [69, 74, 79], wave: 'pluck' };
      for (let i = 0; i < cfg.notes.length; i += 1) {
        this._voice({
          t: t + i * 0.055,
          freq: mtof(cfg.notes[i]),
          dur: 0.24 + i * 0.06,
          gain: 0.06,
          wave: cfg.wave,
          type: cfg.type || 'sine',
          attack: 0.006,
          lp: 6500,
          lpEnd: 3200,
          pan: i % 2 === 0 ? -0.12 : 0.12,
          send: 0.08,
        });
      }
      if (cfg.whoosh) {
        this._noise({
          t,
          dur: 0.38,
          gain: 0.045,
          filter: 'bandpass',
          freq: 500,
          freqEnd: 2300,
          q: 0.8,
          attack: 0.04,
        });
      }
      this._bell(mtof(cfg.notes[cfg.notes.length - 1] + 12), t + 0.16, 0.45, 0.035, this._sfxBus, 0.1);
    });
  }

  playHit() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      this._noise({
        t,
        dur: 0.2,
        gain: 0.16,
        filter: 'lowpass',
        freq: 1100,
        freqEnd: 180,
        q: 0.6,
      });
      this._noise({
        t,
        dur: 0.1,
        gain: 0.065,
        filter: 'bandpass',
        freq: 1900,
        q: 0.8,
      });
      this._voice({
        t,
        freq: 160,
        freqEnd: 50,
        dur: 0.28,
        gain: 0.19,
        type: 'sine',
        attack: 0.002,
        lp: 700,
        lpEnd: 200,
      });
      this._voice({
        t,
        freq: 82,
        freqEnd: 40,
        dur: 0.32,
        gain: 0.13,
        type: 'triangle',
        attack: 0.002,
        lp: 420,
        lpEnd: 120,
      });
    });
  }

  playNearMiss() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      this._noise({
        t,
        dur: 0.32,
        gain: 0.09,
        filter: 'bandpass',
        freq: 520,
        freqEnd: 2500,
        q: 0.9,
        attack: 0.035,
        pan: 0.28,
      });
      this._noise({
        t: t + 0.02,
        dur: 0.24,
        gain: 0.045,
        filter: 'bandpass',
        freq: 2200,
        freqEnd: 680,
        q: 1.2,
        pan: -0.22,
      });
      this._bell(mtof(88), t + 0.13, 0.18, 0.022, this._sfxBus, -0.1);
    });
  }

  playBoostStart() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      this._noise({
        t,
        dur: 0.5,
        gain: 0.11,
        filter: 'bandpass',
        freq: 300,
        freqEnd: 2800,
        q: 0.7,
        attack: 0.05,
      });
      this._voice({
        t,
        freq: 90,
        freqEnd: 260,
        dur: 0.5,
        gain: 0.075,
        type: 'sawtooth',
        attack: 0.04,
        lp: 600,
        lpEnd: 4200,
      });
      this._voice({
        t: t + 0.26,
        freq: 520,
        freqEnd: 900,
        dur: 0.3,
        gain: 0.05,
        wave: 'lead',
        attack: 0.01,
        lp: 5200,
      });
    });
  }

  /** 加速带：向前冲的 whoosh + 三连亮音，和氮气区分开。 */
  playSpeedPad() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      this._noise({
        t,
        dur: 0.46,
        gain: 0.085,
        filter: 'bandpass',
        freq: 420,
        freqEnd: 3600,
        q: 0.75,
        attack: 0.02,
      });
      this._voice({
        t,
        freq: 170,
        freqEnd: 430,
        dur: 0.28,
        gain: 0.055,
        type: 'sawtooth',
        attack: 0.01,
        lp: 760,
        lpEnd: 3800,
      });
      const notes = [72, 76, 79];
      for (let i = 0; i < notes.length; i += 1) {
        this._voice({
          t: t + 0.035 + i * 0.065,
          freq: mtof(notes[i]),
          dur: 0.42,
          gain: 0.04,
          wave: 'lead',
          attack: 0.005,
          lp: 6200,
          lpEnd: 2200,
          pan: i % 2 === 0 ? -0.22 : 0.22,
          send: 0.2,
        });
      }
      this._bell(mtof(84), t + 0.1, 0.55, 0.032, this._sfxBus, 0.15);
    });
  }

  playHeartbeat() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.004;
      for (let i = 0; i < 2; i += 1) {
        const tt = t + i * 0.22;
        this._voice({
          t: tt,
          freq: 78,
          freqEnd: 46,
          dur: 0.18,
          gain: i === 0 ? 0.15 : 0.095,
          type: 'sine',
          attack: 0.006,
          lp: 300,
          lpEnd: 120,
        });
        this._noise({
          t: tt,
          dur: 0.06,
          gain: 0.02,
          filter: 'lowpass',
          freq: 320,
          q: 0.5,
        });
      }
    });
  }

  playClick() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.003;
      this._voice({
        t,
        freq: 1120,
        dur: 0.045,
        gain: 0.028,
        type: 'sine',
        attack: 0.001,
        lp: 5200,
      });
      this._voice({
        t,
        freq: 660,
        dur: 0.06,
        gain: 0.02,
        type: 'triangle',
        attack: 0.001,
        lp: 2600,
      });
    });
  }

  playCountdown(n) {
    this._safe((ctx) => {
      const num = Math.floor(Number(n));
      const t = nowOf(ctx) + 0.004;
      if (num > 0) {
        this._voice({
          t,
          freq: 660,
          dur: 0.17,
          gain: 0.085,
          type: 'square',
          attack: 0.004,
          lp: 2400,
          lpEnd: 1600,
        });
        this._voice({
          t,
          freq: 330,
          dur: 0.2,
          gain: 0.03,
          type: 'sine',
          attack: 0.004,
        });
      } else {
        this._voice({
          t,
          freq: 880,
          dur: 0.18,
          gain: 0.075,
          type: 'triangle',
          attack: 0.004,
          lp: 5000,
        });
        this._voice({
          t: t + 0.07,
          freq: 1320,
          dur: 0.32,
          gain: 0.07,
          wave: 'pluck',
          attack: 0.004,
          lp: 7000,
        });
        this._bell(mtof(88), t + 0.07, 0.4, 0.03, this._sfxBus, 0);
      }
    });
  }

  playStageIntro() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.01;
      // 换幕 jingle 应该预告“下一幕”，而 setStage 是在下个小节线才生效。
      const stage = this._pendingStage != null ? this._pendingStage : this._musicStage;
      let notes;
      let wave;
      if (stage === 2) {
        notes = [62, 66, 69, 74, 78];
        wave = 'flute';
      } else if (stage === 3) {
        notes = [62, 66, 69, 73, 78];
        wave = 'ep';
      } else {
        notes = [57, 64, 69, 76];
        wave = 'pluck';
      }
      for (let i = 0; i < notes.length; i += 1) {
        this._voice({
          t: t + i * 0.085,
          freq: mtof(notes[i]),
          dur: 1.1 + i * 0.08,
          gain: 0.045,
          wave,
          attack: stage === 2 ? 0.06 : 0.015,
          lp: 2800,
          lpEnd: 1400,
          pan: i % 2 === 0 ? -0.18 : 0.18,
          send: 0.2,
        });
      }
      this._noise({
        t,
        dur: 1.15,
        gain: 0.028,
        filter: 'lowpass',
        freq: 700,
        freqEnd: 2600,
        q: 0.5,
        attack: 0.5,
        pan: 0.15,
      });
      this._bell(mtof(notes[notes.length - 1] + 12), t + 0.6, 0.8, 0.03, this._sfxBus, 0.15);
    });
  }

  playGameOver() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.01;
      const seq = [
        { m: 69, dt: 0, dur: 0.75 },
        { m: 65, dt: 0.28, dur: 0.75 },
        { m: 64, dt: 0.56, dur: 0.9 },
        { m: 57, dt: 0.9, dur: 1.5 },
      ];
      for (const n of seq) {
        this._voice({
          t: t + n.dt,
          freq: mtof(n.m),
          dur: n.dur,
          gain: 0.065,
          wave: 'flute',
          attack: 0.03,
          lp: 2200,
          lpEnd: 1100,
          pan: -0.05,
          send: 0.16,
        });
        this._voice({
          t: t + n.dt,
          freq: mtof(n.m - 12),
          dur: n.dur,
          gain: 0.028,
          type: 'triangle',
          attack: 0.04,
          lp: 900,
        });
      }
      this._voice({
        t,
        freq: mtof(33),
        dur: 2.2,
        gain: 0.045,
        type: 'sine',
        attack: 0.2,
        lp: 260,
      });
    });
  }

  playVictory() {
    this._safe((ctx) => {
      const t = nowOf(ctx) + 0.01;
      /* 上行号角 */
      const fanfare = [
        { m: 69, dt: 0, dur: 0.5 },
        { m: 73, dt: 0.12, dur: 0.5 },
        { m: 76, dt: 0.24, dur: 0.55 },
        { m: 81, dt: 0.36, dur: 0.8 },
        { m: 88, dt: 0.52, dur: 0.9 },
      ];
      for (const n of fanfare) {
        this._voice({
          t: t + n.dt,
          freq: mtof(n.m),
          dur: n.dur,
          gain: 0.07,
          wave: 'lead',
          detune: 4,
          detune2: -4,
          attack: 0.01,
          lp: 5200,
          lpEnd: 2600,
          pan: 0.12,
          send: 0.2,
        });
        this._bell(mtof(n.m + 12), t + n.dt, n.dur * 0.9, 0.026, this._sfxBus, -0.12);
      }
      /* 温暖铺底和弦 */
      for (const m of [57, 61, 64, 69]) {
        this._voice({
          t: t + 0.04,
          freq: mtof(m),
          dur: 2.4,
          gain: 0.032,
          wave: 'ep',
          attack: 0.12,
          lp: 2200,
          lpEnd: 1200,
          pan: m === 57 ? -0.2 : 0.2,
          send: 0.15,
        });
      }
      /* 彩带高音 */
      const sparkle = [93, 95, 97, 100];
      for (let i = 0; i < sparkle.length; i += 1) {
        this._bell(mtof(sparkle[i]), t + 0.9 + i * 0.16, 0.5, 0.024, this._sfxBus, i % 2 ? 0.3 : -0.3);
      }
      this._noise({
        t: t + 0.2,
        dur: 1.6,
        gain: 0.025,
        filter: 'highpass',
        freq: 3000,
        q: 0.6,
        attack: 0.4,
        pan: 0,
      });
    });
  }

  /* ==========================================================================
   * 自检 / 调试（非契约方法，供 audio-lab 与 QA 读取）
   * ======================================================================== */

  getNodeCount() {
    return this._persistent.size;
  }

  getStatus() {
    const ctx = this.ctx;
    return {
      version: VERSION,
      ready: this._isReady(),
      failed: this._failed,
      contextState: ctx ? ctx.state : 'absent',
      sampleRate: ctx ? ctx.sampleRate : 0,
      stage: this._musicStage,
      stageName: STAGE_NAMES[this._musicStage] || '',
      musicWanted: this._musicWanted,
      musicPlaying: this._musicPlaying,
      pendingStage: this._pendingStage,
      intensity: this._intensity,
      speed: this._speed,
      engine: !!this._engine,
      boost: !!this._boost,
      paused: this._paused,
      muted: this._muted,
      nodes: this._persistent.size,
      error: this._lastError,
    };
  }
}

/** 契约要求的单例。 */
export const audio = new AudioEngine();

export default audio;
