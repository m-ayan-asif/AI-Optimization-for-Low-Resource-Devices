/**
 * Collects coarse, non-identifying client capability metrics for the
 * device-monitoring dashboard.
 *
 * Every field is best-effort: several of these APIs exist only in Chromium
 * browsers (Chrome, Edge, Android WebView) and are missing in Safari/Firefox.
 * A missing API yields `null` (stored as NULL and excluded from averages),
 * never a made-up default.
 *
 *  - device_memory_gb   navigator.deviceMemory: RAM rounded to a power of two
 *                       and capped at 8 GB, so "8" means "8 or more".
 *  - client_ram_used_mb JS heap currently used by THIS page
 *                       (performance.memory.usedJSHeapSize). It is the app's
 *                       footprint, not the device's total or free memory.
 *  - effective_connection / client_rtt_ms  Network Information API estimate.
 */
export function getClientDeviceSpecs() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  let client_ram_used_mb = null;
  const heap = window.performance?.memory?.usedJSHeapSize;
  if (typeof heap === 'number' && Number.isFinite(heap)) {
    client_ram_used_mb = parseFloat((heap / (1024 * 1024)).toFixed(2));
  }

  return {
    device_cores: navigator.hardwareConcurrency ?? null,
    device_memory_gb: navigator.deviceMemory ?? null,
    client_ram_used_mb,
    effective_connection: connection?.effectiveType ?? null,
    client_rtt_ms: connection?.rtt ?? null,
    browser_user_agent: navigator.userAgent ?? null,
  };
}
