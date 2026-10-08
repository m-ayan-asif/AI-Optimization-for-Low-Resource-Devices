// Where the PWA finds its on-device models. Paths are versioned because the reverse proxy serves /models/* as
// immutable: ship a new model under a new folder name instead of overwriting files.
export const SKIN_MODEL_DIR = '/models/skin-v5';
export const WHISPER_MODEL_ROOT = '/models/';
export const WHISPER_MODEL_ID = 'whisper-small-ur-v1';
export const ORT_WASM_PATH = '/ort/';
export const MODEL_CACHE = 'skinsense-models-v1';
