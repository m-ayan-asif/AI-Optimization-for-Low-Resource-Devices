// Pure image / prediction helpers for on-device screening. They reproduce what the inference service does in Python
// (torchvision Resize = Pillow bilinear, OpenCV colour conversions, quality.py guards) so a phone gets the same
// verdict as the server for the same photo. No DOM access here, so everything is unit-tested in Node against
// fixtures generated with Pillow / OpenCV (see src/__tests__/ondevice.test.js).

// ── Pillow-exact bilinear resize (ImagingResample, 8-bit fixed point) ────────────────────────────────────────────
const PRECISION_BITS = 32 - 8 - 2;
const HALF = 1 << (PRECISION_BITS - 1);
const ONE = 1 << PRECISION_BITS;

function bilinearFilter(x) {
  const a = Math.abs(x);
  return a < 1 ? 1 - a : 0;
}

function precomputeCoeffs(inSize, outSize) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 1 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const ss = 1 / filterscale;
  const w = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      w[x] = bilinearFilter((x + xmin - center + 0.5) * ss);
      ww += w[x];
    }
    for (let x = 0; x < ksize; x++) {
      const v = x < xmax && ww !== 0 ? w[x] / ww : 0;
      // normalize_coeffs_8bpc: round half away from zero into fixed point
      kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v * ONE) : Math.trunc(0.5 + v * ONE);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

function clip8(v) {
  if (v >= ONE * 256) return 255;
  if (v <= 0) return 0;
  return v >> PRECISION_BITS;
}

/** Resize interleaved RGB (Uint8Array, w*h*3) like Pillow's Image.resize((outW, outH), BILINEAR). */
export function resizeBilinearRGB(src, inW, inH, outW, outH) {
  let cur = src;
  let curW = inW;
  // Horizontal pass first (Pillow order); intermediate values are rounded to 8 bit, as in Pillow.
  if (outW !== inW) {
    const { bounds, kk, ksize } = precomputeCoeffs(inW, outW);
    const tmp = new Uint8Array(outW * inH * 3);
    for (let y = 0; y < inH; y++) {
      const row = y * inW * 3;
      for (let xx = 0; xx < outW; xx++) {
        const xmin = bounds[xx * 2];
        const xmax = bounds[xx * 2 + 1];
        const k = xx * ksize;
        let r = HALF, g = HALF, b = HALF;
        for (let x = 0; x < xmax; x++) {
          const p = row + (x + xmin) * 3;
          const c = kk[k + x];
          r += cur[p] * c; g += cur[p + 1] * c; b += cur[p + 2] * c;
        }
        const o = (y * outW + xx) * 3;
        tmp[o] = clip8(r); tmp[o + 1] = clip8(g); tmp[o + 2] = clip8(b);
      }
    }
    cur = tmp;
    curW = outW;
  }
  if (outH !== inH) {
    const { bounds, kk, ksize } = precomputeCoeffs(inH, outH);
    const out = new Uint8Array(curW * outH * 3);
    for (let yy = 0; yy < outH; yy++) {
      const ymin = bounds[yy * 2];
      const ymax = bounds[yy * 2 + 1];
      const k = yy * ksize;
      for (let x = 0; x < curW; x++) {
        let r = HALF, g = HALF, b = HALF;
        for (let y = 0; y < ymax; y++) {
          const p = ((y + ymin) * curW + x) * 3;
          const c = kk[k + y];
          r += cur[p] * c; g += cur[p + 1] * c; b += cur[p + 2] * c;
        }
        const o = (yy * curW + x) * 3;
        out[o] = clip8(r); out[o + 1] = clip8(g); out[o + 2] = clip8(b);
      }
    }
    cur = out;
  }
  return cur === src ? src.slice() : cur;
}

/** RGBA (canvas ImageData.data) -> packed RGB. */
export function rgbaToRgb(rgba) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = rgba[i * 4];
    out[i * 3 + 1] = rgba[i * 4 + 1];
    out[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return out;
}

/** Packed RGB (HWC uint8) -> normalised CHW float32, i.e. ToTensor() + Normalize(mean, std). */
export function toNormalizedCHW(rgb, w, h, mean, std) {
  const plane = w * h;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      out[c * plane + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c];
    }
  }
  return out;
}

