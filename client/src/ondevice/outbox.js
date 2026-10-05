// Screenings analysed on the device are kept in IndexedDB until they reach the server: right away when online, or
// by syncOutbox() once the connection returns. A synced record keeps only its server case id, so an old
// /results/local/<id> link still resolves.
import api from '../utils/api';

const DB_NAME = 'skinsense';
const STORE = 'outbox';
export const OUTBOX_CHANGED = 'skinsense-outbox-changed';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveScreening(record) {
  const id = record.id || crypto.randomUUID();
  await tx('readwrite', (s) => s.put({ ...record, id, createdAt: record.createdAt || new Date().toISOString() }));
  window.dispatchEvent(new Event(OUTBOX_CHANGED));
  return id;
}

export const getScreening = (id) => tx('readonly', (s) => s.get(id));
export const listScreenings = () => tx('readonly', (s) => s.getAll());

export async function pendingCount() {
  return (await listScreenings()).filter((r) => !r.caseId).length;
}

const inFlight = new Set(); // ids being uploaded right now, so a background sync never sends one twice

/** Upload one locally analysed screening; returns the server case id. */
export async function uploadScreening(record) {
  if (inFlight.has(record.id)) throw new Error('Upload already in progress');
  inFlight.add(record.id);
  try {
    return await uploadOnce(record);
  } finally {
    inFlight.delete(record.id);
  }
}

async function uploadOnce(record) {
  const { data: created } = await api.post('/screening/create');
  const caseId = created.case_id;

  const img = new FormData();
  img.append('image', record.imageBlob, record.imageName || 'photo.jpg');
  await api.post(`/screening/${caseId}/upload-image`, img, { headers: { 'Content-Type': 'multipart/form-data' } });

  const text = record.text?.trim();
  if (record.audioBlob) {
    const voice = new FormData();
    voice.append('audio', record.audioBlob, 'recording.wav');
    voice.append('language', record.language === 'en' ? 'en' : 'ur');
    if (record.transcript) voice.append('deviceTranscript', record.transcript);
    if (text) voice.append('additionalText', text);
    await api.post(`/screening/${caseId}/voice`, voice, { headers: { 'Content-Type': 'multipart/form-data' } });
  } else if (text) {
    await api.post(`/screening/${caseId}/text-input`, { text, language: record.language });
  }

  const result = new FormData();
  result.append('prediction', JSON.stringify(record.prediction));
  if (record.heatmapBlob) result.append('heatmap', record.heatmapBlob, 'heatmap.png');
  await api.post(`/screening/${caseId}/device-result`, result, { headers: { 'Content-Type': 'multipart/form-data' } });

  await saveScreening({ id: record.id, createdAt: record.createdAt, caseId, top_condition: record.prediction.top_condition });
  return caseId;
}

let syncing = null;

/** Push every pending screening to the server. Safe to call often; concurrent calls share one run. */
export function syncOutbox() {
  if (!syncing) {
    syncing = (async () => {
      let uploaded = 0;
      for (const r of await listScreenings()) {
        if (r.caseId || inFlight.has(r.id)) continue;
        try {
          await uploadScreening(r);
          uploaded++;
        } catch (err) {
          if (!err.response) break; // still offline: try again later
          console.warn('Outbox upload rejected by the server, keeping it on the device:', err.response?.data);
        }
      }
      return uploaded;
    })().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}
