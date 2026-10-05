// Runs our Urdu whisper-small fine-tune (int8 ONNX, ~330 MB) off the main thread with transformers.js.
// Model files come from our own origin (no Hugging Face Hub calls) and stay in the browser cache for offline use.
// Backend: WebAssembly. The int8 (q8) graph is not suited to the WebGPU backend - in testing it hung and crashed the
// tab even on a desktop RTX GPU - and WebGPU support on phones is patchy anyway.
import { pipeline, env } from '@huggingface/transformers';
import { WHISPER_MODEL_ROOT, WHISPER_MODEL_ID, ORT_WASM_PATH } from './config';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = WHISPER_MODEL_ROOT;
env.useBrowserCache = true;
// transformers.js keeps the files in Cache Storage; skip the HTTP disk cache, which would hold a second 330 MB copy
// and fails outright (ERR_CACHE_WRITE_FAILURE) when it is small, as on phones low on space.
env.fetch = (url, init) => fetch(url, { ...init, cache: 'no-store' });
env.backends.onnx.wasm.wasmPaths = ORT_WASM_PATH;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let asrPromise = null;

function load() {
  if (!asrPromise) {
    const progress_callback = (p) => {
      if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
    };
    asrPromise = pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback,
    }).catch((err) => {
      asrPromise = null;
      throw err;
    });
  }
  return asrPromise;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      await load();
      self.postMessage({ id, type: 'loaded', device: 'wasm' });
    } else if (type === 'transcribe') {
      const asr = await load();
      const t0 = performance.now();
      // The server also transcribes everything as Urdu (server.py /transcribe): this model is an Urdu fine-tune.
      const out = await asr(data.audio, { language: 'urdu', task: 'transcribe', chunk_length_s: 30 });
      self.postMessage({ id, type: 'result', text: (out.text || '').trim(), ms: Math.round(performance.now() - t0), device: 'wasm' });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
};
