// Main-thread client for the Whisper worker.
let worker = null;
let nextId = 1;
const pending = new Map();
const progressListeners = new Set();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./asr.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        progressListeners.forEach((fn) => fn(data));
        return;
      }
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
  }
  return worker;
}

function call(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}

export function onAsrProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export const loadAsr = () => call({ type: 'load' });

/** @param {Float32Array} audio 16 kHz mono PCM */
export async function transcribeOnDevice(audio) {
  const copy = audio.slice();
  const res = await call({ type: 'transcribe', audio: copy }, [copy.buffer]);
  return { text: res.text, ms: res.ms, device: res.device };
}
