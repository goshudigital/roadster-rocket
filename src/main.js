import './style.css';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { initDisplayAds } from './ads.js';
import { Sound } from './audio.js';
import { Engine } from './engine.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());
initDisplayAds();

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = ['/models/roadster.glb', '/models/vehicles.glb'];
  const done = files.map(() => 0);
  const report = () => onProgress(done.reduce((a, b) => a + b, 0) / files.length);
  const [car, vehicles] = await Promise.all(
    files.map((url, i) =>
      loader.loadAsync(url, (e) => {
        if (e.total) done[i] = e.loaded / e.total;
        report();
      }),
    ),
  );
  return { car: car.scene, vehicles: vehicles.scene };
}

async function boot() {
  const ui = new UI();
  if (!webglAvailable()) {
    ui.loading(0, 'Your browser does not support WebGL 2, which this game needs. Try the latest Chrome, Safari, Edge or Firefox.');
    return;
  }
  const canvas = document.getElementById('game');
  const wrap = document.getElementById('game-wrap');
  const engine = new Engine(canvas, wrap);
  const sound = new Sound();
  const input = new Input(document.getElementById('touch'));

  const assets = await loadModels((f) => ui.loading(0.1 + f * 0.8));
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  ui.loading(0.95, 'Arming thrusters…');

  const game = new Game(engine, assets, sound, input);
  if (import.meta.env.DEV) {
    // Test hooks: drive the simulation manually (rAF pauses in hidden tabs).
    window.__game = game;
    window.__step = (seconds, keys = []) => {
      for (const k of keys) input.keys.add(k);
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) game.update(1 / 60);
      for (const k of keys) input.keys.delete(k);
      engine.render();
      const c = game.run;
      return JSON.stringify({ state: game.state, x: +c.x.toFixed(2), y: +c.y.toFixed(2), mph: Math.round(c.speed * 2.237), dist: Math.round(game.dist), air: Math.round(c.air), score: game.score(), loop: !!c.loop, gems: c.gems, reason: c.reason });
    };
  }
  // Compile shaders up front so the first frames don't hitch.
  engine.renderer.compile(engine.scene, engine.camera);
  ui.loading(1);
  game.ui.show('title');

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!game.manual) {
      game.update(dt);
      engine.render();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'Something went wrong while loading. Please refresh the page.';
});