// ── Skin-tone guard: OpenCV-exact 8-bit RGB->HSV and RGB->YCrCb (quality.skin_ratio) ──────────────────────────────
const HSV_SHIFT = 12;
const SDIV = new Int32Array(256);
const HDIV180 = new Int32Array(256);
for (let i = 1; i < 256; i++) {
  SDIV[i] = Math.round((255 << HSV_SHIFT) / i);
  HDIV180[i] = Math.round((180 << HSV_SHIFT) / (6 * i));
}
const YUV_SHIFT = 14;
const R2Y = 4899, G2Y = 9617, B2Y = 1868, CR = 11682, CB = 9241;
const YUV_DELTA = 128 << YUV_SHIFT;
const YUV_ROUND = 1 << (YUV_SHIFT - 1);

function sat8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function rgbToHsv8(r, g, b) {
  let v = b, vmin = b;
  if (g > v) v = g;
  if (r > v) v = r;
  if (g < vmin) vmin = g;
  if (r < vmin) vmin = r;
  const diff = v - vmin;
  const vr = v === r ? -1 : 0;
  const vg = v === g ? -1 : 0;
  const s = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
  let h = (vr & (g - b)) + (~vr & ((vg & (b - r + 2 * diff)) + (~vg & (r - g + 4 * diff))));
  h = (h * HDIV180[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
  if (h < 0) h += 180;
  return [h, s, v];
}

export function rgbToYCrCb8(r, g, b) {
  const y = (r * R2Y + g * G2Y + b * B2Y + YUV_ROUND) >> YUV_SHIFT;
  const cr = ((r - y) * CR + YUV_DELTA + YUV_ROUND) >> YUV_SHIFT;
  const cb = ((b - y) * CB + YUV_DELTA + YUV_ROUND) >> YUV_SHIFT;
  return [sat8(y), sat8(cr), sat8(cb)];
}

/** Fraction of pixels inside both the HSV and the YCrCb skin ranges (Fitzpatrick IV-VI included). */
export function skinRatio(rgb) {
  const n = rgb.length / 3;
  if (n === 0) return 0;
  let skin = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const [h, s] = rgbToHsv8(r, g, b);
    // hue 0-25 or 160-180: red wraps around the hue circle (pink / inflamed skin), as in quality.skin_ratio
    if ((h > 25 && h < 160) || s < 15) continue;
    const [, cr, cb] = rgbToYCrCb8(r, g, b);
    if (cr >= 133 && cr <= 173 && cb >= 77 && cb <= 127) skin++;
  }
  return skin / n;
}

// ── Blur guard: variance of the Laplacian at <= maxSide px (quality.check_image_blur) ─────────────────────────────
// cv2.COLOR_BGR2GRAY on 8-bit input uses 15-bit coefficients (YCrCb above uses 14-bit ones)
const GRAY_SHIFT = 15, R2G = 9798, G2G = 19235, B2G = 3735;

function grayOf(rgb, n) {
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = (rgb[i * 3] * R2G + rgb[i * 3 + 1] * G2G + rgb[i * 3 + 2] * B2G + (1 << (GRAY_SHIFT - 1))) >> GRAY_SHIFT;
  }
  return g;
}

// Area-average downscale (cv2.INTER_AREA): every output pixel is the coverage-weighted mean of the source pixels.
function areaResize(src, w, h, ow, oh) {
  const sx = w / ow, sy = h / oh;
  const tmp = new Float64Array(ow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < ow; x++) {
      const x0 = x * sx, x1 = x0 + sx;
      let acc = 0;
      for (let i = Math.floor(x0); i < Math.min(Math.ceil(x1), w); i++) {
        acc += src[y * w + i] * (Math.min(i + 1, x1) - Math.max(i, x0));
      }
      tmp[y * ow + x] = acc / sx;
    }
  }
  const out = new Float64Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const y0 = y * sy, y1 = y0 + sy;
    for (let x = 0; x < ow; x++) {
      let acc = 0;
      for (let j = Math.floor(y0); j < Math.min(Math.ceil(y1), h); j++) {
        acc += tmp[j * ow + x] * (Math.min(j + 1, y1) - Math.max(j, y0));
      }
      out[y * ow + x] = Math.round(acc / sy);
    }
  }
  return out;
}

