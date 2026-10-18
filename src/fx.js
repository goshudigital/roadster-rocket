import * as THREE from 'three';

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeDotTexture() {
  return canvasTexture(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}

export function makePuffTexture() {
  return canvasTexture(128, (g, s) => {
    // A few overlapping soft blobs give a billowy cold-gas cloud.
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * s * 0.18;
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      const rad = s * (0.22 + Math.random() * 0.16);
      const r = g.createRadialGradient(x, y, 0, x, y, rad);
      r.addColorStop(0, 'rgba(255,255,255,0.32)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.12)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }
  });
}

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iCol;
  attribute vec2 iSz;
  varying vec2 vUv;
  varying vec4 vCol;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vCol = iCol;
    float c = cos(iSz.y), s = sin(iSz.y);
    vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSz.x;
    vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += p;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vCol;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D(map, vUv);
    gl_FragColor = vec4(vCol.rgb * tex.rgb, vCol.a * tex.a);
    if (gl_FragColor.a < 0.002) discard;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Pooled camera-facing particles drawn in one instanced draw call. */
export class Particles {
  constructor(scene, { max = 1000, texture, additive = false, fog = true }) {
    this.max = max;
    this.count = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSz = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iSz', this.aSz);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: texture } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.map.value = texture;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);

    // Simulation state (structure of arrays).
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.scrolls = new Uint8Array(max);
  }

  /** Spawn one particle. Options are positional for speed in hot loops. */
  spawn(x, y, z, vx, vy, vz, ttl, size0, size1, r, g, b, alpha, drag = 0, grav = 0, scroll = 1) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.p[i3] = x;
    this.p[i3 + 1] = y;
    this.p[i3 + 2] = z;
    this.v[i3] = vx;
    this.v[i3 + 1] = vy;
    this.v[i3 + 2] = vz;
    this.c[i3] = r;
    this.c[i3 + 1] = g;
    this.c[i3 + 2] = b;
    this.life[i] = ttl;
    this.ttl[i] = ttl;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.rot[i] = Math.random() * 6.283;
    this.rotV[i] = (Math.random() - 0.5) * 1.6;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.scrolls[i] = scroll;
  }

  copy(from, to) {
    const f3 = from * 3;
    const t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.p[t3 + k] = this.p[f3 + k];
      this.v[t3 + k] = this.v[f3 + k];
      this.c[t3 + k] = this.c[f3 + k];
    }
    this.life[to] = this.life[from];
    this.ttl[to] = this.ttl[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.rot[to] = this.rot[from];
    this.rotV[to] = this.rotV[from];
    this.drag[to] = this.drag[from];
    this.grav[to] = this.grav[from];
    this.scrolls[to] = this.scrolls[from];
  }

  /** scroll: metres the world moved toward the camera this frame. */
  update(dt, scroll) {
    const pos = this.aPos.array;
    const col = this.aCol.array;
    const sz = this.aSz.array;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) this.copy(this.count, i);
        i--;
        continue;
      }
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= damp;
      this.v[i3 + 1] = this.v[i3 + 1] * damp + this.grav[i] * dt;
      this.v[i3 + 2] *= damp;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt + (this.scrolls[i] ? scroll : 0);
      this.rot[i] += this.rotV[i] * dt;

      const t = 1 - this.life[i] / this.ttl[i];
      const grow = 1 - (1 - t) * (1 - t);
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      pos[i3] = this.p[i3];
      pos[i3 + 1] = this.p[i3 + 1];
      pos[i3 + 2] = this.p[i3 + 2];
      const i4 = i * 4;
      col[i4] = this.c[i3];
      col[i4 + 1] = this.c[i3 + 1];
      col[i4 + 2] = this.c[i3 + 2];
      col[i4 + 3] = this.a0[i] * fade;
      sz[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * grow;
      sz[i * 2 + 1] = this.rot[i];
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSz.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}

/** Streaks that rush past the camera at high speed. */
export class SpeedLines {
  constructor(scene, n = 80) {
    this.n = n;
    this.pos = new Float32Array(n * 6);
    this.seed = [];
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    this.mat = new THREE.LineBasicMaterial({
      color: 0xcfe9ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    for (let i = 0; i < n; i++) this.seed.push(this.respawn({}, true));
  }

  respawn(s, anywhere = false) {
    const side = Math.random() < 0.5 ? -1 : 1;
    s.x = side * (2.5 + Math.random() * 16);
    s.y = 0.4 + Math.random() * 9;
    s.z = anywhere ? -Math.random() * 160 : -140 - Math.random() * 40;
    return s;
  }

  update(dt, speed, intensity, camX, camY) {
    this.mat.opacity += (intensity * 0.55 - this.mat.opacity) * Math.min(1, dt * 4);
    this.lines.visible = this.mat.opacity > 0.01;
    if (!this.lines.visible) return;
    const len = 1.5 + speed * 0.09;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      s.z += speed * 1.4 * dt;
      if (s.z > 12) this.respawn(s);
      const o = i * 6;
      this.pos[o] = camX + s.x;
      this.pos[o + 1] = camY * 0.5 + s.y;
      this.pos[o + 2] = s.z;
      this.pos[o + 3] = camX + s.x;
      this.pos[o + 4] = camY * 0.5 + s.y;
      this.pos[o + 5] = s.z - len;
    }
    this.attr.needsUpdate = true;
  }
}
