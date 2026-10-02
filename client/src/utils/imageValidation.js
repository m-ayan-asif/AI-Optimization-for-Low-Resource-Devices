const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

export function validateImageFile(file) {
  const errors = [];

  if (!file) {
    errors.push('No file selected.');
    return { valid: false, errors };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push('Only JPEG and PNG images are accepted.');
  }

  if (file.size > MAX_FILE_SIZE) {
    errors.push('Image must be under 10MB.');
  }

  return { valid: errors.length === 0, errors };
}

export function validateImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const errors = [];
      if (img.width < MIN_WIDTH || img.height < MIN_HEIGHT) {
        errors.push(
          `Image must be at least ${MIN_WIDTH}×${MIN_HEIGHT} pixels. Yours is ${img.width}×${img.height}.`
        );
      }
      resolve({
        valid: errors.length === 0,
        errors,
        width: img.width,
        height: img.height,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ valid: false, errors: ['Could not read image file.'] });
    };

    img.src = url;
  });
}

export function getConfidenceLevel(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.3) return 'low';
  return 'out_of_scope';
}

// Confidence semantics. These must stay in step with the --color-conf-*
// tokens and the .confidence-* classes in index.css. Each value meets WCAG AA
// as text on white and on its own tint; the 'no reading' tier is neutral
// rather than branded, because a sub-threshold score is an absence of signal.
export function getConfidenceColor(score) {
  if (score >= 0.8) return '#0f7a43';
  if (score >= 0.6) return '#a15c00';
  if (score >= 0.3) return '#b3261e';
  return '#4a4356';
}
