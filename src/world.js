import * as THREE from 'three';

const ROAD_W = 22;
const ROAD_TILE = 24;
const GROUND_TILE = 32;

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function tex(c, { srgb = true, repeat = [1, 1], aniso = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  return t;
}

function roadCanvases() {
  const W = 512;
  const H = 1024;
  const px = (x) => ((x + ROAD_W / 2) / ROAD_W) * W;
  const pz = (m) => (m / ROAD_TILE) * H;
  const albedo = canvas(W, H, (g) => {
    g.fillStyle = '#1b1d22';
    g.fillRect(0, 0, W, H);
    // Asphalt grain.
    for (let i = 0; i < 9000; i++) {
      const v = 20 + Math.random() * 26;
      g.fillStyle = `rgba(${v},${v + 1},${v + 4},${0.35 + Math.random() * 0.4})`;
      g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // Tyre-polished lanes are slightly darker.
    for (const lane of [-6, 0, 6]) {
      for (const off of [-0.9, 0.9]) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(px(lane + off) - 14, 0, 28, H);
      }
    }
  });
  const lines = canvas(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    for (const x of [-3, 3]) {
      for (const z0 of [0, 12]) g.fillRect(px(x) - 2.5, pz(z0), 5, pz(6));
    }
    for (const x of [-9, 9]) g.fillRect(px(x) - 3.5, 0, 7, H);
    // Red / white kerbs on the shoulders.
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#ff2a3a' : '#e8e8e8';
      g.fillRect(px(-10.6), pz(i * 2), px(-9.5) - px(-10.6), pz(2));
      g.fillRect(px(9.5), pz(i * 2), px(10.6) - px(9.5), pz(2));
    }
  });
  // Combine: albedo gets the paint too, the emissive map makes paint catch light.
  const a = albedo.getContext('2d');
  a.globalAlpha = 0.85;
  a.drawImage(lines, 0, 0);
  return { albedo, lines };
}

function groundCanvas() {
  return canvas(512, 512, (g, W, H) => {
    g.fillStyle = '#23252b';
    g.fillRect(0, 0, W, H);
    const slab = W / 4;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = 28 + Math.random() * 12;
        g.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
        g.fillRect(x * slab + 2, y * slab + 2, slab - 4, slab - 4);
      }
    }
    for (let i = 0; i < 4000; i++) {
      const v = 30 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
      g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
    }
  });
}

