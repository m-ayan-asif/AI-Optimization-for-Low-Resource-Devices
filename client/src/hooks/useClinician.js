import { useState } from 'react';
import api from '../utils/api';

export function useClinician() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function getStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/clinician/stats');
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load stats');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getCases(status) {
    setLoading(true);
    setError(null);
    try {
      const params = status ? { status } : {};
      const res = await api.get('/clinician/cases', { params });
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load cases');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function getCaseDetail(caseId) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/clinician/cases/${caseId}`);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load case');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitFeedback(caseId, payload) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/clinician/cases/${caseId}/feedback`, payload);
      return res.data;
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit feedback');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, getStats, getCases, getCaseDetail, submitFeedback };
}
