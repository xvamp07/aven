/* Diagnostics: facts about this phone and browser, read live (never assumed). */

export function displayMode() {
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return standalone ? 'standalone' : 'browser';
}

export async function storageInfo() {
  const info = { api: Boolean(navigator.storage), persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      info.persisted = await navigator.storage.persisted();
    }
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const estimate = await navigator.storage.estimate();
      info.usage = estimate.usage ?? null;
      info.quota = estimate.quota ?? null;
    }
  } catch (_) { /* leave the unknowns as null */ }
  return info;
}

export async function requestPersistence() {
  if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
    return { supported: false, granted: false };
  }
  try {
    return { supported: true, granted: await navigator.storage.persist() };
  } catch (_) {
    return { supported: true, granted: false };
  }
}

/* Reads the notch / home-indicator padding the phone reports. */
export function safeAreaInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'visibility:hidden', 'pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/* Can this browser hand a file to the share sheet (Save to Files)? */
export function shareSupport() {
  const result = { share: typeof navigator.share === 'function', json: false, text: false };
  if (result.share && typeof navigator.canShare === 'function') {
    try {
      result.json = navigator.canShare({ files: [new File(['{}'], 'test.json', { type: 'application/json' })] });
      result.text = navigator.canShare({ files: [new File(['{}'], 'test.json', { type: 'text/plain' })] });
    } catch (_) { /* leave false */ }
  }
  return result;
}

export function systemSummary() {
  const ua = navigator.userAgent || '';
  const ios = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/);
  const isApple = /iPhone|iPad|iPod/.test(ua);
  const label = isApple && ios
    ? `${/iPad/.test(ua) ? 'iPad' : 'iPhone'}, iOS ${ios[1]}.${ios[2]}${ios[3] ? '.' + ios[3] : ''}`
    : ua.slice(0, 80);
  return {
    label,
    screen: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}x`,
    clipboard: Boolean(navigator.clipboard && navigator.clipboard.writeText),
    wakeLock: 'wakeLock' in navigator,
    indexedDB: 'indexedDB' in window,
    serviceWorker: 'serviceWorker' in navigator,
  };
}

/* Asks a service worker something and waits for its answer. */
export function askWorker(worker, type) {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2500);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch (_) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export async function serviceWorkerInfo(registration) {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = registration || await navigator.serviceWorker.getRegistration();
  if (!reg) return { supported: true, registered: false };
  const active = reg.active;
  return {
    supported: true,
    registered: true,
    installing: Boolean(reg.installing),
    waiting: Boolean(reg.waiting),
    activeState: active ? active.state : null,
    controlled: Boolean(navigator.serviceWorker.controller),
    status: active ? await askWorker(active, 'GET_STATUS') : null,
  };
}
