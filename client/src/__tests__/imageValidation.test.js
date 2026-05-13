/**
 * Unit tests for the imageValidation utility module.
 *
 * Four pure functions are tested:
 *  - validateImageFile(file)       → synchronous; checks MIME type and file size.
 *  - validateImageDimensions(file) → async; checks pixel dimensions via Image().
 *  - getConfidenceLevel(score)     → maps a float to 'high' / 'medium' / 'low'.
 *  - getConfidenceColor(score)     → maps a float to a CSS hex colour string.
 *
 * Dimension tests:
 *  - The browser Image() constructor is not available in jsdom's default config,
 *    so we replace global.Image with a mock factory (mockImage) that fires
 *    onload/onerror via setTimeout, matching the real async browser behaviour.
 *  - File.size is a read-only property in jsdom; Object.defineProperty() lets
 *    us override it to test size limits without creating a real multi-megabyte
 *    buffer.
 *
 * Boundary value tests confirm the exact thresholds in each function so any
 * change to the constants will immediately break a test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateImageFile,
  validateImageDimensions,
  getConfidenceLevel,
  getConfidenceColor,
} from '../utils/imageValidation';

// ─── validateImageFile ────────────────────────────────────────────────────────

describe('validateImageFile()', () => {
  it('SUCCESS: accepts a valid JPEG file within size limit', () => {
    const file = new File(['data'], 'skin.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 1024 * 1024 }); // 1MB
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('SUCCESS: accepts a valid PNG file within size limit', () => {
    const file = new File(['data'], 'skin.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 500 * 1024 }); // 500KB
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('SUCCESS: accepts a file at exactly the 10 MB size limit', () => {
    // File.size is read-only in jsdom; Object.defineProperty overrides it
    // so we can test the boundary without allocating a real 10 MB buffer.
    const file = new File(['data'], 'skin.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 });
    const { valid } = validateImageFile(file);
    expect(valid).toBe(true);
  });

  it('ERROR: rejects a GIF file with the correct error message', () => {
    const file = new File(['gif'], 'anim.gif', { type: 'image/gif' });
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/jpeg and png/i);
  });

  it('ERROR: rejects a PDF file', () => {
    const file = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' });
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('ERROR: rejects a file that exceeds 10 MB', () => {
    const file = new File(['data'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/under 10mb/i);
  });

  it('EDGE: accumulates both errors when file is wrong type AND over size', () => {
    const file = new File(['data'], 'big.gif', { type: 'image/gif' });
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
    const { valid, errors } = validateImageFile(file);
    expect(valid).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it('EDGE: rejects a file with empty MIME type', () => {
    const file = new File(['data'], 'noext', { type: '' });
    const { valid } = validateImageFile(file);
    expect(valid).toBe(false);
  });
});

// ─── validateImageDimensions ─────────────────────────────────────────────────

describe('validateImageDimensions()', () => {
  // Returns a mock Image object that fires onload or onerror asynchronously via
  // setTimeout (matching real browser behaviour).  Setting src triggers the
  // callback, which is how validateImageDimensions() detects load completion.
  // shouldError=true simulates a corrupt/unreadable file.
  function mockImage(width, height, shouldError = false) {
    const img = {
      onload: null,
      onerror: null,
      set src(_) {
        if (shouldError) {
          setTimeout(() => this.onerror && this.onerror(), 0);
        } else {
          this.width = width;
          this.height = height;
          setTimeout(() => this.onload && this.onload(), 0);
        }
      },
      width: 0,
      height: 0,
    };
    return img;
  }

  beforeEach(() => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(400, 400));
  });

  it('SUCCESS: resolves valid for an image that meets minimum dimensions (400×400)', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(400, 400));
    const file = new File(['data'], 'ok.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);
  });

  it('SUCCESS: resolves valid for an image at exactly 300×300 (the minimum)', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(300, 300));
    const file = new File(['data'], 'ok.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(true);
  });

  it('ERROR: rejects an image smaller than 300×300', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(200, 150));
    const file = new File(['data'], 'small.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/300/);
    expect(result.errors[0]).toMatch(/200/);
    expect(result.errors[0]).toMatch(/150/);
  });

  it('ERROR: rejects an image that is wide but not tall enough', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(800, 100));
    const file = new File(['data'], 'wide.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(false);
  });

  it('ERROR: resolves invalid when the image cannot be loaded (onerror fires)', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(0, 0, true));
    const file = new File(['bad data'], 'corrupt.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/could not read/i);
  });

  it('EDGE: exactly 299×300 fails on width only', async () => {
    vi.spyOn(global, 'Image').mockImplementation(() => mockImage(299, 300));
    const file = new File(['data'], 'narrow.jpg', { type: 'image/jpeg' });
    const result = await validateImageDimensions(file);
    expect(result.valid).toBe(false);
  });
});

// ─── getConfidenceLevel ───────────────────────────────────────────────────────

describe('getConfidenceLevel()', () => {
  it("returns 'high' for score >= 0.8", () => {
    expect(getConfidenceLevel(0.8)).toBe('high');
    expect(getConfidenceLevel(0.95)).toBe('high');
    expect(getConfidenceLevel(1.0)).toBe('high');
  });

  it("returns 'medium' for score >= 0.6 and < 0.8", () => {
    expect(getConfidenceLevel(0.6)).toBe('medium');
    expect(getConfidenceLevel(0.7)).toBe('medium');
    expect(getConfidenceLevel(0.79)).toBe('medium');
  });

  it("returns 'low' for score < 0.6", () => {
    expect(getConfidenceLevel(0.0)).toBe('low');
    expect(getConfidenceLevel(0.59)).toBe('low');
    expect(getConfidenceLevel(0.3)).toBe('low');
  });

  it('EDGE: exactly 0.8 is high (inclusive boundary)', () => {
    expect(getConfidenceLevel(0.8)).toBe('high');
  });

  it('EDGE: exactly 0.6 is medium (inclusive boundary)', () => {
    expect(getConfidenceLevel(0.6)).toBe('medium');
  });
});

// ─── getConfidenceColor ───────────────────────────────────────────────────────

describe('getConfidenceColor()', () => {
  it('returns green (#16a34a) for high confidence (>= 0.8)', () => {
    expect(getConfidenceColor(0.8)).toBe('#16a34a');
    expect(getConfidenceColor(1.0)).toBe('#16a34a');
  });

  it('returns amber (#d97706) for medium confidence (>= 0.6, < 0.8)', () => {
    expect(getConfidenceColor(0.6)).toBe('#d97706');
    expect(getConfidenceColor(0.75)).toBe('#d97706');
    expect(getConfidenceColor(0.79)).toBe('#d97706');
  });

  it('returns red (#dc2626) for low confidence (< 0.6)', () => {
    expect(getConfidenceColor(0.0)).toBe('#dc2626');
    expect(getConfidenceColor(0.59)).toBe('#dc2626');
  });

  it('EDGE: boundary values match expected colors', () => {
    expect(getConfidenceColor(0.8)).toBe('#16a34a');
    expect(getConfidenceColor(0.6)).toBe('#d97706');
  });
});
