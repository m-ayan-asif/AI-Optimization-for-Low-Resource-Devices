// Browser-facing URL for a stored Grad-CAM overlay.
//  - Server-side predictions: a UUID file name written by the inference service. INFERENCE_URL is an internal hostname
//    in Docker, so production sets PUBLIC_HEATMAP_BASE=/heatmaps and the reverse proxy forwards that path.
//  - On-device (PWA) predictions: "device/<uuid>.png", uploaded with the result and served by this API.
const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';
const PUBLIC_HEATMAP_BASE = process.env.PUBLIC_HEATMAP_BASE || `${INFERENCE_URL}/heatmaps`;
const DEVICE_HEATMAP_PREFIX = 'device/';
const DEVICE_HEATMAP_ROUTE = '/api/device-heatmaps';

function heatmapUrl(heatmapPath) {
  if (!heatmapPath) return null;
  if (heatmapPath.startsWith(DEVICE_HEATMAP_PREFIX)) {
    return `${DEVICE_HEATMAP_ROUTE}/${heatmapPath.slice(DEVICE_HEATMAP_PREFIX.length)}`;
  }
  return `${PUBLIC_HEATMAP_BASE}/${heatmapPath}`;
}

module.exports = { heatmapUrl, DEVICE_HEATMAP_PREFIX, DEVICE_HEATMAP_ROUTE };
