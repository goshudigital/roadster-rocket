const $ = (id) => document.getElementById(id);
const ARC = 235.6; // 270° of a r=50 circle

/** DOM side of the game: HUD, screens, popups. Writes only when values change. */
export class UI {
  constructor() {
    this.el = {
      wrap: $('game-wrap'),
      hud: $('hud'),
      score: $('score'),
      chain: $('chain'),
      gems: $('gems'),
      speed: $('speed'),
      air: $('air'),
      speedRing: $('speed-ring'),
      airRing: $('air-ring'),
      gaugeAir: document.querySelector('.gauge-air'),
      popups: $('popups'),
      hint: $('hint'),
      countdown: $('countdown'),
      toast: $('toast'),
      touch: $('touch'),
      loadBar: $('load-bar'),
      loadText: $('load-text'),
    };
    this.screens = {
      loading: $('scr-loading'),
      title: $('scr-title'),
      garage: $('scr-garage'),
      pause: $('scr-pause'),
      over: $('scr-over'),
    };
    this.cache = {};
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.el.wrap.classList.toggle('touch-mode', this.touchMode);
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('show', k === name);
  }

  hud(on) {
    this.el.hud.hidden = !on;
    this.el.touch.hidden = !(on && this.touchMode);
    this.el.wrap.classList.toggle('playing', on);
  }

  text(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  ring(key, el, frac) {
    const v = Math.round(Math.max(0, Math.min(1, frac)) * 200) / 200;
    if (this.cache[key] === v) return;
    this.cache[key] = v;
    el.style.strokeDasharray = `${(v * ARC).toFixed(1)} 314.2`;
  }

  update({ score, chain, gems, mph, speed01, air, air01 }) {
    this.text('score', this.el.score, score.toLocaleString('en-US'));
    const chainText = chain > 1 ? `×${chain}` : '';
    if (this.cache.chain !== chainText) {
      this.el.chain.classList.toggle('on', chain > 1);
    }
    this.text('chain', this.el.chain, chainText);
    this.text('gems', this.el.gems, String(gems));
    this.text('speed', this.el.speed, String(mph));
    this.text('air', this.el.air, String(Math.round(air)));
    this.ring('speedRing', this.el.speedRing, speed01);
    this.ring('airRing', this.el.airRing, air01);
    const low = air01 < 0.2;
    if (this.cache.low !== low) {
      this.cache.low = low;
      this.el.gaugeAir.classList.toggle('low', low);
    }
  }

  popup(text, sub = '', cls = '') {
    const box = this.el.popups;
    while (box.children.length > 2) box.firstChild.remove();
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      d.appendChild(s);
    }
    box.appendChild(d);
    setTimeout(() => d.remove(), 1300);
  }

  hint(text, ms = 3000) {
    const h = this.el.hint;
    h.textContent = text;
    h.classList.add('on');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('on'), ms);
  }

  clearHint() {
    clearTimeout(this.hintTimer);
    this.el.hint.classList.remove('on');
  }

  countdown(text, go = false) {
    const c = this.el.countdown;
    c.textContent = '';
    if (!text) return;
    const s = document.createElement('span');
    s.textContent = text;
    if (go) s.className = 'go';
    c.appendChild(s);
  }

  toast(text, ms = 2200) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  loading(frac, text) {
    this.el.loadBar.style.width = `${Math.round(frac * 100)}%`;
    if (text) this.el.loadText.textContent = text;
  }
}