export function blurScore(rgb, w, h, maxSide = 512) {
  let gray = grayOf(rgb, w * h);
  const longest = Math.max(w, h);
  if (longest > maxSide) {
    const scale = maxSide / longest;
    const ow = Math.max(1, Math.trunc(w * scale));
    const oh = Math.max(1, Math.trunc(h * scale));
    gray = areaResize(gray, w, h, ow, oh);
    w = ow;
    h = oh;
  }
  // 3x3 Laplacian (ksize=1) with BORDER_REFLECT_101
  const at = (x, y) => {
    if (x < 0) x = w > 1 ? -x : 0; else if (x >= w) x = w > 1 ? 2 * w - x - 2 : 0;
    if (y < 0) y = h > 1 ? -y : 0; else if (y >= h) y = h > 1 ? 2 * h - y - 2 : 0;
    return gray[y * w + x];
  };
  let sum = 0, sumSq = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * gray[y * w + x];
      sum += v;
      sumSq += v * v;
    }
  }
  const n = w * h;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ── Prediction quality (quality.assess_prediction) ───────────────────────────────────────────────────────────────
export function softmax(logits) {
  const m = Math.max(...logits);
  const e = logits.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function logSumExp(logits) {
  const m = Math.max(...logits);
  return m + Math.log(logits.reduce((a, v) => a + Math.exp(v - m), 0));
}

export function entropy(probs) {
  return probs.reduce((acc, p) => (p > 1e-6 ? acc - p * Math.log(p) : acc), 0);
}

export function assessPrediction(confidence, margin, ent, energy, g) {
  if (confidence <= g.low_confidence_threshold) return 'out_of_scope';
  if (ent > g.ood_entropy_threshold && margin < g.ood_margin_threshold) return 'out_of_scope';
  if (energy != null && energy < g.ood_energy_threshold) return 'out_of_scope';
  return 'classified';
}

/** Probability of the trained "not a skin lesion" class (8-output models), or null for 7-output models. */
export function notLesionProbability(logits, meta) {
  const i = meta.not_lesion_index;
  return i == null || logits.length <= i ? null : softmax(logits)[i];
}

/** Server-shaped prediction from raw logits (same fields /predict returns), over the disease logits only. */
export function summarizeLogits(allLogits, meta) {
  const logits = allLogits.slice(0, meta.class_names.length);
  const probs = softmax(logits);
  const order = probs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const [top, topIdx] = order[0];
  const margin = top - order[1][0];
  const ent = entropy(probs);
  const energy = logSumExp(logits);
  const status = assessPrediction(top, margin, ent, energy, meta.guards);
  const allScores = {};
  meta.class_names.forEach((name, i) => {
    allScores[name] = Math.round(probs[i] * 1e4) / 1e4;
  });
  return {
    top_condition: status === 'classified' ? meta.class_names[topIdx] : 'No Disease / Inconclusive',
    confidence_score: Math.round(top * 1e4) / 1e4,
    status,
    all_scores: allScores,
    topIdx,
    entropy: ent,
    energy,
    margin,
  };
}

// ── Grad-CAM overlay (server.create_heatmap_overlay) ─────────────────────────────────────────────────────────────
function jet(v) {
  const c = (x) => Math.max(0, Math.min(1, x));
  return [c(1.5 - Math.abs(4 * v - 3)), c(1.5 - Math.abs(4 * v - 2)), c(1.5 - Math.abs(4 * v - 1))];
}

/**
 * Blend a (camH x camW) map in [0,1] over the resized RGB image: bilinear upsample (cv2.INTER_LINEAR), JET colour
 * map, 0.4 alpha. Returns RGBA ready for a canvas ImageData.
 */
export function heatmapOverlayRGBA(rgb, size, cam, camW, camH, alpha = 0.4) {
  const out = new Uint8ClampedArray(size * size * 4);
  const sx = camW / size, sy = camH / size;
  for (let y = 0; y < size; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    fy = Math.max(0, Math.min(camH - 1, fy));
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, camH - 1), dy = fy - y0;
    for (let x = 0; x < size; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      fx = Math.max(0, Math.min(camW - 1, fx));
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, camW - 1), dx = fx - x0;
      const v = (cam[y0 * camW + x0] * (1 - dx) + cam[y0 * camW + x1] * dx) * (1 - dy) +
        (cam[y1 * camW + x0] * (1 - dx) + cam[y1 * camW + x1] * dx) * dy;
      const [hr, hg, hb] = jet(Math.round(255 * Math.max(0, Math.min(1, v))) / 255);
      const i = y * size + x;
      out[i * 4] = alpha * hr * 255 + (1 - alpha) * rgb[i * 3];
      out[i * 4 + 1] = alpha * hg * 255 + (1 - alpha) * rgb[i * 3 + 1];
      out[i * 4 + 2] = alpha * hb * 255 + (1 - alpha) * rgb[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}
