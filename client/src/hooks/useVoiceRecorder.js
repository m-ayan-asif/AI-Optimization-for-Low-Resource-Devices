import { useState, useRef, useCallback } from 'react';

function getSupportedMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Convert any browser audio blob to 16 kHz mono WAV using the Web Audio API.
// WAV PCM is readable by Python's soundfile with no external dependencies.
async function convertToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode compressed audio (WebM/Opus, OGG, MP4…)
  const decodeCtx = new AudioContext();
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  // Resample to 16 kHz mono — what Whisper expects
  const TARGET_SR = 16000;
  const numFrames = Math.ceil(audioBuffer.duration * TARGET_SR);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_SR);
  const src = offlineCtx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(offlineCtx.destination);
  src.start(0);
  const rendered = await offlineCtx.startRendering();

  // Encode to 16-bit PCM WAV
  const pcm = rendered.getChannelData(0);
  const wavBytes = encodePcmWav(pcm, TARGET_SR);
  return new Blob([wavBytes], { type: 'audio/wav' });
}

function encodePcmWav(float32, sampleRate) {
  const numSamples = float32.length;
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}

export function useVoiceRecorder(maxDuration = 30000) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTime = useRef(null);

  const startRecording = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    chunks.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);

        const rawBlob = new Blob(chunks.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        try {
          const wavBlob = await convertToWav(rawBlob);
          setAudioBlob(wavBlob);
        } catch (convErr) {
          console.warn('WAV conversion failed, sending raw audio:', convErr);
          setAudioBlob(rawBlob);
        }
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setIsRecording(true);
      startTime.current = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
        setDuration(elapsed);
        if (elapsed * 1000 >= maxDuration) stopRecording();
      }, 1000);
    } catch (err) {
      setError('Microphone access denied. Please allow microphone permissions.');
    }
  }, [maxDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  }, []);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setDuration(0);
  }, []);

  return { isRecording, audioBlob, duration, error, startRecording, stopRecording, clearRecording };
}
