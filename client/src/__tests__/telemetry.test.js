import { describe, it, expect, afterEach, vi } from 'vitest';
import { getClientDeviceSpecs } from '../utils/telemetry';

function setNavigator(props) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(window.navigator, key, { value, configurable: true });
  }
}

function clearNavigator(...keys) {
  for (const key of keys) {
    // Removing the own property restores the prototype getter (or "missing").
    delete window.navigator[key];
  }
}

afterEach(() => {
  clearNavigator('hardwareConcurrency', 'deviceMemory', 'connection', 'mozConnection', 'webkitConnection');
  vi.unstubAllGlobals();
  delete window.performance.memory;
});

describe('getClientDeviceSpecs', () => {
  it('reads cores, memory, connection and JS heap when available', () => {
    setNavigator({
      hardwareConcurrency: 8,
      deviceMemory: 4,
      connection: { effectiveType: '3g', rtt: 300 },
    });
    Object.defineProperty(window.performance, 'memory', {
      value: { usedJSHeapSize: 20 * 1024 * 1024 },
      configurable: true,
    });

    const specs = getClientDeviceSpecs();
    expect(specs.device_cores).toBe(8);
    expect(specs.device_memory_gb).toBe(4);
    expect(specs.client_ram_used_mb).toBe(20);
    expect(specs.effective_connection).toBe('3g');
    expect(specs.client_rtt_ms).toBe(300);
  });

  it('returns null (not a fabricated value) when the Network Information API is missing', () => {
    setNavigator({ connection: undefined, mozConnection: undefined, webkitConnection: undefined });
    const specs = getClientDeviceSpecs();
    expect(specs.effective_connection).toBeNull();
    expect(specs.client_rtt_ms).toBeNull();
  });

  it('returns null memory fields on browsers without deviceMemory / performance.memory', () => {
    setNavigator({ deviceMemory: undefined });
    delete window.performance.memory;
    const specs = getClientDeviceSpecs();
    expect(specs.device_memory_gb).toBeNull();
    expect(specs.client_ram_used_mb).toBeNull();
  });

  it('keeps a legitimate rtt of 0 instead of turning it into null', () => {
    setNavigator({ connection: { effectiveType: '4g', rtt: 0 } });
    expect(getClientDeviceSpecs().client_rtt_ms).toBe(0);
  });

  it('rounds the JS heap to 2 decimals', () => {
    Object.defineProperty(window.performance, 'memory', {
      value: { usedJSHeapSize: 14.123456 * 1024 * 1024 },
      configurable: true,
    });
    expect(getClientDeviceSpecs().client_ram_used_mb).toBe(14.12);
  });

  it('ignores a non-numeric heap value', () => {
    Object.defineProperty(window.performance, 'memory', {
      value: { usedJSHeapSize: 'n/a' },
      configurable: true,
    });
    expect(getClientDeviceSpecs().client_ram_used_mb).toBeNull();
  });

  it('includes the user agent string', () => {
    expect(typeof getClientDeviceSpecs().browser_user_agent).toBe('string');
  });
});
