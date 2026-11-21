// ui.js — DOM/HUD 控制（不含 three.js）
import { CFG, formatNum, formatClock } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LS_BEST_D = 'ontime.bestDistance';
const LS_BEST_S = 'ontime.bestScore';
const LS_RIDER = 'ontime.rider';
const LS_SOUND = 'ontime.sound';

export class UI {
  constructor() {
    const el = this.el = {
      body: document.body,
      loading: $('#loading'),
      loadingBar: $('#loading-bar'),
      loadingPct: $('#loading-pct'),
      loadTip: $('#load-tip'),
      start: $('#start-screen'),
      bestDistance: $('#best-distance'),
      bestScore: $('#best-score'),
      riderCards: $('#rider-cards'),
      guide: $('#guide-panel'),
      guideBtn: $('#btn-guide'),
      guideClose: $('#btn-guide-close'),
      hud: $('#hud'),
      hearts: $('#hearts'),
      distance: $('#distance'),
      deliveryTime: $('#delivery-time'),
      stageLabel: $('#stage-label'),
      stageProgress: $('#stage-progress'),
      stageFill: $('#stage-fill'),
      routeMarker: $('#route-marker'),
      cups: $('#cups'),
      score: $('#score'),
      comboWrap: $('#combo-wrap'),
      comboValue: $('#combo-value'),
      comboBar: $('#combo-bar-fill'),
      speedNum: $('#speed-num'),
      speedArc: $('#speed-arc'),
      boostWrap: $('#boost-wrap'),
      boostFill: $('#boost-fill'),
      powerups: {
        shield: $('#powerup-shield'),
        magnet: $('#powerup-magnet'),
        nitro: $('#powerup-nitro'),
        double: $('#powerup-double'),
      },
      pause: $('#pause-screen'),
      gameover: $('#gameover-screen'),
      victory: $('#victory-screen'),
      go: {
        distance: $('#go-distance'), cups: $('#go-cups'), combo: $('#go-combo'),
        score: $('#go-score'), best: $('#go-best'), newbest: $('#go-newbest'),
      },
      vic: {
        distance: $('#vic-distance'), cups: $('#vic-cups'), score: $('#vic-score'),
        stars: $('#vic-stars'),
      },
      toast: $('#toast-layer'),
      float: $('#float-layer'),
      touch: $('#touch-ui'),
      rotate: $('#rotate-hint'),
      fatal: $('#fatal-error'),
      fatalMsg: $('#fatal-message'),
      startBtn: $('#btn-start'),
    };
    this.handlers = {};
    this.cache = {};
    this.bestDistance = Number(localStorage.getItem(LS_BEST_D) || 0);
    this.bestScore = Number(localStorage.getItem(LS_BEST_S) || 0);
    this.rider = localStorage.getItem(LS_RIDER) === 'xiaoman' ? 'xiaoman' : 'alan';
    this.soundOn = localStorage.getItem(LS_SOUND) !== '0';
    this._toastTimers = new Set();
    this._bind();
    this._applyRider();
    this._applySound();
    this.setBest(this.bestDistance, this.bestScore);
  }

  _bind() {
    const onClick = (el, fn) => el && el.addEventListener('click', (e) => { e.preventDefault(); fn?.(e); });
    onClick(this.el.startBtn, () => this.handlers.start?.());
    onClick(this.el.guideBtn, () => this.toggleGuide());
    onClick(this.el.guideClose, () => this.toggleGuide(false));
    onClick($('#btn-pause'), () => this.handlers.pause?.());
    onClick($('#btn-resume'), () => this.handlers.resume?.());
    onClick($('#btn-restart-pause'), () => this.handlers.restart?.());
    onClick($('#btn-quit'), () => this.handlers.quit?.());
    onClick($('#btn-restart'), () => this.handlers.restart?.());
    onClick($('#btn-home'), () => this.handlers.home?.());
    onClick($('#btn-endless'), () => this.handlers.endless?.());
    onClick($('#btn-victory-home'), () => this.handlers.home?.());
    $$('.js-sound').forEach((b) => onClick(b, () => this.handlers.sound?.()));
    this.el.riderCards?.addEventListener('click', (e) => {
      const card = e.target.closest('.rider-card');
      if (!card) return;
      const id = card.dataset.rider;
      if (!id || id === this.rider) return;
      this.rider = id;
      localStorage.setItem(LS_RIDER, id);
      this._applyRider();
      this.handlers.rider?.({ id });
      this.toast(id === 'xiaoman' ? '小满：交给我吧！' : '阿蓝：这单稳了。', { type: 'good', duration: 1300 });
    });
    // 触屏 / 鼠标点按场景自动开始（开始页）
    this.el.start?.addEventListener('click', (e) => {
      if (e.target.closest('button, .rider-card, .guide-panel')) return;
      this.handlers.start?.();
    });
    // 手机横屏提示只提示一次
    this._rotateTimer = null;
    addEventListener('orientationchange', () => this.checkOrientation());
  }

  bind(handlers) { this.handlers = handlers || {}; }

