/* global Buffer */
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/ondevice.json';
import {
  resizeBilinearRGB,
  rgbToHsv8,
  rgbToYCrCb8,
  skinRatio,
  blurScore,
  summarizeLogits,
  toNormalizedCHW,
  heatmapOverlayRGBA,
} from '../ondevice/preprocess';

// Reference values come from Pillow / OpenCV / inference/quality.py (client/scripts/make_ondevice_fixtures.py), so
// these tests pin the phone's preprocessing to what the server does with the same photo.
const bytes = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));
const img = bytes(fixture.image.rgb);
const { w: W, h: H } = fixture.image;

describe('resizeBilinearRGB (Pillow BILINEAR)', () => {
  it.each(fixture.resizes.map((r) => [r.w, r.h, r]))('matches Pillow exactly at %ix%i', (ow, oh, r) => {
    const out = resizeBilinearRGB(img, W, H, ow, oh);
    const ref = bytes(r.rgb);
    expect(out.length).toBe(ref.length);
    let mismatches = 0;
    for (let i = 0; i < ref.length; i++) if (out[i] !== ref[i]) mismatches++;
    expect(mismatches).toBe(0);
  });

  it('returns a copy when the size is unchanged', () => {
    const out = resizeBilinearRGB(img, W, H, W, H);
    expect(out).not.toBe(img);
    expect(out).toEqual(img);
  });
});

describe('OpenCV colour conversions', () => {
  const px = bytes(fixture.pixels.rgb);
  const hsv = bytes(fixture.pixels.hsv);
  const ycc = bytes(fixture.pixels.ycrcb);

  it('RGB -> HSV matches cv2 for every sampled pixel', () => {
    for (let i = 0; i < px.length / 3; i++) {
      expect(rgbToHsv8(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])).toEqual([hsv[i * 3], hsv[i * 3 + 1], hsv[i * 3 + 2]]);
    }
  });

  it('RGB -> YCrCb matches cv2 for every sampled pixel', () => {
    for (let i = 0; i < px.length / 3; i++) {
      expect(rgbToYCrCb8(px[i * 3], px[i * 3 + 1], px[i * 3 + 2])).toEqual([ycc[i * 3], ycc[i * 3 + 1], ycc[i * 3 + 2]]);
    }
  });
});

describe('guards', () => {
  it('skinRatio equals quality.skin_ratio', () => {
    expect(skinRatio(img)).toBeCloseTo(fixture.skin_ratio, 10);
  });

  it('skinRatio of an empty image is 0', () => {
    expect(skinRatio(new Uint8Array(0))).toBe(0);
  });

  it('blurScore equals quality.check_image_blur without downscaling', () => {
    expect(blurScore(img, W, H, 512)).toBeCloseTo(fixture.blur.full, 6);
  });

  it('blurScore stays within 5% of OpenCV when INTER_AREA downscaling applies', () => {
    const v = blurScore(img, W, H, 100);
    expect(Math.abs(v - fixture.blur.max_side_100) / fixture.blur.max_side_100).toBeLessThan(0.05);
  });

  it.each(fixture.logit_cases.map((c, i) => [i, c]))('summarizeLogits case %i matches quality.assess_prediction', (_, c) => {
    const meta = { guards: fixture.guards, class_names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    const s = summarizeLogits(c.logits, meta);
    expect(s.entropy).toBeCloseTo(c.entropy, 9);
    expect(s.energy).toBeCloseTo(c.energy, 9);
    expect(s.status).toBe(c.status);
    const total = Object.values(s.all_scores).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 3);
    if (s.status !== 'classified') expect(s.top_condition).toBe('No Disease / Inconclusive');
  });
});

describe('tensor + heatmap helpers', () => {
  it('toNormalizedCHW lays out channels first and normalises', () => {
    const rgb = Uint8Array.from([255, 0, 128, 0, 255, 64]);
    const t = toNormalizedCHW(rgb, 2, 1, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(Array.from(t).map((v) => Math.round(v * 100) / 100)).toEqual([1, -1, -1, 1, 0, -0.5]);
  });

  it('heatmapOverlayRGBA is opaque and keeps 60% of the image where the CAM is zero', () => {
    const size = 4;
    const rgb = new Uint8Array(size * size * 3).fill(200);
    const out = heatmapOverlayRGBA(rgb, size, new Float32Array(4), 2, 2);
    expect(out.length).toBe(size * size * 4);
    expect(out[3]).toBe(255);
    // CAM 0 -> JET dark blue (0, 0, 0.5): R = 0.6 * 200 = 120
    expect(out[0]).toBe(120);
  });
});
