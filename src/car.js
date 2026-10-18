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
