import { useState } from 'react';
import api from '../utils/api';

export function useScreening() {
  const [caseId, setCaseId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  async function createCase() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/screening/create');
      setCaseId(res.data.case_id);
      return res.data.case_id;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create screening');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function uploadImage(id, file) {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post(`/screening/${id}/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Image upload failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitVoice(id, audioBlob, language, additionalText = null) {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      if (audioBlob) {
        // Browser hook converts to WAV before this point; fall back to webm extension if not
        const ext = audioBlob.type.includes('wav') ? '.wav'
          : audioBlob.type.includes('ogg') ? '.ogg'
          : audioBlob.type.includes('mp4') ? '.mp4'
          : '.webm';
        formData.append('audio', audioBlob, `recording${ext}`);
      }
      // Roman Urdu is still Urdu for the server's language field
      formData.append('language', language === 'en' ? 'en' : 'ur');
      if (additionalText && additionalText.trim()) {
        formData.append('additionalText', additionalText.trim());
      }
      const res = await api.post(`/screening/${id}/voice`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Voice processing failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitTextInput(id, text, language) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/screening/${id}/text-input`, {
        text,
        language,
      });
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Text submission failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function runInference(id) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/screening/${id}/inference`);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Analysis failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getResults(id) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/screening/${id}/results`);
      setResults(res.data);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load results');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getHistory() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/screening/history/list');
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load history');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setCaseId(null);
    setResults(null);
    setError(null);
  }

  return {
    caseId,
    loading,
    error,
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
