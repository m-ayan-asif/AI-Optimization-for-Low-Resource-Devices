export function getClientDeviceSpecs() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  return {
    device_cores: navigator.hardwareConcurrency || null,
    device_memory_gb: navigator.deviceMemory || null,
    effective_connection: connection?.effectiveType || '4g',
    client_rtt_ms: connection?.rtt || null,
    browser_user_agent: navigator.userAgent,
  };
}
