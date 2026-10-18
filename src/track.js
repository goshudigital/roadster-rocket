import * as THREE from 'three';
import { PHYS, cruiseSpeed, launchVy } from './physics.js';

const LANES = [-6, 0, 6];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Rows of vehicles parked nose-to-tail across the course, like the reveal's jump lineup.
const ROWS = {
  semi: [['Semi', 0]],
  pods: [['Pod', -6.3], ['Pod', -2.0], ['Pod', 2.3], ['Pod', 6.6]],
  sedans: [['Sedan', -6], ['Sedan', 0], ['Sedan', 6]],
  pickups: [['Pickup', -6.1], ['Pickup', 0], ['Pickup', 6.1]],
  mixed: [['Pod', -6.6], ['Sedan', -1.2], ['Pickup', 4.9]],
};
const INTRO = ['gems_line', 'lineup_jump', 'gems_snake', 'wall_thrust', 'lineup_jump'];

/**
 * "The Ramp" from the reveal: a concrete ribbon that curves up from the floor,
 * runs vertical, then curls over the top to ~170° so the car hangs upside down
 * about 20 m (≈67 ft) up, held only by suction.
 */
export const BIG_RAMP = {
  R1: 9, // lower curve radius (floor to vertical)
  V: 7, // vertical section
  R2: 4.6, // curl radius over the top
  CURL: (80 * Math.PI) / 180, // past vertical, ending at 170°
  W: 6.6, // ribbon width
  X: 7.4, // sits in the right lane of the course
};
export const BIG_RAMP_LEN = (BIG_RAMP.R1 * Math.PI) / 2 + BIG_RAMP.V + BIG_RAMP.R2 * BIG_RAMP.CURL;

/** Point on the ramp at arc length u: f = metres forward of the base, y = height, th = pitch. */
export function bigRampPoint(u, out = {}) {
  const { R1, V, R2, CURL } = BIG_RAMP;
  const a1 = (R1 * Math.PI) / 2;
  if (u <= a1) {
    const th = Math.max(0, u) / R1;
    out.f = R1 * Math.sin(th);
    out.y = R1 * (1 - Math.cos(th));
    out.th = th;
    return out;
  }
  u -= a1;
  if (u <= V) {
    out.f = R1;
    out.y = R1 + u;
    out.th = Math.PI / 2;
    return out;
  }
  u -= V;
  const p = Math.min(u / R2, CURL);
  out.f = R1 - R2 + R2 * Math.cos(p);
  out.y = R1 + V + R2 * Math.sin(p);
  out.th = Math.PI / 2 + p;
  return out;
}

class RampEdge extends THREE.Curve {
  constructor(x) {
    super();
    this.x = x;
    this.p = {};
  }
  getPoint(t, out = new THREE.Vector3()) {
    const p = bigRampPoint(t * BIG_RAMP_LEN, this.p);
    // Lift the edge tube slightly off the surface along the inward normal.
    return out.set(this.x, p.y + Math.cos(p.th) * 0.08, -(p.f - Math.sin(p.th) * 0.08));
  }
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

/**
 * Spawns, scrolls and recycles everything on the course, and answers the
 * physics questions: what surface is under the car, and did it hit something.
 * Positions along the course are "s" (metres from the start). An entity at s is
 * drawn at z = dist - s, so the car (always at z = 0) sits at s = dist.
 */
export class Track {
  constructor(scene, vehiclesRoot, fx, envMap) {
    this.scene = scene;
    this.envMap = envMap;
    this.fx = fx;
    this.entities = [];
    this.pools = new Map();
    this.speed = 45;
    this.d = 0;
    this.makeTemplates(vehiclesRoot);
    this.makeShared();
    this._v = new THREE.Vector3();
    this._p = {};
  }

