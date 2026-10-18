/**
 * AdSense integration.
 *
 * - Display units: any element with data-ad="<key>" gets a responsive unit when
 *   VITE_AD_SLOT_<KEY> is set (e.g. VITE_AD_SLOT_BELOWGAME). Without slot ids the
 *   page still earns through Auto ads, which only need the client id.
 * - Game ads: the AdSense H5 Games Ad Placement API (adBreak/adConfig). It is a
 *   no-op until the account is enabled for H5 games, and the game never waits on it.
 */
const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
export const adsEnabled = /^ca-pub-\d{10,20}$/.test(CLIENT);

window.adsbygoogle = window.adsbygoogle || [];
const push = (o) => {
  try {
    window.adsbygoogle.push(o);
  } catch (err) {
    console.warn('[ads]', err);
  }
};

export function initDisplayAds() {
  const slots = {
    belowgame: import.meta.env.VITE_AD_SLOT_BELOWGAME,
    incontent: import.meta.env.VITE_AD_SLOT_INCONTENT,
  };
  for (const el of document.querySelectorAll('[data-ad]')) {
    const slot = slots[el.dataset.ad.toLowerCase()];
    if (!adsEnabled || !slot) continue;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = CLIENT;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    el.appendChild(ins);
    el.classList.add('has-ad');
    push({});
  }
}

let configured = false;
export function configureGameAds({ onMute, onUnmute }) {
  if (!adsEnabled || configured) return;
  configured = true;
  push({
    preloadAdBreaks: 'on',
    sound: 'on',
    onReady: () => {},
  });
  hooks.mute = onMute;
  hooks.unmute = onUnmute;
}
const hooks = { mute: () => {}, unmute: () => {} };

/**
 * Interstitial between runs. `pause`/`resume` are called only if an ad really shows.
 */
export function interstitial(name, { pause, resume }) {
  if (!adsEnabled) return;
  push({
    type: 'next',
    name,
    beforeAd: () => {
      hooks.mute();
      pause();
    },
    afterAd: () => {
      hooks.unmute();
      resume();
    },
  });
}

/**
 * Offers a rewarded ad. `onAvailable(show)` fires only when an ad is ready;
 * call show() from a user click. `onReward` fires when the ad was watched.
 */
export function offerReward(name, { onAvailable, onReward, onDone }) {
  if (!adsEnabled) return;
  push({
    type: 'reward',
    name,
    beforeAd: () => hooks.mute(),
    afterAd: () => hooks.unmute(),
    beforeReward: (showAdFn) => onAvailable(showAdFn),
    adDismissed: () => {},
    adViewed: () => onReward(),
    adBreakDone: () => onDone?.(),
  });
}
