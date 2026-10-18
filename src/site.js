/**
 * Shared by every page: the "Privacy & cookie settings" footer link reopens
 * Google's consent message (AdSense Privacy & messaging) so visitors in the
 * EEA/UK can change or withdraw consent at any time. Outside those regions the
 * consent tool does not run and the click has no effect.
 */
for (const el of document.querySelectorAll('[data-consent-settings]')) {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const fc = (window.googlefc = window.googlefc || {});
    fc.callbackQueue = fc.callbackQueue || [];
    fc.callbackQueue.push(() => fc.showRevocationMessage?.());
  });
}
