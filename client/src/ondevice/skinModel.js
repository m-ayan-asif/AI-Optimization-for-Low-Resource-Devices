import * as ort from 'onnxruntime-web/wasm';
import {
  rgbaToRgb,
  resizeBilinearRGB,
  toNormalizedCHW,
  skinRatio,
  blurScore,
  summarizeLogits,
  heatmapOverlayRGBA,
} from './preprocess';
import { SKIN_MODEL_DIR, ORT_WASM_PATH } from './config';
import { cachedFetch } from './modelCache';

// Decoding cap: the guards and the 320 px model input are insensitive to decode resolution (the clean test set scores
// 74.75 / 74.71 / 74.67% at 600 px / 1024 px / full decode), so a phone never needs a 12 MP canvas.
const MAX_DECODE_SIDE = 2048;

let sessionPromise = null;

export class ScreeningError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function loadSession() {
  ort.env.wasm.wasmPaths = ORT_WASM_PATH;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const [meta, modelBytes] = await Promise.all([
    cachedFetch(`${SKIN_MODEL_DIR}/meta.json`).then((r) => r.json()),
    cachedFetch(`${SKIN_MODEL_DIR}/student.onnx`).then((r) => r.arrayBuffer()),
  ]);
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
  return { session, meta };
}

export function loadSkinModel() {
  if (!sessionPromise) {
    sessionPromise = loadSession().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function decodeToRgb(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { rgb: rgbaToRgb(ctx.getImageData(0, 0, w, h).data), w, h };
}

async function rgbaToPngBlob(rgba, size) {
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * The /predict pipeline on the device: skin + blur guards, the ONNX student (logits + Grad-CAM), the out-of-scope
 * check and the heatmap overlay. Throws ScreeningError with the server's error codes when a guard rejects the photo.
 */
export async function analyzeImage(file) {
  const t0 = performance.now();
  const { session, meta } = await loadSkinModel();
  const { guards, img_size: size } = meta;

  const { rgb, w, h } = await decodeToRgb(file);
  if (skinRatio(rgb) < guards.min_skin_ratio) {
    throw new ScreeningError('NO_SKIN_DETECTED', 'No skin detected. Please upload a clear photo of the affected skin area.');
  }
  const blur = blurScore(rgb, w, h, guards.blur_max_side);
  if (blur < guards.blur_reject_threshold) {
    throw new ScreeningError('IMAGE_TOO_BLURRY', 'The image is too blurry for an accurate screening.');
  }
  const resized = resizeBilinearRGB(rgb, w, h, size, size);
  const input = new ort.Tensor('float32', toNormalizedCHW(resized, size, size, meta.mean, meta.std), [1, 3, size, size]);
  const t1 = performance.now();

  const out = await session.run({ input });
  const t2 = performance.now();
  const summary = summarizeLogits(Array.from(out.logits.data), meta);
  const [, camH, camW] = out.cam.dims;
  const heatmap = await rgbaToPngBlob(heatmapOverlayRGBA(resized, size, out.cam.data, camW, camH), size);
  const t3 = performance.now();

  const ms = (a, b) => Math.round(b - a);
  return {
    prediction: {
      model_version: meta.model_version,
      top_condition: summary.top_condition,
      confidence_score: summary.confidence_score,
      status: summary.status,
      all_scores: summary.all_scores,
      inference_time_ms: Math.max(1, ms(t0, t3)),
      telemetry: {
        image_preprocess_ms: ms(t0, t1),
        model_inference_ms: ms(t1, t2),
        gradcam_generation_ms: ms(t2, t3),
        device_type: 'browser-wasm',
        blur_score: Math.round(blur * 10) / 10,
        entropy: Math.round(summary.entropy * 1000) / 1000,
        confidence_margin: Math.round(summary.margin * 1000) / 1000,
      },
    },
    heatmap,
  };
}
