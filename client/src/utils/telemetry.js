export function getClientDeviceSpecs() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  // Active JS heap allocation in MB (Chromium browsers)
  let client_ram_used_mb = null;
  if (window.performance && window.performance.memory) {
    client_ram_used_mb = parseFloat(
      (window.performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)
    );
  }

  return {
    device_cores: navigator.hardwareConcurrency || null,
    device_memory_gb: navigator.deviceMemory || null,
    client_ram_used_mb: client_ram_used_mb,
    effective_connection: connection?.effectiveType || '4g',
    client_rtt_ms: connection?.rtt || null,
    browser_user_agent: navigator.userAgent,
  };
}