  _applyRider() {
    $$('.rider-card', this.el.riderCards).forEach((c) => c.classList.toggle('is-active', c.dataset.rider === this.rider));
  }

  _applySound() {
    this.el.body.classList.toggle('is-muted', !this.soundOn);
    $$('.js-sound').forEach((b) => b.classList.toggle('is-off', !this.soundOn));
  }

  toggleSound() {
    this.soundOn = !this.soundOn;
    localStorage.setItem(LS_SOUND, this.soundOn ? '1' : '0');
    this._applySound();
    this.handlers.sound?.(this.soundOn);
    return this.soundOn;
  }

  setSound(on) { this.soundOn = !!on; this._applySound(); }

  // —— 加载 ——
  setLoading(pct, tip) {
    const p = Math.max(0, Math.min(1, pct || 0));
    if (this.el.loadingBar) this.el.loadingBar.style.width = `${(p * 100).toFixed(1)}%`;
    if (this.el.loadingPct) this.el.loadingPct.textContent = `${Math.round(p * 100)}%`;
    if (tip && this._lastTip !== tip) { this.el.loadTip.textContent = tip; this._lastTip = tip; }
  }

  doneLoading() {
    this.el.body.classList.remove('is-loading');
    this.el.loading?.classList.add('is-hidden');
  }

  // —— 开始 ——
  showStart() {
    this.el.body.classList.remove('is-playing', 'is-paused', 'is-gameover', 'is-victory');
    this.el.body.classList.add('is-started');
    this.el.start?.classList.remove('is-hidden');
    this.el.hud?.classList.add('is-hidden');
    this.el.pause?.classList.add('is-hidden');
    this.el.gameover?.classList.add('is-hidden');
    this.el.victory?.classList.add('is-hidden');
    this.setBest(this.bestDistance, this.bestScore);
  }

  hideStart() {
    this.el.start?.classList.add('is-hidden');
    this.toggleGuide(false);
  }

  beginGame() {
    this.el.body.classList.remove('is-started', 'is-paused', 'is-gameover', 'is-victory');
    this.el.body.classList.add('is-playing');
    this.el.hud?.classList.remove('is-hidden');
    this.el.pause?.classList.add('is-hidden');
    this.el.gameover?.classList.add('is-hidden');
    this.el.victory?.classList.add('is-hidden');
  }

  showPause(on) {
    this.el.pause?.classList.toggle('is-hidden', !on);
    this.el.body.classList.toggle('is-paused', !!on);
  }

  // —— HUD 数值 ——
  setBest(distance, score) {
    this.bestDistance = Math.max(this.bestDistance, Math.round(distance || 0));
    this.bestScore = Math.max(this.bestScore, Math.round(score || 0));
    localStorage.setItem(LS_BEST_D, this.bestDistance);
    localStorage.setItem(LS_BEST_S, this.bestScore);
    if (this.el.bestDistance) this.el.bestDistance.textContent = `${formatNum(this.bestDistance)} m`;
    if (this.el.bestScore) this.el.bestScore.textContent = `¥${formatNum(this.bestScore)}`;
  }

  setHearts(n, max = 3) {
    if (this.cache.hearts === n) return;
    this.cache.hearts = n;
    $$('.heart', this.el.hearts).forEach((h, i) => h.classList.toggle('gone', i >= n));
    this.el.body.classList.toggle('is-lowhp', n <= 1);
  }

  setDistance(m) {
    const v = Math.floor(m);
    if (this.cache.distance === v) return;
    this.cache.distance = v;
    this.el.distance.textContent = formatNum(v);
    this.el.routeMarker.style.left = `${Math.max(0, Math.min(100, (m / CFG.arrival) * 100)).toFixed(2)}%`;
  }

  setTime(sec) {
    const v = formatClock(sec);
    if (this.cache.time === v) return;
    this.cache.time = v;
    this.el.deliveryTime.textContent = v;
  }

