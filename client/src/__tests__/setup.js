import '@testing-library/jest-dom';

// ── Blob.arrayBuffer polyfill (jsdom may omit it) ─────────────────────────────
// convertToWav in useVoiceRecorder calls blob.arrayBuffer(). Add it when absent.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return Promise.resolve(new ArrayBuffer(this.size));
  };
}

// ── MediaRecorder mock ────────────────────────────────────────────────────────
class MockMediaRecorder {
  constructor(stream, options = {}) {
    this.state = 'inactive';
    this.mimeType = options.mimeType || 'audio/webm';
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['mock audio'], { type: this.mimeType }) });
    }
    if (this.onstop) this.onstop();
  }
  static isTypeSupported(type) {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm';
  }
}
global.MediaRecorder = MockMediaRecorder;

// ── AudioContext / OfflineAudioContext mocks ──────────────────────────────────
class MockAudioBuffer {
  constructor({ numberOfChannels = 1, length = 1600, sampleRate = 16000 } = {}) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = new Float32Array(length);
  }
  getChannelData() {
    return this._data;
  }
}

class MockAudioContext {
  decodeAudioData() {
    return Promise.resolve(new MockAudioBuffer({ numberOfChannels: 1, length: 16000, sampleRate: 16000 }));
  }
  close() {
    return Promise.resolve();
  }
}

class MockOfflineAudioContext {
  constructor(numChannels, numFrames, sampleRate) {
    this._numFrames = numFrames;
    this._sampleRate = sampleRate;
  }
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn() };
  }
  get destination() {
    return {};
  }
  startRendering() {
    return Promise.resolve(new MockAudioBuffer({ numberOfChannels: 1, length: this._numFrames, sampleRate: this._sampleRate }));
  }
}

global.AudioContext = MockAudioContext;
global.OfflineAudioContext = MockOfflineAudioContext;

// ── URL / navigator mocks ────────────────────────────────────────────────────
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn(),
  },
});
