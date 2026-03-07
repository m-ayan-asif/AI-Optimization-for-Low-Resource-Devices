import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { REGIONS } from '../utils/constants';
import { Eye, EyeOff, ArrowRight, User, Stethoscope } from 'lucide-react';

export default function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '', email: '', password: '', confirmPassword: '',
    role: 'patient', age: '', gender: '', region: '',
  });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      const { confirmPassword, ...data } = form;
      await register(data);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all bg-gray-50/50 placeholder-gray-300";
  const labelClass = "block text-sm font-medium text-gray-600 mb-1.5";

  return (
    <div className="min-h-screen auth-gradient flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-purple-700 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-purple-200">
            <span className="text-white font-bold text-2xl">SS</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('app.name')}</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-purple-100/50 border border-purple-100/60 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">{t('auth.register')}</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-5 border border-red-100">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Role selector */}
            <div>
              <label className={labelClass}>{t('auth.role')}</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'patient', label: t('auth.rolePatient'), icon: User },
                  { value: 'clinician', label: t('auth.roleHealthworker'), icon: Stethoscope },
                ].map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateForm('role', value)}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border-2 transition-all cursor-pointer ${
                      form.role === value
                        ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-sm shadow-purple-100'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('auth.username')}</label>
              <input type="text" value={form.username} onChange={(e) => updateForm('username', e.target.value)} className={inputClass} placeholder="Choose a username" required />
            </div>

            <div>
              <label className={labelClass}>{t('auth.email')}</label>
              <input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} className={inputClass} placeholder="your@email.com" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t('auth.password')}</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => updateForm('password', e.target.value)} className={`${inputClass} pr-10`} placeholder="Min 6 chars" required />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none p-1">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>{t('auth.confirmPassword')}</label>
                <input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} className={inputClass} placeholder="Repeat password" required />
              </div>
            </div>

            {form.role === 'patient' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>{t('auth.age')}</label>
                  <input type="number" value={form.age} onChange={(e) => updateForm('age', e.target.value)} className={inputClass} placeholder="—" />
                </div>
                <div>
                  <label className={labelClass}>{t('auth.gender')}</label>
                  <select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} className={`${inputClass} bg-white`}>
                    <option value="">—</option>
                    <option value="Male">{t('auth.male')}</option>
                    <option value="Female">{t('auth.female')}</option>
                    <option value="Other">{t('auth.other')}</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{t('auth.region')}</label>
                  <select value={form.region} onChange={(e) => updateForm('region', e.target.value)} className={`${inputClass} bg-white`}>
                    <option value="">—</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 cursor-pointer text-sm shadow-md shadow-purple-200 flex items-center justify-center gap-2 border-none"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>{t('auth.register')} <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-400">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="text-purple-600 font-semibold no-underline hover:text-purple-700">{t('auth.loginHere')}</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
