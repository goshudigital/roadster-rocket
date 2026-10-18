import * as THREE from 'three';
import * as ads from './ads.js';
import { Car, PAINTS, paintSwatch } from './car.js';
import { makeDotTexture, makePuffTexture, Particles, SpeedLines } from './fx.js';
import { cruiseSpeed, launchVy, PHYS } from './physics.js';
import { persist, save } from './storage.js';
import { loopX, Track } from './track.js';
import { UI } from './ui.js';
import { World } from './world.js';

const TAU = Math.PI * 2;
const MPH = 2.23694;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);
const VEHICLE_NAMES = { Semi: 'a semi truck', Pickup: 'a pickup', Sedan: 'a parked car', Pod: 'a robotaxi' };

export class Game {
  constructor(engine, assets, sound, input) {
    this.engine = engine;
    this.sound = sound;
    this.input = input;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.ui = new UI();
    this.world = new World(this.scene, engine.renderer);
    this.fx = {
      smoke: new Particles(this.scene, { max: engine.mobile ? 1000 : 1800, texture: makePuffTexture() }),
      glow: new Particles(this.scene, { max: 1000, texture: makeDotTexture(), additive: true, fog: false }),
    };
    this.lines = new SpeedLines(this.scene);
    this.track = new Track(this.scene, assets.vehicles, this.fx, engine.envMap);
    this.car = new Car(assets.car, engine.envMap);
    this.scene.add(this.car.root);
    this.applyPaint(save.paint);
    this.shadow = this.makeShadow();

    this.state = 'title';
    this.time = 0;
    this.timeScale = 1;
    this.dist = 0;
    this.shake = 0;
    this.viewShift = 0;
    this.camPos = new THREE.Vector3(7, 2.4, 6);
    this.look = new THREE.Vector3(0, 0.8, -1);
    this._surf = { h: 0, ramp: null, roof: null };
    this._surf2 = { h: 0, ramp: null, roof: null };
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this.inView = true;

    this.newRun();
    this.track.reset();
    this.track.introOn = true;
    this.track.fill(0);
    this.bindUI();
    this.refreshTitle();
    ads.configureGameAds({ onMute: () => sound.mute(true), onUnmute: () => sound.mute(false) });
  }

