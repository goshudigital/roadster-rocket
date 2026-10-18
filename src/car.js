import * as THREE from 'three';

export const PAINTS = [
  { id: 'ano', name: 'Ano White', price: 0, color: '#e9e7e2', metalness: 0.12, roughness: 0.3 },
  { id: 'carbon', name: 'Midnight Carbon', price: 300, color: '#17191e', metalness: 0.55, roughness: 0.3 },
  { id: 'red', name: 'Rocket Red', price: 600, color: '#b3101d', metalness: 0.45, roughness: 0.26 },
  { id: 'titanium', name: 'Titanium', price: 1000, color: '#a2a6ab', metalness: 0.95, roughness: 0.24 },
  { id: 'cobalt', name: 'Deep Cobalt', price: 1600, color: '#1c3fb0', metalness: 0.6, roughness: 0.24 },
  { id: 'gold', name: 'Gold Glaze', price: 2500, color: '#caa24c', metalness: 1.0, roughness: 0.22 },
  { id: 'steel', name: 'Starship Steel', price: 4000, color: '#c9ced3', metalness: 1.0, roughness: 0.36 },
  { id: 'plasma', name: 'Plasma Violet', price: 6000, color: '#6c2bdc', metalness: 0.55, roughness: 0.2 },
];

export function paintSwatch(p) {
  return `radial-gradient(circle at 35% 30%, #ffffff${p.metalness > 0.8 ? 'cc' : '99'} 0%, ${p.color} 38%, ${p.color} 62%, #000000aa 100%)`;
}

const _v = new THREE.Vector3();

