const { describe, it, expect } = require('@jest/globals');

// Canonical schema definition matching quality.py & server.py
const VALID_CONDITIONS = [
  'Vitiligo',
  'Melasma',
  'Psoriasis',
  'Eczema',
  'Tinea',
  'Contact Dermatitis',
  'Seborrheic Dermatitis',
  'No Disease / Inconclusive'
];

function validateInferenceContract(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['Payload must be an object'];

  if (typeof payload.model_version !== 'string' || !payload.model_version) {
    errors.push('model_version must be a non-empty string');
  }
  if (!VALID_CONDITIONS.includes(payload.top_condition)) {
    errors.push(`top_condition '${payload.top_condition}' is not in the allowed class contract`);
  }
  if (typeof payload.confidence_score !== 'number' || payload.confidence_score < 0 || payload.confidence_score > 1) {
    errors.push('confidence_score must be a float between 0.0 and 1.0');
  }
  if (!['classified', 'out_of_scope'].includes(payload.status)) {
    errors.push('status must be either "classified" or "out_of_scope"');
  }
  if (!payload.all_scores || typeof payload.all_scores !== 'object') {
    errors.push('all_scores must be an object dictionary of class probabilities');
  } else {
    const scoreKeys = Object.keys(payload.all_scores);
    const expectedBase7 = VALID_CONDITIONS.slice(0, 7);
    const hasAll7 = expectedBase7.every((k) => scoreKeys.includes(k));
    if (!hasAll7) errors.push('all_scores is missing one or more of the 7 primary clinical classes');

    const sum = Object.values(payload.all_scores).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.05) {
      errors.push(`all_scores sum (${sum}) diverges significantly from softmax unit sum (1.0)`);
    }
  }

  if (payload.telemetry) {
    const t = payload.telemetry;
    const requiredMetrics = [
      'image_preprocess_ms',
      'model_inference_ms',
      'gradcam_generation_ms',
      'total_server_time_ms',
      'server_ram_used_mb',
      'device_type',
      'blur_score',
      'entropy',
      'confidence_margin'
    ];
    for (const m of requiredMetrics) {
      if (t[m] === undefined || t[m] === null) {
        errors.push(`telemetry block missing required metric: ${m}`);
      }
    }
  }

  return errors;
}

describe('Inference Service API Contract', () => {
  it('passes on canonical valid prediction payload', () => {
    const mockFastApiOutput = {
      model_version: 'mobilenetv3-large-dualkd-clean320-notlesion-v3',
      top_condition: 'Eczema',
      confidence_score: 0.8521,
      status: 'classified',
      all_scores: {
        Vitiligo: 0.01,
        Melasma: 0.01,
        Psoriasis: 0.02,
        Eczema: 0.8521,
        Tinea: 0.05,
        'Contact Dermatitis': 0.04,
        'Seborrheic Dermatitis': 0.0179
      },
      heatmap_path: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.png',
      inference_time_ms: 184,
      telemetry: {
        image_preprocess_ms: 22,
        model_inference_ms: 82,
        gradcam_generation_ms: 80,
        total_server_time_ms: 184,
        server_ram_used_mb: 4.12,
        gpu_vram_used_mb: 0.0,
        device_type: 'cpu',
        blur_score: 48.2,
        entropy: 0.621,
        confidence_margin: 0.8021
      }
    };
    const errors = validateInferenceContract(mockFastApiOutput);
    expect(errors).toHaveLength(0);
  });

  it('rejects payload when top_condition is unrecognized', () => {
    const invalidOutput = {
      model_version: 'v1',
      top_condition: 'Melanoma', // Not one of the 7 classes
      confidence_score: 0.9,
      status: 'classified',
      all_scores: {}
    };
    const errors = validateInferenceContract(invalidOutput);
    expect(errors.some((e) => e.includes('allowed class contract'))).toBe(true);
  });

  it('rejects payload when telemetry fields are missing', () => {
    const missingTelemetry = {
      model_version: 'v1',
      top_condition: 'Tinea',
      confidence_score: 0.75,
      status: 'classified',
      all_scores: {
        Vitiligo: 0.0, Melasma: 0.0, Psoriasis: 0.0, Eczema: 0.1,
        Tinea: 0.75, 'Contact Dermatitis': 0.1, 'Seborrheic Dermatitis': 0.05
      },
      telemetry: {
        image_preprocess_ms: 10
        // Missing remaining profiling fields
      }
    };
    const errors = validateInferenceContract(missingTelemetry);
    expect(errors.length).toBeGreaterThan(0);
  });
});

module.exports = { validateInferenceContract };