  // ------------------------------------------------------------- assets --
  makeTemplates(root) {
    this.templates = {};
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.name === 'Concrete') continue;
        m.envMap = this.envMap;
        m.envMapIntensity = 0.55;
      }
    });
    for (const name of ['Semi', 'Pickup', 'Sedan', 'Pod', 'Barrier']) {
      const obj = root.getObjectByName(name);
      if (!obj) continue;
      obj.position.set(0, 0, 0);
      obj.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
      this.templates[name] = { obj, w: size.x, l: size.z, h: size.y };
    }
    const paints = ['#9b1220', '#1d3c8f', '#121317', '#b9bec6', '#245e46', '#d9d9d9'];
    this.sedanPaints = paints.map((c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.32, envMap: this.envMap, envMapIntensity: 0.55 });
      m.name = 'VehPaint';
      return m;
    });
  }

  makeShared() {
    this.gemGeo = new THREE.OctahedronGeometry(0.42, 0);
    this.gemGeo.scale(1, 1.5, 1);
    this.gemMat = new THREE.MeshStandardMaterial({
      color: '#c8fbff',
      emissive: '#2fe6ff',
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.15,
      flatShading: true,
    });

    this.tankBody = new THREE.CapsuleGeometry(0.42, 1.0, 6, 16);
    this.tankMat = new THREE.MeshStandardMaterial({ color: '#1f2633', metalness: 0.5, roughness: 0.35, envMap: this.envMap, envMapIntensity: 0.8 });
    this.tankBand = new THREE.TorusGeometry(0.45, 0.06, 8, 28);
    this.tankBandMat = new THREE.MeshStandardMaterial({ color: '#0a2a33', emissive: '#3fd5ff', emissiveIntensity: 3 });

    this.chevron = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b8101f';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f2f2f2';
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.12);
      g.lineTo(w * 0.92, h * 0.6);
      g.lineTo(w * 0.72, h * 0.6);
      g.lineTo(w * 0.5, h * 0.36);
      g.lineTo(w * 0.28, h * 0.6);
      g.lineTo(w * 0.08, h * 0.6);
      g.closePath();
      g.fill();
    }, true);
    this.rampSideMat = new THREE.MeshStandardMaterial({ color: '#5a0710', roughness: 0.6 });
    this.lightRed = new THREE.MeshStandardMaterial({ color: '#220306', emissive: '#ff2236', emissiveIntensity: 3.5 });
    this.neonRed = new THREE.MeshStandardMaterial({ color: '#2a0306', emissive: '#ff1f35', emissiveIntensity: 4.2 });
    this.whiteDot = new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffffff', emissiveIntensity: 5 });
    this.wallMat = new THREE.MeshStandardMaterial({ color: '#141519', roughness: 0.8, metalness: 0.2 });
    this.paintMat = new THREE.MeshBasicMaterial({
      color: '#b9bcc2',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    // Concrete ramp surface: grey, panel seams, white centre line, dark edge bands.
    this.rampConcrete = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#8a8c90';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = 110 + Math.random() * 50;
        g.fillStyle = `rgba(${v},${v + 1},${v + 3},0.35)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.fillStyle = 'rgba(40,42,46,0.35)';
      for (let y = 0; y < h; y += 128) g.fillRect(0, y, w, 3);
      g.fillStyle = '#f2f2f2';
      g.fillRect(w / 2 - 4, 0, 8, h);
      g.fillStyle = 'rgba(30,30,34,0.6)';
      g.fillRect(0, 0, 10, h);
      g.fillRect(w - 10, 0, 10, h);
    }, true);
    this.curtainTex = canvasTex(256, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const k = 0.45 + 0.55 * Math.abs(Math.sin(t * Math.PI * 4));
        grad.addColorStop(t, `rgb(${Math.round(150 * k)},${Math.round(8 * k)},${Math.round(16 * k)})`);
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      const v = g.createLinearGradient(0, 0, 0, h);
      v.addColorStop(0, 'rgba(0,0,0,0.55)');
      v.addColorStop(0.5, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
    });
    this.frameMat = new THREE.MeshStandardMaterial({ color: '#30343c', metalness: 0.6, roughness: 0.45 });
    this.signTex = new Map();
  }

  // -------------------------------------------------------------- pools --
  take(key, make) {
    const pool = this.pools.get(key);
    const obj = pool && pool.length ? pool.pop() : make();
    obj.visible = true;
    if (!obj.parent) this.scene.add(obj);
    obj.userData.poolKey = key;
    return obj;
  }

  release(e) {
    if (e.obj) {
      e.obj.visible = false;
      const key = e.obj.userData.poolKey;
      if (!this.pools.has(key)) this.pools.set(key, []);
      this.pools.get(key).push(e.obj);
    }
  }

  add(e) {
    e.end = e.end ?? e.s + (e.hz || 1);
    this.entities.push(e);
    return e;
  }

  reset() {
    for (const e of this.entities) this.release(e);
    this.entities.length = 0;
    this.patterns = 0;
    this.last = '';
    this.lastTank = 0;
    this.nextNeon = 30;
    this.nextMark = 120;
    this.nextHaze = 60;
    // The hero ramp right at the start, as on the reveal stage. Optional:
    // stay in the right lane to ride it.
    this.bigRamp(52);
    this.cursor = 52 + BIG_RAMP.R1 + 45;
  }

  // --------------------------------------------------------- primitives --
  gem(x, y, s) {
    const obj = this.take('gem', () => new THREE.Mesh(this.gemGeo, this.gemMat));
    obj.position.set(x, y, 0);
    obj.rotation.y = Math.random() * 6;
    return this.add({ kind: 'gem', s, x, y, obj, end: s + 1 });
  }

  tank(x, y, s) {
    const obj = this.take('tank', () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.tankBody, this.tankMat);
      const b1 = new THREE.Mesh(this.tankBand, this.tankBandMat);
      const b2 = b1.clone();
      b1.rotation.x = b2.rotation.x = Math.PI / 2;
      b1.position.y = 0.32;
      b2.position.y = -0.32;
      g.add(body, b1, b2);
      return g;
    });
    obj.position.set(x, y, 0);
    this.lastTank = s;
    return this.add({ kind: 'tank', s, x, y, obj, end: s + 1 });
  }

  vehicle(type, x, s, orient, variant) {
    const t = this.templates[type];
    if (!t) return null;
    const v = type === 'Sedan' ? (variant ?? (Math.random() * this.sedanPaints.length) | 0) : 0;
    const obj = this.take(`veh:${type}:${v}`, () => {
      const o = t.obj.clone(true);
      if (type === 'Sedan') {
        o.traverse((m) => {
          if (m.isMesh && m.material.name === 'VehPaint') m.material = this.sedanPaints[v];
        });
      }
      return o;
    });
    const cross = orient === 'cross';
    obj.rotation.y = cross ? (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 : Math.random() < 0.5 ? 0 : Math.PI;
    obj.position.set(x, 0, 0);
    const hx = (cross ? t.l : t.w) / 2;
    const hz = (cross ? t.w : t.l) / 2;
    return this.add({ kind: 'vehicle', type, solid: true, s, x, hx, hz, h: t.h, obj, end: s + hz, minGap: 99 });
  }

  barrier(x, s) {
    const t = this.templates.Barrier;
    const obj = this.take('barrier', () => t.obj.clone(true));
    obj.position.set(x, 0, 0);
    obj.rotation.y = 0;
    return this.add({ kind: 'barrier', solid: true, s, x, hx: t.w / 2, hz: t.l / 2, h: t.h, obj, end: s + t.l / 2, minGap: 99 });
  }

  ramp(x, w, s, L = 12, H = 2.8) {
    const key = `ramp:${w}:${L}:${H}`;
    const obj = this.take(key, () => this.buildRamp(w, L, H));
    obj.position.set(x, 0, 0);
    return this.add({ kind: 'ramp', s, x, w, L, H, obj, end: s + L });
  }

  buildRamp(w, L, H) {
    const x0 = -w / 2;
    const x1 = w / 2;
    // Top slope (UV mapped for chevrons), then sides + back.
    const top = [x0, 0, 0, x1, 0, 0, x1, H, -L, x0, 0, 0, x1, H, -L, x0, H, -L];
    const rep = w / 3.2;
    const uvTop = [0, 0, rep, 0, rep, 3, 0, 0, rep, 3, 0, 3];
    const sides = [
      x0, 0, 0, x0, H, -L, x0, 0, -L,
      x1, 0, 0, x1, 0, -L, x1, H, -L,
      x0, 0, -L, x0, H, -L, x1, H, -L,
      x0, 0, -L, x1, H, -L, x1, 0, -L,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...sides], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([...uvTop, ...new Array(sides.length / 3 * 2).fill(0)], 2));
    geo.addGroup(0, 6, 0);
    geo.addGroup(6, sides.length / 3, 1);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.chevron, roughness: 0.55, emissive: '#ffffff', emissiveMap: this.chevron, emissiveIntensity: 0.12 });
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(geo, [mat, this.rampSideMat]);
    g.add(mesh);
    const slope = Math.hypot(L, H);
    const ang = Math.atan2(H, L);
    for (const sx of [x0 + 0.05, x1 - 0.05]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, slope), this.lightRed);
      strip.position.set(sx, H / 2 + 0.05, -L / 2);
      strip.rotation.x = ang;
      g.add(strip);
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.14), this.lightRed);
    lip.position.set(0, H + 0.02, -L + 0.07);
    g.add(lip);
    return g;
  }

  /** The tall curl ramp from the reveal (see BIG_RAMP). */
  bigRamp(s, x = BIG_RAMP.X) {
    const obj = this.take('bigramp', () => this.buildBigRamp());
    obj.position.set(x, 0, 0);
    this.lastBigRamp = s;
    // Diamonds riding up the face, collected on the climb.
    for (let i = 1; i <= 5; i++) {
      const p = bigRampPoint((BIG_RAMP_LEN * i) / 6.2, this._p);
      const e = this.gem(x, 0, s);
      e.obj.position.y = p.y + Math.cos(p.th) * 1.1;
      e.local = -(p.f - Math.sin(p.th) * 1.1);
      e.fixed = true;
      e.end = s + BIG_RAMP.R1 + 4;
    }
    return this.add({ kind: 'bigramp', s, x, obj, used: false, end: s + BIG_RAMP.R1 + 8 });
  }

  buildBigRamp() {
    const { R1, V, R2, W } = BIG_RAMP;
    const g = new THREE.Group();
    const seg = 160;
    const pos = [];
    const uv = [];
    const idx = [];
    const p = {};
    for (let i = 0; i <= seg; i++) {
      const u = (BIG_RAMP_LEN * i) / seg;
      bigRampPoint(u, p);
      pos.push(-W / 2, p.y, -p.f, W / 2, p.y, -p.f);
      uv.push(0, u / 7, 1, u / 7);
      if (i < seg) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    // Short apron so the ribbon meets the floor cleanly.
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ribbon.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    ribbon.setIndex(idx);
    ribbon.computeVertexNormals();
    const concrete = new THREE.MeshStandardMaterial({
      map: this.rampConcrete,
      emissive: '#ffffff',
      emissiveMap: this.rampConcrete,
      emissiveIntensity: 0.16,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    g.add(new THREE.Mesh(ribbon, concrete));

    // Red neon running up both edges.
    for (const ex of [-W / 2 - 0.02, W / 2 + 0.02]) {
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new RampEdge(ex), 160, 0.07, 8, false), this.neonRed));
    }

    // Solid skirt under the lower curve (both sides) and its back wall.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (let i = 0; i <= 24; i++) {
      bigRampPoint(((R1 * Math.PI) / 2) * (i / 24), p);
      shape.lineTo(p.f, p.y);
    }
    shape.lineTo(R1, 0);
    shape.lineTo(0, 0);
    const skirtGeo = new THREE.ShapeGeometry(shape);
    for (const sx of [-W / 2, W / 2]) {
      const sk = new THREE.Mesh(skirtGeo, this.wallMat);
      sk.rotation.y = Math.PI / 2; // shape's +x (forward f) -> world -z
      sk.position.x = sx;
      g.add(sk);
    }

    // Steel frame behind the vertical wall and the curl.
    const top = R1 + V + R2 + 0.6;
    const colGeo = new THREE.BoxGeometry(0.35, top, 0.35);
    for (const fx of [R1 + 0.5, R1 + 3.4]) {
      for (const sx of [-W / 2 + 0.2, W / 2 - 0.2]) {
        const c = new THREE.Mesh(colGeo, this.frameMat);
        c.position.set(sx, top / 2, -fx);
        g.add(c);
      }
    }
    for (let y = 1.5; y < top; y += 2.6) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.18, 0.18), this.frameMat);
      a.position.set(0, y, -(R1 + 3.4));
      g.add(a);
      for (const sx of [-W / 2 + 0.2, W / 2 - 0.2]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 2.9), this.frameMat);
        b.position.set(sx, y, -(R1 + 1.95));
        g.add(b);
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.9, 0.12), this.frameMat);
        d.position.set(sx, y + 1.3, -(R1 + 1.95));
        d.rotation.x = 0.85;
        g.add(d);
      }
    }
    // Beam under the curl tying it to the frame.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, R2 + 3.4), this.frameMat);
    lip.position.set(0, R1 + V + R2 + 0.5, -(R1 + 3.4 - (R2 + 3.4) / 2));
    g.add(lip);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.1), this.neonRed);
    beacon.position.set(0, R1 + V + R2 + 0.75, -(R1 - R2));
    g.add(beacon);

    // Red stage curtains framing the base, as in the livestream shots.
    const curtainMat = new THREE.MeshStandardMaterial({ map: this.curtainTex, emissive: '#ffffff', emissiveMap: this.curtainTex, emissiveIntensity: 0.55, roughness: 1, side: THREE.DoubleSide });
    g.userData.curtains = [-1, 1].map((sx) => {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(9, 11), curtainMat);
      c.position.set(sx * (W / 2 + 2.6), 5.5, -3.5);
      c.rotation.y = sx * Math.PI / 2;
      g.add(c);
      return c;
    });
    return g;
  }

  sign(text, s, side, color = '#ff3347') {
    const key = `sign:${text}`;
    const obj = this.take(key, () => {
      if (!this.signTex.has(text)) {
        this.signTex.set(text, canvasTex(512, 160, (g, w, h) => {
          g.fillStyle = '#0b0d12';
          g.fillRect(0, 0, w, h);
          g.strokeStyle = color;
          g.lineWidth = 8;
          g.strokeRect(6, 6, w - 12, h - 12);
          g.fillStyle = '#ffffff';
          let size = 64;
          do {
            g.font = `900 ${size}px Orbitron, Arial Black, sans-serif`;
            size -= 2;
          } while (g.measureText(text).width > w - 56 && size > 20);
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(text, w / 2, h / 2 + 4);
        }));
      }
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 5.5, 8), this.frameMat);
      post.position.y = 2.75;
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(7.2, 2.25),
        new THREE.MeshBasicMaterial({ map: this.signTex.get(text), color: '#d0d0d0' }),
      );
      panel.position.y = 6.2;
      g.add(post, panel);
      return g;
    });
    obj.position.set(side * 15.5, 0, 0);
    obj.rotation.y = -side * 0.35;
    return this.add({ kind: 'sign', s, obj, end: s + 1 });
  }

  smoke(s, x0, x1, rate = 9) {
    return this.add({ kind: 'smoke', s, x0, x1, rate, obj: null, end: s + 4 });
  }

  /** Low wall with a red LED strip and white dots, like the light bars lining the venue. */
  neonWall(s, side) {
    const obj = this.take('neon', () => {
      const g = new THREE.Group();
      const len = 26;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, len), this.wallMat);
      wall.position.y = 0.4;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, len), this.neonRed);
      strip.position.set(0, 0.62, 0);
      g.add(wall, strip);
      for (let z = -len / 2 + 1; z < len / 2; z += 2.2) {
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.08), this.whiteDot);
        dot.position.set(0, 0.42, z);
        g.add(dot);
      }
      return g;
    });
    obj.position.set(side * 17, 0, 0);
    // Strip faces the course.
    obj.children[1].position.x = -side * 0.22;
    for (let i = 2; i < obj.children.length; i++) obj.children[i].position.x = -side * 0.22;
    return this.add({ kind: 'neon', s, obj, end: s + 14 });
  }

  /** Painted pad markings: long cross lines like the test site apron. */
  marking(s) {
    const diag = Math.random() < 0.5;
    const obj = this.take(diag ? 'mark:d' : 'mark:x', () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 70), this.paintMat);
      m.rotation.x = -Math.PI / 2;
      return m;
    });
    obj.position.set(0, 0.014, 0);
    obj.rotation.z = diag ? 0.62 * (Math.random() < 0.5 ? 1 : -1) : Math.PI / 2;
    return this.add({ kind: 'mark', s, obj, end: s + 40 });
  }

  // ------------------------------------------------------------ patterns --
  fill(dist) {
    while (this.cursor < dist + 950) {
      const name = this.choosePattern();
      this.speed = cruiseSpeed(this.cursor);
      this.d = Math.min(1, this.cursor / 6000);
      const gap = clamp(70 - this.d * 40, 28, 70) + rand(0, 18) + this.speed * 0.25;
      if (this.cursor - this.lastTank > 300 && this.patterns > 1) {
        this.tank(pick(LANES), 1.3, this.cursor + gap * 0.4);
      }
      this.cursor += gap;
      const len = this[name](this.cursor);
      this.cursor += len;
      this.last = name;
      this.patterns++;
    }
    // Venue dressing, independent of the gameplay patterns.
    while (this.nextNeon < dist + 950) {
      this.neonWall(this.nextNeon, Math.random() < 0.5 ? -1 : 1);
      this.nextNeon += 110 + rand(0, 70);
    }
    while (this.nextMark < dist + 950) {
      this.marking(this.nextMark);
      this.nextMark += 180 + rand(0, 120);
    }
    while (this.nextHaze < dist + 950) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.smoke(this.nextHaze, side * 13, side * 24, 3);
      this.nextHaze += 140 + rand(0, 80);
    }
  }

  choosePattern() {
    if (this.introOn && this.patterns < INTRO.length) return INTRO[this.patterns];
    const d = this.d;
    const w = {
      gems_line: 2.5,
      gems_snake: 2,
      barrier_slalom: 2 + 2 * d,
      lineup_jump: 3.2,
      parked_weave: d > 0.04 ? 2 + 2 * d : 0,
      air_gems: 1.5,
      wall_thrust: d > 0.12 ? 1.4 + d : 0,
      the_ramp: this.cursor - this.lastBigRamp > 1100 ? 1.8 : 0,
      roof_run: d > 0.08 ? 1.2 : 0,
      ramp_lane: 1.5,
      lineup_thrust: d > 0.4 ? 1 + d : 0,
    };
    w[this.last] = 0;
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'gems_line';
  }

  gems_line(s) {
    const x = pick(LANES);
    for (let i = 0; i < 8; i++) this.gem(x, 1.0, s + i * 7);
    return 56;
  }

  gems_snake(s) {
    const ph = rand(0, 6);
    for (let i = 0; i < 12; i++) this.gem(Math.sin(i * 0.42 + ph) * 6.5, 1.0, s + i * 6.5);
    return 78;
  }

  barrier_slalom(s) {
    const step = Math.max(34, this.speed * 0.62);
    let free = pick([0, 1, 2]);
    for (let r = 0; r < 3; r++) {
      const rs = s + r * step;
      for (let l = 0; l < 3; l++) {
        if (l === free) continue;
        this.barrier(LANES[l] - 1.5, rs);
        this.barrier(LANES[l] + 1.5, rs);
      }
      for (let k = -1; k <= 1; k++) this.gem(LANES[free], 1.0, rs + k * 5);
      free = clamp(free + pick([-1, 1]), 0, 2);
    }
    return step * 2 + 10;
  }

  lineupRows(count, mustSemi = true) {
    const keys = ['pods', 'sedans', 'pickups', 'mixed'];
    const rows = [];
    for (let i = 0; i < count; i++) rows.push(pick(keys));
    if (mustSemi) rows[Math.min(count - 1, 1 + ((Math.random() * (count - 1)) | 0))] = 'semi';
    return rows;
  }

  placeRows(rows, s) {
    let cur = s;
    for (const key of rows) {
      const row = ROWS[key];
      let depth = 0;
      for (const [type] of row) depth = Math.max(depth, this.templates[type].w);
      cur += depth / 2;
      for (const [type, x] of row) this.vehicle(type, x, cur, 'cross');
      cur += depth / 2 + 0.7;
    }
    return cur - s;
  }

  arcGems(rampEnd, ramp, n = 7) {
    const v = this.speed;
    const vy = launchVy(v, ramp);
    for (let k = 0; k < n; k++) {
      const t = 0.18 + k * 0.13;
      const y = ramp.H + vy * t - 0.5 * PHYS.G * t * t + 0.65;
      if (y < 1.2) break;
      this.gem(ramp.x, y, rampEnd + v * t);
    }
  }

  /** Red light strip on the floor in front of a lineup, as at the jump demo. */
  floorLights(s) {
    const obj = this.take('floorlights', () => {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(21, 0.06, 0.18), this.neonRed);
      bar.position.y = 0.03;
      g.add(bar);
      return g;
    });
    obj.position.set(0, 0, 0);
    return this.add({ kind: 'floor', s, obj, end: s + 1 });
  }

  lineup_jump(s) {
    const r = this.ramp(0, 20, s, 12, 2.8);
    const start = s + 12 + 15;
    const rows = this.lineupRows(3 + Math.round(this.d * 2));
    this.floorLights(start - 3);
    const depth = this.placeRows(rows, start);
    this.smoke(start + depth / 2, -10, 10);
    this.arcGems(s + 12, r);
    return 12 + 15 + depth + 34;
  }

  parked_weave(s) {
    const step = Math.max(28, this.speed * 0.62);
    let free = pick([0, 1, 2]);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const rs = s + i * step;
      const blocked = [0, 1, 2].filter((l) => l !== free);
      const both = this.d > 0.45 && Math.random() < 0.35;
      const lanes = both ? blocked : [pick(blocked)];
      for (const l of lanes) {
        const semi = this.d > 0.25 && Math.random() < 0.22;
        const type = semi ? 'Semi' : pick(['Sedan', 'Pod', 'Pickup', 'Sedan']);
        this.vehicle(type, LANES[l], rs + (semi ? 8 : 0), 'along');
      }
      this.gem(LANES[free], 1.0, rs);
      free = clamp(free + pick([-1, 0, 1]), 0, 2);
    }
    return step * (n - 1) + 20;
  }

  air_gems(s) {
    const x = pick(LANES);
    this.tank(x, 3.2, s + 8);
    for (let i = 0; i < 10; i++) this.gem(x, 2.5 + Math.sin((i / 9) * Math.PI) * 6.5, s + 18 + i * 6.5);
    return 85;
  }

  wall_thrust(s) {
    this.sign('THRUST ↑', s - 85, -1);
    this.sign('THRUST ↑', s - 85, 1);
    const walls = this.d > 0.5 ? 2 : 1;
    const step = Math.max(32, this.speed * 0.5);
    for (let k = 0; k < walls; k++) {
      for (const x of [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]) this.barrier(x, s + k * step);
      for (const x of [-6, 0, 6]) this.gem(x, 2.6, s + k * step);
    }
    return 20 + (walls - 1) * step;
  }

  the_ramp(s) {
    this.sign('THE RAMP  →', s - 110, 1, '#ff3347');
    for (let i = 0; i < 6; i++) this.gem(BIG_RAMP.X, 1.0, s - 52 + i * 7);
    this.bigRamp(s + 10);
    return 10 + BIG_RAMP.R1 + 45;
  }

  roof_run(s) {
    const r = this.ramp(0, 6.2, s, 10, 2.6);
    const semi = this.templates.Semi;
    let cur = s + 10 + 9;
    for (let k = 0; k < 2; k++) {
      this.vehicle('Semi', 0, cur + semi.l / 2, 'along');
      for (let i = 1; i < 6; i++) this.gem(0, semi.h + 0.9, cur + (semi.l * i) / 6);
      cur += semi.l + 1.5;
    }
    this.arcGems(s + 10, r, 2);
    return cur - s + 25;
  }

  ramp_lane(s) {
    const x = pick(LANES);
    const r = this.ramp(x, 6.2, s, 11, 2.4);
    this.arcGems(s + 11, r, 8);
    if (this.d > 0.3) {
      for (const l of LANES) if (l !== x) this.barrier(l, s + 40);
    }
    return 11 + 60;
  }

  lineup_thrust(s) {
    this.sign('THRUST ↑', s - 85, 1);
    this.floorLights(s - 3);
    const depth = this.placeRows([pick(['pods', 'sedans'])], s);
    for (const x of [-6, 0, 6]) this.gem(x, 3.2, s + depth / 2);
    return depth + 15;
  }

  // ------------------------------------------------------------ per frame --
  update(dt, dist, time) {
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.end < dist - 45) {
        this.release(e);
        list[i] = list[list.length - 1];
        list.pop();
        i--;
        continue;
      }
      if (!e.obj) continue;
      e.obj.position.z = dist - e.s + (e.local || 0);
      if (e.kind === 'gem') {
        e.obj.rotation.y += dt * 3;
        if (!e.fixed) e.obj.position.y = e.y + Math.sin(time * 3 + e.s) * 0.12;
      } else if (e.kind === 'tank') {
        e.obj.rotation.y += dt * 1.5;
        e.obj.position.y = e.y + Math.sin(time * 2.4 + e.s) * 0.2;
      }
    }
  }

  emitSmoke(dt, dist) {
    for (const e of this.entities) {
      if (e.kind !== 'smoke') continue;
      const ahead = e.s - dist;
      if (ahead < -20 || ahead > 320) continue;
      if (Math.random() >= dt * e.rate) continue;
      const x = rand(e.x0, e.x1);
      this.fx.smoke.spawn(x, rand(0.2, 1.5), dist - e.s + rand(-4, 4), rand(-0.5, 0.5), rand(0.4, 1.2), 0, rand(4, 7), 4, 11, 0.75, 0.78, 0.84, 0.3, 0.1, 0.05);
    }
  }

  /** Highest drivable surface under the car, plus the ramp/roof it belongs to. */
  surface(x, s, y, out) {
    out.h = 0;
    out.ramp = null;
    out.roof = null;
    for (const e of this.entities) {
      if (e.kind === 'ramp') {
        if (s >= e.s && s <= e.s + e.L && Math.abs(x - e.x) <= e.w / 2 + 0.6) {
          const h = (e.H * (s - e.s)) / e.L;
          if (h > out.h) {
            out.h = h;
            out.ramp = e;
          }
        }
      } else if (e.solid) {
        if (Math.abs(x - e.x) < e.hx + 0.6 && Math.abs(s - e.s) < e.hz + 1.2 && y >= e.h - PHYS.STEP && e.h > out.h) {
          out.h = e.h;
          out.roof = e;
        }
      }
    }
    return out;
  }

  /** Solid obstacle the car body is intersecting, if any (skipping `ignore`). */
  hit(x, s, y, ignore = null) {
    for (const e of this.entities) {
      if (e === ignore) continue;
      if (e.kind === 'bigramp') {
        // The tower itself: from just past its base to the back of the frame.
        const f = s - e.s;
        if (f > 1 && f < BIG_RAMP.R1 + 4.5 && Math.abs(x - e.x) < BIG_RAMP.W / 2 + PHYS.CAR_HX && y < 21) return e;
        continue;
      }
      if (!e.solid) continue;
      if (Math.abs(x - e.x) < e.hx + PHYS.CAR_HX && Math.abs(s - e.s) < e.hz + PHYS.CAR_HZ && y < e.h - PHYS.STEP) return e;
    }
    return null;
  }

  /** Near-miss bookkeeping; calls onMiss(e) once a vehicle has been passed closely. */
  nearMiss(x, s, y, grounded, onMiss) {
    for (const e of this.entities) {
      if (!e.solid || e.judged) continue;
      if (Math.abs(s - e.s) < e.hz + PHYS.CAR_HZ) {
        const lat = Math.abs(x - e.x) - e.hx - PHYS.CAR_HX;
        const over = y - e.h;
        const gap = over >= 0 ? over : grounded ? lat : 99;
        if (gap >= 0 && gap < e.minGap) e.minGap = gap;
      } else if (e.s + e.hz < s - PHYS.CAR_HZ) {
        e.judged = true;
        if (e.minGap < 0.9 && e.kind === 'vehicle') onMiss(e);
      }
    }
  }

  /** Collect diamonds / canisters within reach of the car centre (world space). */
  collect(center, onGem, onTank) {
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.kind !== 'gem' && e.kind !== 'tank') continue;
      const p = e.obj.position;
      const dz = p.z - center.z;
      if (dz > 4 || dz < -4) continue;
      const r = e.kind === 'gem' ? 2.0 : 2.4;
      if ((p.x - center.x) ** 2 + (p.y - center.y) ** 2 + dz * dz < r * r) {
        if (e.kind === 'gem') onGem(p);
        else onTank(p);
        this.release(e);
        list[i] = list[list.length - 1];
        list.pop();
        i--;
      }
    }
  }

  /** First entity of a kind between dist and dist + range (barrier walls only if wallsOnly). */
  nextOf(kind, dist, range, wallsOnly = false) {
    for (const e of this.entities) {
      if (e.kind !== kind) continue;
      const ahead = e.s - dist;
      if (ahead > 0 && ahead < range && (!wallsOnly || Math.abs(e.x) < 2)) return e;
    }
    return null;
  }

  /** The big ramp whose base the car just reached in its lane (if any). */
  bigRampAt(prevS, s, x) {
    for (const e of this.entities) {
      if (e.kind !== 'bigramp' || e.used) continue;
      if (prevS < e.s && s >= e.s && Math.abs(x - e.x) < BIG_RAMP.W / 2 + PHYS.CAR_HX) return e;
    }
    return null;
  }

  /** Clear obstacles right in front of the car (used when reviving). */
  clearAhead(dist, len) {
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.s > dist - 5 && e.s < dist + len && e.kind !== 'sign' && e.kind !== 'neon' && e.kind !== 'mark') {
        this.release(e);
        list[i] = list[list.length - 1];
        list.pop();
        i--;
      }
    }
  }
}
