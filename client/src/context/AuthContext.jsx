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
        .then((res) => {
          setUser(res.data);
          sessionStorage.setItem('ss_user', JSON.stringify(res.data));
        })
        .catch((err) => {
          // Offline (no response): keep the session so on-device screening still works; the server re-checks the
          // token on the next request anyway.
          const cached = sessionStorage.getItem('ss_user');
          if (!err.response && cached) {
            setUser(JSON.parse(cached));
            return;
          }
          sessionStorage.removeItem('ss_token');
          sessionStorage.removeItem('ss_user');
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
    sessionStorage.setItem('ss_user', JSON.stringify(userData));
    setAuthToken(token);
    setUser(userData);
    return userData;
  }, []);

  const register = useCallback(async (formData) => {
    const res = await api.post('/auth/register', formData);
    const { token, user: userData } = res.data;
    sessionStorage.setItem('ss_token', token);
    sessionStorage.setItem('ss_user', JSON.stringify(userData));
    setAuthToken(token);
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem('ss_token');
    sessionStorage.removeItem('ss_user');
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
