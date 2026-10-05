// Where a screening runs. "auto" = on the device for phones / installed PWAs (the low-connectivity case this project
// targets), on the server for desktop browsers. The choice is a per-device preference, so localStorage is fine.
const KEY = 'ss_processing';
export const MODES = ['auto', 'device', 'server'];

export function onDeviceSupported() {
  return (
    typeof WebAssembly === 'object' &&
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof createImageBitmap === 'function' &&
    typeof indexedDB === 'object'
  );
}

function looksLikePhone() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return Boolean(navigator.userAgentData?.mobile || standalone || coarse);
}

export function getModePreference() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setModePreference(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // private mode: the choice just isn't remembered
  }
}

/** True when this screening should run on the device. */
export function shouldRunOnDevice(pref = getModePreference()) {
  if (!onDeviceSupported()) return false;
  if (pref === 'device') return true;
  if (pref === 'server') return false;
  return looksLikePhone() || !navigator.onLine;
}
