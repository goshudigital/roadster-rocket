import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Renderer, camera, bloom and automatic quality scaling. */
export class Engine {
  constructor(canvas, wrap) {
    this.wrap = wrap;
    this.mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.maxDpr = this.mobile ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4200);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // Reflections only for vehicles: a global environment would light the night road like a studio.
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.mobile ? 0 : 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.65, 0.4, 1.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.useComposer = true;

    this.quality = 2; // 2 = full, 1 = reduced resolution, 0 = no bloom
    this.samples = [];
    this.cooldown = 4;

    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(wrap);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.wrap.clientWidth);
    const h = Math.max(1, this.wrap.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.useComposer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Watches frame time and steps quality down if the device struggles. */
  monitor(dtReal, active) {
    if (!active) return;
    this.cooldown -= dtReal;
    this.samples.push(dtReal);
    if (this.samples.length < 90) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples.length = 0;
    if (this.cooldown > 0 || avg < 1 / 45 || this.quality === 0) return;
    this.cooldown = 3;
    if (this.quality === 2) {
      this.quality = 1;
      this.dpr = Math.max(1, Math.min(this.dpr, 1.25) * 0.85);
      this.resize();
    } else if (this.quality === 1) {
      this.quality = 0;
      this.useComposer = false;
      this.dpr = 1;
      this.resize();
    }
  }
}
