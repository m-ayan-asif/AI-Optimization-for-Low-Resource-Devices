import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen auth-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <img src="/src/assets/logo.png" alt="SkinSense" className="w-20 h-20 mx-auto mb-5 object-contain" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('app.name')}</h1>
          <p className="text-gray-400 text-sm mt-1.5">{t('app.tagline')}</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-purple-100/50 border border-purple-100/60 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">{t('auth.login')}</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-5 border border-red-100 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('auth.username')}</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all bg-gray-50/50 placeholder-gray-300"
                placeholder={t('auth.usernamePlaceholder')}
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">{t('auth.password')}</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all bg-gray-50/50 placeholder-gray-300 pr-11"
                  placeholder={t('auth.passwordPlaceholder')}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none p-1"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 cursor-pointer text-sm shadow-md shadow-purple-200 flex items-center justify-center gap-2 border-none"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {t('auth.login')}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-400">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="text-purple-600 font-semibold no-underline hover:text-purple-700">
                {t('auth.registerHere')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