  setStage(index, progress = 0) {
    if (this.cache.stage !== index) {
      this.cache.stage = index;
      this.el.stageLabel.textContent = CFG.stageNames[index];
      this.el.body.dataset.stage = String(index + 1);
    }
    const dist = Math.floor(progress * CFG.stageDists[index]);
    const label = `${dist} / ${CFG.stageDists[index]}`;
    if (this.cache.stageProgress !== label) {
      this.cache.stageProgress = label;
      this.el.stageProgress.textContent = label;
    }
    this.el.stageFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  setScore(n) {
    const v = Math.round(n);
    if (this.cache.score === v) return;
    this.cache.score = v;
    this.el.score.textContent = formatNum(v);
  }

  setCups(n) {
    if (this.cache.cups === n) return;
    this.cache.cups = n;
    this.el.cups.textContent = formatNum(n);
  }

  setCombo(mult, ratio = 0) {
    const active = mult > 1 && ratio > 0;
    this.el.comboWrap.classList.toggle('is-hidden', !active);
    if (!active) return;
    this.el.comboValue.textContent = String(mult);
    this.el.comboBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  setSpeed(kmh, ratio) {
    const v = Math.round(kmh);
    if (this.cache.speed !== v) {
      this.cache.speed = v;
      this.el.speedNum.textContent = String(v);
    }
    this.el.speedArc.style.strokeDasharray = '100';
    this.el.speedArc.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, ratio)) * 100);
  }

  setBoost(ratio, full, active) {
    this.el.boostFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    this.el.boostWrap.classList.toggle('is-full', !!full);
    this.el.boostWrap.classList.toggle('is-active', !!active);
    this.el.body.classList.toggle('is-boosting', !!active);
  }

  setPowerup(kind, ratio) {
    const el = this.el.powerups[kind];
    if (!el) return;
    const on = ratio > 0;
    el.classList.toggle('is-hidden', !on);
    el.classList.toggle('is-active', on);
    if (on) {
      const bar = $('.powerup-time', el);
      if (bar) bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    }
  }

  setPowerupsAll(active) {
    for (const k of Object.keys(this.el.powerups)) this.setPowerup(k, active?.[k] || 0);
  }

  // —— 提示 ——
  toast(text, opts = {}) {
    const { type = 'info', sub = '', duration = 1600 } = opts;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const b = document.createElement('b');
    b.textContent = text;
    el.appendChild(b);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.appendChild(s);
    }
    this.el.toast.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-show'));
    const t = setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 380);
      this._toastTimers.delete(t);
    }, duration);
    this._toastTimers.add(t);
    // 最多同时 3 条
    while (this.el.toast.children.length > 2) this.el.toast.firstElementChild.remove();
    return el;
  }

  stageBanner(index) {
    return this.toast(CFG.stageFullNames[index], {
      type: 'stage',
      sub: index === 0 ? '晨雾里的第一单' : index === 1 ? '前方：乡镇集市 · 人多车多' : '最后一公里 · 晚霞里的城市',
      duration: 2600,
    });
  }

  float(text, x, y, cls = '') {
    const el = document.createElement('span');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.el.float.appendChild(el);
    setTimeout(() => el.remove(), 1200);
    while (this.el.float.children.length > 12) this.el.float.firstElementChild.remove();
  }

  // —— 结算 ——
  gameOver(stats) {
    const { distance = 0, cups = 0, combo = 1, score = 0 } = stats;
    this.el.body.classList.remove('is-playing', 'is-paused');
    this.el.body.classList.add('is-gameover');
    this.el.go.distance.textContent = formatNum(Math.floor(distance));
    this.el.go.cups.textContent = formatNum(cups);
    this.el.go.combo.textContent = String(combo);
    this.el.go.score.textContent = formatNum(score);
    this.el.go.best.textContent = formatNum(this.bestDistance);
    this.el.gameover.classList.remove('is-hidden');
  }

  victory(stats) {
    const { distance = 0, cups = 0, score = 0, stars = 5 } = stats;
    this.el.body.classList.remove('is-playing', 'is-paused');
    this.el.body.classList.add('is-victory');
    this.el.vic.distance.textContent = formatNum(Math.floor(distance));
    this.el.vic.cups.textContent = formatNum(cups);
    this.el.vic.score.textContent = formatNum(score);
    $$('svg', this.el.vic.stars).forEach((s, i) => s.classList.toggle('off', i >= stars));
    this.el.victory.classList.remove('is-hidden');
  }

  resetGame() {
    this.el.body.classList.remove('is-gameover', 'is-victory', 'is-paused');
    this.el.gameover.classList.add('is-hidden');
    this.el.victory.classList.add('is-hidden');
    this.el.pause.classList.add('is-hidden');
    this.cache = {};
    this.el.toast.replaceChildren();
    this.el.float.replaceChildren();
  }

  setNewBest(on) { this.el.go.newbest?.classList.toggle('is-hidden', !on); }

  toggleGuide(force) {
    const show = force ?? this.el.guide.classList.contains('is-hidden');
    this.el.guide.classList.toggle('is-hidden', !show);
    this.el.body.classList.toggle('is-guide', show);
  }

  setFatal(msg) {
    this.el.fatalMsg.textContent = msg || '这个浏览器暂时不支持 WebGL。换 Chrome / Edge / Safari 最新版试试。';
    this.el.fatal.classList.remove('is-hidden');
    this.el.loading.classList.add('is-hidden');
  }

  setTouch(on) { this.el.body.classList.toggle('is-touch', !!on); }

  checkOrientation() {
    this.el.rotate?.classList.add('is-hidden');
  }

  showRotateHint(ms = 3200) {
    if (!this.el.rotate || innerHeight <= innerWidth) return;
    this.el.rotate.classList.remove('is-hidden');
    clearTimeout(this._rotateTimer);
    this._rotateTimer = setTimeout(() => this.el.rotate.classList.add('is-hidden'), ms);
  }

  hideRotateHint() {
    clearTimeout(this._rotateTimer);
    this.el.rotate?.classList.add('is-hidden');
  }

  setHit() {
    this.el.body.classList.remove('is-hit');
    void this.el.body.offsetWidth;
    this.el.body.classList.add('is-hit');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.el.body.classList.remove('is-hit'), 420);
  }

  setLoadingTip(text) { if (this.el.loadTip) this.el.loadTip.textContent = text; }
}
