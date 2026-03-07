import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { setAuthToken, clearAuthToken } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, check if we have a token in sessionStorage (not localStorage per security reqs)
  useEffect(() => {
    const token = sessionStorage.getItem('ss_token');
    if (token) {
      setAuthToken(token);
      api
        .get('/auth/profile')
        .then((res) => setUser(res.data))
        .catch(() => {
          sessionStorage.removeItem('ss_token');
          clearAuthToken();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { token, user: userData } = res.data;
    sessionStorage.setItem('ss_token', token);
    setAuthToken(token);
    setUser(userData);
    return userData;
  }, []);

  const register = useCallback(async (formData) => {
    const res = await api.post('/auth/register', formData);
    const { token, user: userData } = res.data;
    sessionStorage.setItem('ss_token', token);
    setAuthToken(token);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('ss_token');
    clearAuthToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
