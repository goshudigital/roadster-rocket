const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const THRUST = ['Space', 'ArrowUp', 'KeyW'];
const FLIP = ['KeyF', 'ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'];
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...THRUST, ...FLIP, 'KeyP', 'Escape']);

/** Keyboard + on-screen touch buttons, merged into one control state. */
export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.touch = { left: false, right: false, thrust: false };
    this.capture = false; // when true, game keys don't scroll the page
    this.onPress = null; // (code) => void, fired once per key press
    this.flipQueued = false;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (FLIP.includes(e.code)) this.flipQueued = true;
      this.onPress?.(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => document.hidden && this.reset());

    for (const btn of touchRoot.querySelectorAll('button[data-act]')) {
      const act = btn.dataset.act;
      const down = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('on');
        if (act === 'flip') this.flipQueued = true;
        else this.touch[act] = true;
      };
      const up = (e) => {
        e.preventDefault();
        btn.classList.remove('on');
        if (act !== 'flip') this.touch[act] = false;
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  has(list) {
    return list.some((k) => this.keys.has(k));
  }

  get steer() {
    const l = this.has(LEFT) || this.touch.left;
    const r = this.has(RIGHT) || this.touch.right;
    return (r ? 1 : 0) - (l ? 1 : 0);
  }

  get thrust() {
    return this.has(THRUST) || this.touch.thrust;
  }

  /** Returns true once per flip press. */
  takeFlip() {
    const f = this.flipQueued;
    this.flipQueued = false;
    return f;
  }

  reset() {
    this.keys.clear();
    this.touch.left = this.touch.right = this.touch.thrust = false;
    this.flipQueued = false;
  }
}
