import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useScreening } from '../hooks/useScreening';

// Mock the axios instance used by the hook
vi.mock('../utils/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import api from '../utils/api';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createCase ───────────────────────────────────────────────────────────────

describe('createCase()', () => {
  it('SUCCESS: sets caseId and returns it', async () => {
    api.post.mockResolvedValueOnce({ data: { case_id: 'case-abc' } });

    const { result } = renderHook(() => useScreening());
    let returned;
    await act(async () => { returned = await result.current.createCase(); });

    expect(returned).toBe('case-abc');
    expect(result.current.caseId).toBe('case-abc');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('SUCCESS: calls POST /screening/create', async () => {
    api.post.mockResolvedValueOnce({ data: { case_id: 'case-xyz' } });
    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.createCase(); });
    expect(api.post).toHaveBeenCalledWith('/screening/create');
  });

  it('ERROR: sets error and re-throws on API failure', async () => {
    const err = Object.assign(new Error('Net error'), { response: { data: { error: 'Failed to create screening' } } });
    api.post.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useScreening());

    // Wrap inside act so state updates in the catch block are flushed before asserting
    let threw = false;
    await act(async () => {
      try { await result.current.createCase(); } catch { threw = true; }
    });

    expect(threw).toBe(true);
    expect(result.current.error).toBe('Failed to create screening');
    expect(result.current.caseId).toBeNull();
  });

  it('ERROR: uses generic message when response has no error field', async () => {
    api.post.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.createCase(); } catch {} });
    expect(result.current.error).toBe('Failed to create screening');
  });

  it('EDGE: sets loading=true during request and false afterwards', async () => {
    let resolveFn;
    api.post.mockReturnValueOnce(new Promise((res) => { resolveFn = res; }));

    const { result } = renderHook(() => useScreening());
    act(() => { result.current.createCase(); });
    expect(result.current.loading).toBe(true);

    await act(async () => { resolveFn({ data: { case_id: 'c1' } }); });
    expect(result.current.loading).toBe(false);
  });

  it('EDGE: clears previous error at the start of a new call', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Old error' } } });
    api.post.mockRejectedValueOnce(err);
    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.createCase(); } catch {} });
    expect(result.current.error).toBe('Old error');

    api.post.mockResolvedValueOnce({ data: { case_id: 'c2' } });
    await act(async () => { await result.current.createCase(); });
    expect(result.current.error).toBeNull();
  });
});

// ─── uploadImage ─────────────────────────────────────────────────────────────

describe('uploadImage()', () => {
  it('SUCCESS: posts the image and returns response data', async () => {
    api.post.mockResolvedValueOnce({ data: { image_id: 42 } });
    const file = new File(['img'], 'skin.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useScreening());
    let data;
    await act(async () => { data = await result.current.uploadImage('case-1', file); });

    expect(data).toEqual({ image_id: 42 });
    expect(api.post).toHaveBeenCalledWith(
      '/screening/case-1/upload-image',
      expect.any(FormData),
      expect.objectContaining({ headers: { 'Content-Type': 'multipart/form-data' } })
    );
  });

  it('ERROR: sets error and re-throws on failure', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Image upload failed' } } });
    api.post.mockRejectedValueOnce(err);
    const file = new File(['img'], 'skin.jpg', { type: 'image/jpeg' });

    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.uploadImage('case-1', file); } catch {} });

    expect(result.current.error).toBe('Image upload failed');
  });
});

// ─── submitVoice ─────────────────────────────────────────────────────────────

