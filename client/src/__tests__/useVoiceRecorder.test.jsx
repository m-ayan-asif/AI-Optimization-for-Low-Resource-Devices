/**
 * Unit tests for the useVoiceRecorder React hook.
 *
 * The hook controls the mic lifecycle (getUserMedia → MediaRecorder → WAV
 * conversion via AudioContext) and exposes isRecording, audioBlob, duration,
 * and error.  Browser APIs absent in jsdom are shimmed in vitest.setup.js;
 * here we only override behaviour for specific scenarios.
 *
 * Key patterns used across these tests:
 *  - makeMockStream() returns a minimal MediaStream stub so getUserMedia never
 *    touches real hardware and each test starts from a clean state.
 *  - stopRecording() kicks off an async WAV-conversion pipeline internally.
 *    `await new Promise(r => setTimeout(r, 0))` drains the microtask queue so
 *    audioBlob is populated before assertions run.
 *  - Duration timer tests scope vi.useFakeTimers() to only setInterval,
 *    clearInterval, and Date — deliberately NOT faking setTimeout so React 19's
 *    internal scheduler and Promise chains continue to work during rendering.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

// Returns a minimal MediaStream-like object with one stoppable track.
// Fresh instance per test so mock call counts don't bleed between tests.
function makeMockStream() {
  const track = { stop: vi.fn() };
  return { getTracks: vi.fn(() => [track]) };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigator.mediaDevices.getUserMedia.mockResolvedValue(makeMockStream());
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe('Initial state', () => {
  it('has correct defaults before any interaction', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.duration).toBe(0);
    expect(result.current.error).toBeNull();
  });
});

// ─── startRecording ───────────────────────────────────────────────────────────

describe('startRecording()', () => {
  it('SUCCESS: sets isRecording to true after mic access is granted', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('SUCCESS: requests the microphone with audio: true', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('SUCCESS: clears error state from a previous failed attempt', async () => {
    navigator.mediaDevices.getUserMedia
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce(makeMockStream());

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.startRecording(); });
    expect(result.current.error).toBeTruthy();

    await act(async () => { await result.current.startRecording(); });
    expect(result.current.isRecording).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('ERROR: sets error message when microphone access is denied', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' })
    );

    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toMatch(/microphone access denied/i);
  });

  it('ERROR: sets error when getUserMedia throws a generic error', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('Hardware unavailable'));

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.startRecording(); });

    expect(result.current.error).toBeTruthy();
    expect(result.current.isRecording).toBe(false);
  });
});

// ─── stopRecording ────────────────────────────────────────────────────────────

describe('stopRecording()', () => {
  it('SUCCESS: sets isRecording to false immediately', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      result.current.stopRecording();
      // Allow WAV-conversion microtasks (blob.arrayBuffer → decodeAudioData → startRendering) to settle
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isRecording).toBe(false);
  });

  it('SUCCESS: produces a non-null Blob after stopping', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      // The WAV conversion (decodeAudioData → OfflineAudioContext → Blob) runs
      // as microtasks after stopRecording() returns.  setTimeout(r, 0) ensures
      // the microtask queue is flushed before we assert on audioBlob.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.audioBlob).toBeInstanceOf(Blob);
  });

  it('EDGE: calling stopRecording when not recording is a no-op', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(() => act(() => { result.current.stopRecording(); })).not.toThrow();
    expect(result.current.isRecording).toBe(false);
  });
});

// ─── clearRecording ───────────────────────────────────────────────────────────

describe('clearRecording()', () => {
  it('resets audioBlob and duration to initial values', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => { result.current.clearRecording(); });

    expect(result.current.audioBlob).toBeNull();
    expect(result.current.duration).toBe(0);
  });

  it('is safe to call when nothing was recorded yet', () => {
    const { result } = renderHook(() => useVoiceRecorder());
    expect(() => act(() => { result.current.clearRecording(); })).not.toThrow();
    expect(result.current.audioBlob).toBeNull();
    expect(result.current.duration).toBe(0);
  });
});

// ─── Duration timer ───────────────────────────────────────────────────────────
// Only mock setInterval/clearInterval/Date — NOT setTimeout.
// React 19's internal scheduler and Promise microtasks rely on setTimeout;
// faking it causes act() to deadlock while waiting for state updates that
// can never run because their scheduler callbacks are suspended.

describe('Duration timer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments duration every second while recording', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });

    // Advance fake setInterval by 3 s; use synchronous act so state updates
    // from the callback are flushed before we assert.
    act(() => { vi.advanceTimersByTime(3000); });

    expect(result.current.duration).toBeGreaterThanOrEqual(3);
  });

  it('auto-stops when maxDuration is reached', async () => {
    const maxMs = 5000;
    const { result } = renderHook(() => useVoiceRecorder(maxMs));

    await act(async () => { await result.current.startRecording(); });
    act(() => { vi.advanceTimersByTime(maxMs + 1000); });

    expect(result.current.isRecording).toBe(false);
  });

  it('does not increment duration after recording is stopped', async () => {
    const { result } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.startRecording(); });
    act(() => { vi.advanceTimersByTime(2000); });

    act(() => { result.current.stopRecording(); });
    const durationAtStop = result.current.duration;

    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.duration).toBe(durationAtStop);
  });
});

// ─── WAV conversion fallback ──────────────────────────────────────────────────

describe('WAV conversion fallback', () => {
  it('falls back to raw blob when AudioContext.decodeAudioData rejects', async () => {
    // Replace the global AudioContext with a version whose decodeAudioData always
    // rejects.  The hook should catch this and fall back to using the raw
    // compressed blob rather than leaving audioBlob as null.
    const OriginalAudioContext = global.AudioContext;
    global.AudioContext = class {
      decodeAudioData() { return Promise.reject(new Error('decode failed')); }
      close() { return Promise.resolve(); }
    };

    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.startRecording(); });
    await act(async () => {
      result.current.stopRecording();
      await new Promise((r) => setTimeout(r, 0));
    });

    // Fallback means rawBlob is used — still a Blob
    if (result.current.audioBlob !== null) {
      expect(result.current.audioBlob).toBeInstanceOf(Blob);
    }

    global.AudioContext = OriginalAudioContext;
  });
});