const JET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFres;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFres = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;
const JET_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uDiamonds;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vFres;
  void main() {
    // Clamp everything that feeds pow(): one NaN pixel would black out the bloom pass.
    float along = clamp(1.0 - vUv.y, 0.0, 1.0); // 0 at the nozzle, 1 at the tip
    float fade = pow(1.0 - along, 1.3);
    float core = pow(clamp(vFres, 0.0, 1.0), 1.4);
    float bands = 1.0 + uDiamonds * 0.7 * sin(along * 36.0 - uTime * 42.0);
    float flicker = 0.9 + 0.1 * sin(uTime * 61.0 + along * 9.0);
    float a = clamp(uIntensity * fade * core * bands * flicker, 0.0, 3.0);
    if (!(a > 0.002)) discard;
    vec3 col = mix(vec3(1.0), uColor, smoothstep(0.0, 0.7, along));
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * The player's roadster. Hierarchy:
 *   root   (track position: x, ground height, z = 0)  - loop rotation pivots here
 *   pivot  (centre of mass, 0.55 m up)                - flips / banking pivot here
 *   model  (the Blender GLB, offset back down)
 */
export class Car {
  constructor(template, envMap) {
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.55;
    this.root.add(this.pivot);
    this.model = template.clone(true);
    this.model.position.y = -0.55;
    this.pivot.add(this.model);

    this.wheels = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((n) => this.model.getObjectByName(n)).filter(Boolean);
    this.wing = this.model.getObjectByName('Wing');
    this.wingBase = this.wing ? this.wing.position.clone() : new THREE.Vector3();
    this.wingDeploy = 0;
    this.wheelAngle = 0;

    this.materials = {};
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials[m.name] = m;
    });
    for (const m of Object.values(this.materials)) {
      m.envMap = envMap;
      m.envMapIntensity = 0.7;
    }
    const body = this.materials.Body;
    if (body) {
      body.envMapIntensity = 0.55;
      body.clearcoat = 0.35;
    }
    const glass = this.materials.Glass;
    if (glass) {
      glass.envMapIntensity = 1.2;
      glass.color.set('#6b4a1c');
      glass.metalness = 0.95;
      glass.roughness = 0.05;
    }
    for (const n of ['Titanium', 'Rim', 'Nozzle']) if (this.materials[n]) this.materials[n].envMapIntensity = 1.1;
    this.tail = this.materials.LightRed;
    this.head = this.materials.LightWhite;
    // Keep the full-width taillight saturated red (very bright red tone-maps to peach).
    if (this.tail) this.tail.emissiveIntensity = 2.4;
    this.tailBase = this.tail ? this.tail.emissiveIntensity : 1;
    this.brake = 0;

    // Thruster emitters, positions in model space. dir is the gas jet direction.
    this.emitters = [];
    this.model.traverse((o) => {
      if (!o.name.startsWith('T_')) return;
      const kind = o.name.startsWith('T_Rear') ? 'rear' : o.name.startsWith('T_Down') ? 'down' : 'side';
      const dir = new THREE.Vector3(kind === 'rear' ? 0 : kind === 'side' ? Math.sign(o.position.x) : 0, kind === 'down' ? -1 : 0, kind === 'rear' ? 1 : 0);
      this.emitters.push({ obj: o, kind, dir });
    });
    this.makeJets();
  }

  /**
   * Straight cold-gas jet columns, like the blue-white jets in the reveal
   * footage: four lift jets under the corners, the rear mains, two lateral.
   */
  makeJets() {
    const base = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uDiamonds: { value: 0 },
        uColor: { value: new THREE.Color('#9fd2ff') },
      },
      vertexShader: JET_VERT,
      fragmentShader: JET_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.jetMats = { down: base, rear: base.clone(), sideL: base.clone(), sideR: base.clone() };
    this.jetMats.rear.uniforms.uDiamonds.value = 1;
    this.jets = [];
    const geoms = {
      down: new THREE.CylinderGeometry(0.08, 0.42, 1, 16, 1, true).translate(0, -0.5, 0),
      rear: new THREE.CylinderGeometry(0.07, 0.3, 1, 16, 1, true).translate(0, -0.5, 0),
      side: new THREE.CylinderGeometry(0.05, 0.25, 1, 12, 1, true).translate(0, -0.5, 0),
    };
    for (const e of this.emitters) {
      let mat;
      let geo;
      let len;
      const m = new THREE.Mesh();
      if (e.kind === 'down') {
        mat = this.jetMats.down;
        geo = geoms.down;
        len = 4.8;
      } else if (e.kind === 'rear') {
        mat = this.jetMats.rear;
        geo = geoms.rear;
        len = 3.4;
        m.rotation.x = -Math.PI / 2; // -Y -> +Z (out of the tail)
      } else {
        const left = e.obj.position.x < 0;
        mat = left ? this.jetMats.sideL : this.jetMats.sideR;
        geo = geoms.side;
        len = 2.2;
        m.rotation.z = left ? -Math.PI / 2 : Math.PI / 2; // -Y -> outward
      }
      m.geometry = geo;
      m.material = mat;
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 5;
      m.userData = { kind: e.kind, len, mat };
      e.obj.add(m);
      this.jets.push(m);
    }
  }

  /** Jet intensities 0..1 by group. */
  setJets({ down = 0, rear = 0, sideL = 0, sideR = 0 }, time) {
    const lv = { down, rear, sideL, sideR };
    for (const [k, mat] of Object.entries(this.jetMats)) {
      mat.uniforms.uIntensity.value = lv[k] * 1.9;
      mat.uniforms.uTime.value = time;
    }
    for (const j of this.jets) {
      const { kind, len, mat } = j.userData;
      const i = mat === this.jetMats.down ? down : mat === this.jetMats.rear ? rear : mat === this.jetMats.sideL ? sideL : sideR;
      j.visible = i > 0.02;
      if (j.visible) j.scale.set(0.8 + i * 0.4, 0.3 + i * len * (0.92 + Math.random() * 0.16), 0.8 + i * 0.4);
    }
  }

  setPaint(paint) {
    const m = this.materials.Body;
    if (!m) return;
    m.color.set(paint.color);
    m.metalness = paint.metalness;
    m.roughness = paint.roughness;
    m.needsUpdate = true;
  }

  flashBrake() {
    this.brake = 1;
  }

  /** speed in m/s; wing: 0..1 deploy target. */
  update(dt, speed, wing) {
    this.wheelAngle -= (speed * dt) / 0.36;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    this.wingDeploy += (wing - this.wingDeploy) * Math.min(1, dt * 5);
    if (this.wing) {
      this.wing.position.y = this.wingBase.y + this.wingDeploy * 0.24;
      this.wing.position.z = this.wingBase.z + this.wingDeploy * 0.04;
      this.wing.rotation.x = -this.wingDeploy * 0.18;
    }
    this.brake = Math.max(0, this.brake - dt * 2.5);
    if (this.tail) this.tail.emissiveIntensity = this.tailBase * (1 + this.brake * 1.8);
  }

  /** World position of an emitter (after matrices are updated). */
  emitterWorld(e, out) {
    return e.obj.getWorldPosition(out);
  }

  /** Rotate a model-space direction into world space. */
  dirWorld(dir, out) {
    out.copy(dir).transformDirection(this.model.matrixWorld);
    return out;
  }

  get worldCenter() {
    return this.pivot.getWorldPosition(_v);
  }
}
