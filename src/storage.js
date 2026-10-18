const KEY = 'roadster-rocket:v1';

const DEFAULTS = {
  best: 0,
  coins: 0,
  owned: ['ano'],
  paint: 'ano',
  sound: true,
  music: true,
  runs: 0,
  flipsTaught: false,
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw, owned: Array.isArray(raw.owned) ? raw.owned : [...DEFAULTS.owned] };
  } catch {
    return { ...DEFAULTS, owned: [...DEFAULTS.owned] };
  }
}

export const save = load();

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode or storage blocked: progress just won't persist */
  }
}
