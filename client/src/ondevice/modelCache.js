import { MODEL_CACHE } from './config';

// Cache-first fetch for model files, so the models work offline after one download even before the service worker
// controls the page (the service worker also caches /models/*).
export async function cachedFetch(url) {
  if (typeof caches === 'undefined') return fetch(url);
  const cache = await caches.open(MODEL_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  await cache.put(url, res.clone());
  return res;
}