describe('submitVoice()', () => {
  it('SUCCESS: posts WAV audio and returns transcript data', async () => {
    api.post.mockResolvedValueOnce({ data: { transcript_id: 7, transcript_text: 'خارش', keywords: [] } });
    const blob = new Blob(['wav'], { type: 'audio/wav' });

    const { result } = renderHook(() => useScreening());
    let data;
    await act(async () => { data = await result.current.submitVoice('case-1', blob, 'ur'); });

    expect(data.transcript_id).toBe(7);
  });

  it('EDGE: uses .wav extension for audio/wav blobs', async () => {
    api.post.mockResolvedValueOnce({ data: { transcript_id: 1 } });
    const blob = new Blob(['wav'], { type: 'audio/wav' });

    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.submitVoice('case-1', blob, 'ur'); });

    const [, formData] = api.post.mock.calls[0];
    const entries = [...formData.entries()];
    const audioEntry = entries.find(([k]) => k === 'audio');
    expect(audioEntry[1].name).toBe('recording.wav');
  });

  it('EDGE: uses .webm extension for audio/webm blobs', async () => {
    api.post.mockResolvedValueOnce({ data: { transcript_id: 2 } });
    const blob = new Blob(['webm'], { type: 'audio/webm' });

    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.submitVoice('case-1', blob, 'ur'); });

    const [, formData] = api.post.mock.calls[0];
    const audioEntry = [...formData.entries()].find(([k]) => k === 'audio');
    expect(audioEntry[1].name).toBe('recording.webm');
  });

  it('EDGE: uses .ogg extension for audio/ogg blobs', async () => {
    api.post.mockResolvedValueOnce({ data: { transcript_id: 3 } });
    const blob = new Blob(['ogg'], { type: 'audio/ogg' });

    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.submitVoice('case-1', blob, 'ur'); });

    const [, formData] = api.post.mock.calls[0];
    const audioEntry = [...formData.entries()].find(([k]) => k === 'audio');
    expect(audioEntry[1].name).toBe('recording.ogg');
  });

  it('EDGE: submits language field even when audioBlob is null (voice skipped)', async () => {
    api.post.mockResolvedValueOnce({ data: { transcript_id: 4 } });

    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.submitVoice('case-1', null, 'en'); });

    const [, formData] = api.post.mock.calls[0];
    const langEntry = [...formData.entries()].find(([k]) => k === 'language');
    expect(langEntry[1]).toBe('en');
  });

  it('ERROR: sets error and re-throws on failure', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Voice processing failed' } } });
    api.post.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.submitVoice('case-1', null, 'ur'); } catch {} });

    expect(result.current.error).toBe('Voice processing failed');
  });
});

// ─── runInference ─────────────────────────────────────────────────────────────

describe('runInference()', () => {
  it('SUCCESS: posts to inference endpoint and returns prediction', async () => {
    api.post.mockResolvedValueOnce({ data: { prediction_id: 55, top_condition: 'Eczema', confidence_score: 0.87 } });

    const { result } = renderHook(() => useScreening());
    let data;
    await act(async () => { data = await result.current.runInference('case-1'); });

    expect(data.top_condition).toBe('Eczema');
    expect(api.post).toHaveBeenCalledWith('/screening/case-1/inference');
  });

  it('ERROR: sets error message on failure', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Analysis failed' } } });
    api.post.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.runInference('case-1'); } catch {} });

    expect(result.current.error).toBe('Analysis failed');
  });
});

// ─── getResults ───────────────────────────────────────────────────────────────

describe('getResults()', () => {
  it('SUCCESS: fetches and stores results in state', async () => {
    const mockResult = { case_id: 'c1', top_condition: 'Psoriasis', confidence_score: 0.75 };
    api.get.mockResolvedValueOnce({ data: mockResult });

    const { result } = renderHook(() => useScreening());
    let data;
    await act(async () => { data = await result.current.getResults('c1'); });

    expect(data).toEqual(mockResult);
    expect(result.current.results).toEqual(mockResult);
  });

  it('ERROR: sets error on failure', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Failed to load results' } } });
    api.get.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.getResults('c1'); } catch {} });

    expect(result.current.error).toBe('Failed to load results');
    expect(result.current.results).toBeNull();
  });
});

// ─── getHistory ───────────────────────────────────────────────────────────────

describe('getHistory()', () => {
  it('SUCCESS: fetches case history list', async () => {
    const history = [{ case_id: 'c1' }, { case_id: 'c2' }];
    api.get.mockResolvedValueOnce({ data: history });

    const { result } = renderHook(() => useScreening());
    let data;
    await act(async () => { data = await result.current.getHistory(); });

    expect(data).toEqual(history);
    expect(api.get).toHaveBeenCalledWith('/screening/history/list');
  });

  it('ERROR: sets error on failure', async () => {
    const err = Object.assign(new Error(), { response: { data: { error: 'Failed to load history' } } });
    api.get.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useScreening());
    await act(async () => { try { await result.current.getHistory(); } catch {} });

    expect(result.current.error).toBe('Failed to load history');
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe('reset()', () => {
  it('clears caseId, results, and error', async () => {
    api.post.mockResolvedValueOnce({ data: { case_id: 'c99' } });
    api.get.mockResolvedValueOnce({ data: { top_condition: 'Eczema' } });

    const { result } = renderHook(() => useScreening());
    await act(async () => { await result.current.createCase(); });
    await act(async () => { await result.current.getResults('c99'); });

    expect(result.current.caseId).toBe('c99');
    expect(result.current.results).not.toBeNull();

    act(() => { result.current.reset(); });

    expect(result.current.caseId).toBeNull();
    expect(result.current.results).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
