import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Client-side validation
    if (!form.username.trim()) {
      setError(t('errors.usernameRequired'));
      return;
    }
    if (!form.password) {
      setError(t('errors.passwordRequired'));
      return;
    }

    setLoading(true);
    try {
      const userData = await login(form.username.trim(), form.password);
      navigate(userData.role === 'clinician' ? '/clinician/dashboard' : '/dashboard');
    } catch (err) {
      const status = err.response?.status;
      const serverMsg = err.response?.data?.error;

      if (status === 401) {
        setError(t('errors.invalidCredentials'));
      } else if (status === 429) {
        setError(t('errors.tooManyAttempts'));
      } else if (!err.response) {
        setError(t('errors.networkError'));
      } else {
        setError(serverMsg || t('errors.loginFailed'));
      }
      // Keep the username, only clear password
      setForm((prev) => ({ ...prev, password: '' }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Chassis edge — echoes the app header, marks the top of the instrument */}
      <div className="h-1 bg-brand-800 shrink-0" />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[26rem]">
          {/* Identity */}
          <div className="flex items-center gap-3 mb-7">
            <img
              src="/src/assets/logo.png"
              alt=""
              className="w-12 h-12 object-contain shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-h1 text-ink-950 m-0">{t('app.name')}</h1>
              <p className="text-meta text-ink-500 m-0 mt-0.5">{t('app.tagline')}</p>
            </div>
          </div>

          {/* Record panel */}
          <div className="panel">
            <div className="panel-head">
              <h2 className="label m-0">{t('auth.login')}</h2>
            </div>

            <div className="panel-body">
              {error && (
                <div className="notice notice-critical mb-5" role="alert">
                  <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
                  <span className="text-body">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="username" className="label mb-2">
                    {t('auth.username')}
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="field"
                    placeholder={t('auth.usernamePlaceholder')}
                    autoComplete="username"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="label mb-2">
                    {t('auth.password')}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPass ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="field pe-11"
                      placeholder={t('auth.passwordPlaceholder')}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      aria-label={t('auth.password')}
                      className="absolute end-1 top-1/2 -translate-y-1/2 p-2.5 text-ink-600 hover:text-ink-950 cursor-pointer bg-transparent border-none"
                    >
                      {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? (
                    <span className="w-[18px] h-[18px] border-2 border-white/35 border-t-white rounded-pill animate-spin" />
                  ) : (
                    t('auth.login')
                  )}
                </button>
              </form>
            </div>

            <div className="border-t border-line px-4 py-3.5 text-meta text-ink-600 text-center">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="link">
                {t('auth.registerHere')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
