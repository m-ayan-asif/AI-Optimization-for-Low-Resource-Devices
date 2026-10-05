// Turn a recorded blob into the 16 kHz mono Float32 PCM Whisper expects. useVoiceRecorder already produces a 16 kHz
// PCM WAV; anything else is decoded and resampled with the Web Audio API.
const TARGET_SR = 16000;

export function parsePcm16Wav(buf) {
  const view = new DataView(buf);
  const tag = (o) =>
    String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off);
    const size = view.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data' && fmt) {
      if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1 || fmt.rate !== TARGET_SR) return null;
      const n = Math.min(size, buf.byteLength - body) >> 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(body + i * 2, true) / 32768;
      return out;
    }
    off = body + size + (size & 1);
  }
  return null;
}

export async function blobToPcm16k(blob) {
  const buf = await blob.arrayBuffer();
  const pcm = parsePcm16Wav(buf);
  if (pcm) return pcm;
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  await ctx.close();
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SR), TARGET_SR);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  return (await offline.startRendering()).getChannelData(0);
}