function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = canvas(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, inner);
    r.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
    r.addColorStop(1, outer);
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BEAM_VERT = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  uniform float uHeight;
  void main() {
    vH = position.y / uHeight + 0.5;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const BEAM_FRAG = /* glsl */ `
  varying float vH;
  varying vec3 vN;
  varying vec3 vV;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float edge = pow(abs(dot(vN, vV)), 1.6);
    float a = uOpacity * edge * smoothstep(0.0, 0.25, vH) * (0.25 + 0.75 * vH);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/** Everything that isn't gameplay: sky, ground, road, lights and the launch site backdrop. */
export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.time = 0;
    const aniso = renderer.capabilities.getMaxAnisotropy();

    scene.background = new THREE.Color('#05070d');
    scene.fog = new THREE.FogExp2('#0a0f1d', 0.0021);

    this.buildSky();
    this.buildGround(aniso);
    this.buildRoad(aniso);
    this.buildEdgeLights();
    this.buildFloodlights();
    this.buildBackdrop();
    this.buildLights();
  }

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 40, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color('#020309') },
          uMid: { value: new THREE.Color('#081028') },
          uHorizon: { value: new THREE.Color('#1a2346') },
          uGlow: { value: new THREE.Color('#5a2f3c') },
          uFlash: { value: 0 },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGlow; uniform float uFlash;
          varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.16, h));
            c = mix(c, uTop, smoothstep(0.16, 0.7, h));
            // Warm light pollution from the launch site, off to the right.
            float site = pow(max(0.0, dot(normalize(vec3(vP.x, 0.0, vP.z)), normalize(vec3(0.35, 0.0, -1.0)))), 6.0);
            c += uGlow * site * (1.0 - smoothstep(0.0, 0.22, h)) * (0.8 + uFlash * 3.0);
            c = mix(c, vec3(0.04, 0.05, 0.09), step(h, -0.01));
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);

    // Stars with a gentle twinkle.
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = 0.04 + Math.random() * 0.96;
      const r = 1800;
      const y = Math.pow(v, 0.8);
      const ring = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(u) * ring * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = Math.sin(u) * ring * r;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float seed; uniform float uTime; uniform float uPx; varying float vA;
        void main(){
          vA = (0.35 + 0.65 * seed) * (0.75 + 0.25 * sin(uTime * (1.0 + seed * 3.0) + seed * 40.0));
          gl_PointSize = (seed > 0.97 ? 3.2 : 1.6 + seed) * uPx;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = vA * smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
        }`,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);

    const moon = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture('rgba(235,240,255,1)'), color: '#dfe6ff', fog: false, depthWrite: false, transparent: true }),
    );
    moon.position.set(-700, 620, -1500);
    moon.scale.setScalar(150);
    moon.renderOrder = -8;
    this.scene.add(moon);
  }

  buildGround(aniso) {
    this.groundTex = tex(groundCanvas(), { repeat: [3000 / GROUND_TILE, 3000 / GROUND_TILE], aniso });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ map: this.groundTex, color: '#8a8f99', roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.25, -1100);
    this.scene.add(ground);
  }

  buildRoad(aniso) {
    const { albedo, lines } = roadCanvases();
    const len = 1100;
    const rep = [1, len / ROAD_TILE];
    this.roadTex = tex(albedo, { repeat: rep, aniso });
    this.roadEmit = tex(lines, { repeat: rep, aniso, srgb: true });
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, len),
      new THREE.MeshStandardMaterial({
        map: this.roadTex,
        emissiveMap: this.roadEmit,
        emissive: new THREE.Color('#3a3d45'),
        roughness: 0.82,
        metalness: 0.0,
      }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, 60 - len / 2);
    this.scene.add(road);
  }

  buildEdgeLights() {
    const stripMat = new THREE.MeshStandardMaterial({ color: '#1a0204', emissive: '#ff1e33', emissiveIntensity: 2.6 });
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1100), stripMat);
      strip.position.set(side * 11.15, 0.05, 60 - 550);
      this.scene.add(strip);
    }
    this.postSpacing = 12;
    this.postSpan = 1020;
    const perSide = Math.floor(this.postSpan / this.postSpacing);
    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 0.55, 0.22),
      new THREE.MeshStandardMaterial({ color: '#220306', emissive: '#ff2a3d', emissiveIntensity: 3.2 }),
      perSide * 2,
    );
    this.posts.frustumCulled = false;
    this.postsPerSide = perSide;
    this.scene.add(this.posts);
    this.updatePosts(0);
  }

  updatePosts(dist) {
    const m = new THREE.Matrix4();
    const span = this.postSpan;
    for (let i = 0; i < this.postsPerSide; i++) {
      const z = ((((dist - i * this.postSpacing) % span) + span) % span) - span + 40;
      m.makeTranslation(-11.6, 0.3, z);
      this.posts.setMatrixAt(i * 2, m);
      m.makeTranslation(11.6, 0.3, z);
      this.posts.setMatrixAt(i * 2 + 1, m);
    }
    this.posts.instanceMatrix.needsUpdate = true;
  }

  buildFloodlights() {
    this.towers = [];
    this.towerSpacing = 125;
    const count = 9;
    this.towerSpan = this.towerSpacing * count;
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.7, metalness: 0.4 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#f4f7ff', emissiveIntensity: 7 });
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.38, 26, 8);
    const headGeo = new THREE.BoxGeometry(3.2, 1.4, 0.35);
    const beamH = 34;
    const beamGeo = new THREE.ConeGeometry(11, beamH, 28, 1, true);
    const poolTex = glowTexture('rgba(255,248,235,0.9)');
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(side * 21, 13, 0);
      g.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(side * 20.2, 26, 0);
      head.rotation.set(-0.5, side * 0.9, 0);
      g.add(head);
      // Volumetric beam: a cone hanging from the lamp, tilted toward the road.
      const pivot = new THREE.Group();
      pivot.position.set(side * 20.2, 25.6, 0);
      pivot.rotation.z = side * 0.42;
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color('#dfe8ff') }, uOpacity: { value: 0.085 }, uHeight: { value: beamH } },
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      beam.position.y = -beamH / 2;
      beam.renderOrder = 4;
      pivot.add(beam);
      g.add(pivot);
      // Pool of light where the beam lands.
      const hitX = side * 20.2 - side * Math.sin(0.42) * beamH * 0.95;
      const pool = new THREE.Mesh(
        poolGeo,
        new THREE.MeshBasicMaterial({ map: poolTex, color: '#20232b', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(hitX, 0.03, 0);
      pool.scale.set(26, 34, 1);
      g.add(pool);
      g.userData.s = i * this.towerSpacing + 60;
      this.towers.push(g);
      this.scene.add(g);
    }
  }

  buildBackdrop() {
    const site = new THREE.Group();
    site.position.set(380, 0, -1450);
    const dark = new THREE.MeshStandardMaterial({ color: '#0d0f14', roughness: 0.9, fog: false });
    // Launch tower: four columns with bracing and two catch arms.
    const H = 150;
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.4, H, 1.4), dark);
      c.position.set(x, H / 2, z);
      site.add(c);
    }
    for (let y = 8; y < H; y += 9) {
      for (const [w, d, x, z] of [[11, 0.6, 0, -5], [11, 0.6, 0, 5], [0.6, 11, -5, 0], [0.6, 11, 5, 0]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), dark);
        b.position.set(x, y, z);
        site.add(b);
      }
    }
    for (const dz of [-3.5, 3.5]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 1.6), dark);
      arm.position.set(-17, 112, dz);
      site.add(arm);
    }
    // Rocket on the pad, lit by floodlights.
    this.rocket = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: '#8d939c', metalness: 0.9, roughness: 0.35, emissive: '#1c2230', emissiveIntensity: 1.2, fog: false, envMapIntensity: 0.5 });
    const booster = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 70, 28), steel);
    booster.position.y = 35;
    const ship = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 40, 28), steel);
    ship.position.y = 90;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 28), steel);
    nose.position.y = 117;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 2, 28), new THREE.MeshStandardMaterial({ color: '#111', fog: false }));
    band.position.y = 70.5;
    this.rocket.add(booster, ship, nose, band);
    this.rocket.position.set(-34, 6, 0);
    site.add(this.rocket);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 6, 20), dark);
    mount.position.set(-34, 3, 0);
    site.add(mount);

    // Rocket exhaust (hidden until launch).
    const flameTex = glowTexture('rgba(255,236,200,1)');
    this.plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: '#ffd7a1', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.plume.scale.set(60, 90, 1);
    this.plume.position.y = -20;
    this.plume.visible = false;
    this.rocket.add(this.plume);
    this.trail = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: '#ffb36b', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0 }));
      s.visible = false;
      site.add(s);
      this.trail.push(s);
    }
    this.trailTimer = 0;
    this.trailIdx = 0;
    this.launch = { phase: 'idle', t: 0, next: 50 + Math.random() * 30 };

    // Blinking aviation lights.
    this.beacons = [];
    const beaconTex = glowTexture('rgba(255,40,40,1)');
    for (const [x, y, z] of [[0, H + 2, 0], [-30, 113, 0], [6, 75, 6], [-34, 125, 0]]) {
      const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: beaconTex, color: '#ff3b3b', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      b.position.set(x, y, z);
      b.scale.setScalar(14);
      site.add(b);
      this.beacons.push(b);
    }
    // Pad floodlight glow.
    const padGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(190,210,255,0.8)'), color: '#9fb6ff', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.6 }));
    padGlow.position.set(-20, 10, 20);
    padGlow.scale.set(160, 60, 1);
    site.add(padGlow);
    this.site = site;
    this.scene.add(site);

    // Hangars on the left with lit doors.
    const hangarMat = new THREE.MeshStandardMaterial({ color: '#0e1016', roughness: 0.9, fog: false });
    const doorMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0', fog: false });
    for (const [x, z, w] of [[-420, -1250, 120], [-260, -1500, 90], [-620, -1380, 160]]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(w, 34, 60), hangarMat);
      h.position.set(x, 17, z);
      this.scene.add(h);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.45, 20), doorMat);
      door.position.set(x, 10, z + 30.1);
      this.scene.add(door);
    }

    // Distant lights along the horizon.
    const n = 260;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * 0.95 + Math.random() * Math.PI * 0.9;
      const r = 1500 + Math.random() * 250;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 2 + Math.random() * 14;
      pos[i * 3 + 2] = Math.sin(a) * r;
      c.set(Math.random() < 0.2 ? '#ff4d4d' : Math.random() < 0.5 ? '#ffd9a0' : '#cfe0ff');
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lights = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    this.scene.add(lights);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#8ea2ff', '#0b0c12', 0.55);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight('#c3d2ff', 0.9);
    this.moon.position.set(-300, 400, -200);
    this.scene.add(this.moon);
    // Key light that rides with the camera so the car always reads.
    this.key = new THREE.DirectionalLight('#ffffff', 1.2);
    this.scene.add(this.key);
    this.scene.add(this.key.target);
    // Headlights.
    this.headlight = new THREE.SpotLight('#eaf2ff', 14, 150, 0.32, 0.75, 0.6);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
  }

  /** Called each frame. dist: track position of the car. */
  update(dt, dist, car, camera, running, hideNearZ = null) {
    this.time += dt;
    this.starMat.uniforms.uTime.value = this.time;
    this.roadTex.offset.y = (dist / ROAD_TILE) % 1;
    this.roadEmit.offset.y = this.roadTex.offset.y;
    this.groundTex.offset.y = (dist / GROUND_TILE) % 1;
    this.updatePosts(dist);
    for (const t of this.towers) {
      const span = this.towerSpan;
      t.position.z = ((((dist - t.userData.s) % span) + span) % span) - span + 60;
      // Keep the loop cinematic shot clear of light poles.
      t.visible = hideNearZ === null || Math.abs(t.position.z - hideNearZ) > 60;
    }
    const cp = car.root.position;
    this.key.position.set(cp.x + 6, cp.y + 10, 14);
    this.key.target.position.set(cp.x, cp.y, -2);
    this.headlight.position.set(cp.x, cp.y + 2.2, -1.5);
    this.headlight.target.position.set(cp.x, cp.y * 0.3, -55);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);

    const blink = (Math.sin(this.time * 3.2) > 0.6 ? 1 : 0.15);
    for (const b of this.beacons) b.material.opacity = blink;

    this.updateLaunch(dt, running);
  }

  updateLaunch(dt, running) {
    const L = this.launch;
    L.t += dt;
    const flash = this.sky.material.uniforms.uFlash;
    if (L.phase === 'idle') {
      flash.value *= 0.98;
      if (running && L.t > L.next) {
        L.phase = 'ignite';
        L.t = 0;
        this.plume.visible = true;
      }
    } else if (L.phase === 'ignite') {
      const k = Math.min(1, L.t / 3);
      this.plume.material.opacity = k;
      this.plume.scale.set(40 + 40 * k, 60 + 80 * k, 1);
      flash.value = k;
      if (L.t > 3) {
        L.phase = 'ascent';
        L.t = 0;
      }
    } else if (L.phase === 'ascent') {
      const y = 6 + 2.2 * L.t * L.t;
      this.rocket.position.y = y;
      this.rocket.rotation.z = -Math.min(0.5, L.t * L.t * 0.004);
      this.rocket.position.x = -34 - Math.max(0, L.t * L.t * 0.9 - 30);
      const f = 0.85 + Math.random() * 0.3;
      this.plume.scale.set(70 * f, 150 * f, 1);
      flash.value = Math.max(0, 1 - L.t / 12);
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.18;
        const s = this.trail[this.trailIdx++ % this.trail.length];
        s.visible = true;
        s.position.set(this.rocket.position.x, y - 15, this.rocket.position.z);
        s.scale.setScalar(50);
        s.material.opacity = 0.7;
      }
      if (L.t > 26) {
        L.phase = 'reset';
        L.t = 0;
        this.plume.visible = false;
      }
    } else if (L.phase === 'reset' && L.t > 18) {
      this.rocket.position.set(-34, 6, 0);
      this.rocket.rotation.z = 0;
      L.phase = 'idle';
      L.t = 0;
      L.next = 70 + Math.random() * 50;
    }
    for (const s of this.trail) {
      if (!s.visible) continue;
      s.material.opacity -= dt * 0.045;
      s.scale.multiplyScalar(1 + dt * 0.12);
      if (s.material.opacity <= 0) s.visible = false;
    }
  }
}
