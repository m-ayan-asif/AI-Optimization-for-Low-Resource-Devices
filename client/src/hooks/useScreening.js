import { useState } from 'react';
import api from '../utils/api';

export function useScreening() {
  const [caseId, setCaseId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [results, setResults] = useState(null);

  function parseError(err, fallbackMsg) {
    const data = err.response?.data;
    const msg = data?.error || data?.message || fallbackMsg;
    const code = data?.code || (err.response?.status === 413 ? 'FILE_TOO_LARGE' : null);
    return { msg, code };
  }

  async function createCase() {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post('/screening/create');
      setCaseId(res.data.case_id);
      return res.data.case_id;
    } catch (err) {
      const { msg, code } = parseError(err, 'Failed to create screening');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function uploadImage(id, file) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post(`/screening/${id}/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Image upload failed');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitVoice(id, audioBlob, language, additionalText = null) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const formData = new FormData();
      if (audioBlob) {
        const ext = audioBlob.type.includes('wav') ? '.wav'
          : audioBlob.type.includes('ogg') ? '.ogg'
          : audioBlob.type.includes('mp4') ? '.mp4'
          : '.webm';
        formData.append('audio', audioBlob, `recording${ext}`);
      }
      formData.append('language', language === 'en' ? 'en' : 'ur');
      if (additionalText && additionalText.trim()) {
        formData.append('additionalText', additionalText.trim());
      }
      const res = await api.post(`/screening/${id}/voice`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Voice processing failed');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitTextInput(id, text, language) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post(`/screening/${id}/text-input`, { text, language });
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Text submission failed');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function runInference(id) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.post(`/screening/${id}/inference`);
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Analysis failed');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getResults(id) {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.get(`/screening/${id}/results`);
      setResults(res.data);
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Failed to load results');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getHistory() {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const res = await api.get('/screening/history/list');
      return res.data;
    } catch (err) {
      const { msg, code } = parseError(err, 'Failed to load history');
      setError(msg);
      setErrorCode(code);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCaseId(null);
    setResults(null);
    setError(null);
    setErrorCode(null);
  }

  return {
    caseId,
    loading,
    error,
    errorCode,
    setError,
    results,
    createCase,
    uploadImage,
    submitVoice,
    submitTextInput,
    runInference,
    getResults,
    getHistory,
    reset,
  };
}
