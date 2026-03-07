import { useState, useRef, useCallback } from 'react';

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
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timerRef.current);
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setIsRecording(true);
      startTime.current = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
        setDuration(elapsed);
        if (elapsed * 1000 >= maxDuration) {
          stopRecording();
        }
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