  // ---------------------------------------------------------------- setup --
  makeShadow() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,0.85)');
    r.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.9, 5.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    this.scene.add(m);
    return m;
  }

  newRun() {
    this.run = {
      x: 0, y: 0, vx: 0, vy: 0, speed: 0, odo: 0, air: PHYS.AIR_MAX,
      grounded: true, onRamp: null, airtime: 0,
      flip: null, flipQueued: false, flips: [], flipDoneAt: -1, sketchy: false,
      pitch: 0, bank: 0, yaw: 0,
      launch: 0, sixty: false, bonus: 0, gems: 0, gemsBanked: 0, gemT: 0, gemChain: 0,
      stunts: 0, chain: 0, chainTimer: 0, topSpeed: 0,
      loop: null, invuln: 0, revived: false, counted: false,
      crashT: 0, spin: new THREE.Vector3(), reason: '',
      thrusting: false, lowWarned: false, hintT: 0, roofs: new Set(),
      countT: 0, countN: 4, puffT: 0,
    };
  }

  bindUI() {
    const click = (id, fn) => {
      $(id).addEventListener('click', () => {
        this.sound.unlock();
        this.sound.ui();
        fn();
      });
    };
    click('btn-play', () => this.play(false));
    click('btn-garage', () => this.openGarage('title'));
    click('btn-garage-back', () => this.closeGarage());
    click('btn-resume', () => this.resume());
    click('btn-restart', () => this.play(true));
    click('btn-menu', () => this.toTitle());
    click('btn-pause', () => this.pause());
    click('btn-again', () => this.play(true));
    click('btn-over-garage', () => this.openGarage('over'));
    click('btn-share', () => this.share());
    click('btn-revive', () => this.showRewardAd?.());
    click('btn-sound', () => {
      this.sound.setSfx(!save.sound);
      this.refreshTitle();
    });
    click('btn-music', () => {
      this.sound.setMusic(!save.music);
      if (save.music) this.sound.startMusic();
      this.refreshTitle();
    });
    const fs = $('btn-fullscreen');
    if (!document.fullscreenEnabled) fs.hidden = true;
    fs.addEventListener('click', () => this.toggleFullscreen());

    this.input.onPress = (code) => this.onKey(code);
    this.autoPause = true;
    document.addEventListener('visibilitychange', () => document.hidden && this.autoPause && this.pause());
    window.addEventListener('blur', () => this.autoPause && this.pause());
    new IntersectionObserver(([e]) => (this.inView = e.intersectionRatio > 0.35), { threshold: [0, 0.35, 0.7] }).observe(this.ui.el.wrap);
  }

  onKey(code) {
    if (code === 'KeyP' || code === 'Escape') {
      if (this.state === 'playing' || this.state === 'countdown') this.pause();
      else if (this.state === 'paused') this.resume();
      return;
    }
    if (code === 'Enter' || code === 'Space') {
      if (this.state === 'title' && this.inView) {
        this.sound.unlock();
        this.play(false);
      } else if (this.state === 'over' && code === 'Enter') this.play(true);
      else if (this.state === 'paused' && code === 'Enter') this.resume();
    }
  }

  refreshTitle() {
    $('title-best').textContent = save.best.toLocaleString('en-US');
    $('title-coins').textContent = save.coins.toLocaleString('en-US');
    $('btn-sound').setAttribute('aria-pressed', String(save.sound));
    $('btn-music').setAttribute('aria-pressed', String(save.music));
  }

  applyPaint(id) {
    this.car.setPaint(PAINTS.find((p) => p.id === id) || PAINTS[0]);
  }

  // ---------------------------------------------------------- state flow --
  play(again) {
    this.sound.unlock();
    if (save.music) this.sound.startMusic();
    if (again) {
      ads.interstitial('replay', { pause: () => (this.adHold = true), resume: () => (this.adHold = false) });
    }
    this.startRun();
  }

  startRun() {
    this.newRun();
    this.dist = 0;
    this.timeScale = 1;
    this.track.reset();
    this.track.introOn = save.runs < 3;
    this.track.fill(0);
    this.fx.smoke.clear();
    this.fx.glow.clear();
    this.resetCarPose();
    this.state = 'countdown';
    this.ui.show(null);
    this.ui.hud(true);
    this.ui.countdown('');
    this.input.capture = true;
    this.input.reset();
    this.sound.intensity = 1;
    this.focusGame();
  }

  focusGame() {
    const wrap = this.ui.el.wrap;
    const r = wrap.getBoundingClientRect();
    const header = document.querySelector('.site-header')?.offsetHeight || 0;
    if (r.top < header - 2 || r.bottom > window.innerHeight + 2) {
      window.scrollTo({ top: window.scrollY + r.top - header, behavior: 'smooth' });
    }
  }

  go() {
    this.state = 'playing';
    this.run.launch = 0;
    this.sound.launch();
    this.camShake(0.3);
    setTimeout(() => this.ui.countdown(''), 650);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.ui.show('pause');
    this.sound.silence();
    this.input.reset();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom || 'playing';
    this.ui.show(null);
    this.input.reset();
  }

  toTitle() {
    this.state = 'title';
    this.newRun();
    this.dist = 0;
    this.track.reset();
    this.track.introOn = true;
    this.track.fill(0);
    this.fx.smoke.clear();
    this.fx.glow.clear();
    this.resetCarPose();
    this.ui.hud(false);
    this.ui.show('title');
    this.ui.countdown('');
    this.input.capture = false;
    this.sound.intensity = 0;
    this.sound.silence();
    this.refreshTitle();
  }

  openGarage(from) {
    this.garageFrom = from;
    this.state = 'garage';
    this.resetCarPose();
    this.run.x = 0;
    this.run.y = 0;
    this.ui.hud(false);
    this.ui.show('garage');
    this.input.capture = false;
    this.renderGarage();
  }

  closeGarage() {
    this.applyPaint(save.paint);
    if (this.garageFrom === 'over') {
      this.state = 'over';
      this.ui.show('over');
    } else {
      this.toTitle();
    }
  }

  renderGarage() {
    const list = $('paint-list');
    list.textContent = '';
    for (const p of PAINTS) {
      const owned = save.owned.includes(p.id);
      const equipped = save.paint === p.id;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `${equipped ? 'equipped' : ''} ${owned ? '' : 'locked'}`;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = paintSwatch(p);
      const name = document.createElement('span');
      name.className = 'paint-name';
      name.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'paint-meta';
      if (equipped) meta.textContent = 'EQUIPPED';
      else if (owned) meta.textContent = 'OWNED';
      else {
        const ico = document.createElement('i');
        ico.className = 'gem-ico';
        meta.append(ico, p.price.toLocaleString('en-US'));
      }
      b.append(sw, name, meta);
      b.addEventListener('click', () => this.buyOrEquip(p));
      b.addEventListener('pointerenter', () => this.car.setPaint(p));
      b.addEventListener('focus', () => this.car.setPaint(p));
      b.addEventListener('pointerleave', () => this.applyPaint(save.paint));
      li.appendChild(b);
      list.appendChild(li);
    }
    $('garage-coins').textContent = save.coins.toLocaleString('en-US');
  }

  buyOrEquip(p) {
    this.sound.unlock();
    if (save.owned.includes(p.id)) {
      save.paint = p.id;
      this.ui.toast(`${p.name} equipped`);
    } else if (save.coins >= p.price) {
      save.coins -= p.price;
      save.owned.push(p.id);
      save.paint = p.id;
      this.ui.toast(`Unlocked ${p.name}!`);
      this.sound.stunt(4);
    } else {
      this.ui.toast(`Collect ${(p.price - save.coins).toLocaleString('en-US')} more diamonds to unlock ${p.name}`);
      this.sound.warn();
      return;
    }
    persist();
    this.applyPaint(save.paint);
    this.renderGarage();
    this.refreshTitle();
  }

  async share() {
    const score = this.score().toLocaleString('en-US');
    const text = `I scored ${score} in Roadster Rocket 🚀 Jump the semi, ride the loop upside down. Can you beat it?`;
    const url = `${location.origin}/`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Roadster Rocket', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.ui.toast('Link copied - paste it anywhere');
    } catch {
      /* share sheet dismissed */
    }
  }

  toggleFullscreen() {
    const el = this.ui.el.wrap;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    el.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  }

  resetCarPose() {
    const car = this.car;
    car.root.position.set(this.run.x, this.run.y, 0);
    car.root.rotation.set(0, 0, 0);
    car.pivot.rotation.set(0, 0, 0);
    car.root.visible = true;
  }

  score() {
    return Math.floor(this.run.odo) + this.run.bonus;
  }

  // ------------------------------------------------------------- per frame --
  update(dtReal) {
    if (this.adHold) return;
    this.time += dtReal;
    const dt = dtReal * this.timeScale;
    const prevDist = this.dist;
    const s = this.state;

    if (s === 'title' || s === 'garage') this.updateShowroom(dt);
    else if (s === 'countdown') this.updateCountdown(dt);
    else if (s === 'playing') this.updatePlaying(dt);
    else if (s === 'crash' || s === 'over') this.updateCrash(dt);

    if (s !== 'paused') {
      const scroll = this.dist - prevDist;
      this.fx.smoke.update(dt, scroll);
      this.fx.glow.update(dt, scroll);
      this.track.update(dt, this.dist, this.time);
      if (s === 'playing' || s === 'countdown' || s === 'title') this.track.emitSmoke(dt, this.dist);
      this.world.update(dt, this.dist, this.car, this.camera, s === 'playing', this.run.loop ? this.run.loop.e.obj.position.z : null);
      const c = this.run;
      const lineAmt = s === 'playing' && !c.loop ? clamp((c.speed - 55) / 40, 0, 1) : 0;
      this.lines.update(dt, c.speed, lineAmt, this.camera.position.x, this.camera.position.y);
      this.updateShadow();
    }
    this.updateCamera(dtReal);
    const c = this.run;
    this.sound.drive(clamp(c.speed / 112, 0, 1), {
      running: s === 'playing' || s === 'countdown',
      thrust: s === 'playing' && c.thrusting,
      loop: s === 'playing' && !!c.loop,
    });
    this.engine.monitor(dtReal, s === 'playing');
  }

  updateShowroom(dt) {
    const car = this.car;
    car.root.position.set(0, 0, 0);
    car.root.rotation.set(0, 0, 0);
    car.pivot.rotation.set(0, this.state === 'garage' ? this.time * 0.45 : 0, 0);
    car.update(dt, 0, 1);
    // A little cold-gas breathing from the lift ports so the car feels alive.
    this.run.puffT -= dt;
    if (this.run.puffT < 0) {
      this.run.puffT = 2.4 + Math.random() * 2;
      this.run.puffBurst = 0.35;
    }
    if (this.run.puffBurst > 0) {
      this.run.puffBurst -= dt;
      car.root.updateMatrixWorld(true);
      for (const e of car.emitters) {
        if (e.kind !== 'down' || Math.random() > 0.5) continue;
        const p = e.obj.getWorldPosition(this._v);
        this.fx.smoke.spawn(p.x, p.y, p.z, rand(-3, 3), -2, rand(-3, 3), 1.6, 0.4, 2.8, 0.85, 0.9, 1, 0.3, 1.8, 0.4);
      }
    }
  }

  updateCountdown(dt) {
    const c = this.run;
    c.countT += dt;
    const n = 3 - Math.floor(c.countT / 0.75);
    if (n !== c.countN) {
      c.countN = n;
      if (n > 0) {
        this.ui.countdown(String(n));
        this.sound.beep(false);
      } else {
        this.ui.countdown('GO', true);
        this.sound.beep(true);
        this.go();
      }
    }
    this.updateCarPose(dt);
    // Burnout smoke off the rear tyres while the launch control holds the car.
    this.car.root.updateMatrixWorld(true);
    if (Math.random() < 0.7) {
      for (const sx of [-0.86, 0.86]) {
        this.fx.smoke.spawn(c.x + sx, 0.25, 1.3, sx * 2, rand(0.5, 1.5), rand(2, 5), rand(1.2, 1.8), 0.6, 3.2, 0.8, 0.82, 0.86, 0.28, 0.8, 0.2);
      }
    }
    this.car.update(dt, 8, 1);
  }

  updatePlaying(dt) {
    const c = this.run;
    const inp = this.input;
    c.invuln = Math.max(0, c.invuln - dt);
    c.chainTimer -= dt;
    if (c.chainTimer <= 0) c.chain = 0;
    c.gemT -= dt;

    // Launch control: 0-60 mph in under a second, then cruise speed climbs with distance.
    c.launch += dt;
    if (c.speed < 26.82 && c.launch < 2.5) {
      c.speed = Math.min(26.82, c.speed + 30 * dt);
      if (c.speed >= 26.82 && !c.sixty) {
        c.sixty = true;
        this.ui.popup('0–60 MPH', `${c.launch.toFixed(2)} s`);
      }
    } else {
      const target = cruiseSpeed(c.odo);
      c.speed = c.speed < target ? Math.min(target, c.speed + 9 * dt) : damp(c.speed, target, 1, dt);
    }
    c.topSpeed = Math.max(c.topSpeed, c.speed);

    if (inp.takeFlip()) this.tryFlip();

    if (c.loop) {
      this.updateLoop(dt);
    } else {
      const lat = c.grounded ? PHYS.LAT_GROUND : PHYS.LAT_AIR;
      c.vx = damp(c.vx, inp.steer * lat, c.grounded ? 10 : 5, dt);
      const thrust = inp.thrust && c.air > 0;
      if (thrust) c.air = Math.max(0, c.air - PHYS.AIR_USE * dt);
      else if (c.grounded) c.air = Math.min(PHYS.AIR_MAX, c.air + PHYS.AIR_REGEN * dt);
      c.thrusting = thrust;
      if (inp.thrust && c.air <= 0 && !c.lowWarned) {
        c.lowWarned = true;
        this.ui.popup('AIR EMPTY', 'land to recharge', 'warn');
        this.sound.warn();
      }
      if (c.air > 200) c.lowWarned = false;

      const ds = c.speed * dt;
      const steps = Math.max(1, Math.ceil(ds / 1.0));
      for (let k = 0; k < steps; k++) {
        this.step(dt / steps, ds / steps, thrust);
        if (this.state !== 'playing' || c.loop) break;
      }
    }
    if (this.state !== 'playing') return;

    this.track.fill(this.dist);
    this.track.nearMiss(c.x, this.dist, c.y, c.grounded, () => this.award(75, 'NEAR MISS'));
    this.updateCarPose(dt);
    this.car.root.updateMatrixWorld(true);
    this.track.collect(this.car.worldCenter, (p) => this.onGem(p), (p) => this.onTank(p));
    this.updateHints(dt);
    this.emitThrusters(dt);
    this.ui.update({
      score: this.score(),
      chain: c.chain,
      gems: c.gems,
      mph: Math.round(c.speed * MPH),
      speed01: c.speed / 112,
      air: c.air,
      air01: c.air / PHYS.AIR_MAX,
    });
  }

  step(h, ds, thrust) {
    const c = this.run;
    const prev = this.dist;
    this.dist += ds;
    c.odo += ds;
    c.x = clamp(c.x + c.vx * h, -PHYS.X_LIMIT, PHYS.X_LIMIT);
    // Approaching a loop, the suction system lines the car up with the entry lane.
    if (this.track.nextOf('loop', this.dist, 45)) c.x = Math.min(c.x, damp(c.x, -4.5, 5, h));

    const loopE = this.track.loopAt(prev, this.dist);
    if (loopE) {
      this.enterLoop(loopE);
      return;
    }

    const surf = this.track.surface(c.x, this.dist, c.y, this._surf);
    if (c.grounded) {
      if (thrust) {
        c.grounded = false;
        c.vy = c.onRamp ? Math.max(4, launchVy(c.speed, c.onRamp) * ((this.dist - c.onRamp.s) / c.onRamp.L)) : 4;
        c.airtime = 0;
        c.onRamp = null;
      } else if (surf.h < c.y - 0.08) {
        c.grounded = false;
        c.airtime = 0;
        c.vy = c.onRamp ? launchVy(c.speed, c.onRamp) : 0;
        if (c.onRamp) this.onLaunch(c.onRamp);
        c.onRamp = null;
      } else {
        c.y = surf.h;
        c.onRamp = surf.ramp;
        if (surf.roof && surf.roof.type === 'Semi' && !c.roofs.has(surf.roof)) {
          c.roofs.add(surf.roof);
          this.award(200, 'ROOF RUN');
        }
      }
    }
    if (!c.grounded) {
      const fade = clamp((PHYS.CEILING - c.y) / 4, 0, 1);
      const a = -PHYS.G + (thrust && c.vy < PHYS.MAX_VY ? PHYS.THRUST * fade : 0);
      c.vy += a * h;
      c.y += c.vy * h;
      c.airtime += h;
      if (c.flip) {
        c.flip.t += h / PHYS.FLIP_TIME;
        if (c.flip.t >= 1) this.finishFlip(false);
      }
      const s2 = this.track.surface(c.x, this.dist, c.y, this._surf2);
      if (c.y <= s2.h && c.vy <= 0) this.land(s2);
    }
    if (this.state !== 'playing') return;
    if (c.invuln <= 0 && !this.god) {
      const hit = this.track.hit(c.x, this.dist, c.y);
      if (hit) this.crash(`Hit ${hit.kind === 'barrier' ? 'a barrier' : VEHICLE_NAMES[hit.type] || 'a vehicle'}`);
    }
  }

  onLaunch() {
    this.sound.whoosh();
    this.camShake(0.15);
  }

  tryFlip() {
    const c = this.run;
    if (c.grounded || c.loop) return;
    if (c.flip) {
      c.flipQueued = true;
      return;
    }
    this.startFlip();
  }

  startFlip() {
    const steer = this.input.steer;
    this.run.flip = { type: steer ? 'kick' : 'back', dir: steer || 1, t: 0 };
    this.sound.flip();
  }

  finishFlip(sketchy) {
    const c = this.run;
    c.flips.push(c.flip.type);
    c.flip = null;
    c.flipDoneAt = c.airtime;
    if (sketchy) c.sketchy = true;
    if (c.flipQueued && !c.grounded && !sketchy) {
      c.flipQueued = false;
      this.startFlip();
    }
  }

  land(surf) {
    const c = this.run;
    if (c.flip) {
      if (c.flip.t < 0.14) c.flip = null;
      else if (c.flip.t > 0.84) this.finishFlip(true);
      else {
        this.crash('Landed upside down');
        return;
      }
    }
    const impact = -c.vy;
    c.y = surf.h;
    c.vy = 0;
    c.grounded = true;
    c.onRamp = surf.ramp;
    c.flipQueued = false;
    if (c.flips.length) this.scoreFlips();
    else if (c.airtime > 1.5) this.award(100, 'BIG AIR');
    if (c.airtime > 0.25) this.landFx(impact);
    c.airtime = 0;
  }

  scoreFlips() {
    const c = this.run;
    const n = c.flips.length;
    const kicks = c.flips.filter((f) => f === 'kick').length;
    let pts = c.flips.reduce((a, f) => a + (f === 'kick' ? 300 : 250), 0) * (n > 1 ? 1.5 : 1);
    const name = n === 1 ? (kicks ? 'KICK FLIP' : 'BACK FLIP') : n === 2 ? 'DOUBLE FLIP' : n === 3 ? 'TRIPLE FLIP' : `${n}× FLIP`;
    let extra = '';
    if (c.sketchy) extra = 'SKETCHY';
    else if (c.airtime - c.flipDoneAt < 0.3) {
      pts *= 1.5;
      extra = 'PERFECT LANDING';
    }
    this.award(pts, name, extra);
    c.flips = [];
    c.sketchy = false;
    if (!save.flipsTaught) {
      save.flipsTaught = true;
      persist();
    }
  }

  award(points, label, extra = '') {
    const c = this.run;
    c.chain = c.chainTimer > 0 ? Math.min(8, c.chain + 1) : 1;
    c.chainTimer = 4;
    const total = Math.round(points * c.chain);
    c.bonus += total;
    c.stunts++;
    const parts = [];
    if (extra) parts.push(extra);
    parts.push(`+${total.toLocaleString('en-US')}`);
    if (c.chain > 1) parts.push(`×${c.chain}`);
    this.ui.popup(label, parts.join('  '));
    this.sound.stunt(c.chain);
  }

  onGem(p) {
    const c = this.run;
    c.gemChain = c.gemT > 0 ? c.gemChain + 1 : 0;
    c.gemT = 0.7;
    c.gems++;
    c.bonus += 25;
    this.sound.gem(c.gemChain);
    for (let i = 0; i < 9; i++) {
      this.fx.glow.spawn(p.x, p.y, p.z, rand(-5, 5), rand(-3, 6), rand(-5, 5), rand(0.25, 0.45), 0.5, 0.05, 0.4, 0.95, 1.0, 1.0, 2, -6);
    }
  }

  onTank(p) {
    const c = this.run;
    c.air = Math.min(PHYS.AIR_MAX, c.air + PHYS.AIR_TANK);
    this.ui.popup('AIR +220 L');
    this.sound.tank();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      this.fx.glow.spawn(p.x, p.y, p.z, Math.cos(a) * 8, Math.sin(a) * 8, 0, 0.4, 0.6, 0.1, 0.3, 0.8, 1.0, 1.0, 3, 0);
    }
  }

  landFx(impact) {
    const c = this.run;
    const hard = impact > 13;
    this.sound.land(hard);
    this.car.flashBrake();
    this.camShake(Math.min(0.55, impact * 0.025));
    for (let i = 0; i < (hard ? 14 : 7); i++) {
      this.fx.glow.spawn(c.x + rand(-1, 1), c.y + 0.1, rand(-2, 2), rand(-6, 6), rand(2, 7), rand(2, 9), rand(0.25, 0.5), 0.18, 0.05, 1.0, 0.7, 0.35, 1.0, 1, -25);
    }
    for (let i = 0; i < 8; i++) {
      this.fx.smoke.spawn(c.x + rand(-1.6, 1.6), c.y + 0.3, rand(-2, 2), rand(-5, 5), rand(0.5, 2), rand(0, 4), rand(0.8, 1.4), 0.8, 3.6, 0.7, 0.72, 0.78, 0.3, 2, 0);
    }
  }

  // ------------------------------------------------------------------ loop --
  enterLoop(e) {
    const c = this.run;
    c.loop = { e, a: 0, x0: c.x, R: e.R, inv: false };
    c.flip = null;
    c.flips = [];
    c.grounded = true;
    c.vy = 0;
    c.y = 0;
    c.airtime = 0;
    c.thrusting = false;
    this.dist = e.s;
    this.cutCamera = true;
    this.ui.clearHint();
  }

  updateLoop(dt) {
    const c = this.run;
    const L = c.loop;
    L.a += (c.speed * dt) / L.R;
    c.odo += c.speed * dt;
    if (L.a >= TAU) {
      c.loop = null;
      this.dist = L.e.s;
      c.x = loopX(TAU);
      c.y = 0;
      c.vx = 0;
      this.car.root.rotation.set(0, 0, 0);
      this.cutCamera = true;
      this.award(500, 'SUCTION LOOP');
      this.sound.whoosh();
      return;
    }
    const a = L.a;
    this.dist = L.e.s + L.R * Math.sin(a);
    c.y = L.R * (1 - Math.cos(a));
    const k = clamp(a / 0.8, 0, 1);
    c.x = L.x0 + (loopX(a) - L.x0) * k;
    c.air = Math.min(PHYS.AIR_MAX, c.air + PHYS.AIR_REGEN * dt);
    if (!L.inv && a > Math.PI * 0.9) {
      L.inv = true;
      this.ui.popup('UPSIDE DOWN', 'suction fans holding');
    }
  }

  // ----------------------------------------------------------------- crash --
  crash(reason) {
    if (this.state !== 'playing') return;
    const c = this.run;
    this.state = 'crash';
    c.crashT = 0;
    c.reason = reason;
    c.loop = null;
    c.thrusting = false;
    this.timeScale = 0.3;
    c.vy = 7 + Math.random() * 4;
    c.grounded = false;
    c.spin.set(rand(-5, 5), rand(-3, 3), rand(-7, 7));
    this.sound.crash();
    this.sound.silence();
    this.camShake(1.3);
    this.ui.clearHint();
    this.explode();
  }

  explode() {
    const c = this.run;
    const y = c.y + 0.6;
    for (let i = 0; i < 70; i++) {
      const hot = Math.random();
      this.fx.glow.spawn(c.x, y, 0, rand(-14, 14), rand(-2, 14), rand(-14, 10), rand(0.5, 1.1), rand(0.8, 1.6), rand(2, 4), 1.0, 0.45 + hot * 0.4, 0.15 + hot * 0.2, 0.9, 2.5, 2);
    }
    for (let i = 0; i < 40; i++) {
      this.fx.glow.spawn(c.x, y, 0, rand(-20, 20), rand(4, 22), rand(-20, 12), rand(0.6, 1.2), 0.18, 0.05, 1.0, 0.8, 0.5, 1.0, 0.5, -30);
    }
    for (let i = 0; i < 26; i++) {
      this.fx.smoke.spawn(c.x + rand(-1, 1), y, rand(-1, 1), rand(-4, 4), rand(1, 5), rand(-3, 3), rand(2, 3.2), 1.5, 7, 0.16, 0.16, 0.18, 0.75, 1.2, 0.6);
    }
  }

  updateCrash(dt) {
    const c = this.run;
    c.crashT += dt;
    if (c.crashT > 0.3) this.timeScale = damp(this.timeScale, 1, 3, dt);
    c.speed *= Math.exp(-1.6 * dt);
    this.dist += c.speed * dt;
    c.vy -= PHYS.G * dt;
    c.y += c.vy * dt;
    if (c.y < 0) {
      c.y = 0;
      c.vy = Math.abs(c.vy) * 0.3;
      c.spin.multiplyScalar(0.55);
      if (c.speed > 5) {
        for (let i = 0; i < 6; i++) {
          this.fx.glow.spawn(c.x, 0.2, 0, rand(-6, 6), rand(2, 6), rand(2, 10), 0.4, 0.15, 0.05, 1, 0.7, 0.3, 1, 1, -20);
        }
      }
    }
    const car = this.car;
    car.root.position.set(c.x, c.y, 0);
    car.pivot.rotation.x += c.spin.x * dt;
    car.pivot.rotation.y += c.spin.y * dt;
    car.pivot.rotation.z += c.spin.z * dt;
    car.update(dt, c.speed * 0.5, 0);
    if (Math.random() < 0.5) {
      this.fx.smoke.spawn(c.x, c.y + 0.6, 0, rand(-1, 1), rand(2, 4), rand(0, 3), 2.2, 1, 5, 0.12, 0.12, 0.14, 0.6, 1, 0.5);
    }
    if (this.state === 'crash' && c.crashT > 1.5) this.gameOver();
  }

  gameOver() {
    const c = this.run;
    this.state = 'over';
    this.timeScale = 1;
    const score = this.score();
    const isBest = score > save.best;
    if (isBest) save.best = score;
    save.coins += c.gems - c.gemsBanked;
    c.gemsBanked = c.gems;
    if (!c.counted) {
      save.runs++;
      c.counted = true;
    }
    persist();

    $('over-reason').textContent = c.reason || 'Crashed';
    $('over-title').textContent = isBest ? 'NEW BEST!' : 'RUN OVER';
    $('over-score').textContent = score.toLocaleString('en-US');
    const best = $('over-best');
    best.textContent = isBest ? 'PERSONAL BEST' : `BEST ${save.best.toLocaleString('en-US')}`;
    best.classList.toggle('new', isBest);
    $('st-dist').textContent = `${Math.floor(c.odo).toLocaleString('en-US')} m`;
    $('st-speed').textContent = `${Math.round(c.topSpeed * MPH)} mph`;
    $('st-stunts').textContent = String(c.stunts);
    $('st-gems').textContent = `+${c.gems}`;
    this.ui.hud(false);
    this.ui.show('over');
    this.input.capture = false;
    this.sound.intensity = 0;
    this.refreshTitle();

    const revive = $('btn-revive');
    revive.hidden = true;
    this.showRewardAd = null;
    if (!c.revived) {
      ads.offerReward('revive', {
        onAvailable: (show) => {
          if (this.state !== 'over') return;
          this.showRewardAd = show;
          revive.hidden = false;
        },
        onReward: () => this.revive(),
        onDone: () => (revive.hidden = true),
      });
    }
  }

  revive() {
    const c = this.run;
    c.revived = true;
    this.track.clearAhead(this.dist, 120);
    Object.assign(c, {
      y: 0, vy: 0, vx: 0, grounded: true, flip: null, flips: [], flipQueued: false,
      speed: 0, launch: 0, sixty: false, invuln: 3, air: Math.max(c.air, 400),
      x: clamp(c.x, -6, 6), countT: 0, countN: 4, chain: 0, chainTimer: 0,
    });
    this.resetCarPose();
    this.state = 'countdown';
    this.ui.show(null);
    this.ui.hud(true);
    this.input.capture = true;
    this.input.reset();
    this.sound.intensity = 1;
  }

  // ---------------------------------------------------------------- visuals --
  updateCarPose(dt) {
    const c = this.run;
    const car = this.car;
    car.root.position.set(c.x, c.y, 0);
    if (c.loop) {
      car.root.rotation.set(c.loop.a, 0, 0);
      car.pivot.rotation.set(0, 0, 0);
      car.update(dt, c.speed, 1);
      return;
    }
    car.root.rotation.set(0, 0, 0);
    const rampPitch = c.grounded && c.onRamp ? Math.atan2(c.onRamp.H, c.onRamp.L) : 0;
    const airPitch = c.grounded ? 0 : clamp(c.vy * 0.02, -0.28, 0.25);
    c.pitch = damp(c.pitch, rampPitch + airPitch, 12, dt);
    c.bank = damp(c.bank, -c.vx * 0.018, 8, dt);
    c.yaw = damp(c.yaw, -c.vx * 0.011, 8, dt);
    let rx = c.pitch;
    let rz = c.bank;
    if (c.flip) {
      const t = c.flip.t;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      if (c.flip.type === 'back') rx += e * TAU;
      else rz -= c.flip.dir * e * TAU;
    }
    car.pivot.rotation.set(rx, c.yaw, rz, 'YXZ');
    car.root.visible = c.invuln > 0 ? Math.floor(this.time * 14) % 2 === 0 : true;
    car.update(dt, c.grounded ? c.speed : c.speed * 0.5, c.speed > 50 || c.thrusting ? 1 : 0.2);
  }

  updateShadow() {
    const c = this.run;
    const sh = this.shadow;
    if (c.loop || this.state === 'garage' || this.state === 'title') {
      sh.visible = this.state === 'title' || this.state === 'garage';
      sh.position.set(0, 0.03, 0);
      sh.scale.setScalar(1);
      sh.material.opacity = 0.9;
      return;
    }
    sh.visible = true;
    const surf = this.track.surface(c.x, this.dist, c.y + 0.5, this._surf2);
    const above = Math.max(0, c.y - surf.h);
    sh.position.set(c.x, surf.h + 0.04, 0.15);
    sh.scale.setScalar(1 + above * 0.06);
    sh.material.opacity = clamp(0.9 / (1 + above * 0.22), 0.1, 0.9);
  }

  emitThrusters(dt) {
    const c = this.run;
    const car = this.car;
    const smoke = this.fx.smoke;
    const glow = this.fx.glow;
    const rate = this.engine.mobile ? 0.55 : 1;
    const launching = c.launch < 1.2;
    const steer = this.input.steer;
    for (const e of car.emitters) {
      const p = e.obj.getWorldPosition(this._v);
      const d = car.dirWorld(e.dir, this._d);
      if (e.kind === 'rear' && (launching || c.thrusting)) {
        if (Math.random() < rate) {
          const sp = rand(16, 26);
          smoke.spawn(p.x, p.y, p.z, d.x * sp + rand(-1, 1), d.y * sp + rand(-0.4, 1.2), d.z * sp, rand(0.6, 1.1), 0.45, 3.4, 0.86, 0.9, 1.0, 0.4, 1.8, 0.8);
        }
        // Mach diamonds: bright beads riding just behind each nozzle.
        for (let k = 1; k <= 3; k++) {
          const f = k * 0.36 + Math.random() * 0.05;
          glow.spawn(p.x + d.x * f, p.y + d.y * f, p.z + d.z * f, 0, 0, 0, 0.034, 0.36 - k * 0.07, 0.3 - k * 0.07, 0.6, 0.82, 1.0, 0.95, 0, 0, 0);
        }
      } else if (e.kind === 'down' && c.thrusting) {
        if (Math.random() < 0.85 * rate) {
          smoke.spawn(p.x, p.y, p.z, d.x * 8 + rand(-2, 2), -13 + rand(-2, 2), rand(-1, 3), rand(0.5, 0.9), 0.35, 2.6, 0.88, 0.92, 1.0, 0.36, 2.4, 0);
        }
        glow.spawn(p.x, p.y - 0.15, p.z, 0, 0, 0, 0.03, 0.3, 0.25, 0.6, 0.85, 1.0, 0.8, 0, 0, 0);
      } else if (e.kind === 'side' && !c.grounded && steer !== 0 && Math.sign(d.x) === -steer) {
        if (Math.random() < 0.7 * rate) smoke.spawn(p.x, p.y, p.z, d.x * 12, rand(-1, 1), rand(-1, 2), 0.45, 0.25, 1.6, 0.9, 0.92, 1.0, 0.35, 2.5, 0);
      }
    }
    // Downwash kicks up a ring of dust when hovering low.
    if (c.thrusting && c.y < 4.5 && Math.random() < 0.8 * rate) {
      const a = Math.random() * TAU;
      smoke.spawn(c.x + Math.cos(a) * 1.5, 0.3, Math.sin(a) * 2, Math.cos(a) * 9, rand(0.5, 1.5), Math.sin(a) * 9 + 3, rand(0.7, 1.1), 0.8, 3.2, 0.72, 0.75, 0.8, 0.22 * (1 - c.y / 4.5), 2.5, 0);
    }
  }

  updateHints(dt) {
    const c = this.run;
    if (c.loop) return;
    c.hintT -= dt;
    if (c.hintT > 0) return;
    c.hintT = 0.3;
    const touch = this.ui.touchMode;
    if (!c.hintThrust && save.runs < 2 && c.launch > 1.6) {
      c.hintThrust = true;
      this.ui.hint(touch ? 'Hold THRUST to fly' : 'Hold SPACE to fire the thrusters', 3200);
    }
    if (!save.flipsTaught && !c.hintFlip && this.track.nextOf('ramp', this.dist, 130)) {
      c.hintFlip = true;
      this.ui.hint(touch ? 'Hit the ramp, then tap FLIP in the air' : 'Hit the ramp, then press F in the air to flip', 3800);
    }
    if (!c.hintWall && save.runs < 3 && this.track.nextOf('barrier', this.dist, 120, true)) {
      c.hintWall = true;
      this.ui.hint(touch ? 'Tap THRUST to hop the barrier' : 'Tap SPACE to hop the barrier', 3000);
    }
  }

  camShake(v) {
    this.shake = Math.max(this.shake, v);
  }

  updateCamera(dt) {
    const c = this.run;
    const cam = this.camera;
    const tp = this._c;
    const s = this.state === 'paused' ? this.pausedFrom : this.state;
    let lx = 0;
    let ly = 0.8;
    let lz = 0;
    let fov = 60;
    let k = 5;
    let shift = 0;
    let shiftY = 0;
    if (s === 'title' || s === 'garage') {
      const g = s === 'garage';
      const a = this.time * (g ? 0.22 : 0.11) + 0.7;
      const r = g ? 6.6 : 9.2;
      tp.set(Math.sin(a) * r, g ? 1.45 : 2.3, Math.cos(a) * r);
      ly = g ? 0.5 : 0.75;
      fov = g ? 40 : 46;
      k = 2.5;
      if (cam.aspect > 1.25) shift = g ? -0.2 : 0.17;
      else if (g) shiftY = 0.2;
    } else if (c.loop) {
      const P = c.loop.e.obj.position;
      const R = c.loop.R;
      tp.set(25, R * 0.78, P.z + 3);
      lx = 0;
      ly = R * 0.92;
      lz = P.z;
      fov = 60;
      k = 3.2;
    } else if (s === 'countdown') {
      tp.set(c.x + 3.2, 1.5, 7.2);
      lx = c.x - 0.4;
      ly = 0.75;
      lz = -4;
      fov = 52;
      k = 2.4;
    } else if (s === 'crash' || s === 'over') {
      tp.set(c.x * 0.6 + 2, c.y + 4.5, 12);
      lx = c.x;
      ly = c.y + 0.5;
      lz = 0;
      fov = 56;
      k = 1.8;
    } else {
      const sp = clamp((c.speed - 40) / 70, 0, 1);
      // Tall (portrait) screens get a higher, wider chase view so the road isn't cramped.
      const tall = clamp((1.2 - cam.aspect) / 0.7, 0, 1);
      tp.set(c.x * 0.72, 3.0 + tall * 1.6 + c.y * 0.78, 8.4 + sp * 1.4 + tall * 3.2);
      lx = c.x * 0.85;
      ly = 1.0 + c.y * 0.86;
      lz = -12 - tall * 6;
      fov = 58 + sp * 13 + (c.thrusting ? 2 : 0) + tall * 14;
      k = 6;
    }
    if (this.cutCamera) {
      this.cutCamera = false;
      this.camPos.copy(tp);
      this.look.set(lx, ly, lz);
    }
    this.camPos.x = damp(this.camPos.x, tp.x, k, dt);
    this.camPos.y = damp(this.camPos.y, tp.y, k * 0.75, dt);
    this.camPos.z = damp(this.camPos.z, tp.z, k * 0.7, dt);
    this.look.x = damp(this.look.x, lx, k * 1.2, dt);
    this.look.y = damp(this.look.y, ly, k, dt);
    this.look.z = damp(this.look.z, lz, k, dt);
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.7;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }
    cam.lookAt(this.look);
    let dirty = false;
    if (Math.abs(cam.fov - fov) > 0.02) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      dirty = true;
    }
    this.viewShift = damp(this.viewShift, shift, 3, dt);
    this.viewShiftY = damp(this.viewShiftY || 0, shiftY, 3, dt);
    if (Math.abs(this.viewShift) > 0.0005 || this.viewShiftY > 0.0005) {
      const { width: w, height: h } = this.engine;
      cam.setViewOffset(w, h, -w * this.viewShift, h * this.viewShiftY, w, h);
      dirty = true;
    } else if (cam.view?.enabled) {
      this.viewShift = 0;
      this.viewShiftY = 0;
      cam.clearViewOffset();
      dirty = true;
    }
    if (dirty) cam.updateProjectionMatrix();
  }
}
