import { persist, save } from './storage.js';

/** All sound is synthesised with WebAudio: no audio files to download. */
export class Sound {
  constructor() {
    this.ctx = null;
    this.musicTimer = 0;
    this.intensity = 0; // 0 = menu groove, 1 = full drums while racing
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = save.sound ? 1 : 0;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = save.music ? 0.3 : 0;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Electric motor whine: a saw and a sine an octave up, through a resonant low-pass.
    this.motor = ctx.createGain();
    this.motor.gain.value = 0;
    this.motorLP = ctx.createBiquadFilter();
    this.motorLP.type = 'lowpass';
    this.motorLP.frequency.value = 1400;
    this.motorLP.Q.value = 3;
    this.o1 = ctx.createOscillator();
    this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator();
    this.o2.type = 'sine';
    const o1g = ctx.createGain();
    o1g.gain.value = 0.35;
    this.o1.connect(o1g).connect(this.motorLP);
    this.o2.connect(this.motorLP);
    this.motorLP.connect(this.motor).connect(this.sfx);
    this.o1.start();
    this.o2.start();

    // Wind rush and cold-gas hiss are filtered noise loops.
    this.wind = this.noiseLoop('bandpass', 600, 0.7, 1);
    this.hiss = this.noiseLoop('highpass', 1600, 0.4, 0.8);
    this.fans = this.noiseLoop('bandpass', 2600, 6, 1.3);

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  noiseLoop(type, freq, q, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    g.filter = f;
    return g;
  }

  setSfx(on) {
    save.sound = on;
    persist();
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    save.music = on;
    persist();
    if (this.music) this.music.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.1);
  }

  /** Hard mute while an ad plays. */
  mute(on) {
    if (this.master) this.master.gain.setTargetAtTime(on ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Continuous engine/air sounds. speed01 is 0..1 of top speed. */
  drive(speed01, { running, thrust, loop }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 70 + speed01 * 560;
    this.o1.frequency.setTargetAtTime(f, t, 0.06);
    this.o2.frequency.setTargetAtTime(f * 2.02, t, 0.06);
    this.motorLP.frequency.setTargetAtTime(700 + speed01 * 2200, t, 0.1);
    this.motor.gain.setTargetAtTime(running ? 0.035 + speed01 * 0.045 : 0, t, 0.12);
    this.wind.gain.setTargetAtTime(running ? 0.05 + speed01 * 0.22 : 0, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(400 + speed01 * 1400, t, 0.2);
    this.hiss.gain.setTargetAtTime(thrust ? 0.42 : 0, t, thrust ? 0.015 : 0.07);
    this.fans.gain.setTargetAtTime(loop ? 0.12 : 0, t, 0.08);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.motor, this.wind, this.hiss, this.fans]) g.gain.setTargetAtTime(0, t, 0.05);
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, delay = 0, slide = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, { type = 'bandpass', from = 800, to = 800, q = 1, vol = 0.3, delay = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  gem(chain) {
    const f = 1046 * Math.pow(2, Math.min(chain, 10) / 12);
    this.tone(f, 0.09, { type: 'triangle', vol: 0.14 });
    this.tone(f * 1.5, 0.12, { type: 'triangle', vol: 0.1, delay: 0.05 });
  }
  tank() {
    this.burst(0.35, { type: 'bandpass', from: 300, to: 2400, q: 2, vol: 0.25 });
    this.tone(523, 0.12, { type: 'triangle', vol: 0.12 });
    this.tone(784, 0.18, { type: 'triangle', vol: 0.12, delay: 0.07 });
  }
  flip() {
    this.burst(0.4, { from: 300, to: 2200, q: 1.4, vol: 0.22 });
  }
  stunt(level = 0) {
    const base = 523.25 * Math.pow(2, Math.min(level, 6) / 12);
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone(base * m, 0.16, { type: 'square', vol: 0.05, delay: i * 0.05 }));
  }
  land(hard) {
    this.tone(hard ? 140 : 110, 0.22, { vol: hard ? 0.5 : 0.3, slide: 0.35 });
    this.burst(0.12, { type: 'lowpass', from: 2000, to: 300, vol: hard ? 0.25 : 0.12 });
  }
  crash() {
    this.burst(1.3, { type: 'lowpass', from: 4000, to: 120, q: 0.7, vol: 0.7 });
    this.tone(70, 0.9, { vol: 0.6, slide: 0.4 });
    this.burst(0.5, { type: 'highpass', from: 3000, to: 6000, vol: 0.2, delay: 0.05 });
  }
  launch() {
    this.burst(1.2, { type: 'bandpass', from: 2400, to: 500, q: 0.6, vol: 0.45 });
  }
  whoosh() {
    this.burst(0.5, { from: 1800, to: 250, q: 1.1, vol: 0.25 });
  }
  beep(go) {
    this.tone(go ? 880 : 440, go ? 0.35 : 0.16, { type: 'square', vol: 0.09 });
  }
  ui() {
    this.tone(1200, 0.04, { type: 'square', vol: 0.05 });
  }
  warn() {
    this.tone(330, 0.12, { type: 'square', vol: 0.06 });
  }

  // ------------------------------------------------------------- music --
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.12;
    this.stepDur = 60 / 104 / 4;
    this.musicTimer = setInterval(() => this.schedule(), 30);
  }

  schedule() {
    const now = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return;
    if (this.next < now - 0.25) this.next = now + 0.05; // tab was throttled; skip ahead
    while (this.next < now + 0.14) {
      this.playStep(this.step, this.next);
      this.next += this.stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const chords = [
      [110.0, 130.81, 164.81], // Am
      [87.31, 110.0, 130.81], // F
      [130.81, 164.81, 196.0], // C
      [98.0, 123.47, 146.83], // G
    ];
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const [root, third, fifth] = chords[bar];
    const dest = this.music;
    const full = this.intensity > 0.5;

    if (s % 2 === 0) {
      const f = s === 6 || s === 14 ? root : root / 2;
      this.voice(f, this.stepDur * 1.6, t, 'sawtooth', 0.16, 420, dest);
    }
    const arp = [root, third, fifth, root * 2, fifth, third, root * 2, fifth];
    this.voice(arp[s % 8] * 4, this.stepDur * 0.9, t, 'square', full ? 0.035 : 0.025, 2600, dest);
    if (s === 0) {
      for (const f of [root * 2, third * 2, fifth * 2]) {
        this.voice(f, this.stepDur * 15, t, 'sawtooth', 0.03, 900, dest, 0.6);
      }
    }
    if (full) {
      if (s === 0 || s === 8 || s === 10) this.kick(t, dest);
      if (s === 4 || s === 12) this.snare(t, dest);
      if (s % 2 === 0) this.hat(t, dest, s % 4 === 2 ? 0.05 : 0.025);
    } else if (s === 0) {
      this.kick(t, dest, 0.5);
    }
  }

  voice(freq, dur, t, type, vol, cutoff, dest, attack = 0.005) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  kick(t, dest, vol = 1) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.55 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.32);
  }

  snare(t, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  hat(t, dest, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}
