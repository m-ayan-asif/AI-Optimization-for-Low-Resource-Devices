import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { REGIONS } from '../utils/constants';
import { Eye, EyeOff, ArrowRight, User, Stethoscope, AlertCircle } from 'lucide-react';

const KNOWN_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'protonmail.com', 'ymail.com', 'msn.com',
  'yahoo.co.uk', 'googlemail.com',
];

// Segments long enough to be meaningful for substring matching
const KNOWN_BRANDS = KNOWN_EMAIL_DOMAINS
  .map((d) => ({ brand: d.split('.')[0], domain: d }))
  .filter(({ brand }) => brand.length >= 4);

// Institutional/professional TLD patterns that should never be flagged
const INSTITUTIONAL = ['.edu', '.ac.', '.gov', '.mil', '.org', '.net'];

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

function suggestEmailDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  if (KNOWN_EMAIL_DOMAINS.includes(domain)) return null;
  // Never flag institutional/professional domains
  if (INSTITUTIONAL.some((p) => domain.includes(p))) return null;

  // 1. Levenshtein — catches single-char swaps, missing dots, wrong TLDs
  const byDistance = KNOWN_EMAIL_DOMAINS.reduce((best, known) => {
    const dist = levenshtein(domain, known);
    return dist < best.dist ? { domain: known, dist } : best;
  }, { domain: null, dist: Infinity });
  if (byDistance.dist <= 2) return byDistance.domain;

  // 2. Brand substring — catches 123gmail.com, myyahoo.net, outlookmail.com, etc.
  for (const { brand, domain: known } of KNOWN_BRANDS) {
    if (domain.includes(brand)) return known;
  }

  return null;
}

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

    // Client-side validation
    if (!form.username.trim()) { setError(t('errors.usernameRequired')); return; }
    if (form.username.trim().length < 3) { setError(t('errors.usernameTooShort')); return; }
    if (!/[a-zA-Z]/.test(form.username.trim())) { setError(t('errors.usernameNoLetters')); return; }
    if (!form.email.trim()) { setError(t('errors.emailRequired')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError(t('errors.emailInvalid')); return; }
    const suggestion = suggestEmailDomain(form.email.trim());
    if (suggestion) {
      setError(`Did you mean ${form.email.trim().split('@')[0]}@${suggestion}?`);
      return;
    }
    if (!form.password) { setError(t('errors.passwordRequired')); return; }
    if (form.password.length < 6) { setError(t('errors.passwordTooShort')); return; }
    if (form.password !== form.confirmPassword) { setError(t('errors.passwordMismatch')); return; }
    if (!form.age) { setError(t('errors.ageRequired')); return; }
    if (Number(form.age) < 1 || Number(form.age) > 120 || !Number.isInteger(Number(form.age))) {
      setError('Please enter a valid age (1–120).');
      return;
    }
    if (!form.gender) { setError(t('errors.genderRequired')); return; }
    if (!form.region) { setError(t('errors.regionRequired')); return; }

    setLoading(true);
    try {
      const { confirmPassword, ...data } = form;
      data.username = data.username.trim();
      data.email = data.email.trim();
      await register(data);
      navigate('/dashboard');
    } catch (err) {
      const status = err.response?.status;
      const serverMsg = err.response?.data?.error;

      if (status === 409) {
        setError(t('errors.userExists'));
      } else if (status === 429) {
        setError(t('errors.tooManyAttempts'));
      } else if (!err.response) {
        setError(t('errors.networkError'));
      } else if (status === 400 && serverMsg?.toLowerCase().includes('email domain')) {
        setError(t('errors.emailDomainInvalid'));
      } else {
        setError(serverMsg || t('errors.registrationFailed'));
      }
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
          <img src="/src/assets/logo.png" alt="SkinSense" className="w-20 h-20 mx-auto mb-5 object-contain" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('app.name')}</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-purple-100/50 border border-purple-100/60 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">{t('auth.register')}</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-5 border border-red-100 flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
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
              <input type="text" value={form.username} onChange={(e) => updateForm('username', e.target.value)} className={inputClass} placeholder={t('auth.usernamePlaceholder')} autoComplete="username" />
            </div>

            <div>
              <label className={labelClass}>{t('auth.email')}</label>
              <input type="email" value={form.email} onChange={(e) => updateForm('email', e.target.value)} className={inputClass} placeholder={t('auth.emailPlaceholder')} autoComplete="email" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t('auth.password')}</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={(e) => updateForm('password', e.target.value)} className={`${inputClass} pr-10`} placeholder={t('auth.passwordPlaceholder')} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none p-1">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>{t('auth.confirmPassword')}</label>
                <input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} className={inputClass} placeholder={t('auth.confirmPlaceholder')} autoComplete="new-password" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>{t('auth.age')} <span className="text-red-500">*</span></label>
                <input type="number" value={form.age} onChange={(e) => updateForm('age', e.target.value)} className={inputClass} placeholder="—" min="1" max="120" />
              </div>
              <div>
                <label className={labelClass}>{t('auth.gender')} <span className="text-red-500">*</span></label>
                <select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} className={`${inputClass} bg-white`}>
                  <option value="">—</option>
                  <option value="Male">{t('auth.male')}</option>
                  <option value="Female">{t('auth.female')}</option>
                  <option value="Other">{t('auth.other')}</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>{t('auth.region')} <span className="text-red-500">*</span></label>
                <select value={form.region} onChange={(e) => updateForm('region', e.target.value)} className={`${inputClass} bg-white`}>
                  <option value="">—</option>
                  {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
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
