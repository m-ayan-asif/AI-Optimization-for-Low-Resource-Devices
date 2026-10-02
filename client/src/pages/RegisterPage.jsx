import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { REGIONS } from '../utils/constants';
import { Eye, EyeOff, User, Stethoscope, AlertCircle } from 'lucide-react';

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

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Chassis edge — echoes the app header, marks the top of the instrument */}
      <div className="h-1 bg-brand-800 shrink-0" />

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[30rem]">
          {/* Identity */}
          <div className="flex items-center gap-3 mb-7">
            <img
              src="/src/assets/logo.png"
              alt=""
              className="w-12 h-12 object-contain shrink-0"
            />
            <h1 className="text-h1 text-ink-950 m-0">{t('app.name')}</h1>
          </div>

          {/* Record panel */}
          <div className="panel">
            <div className="panel-head">
              <h2 className="label m-0">{t('auth.register')}</h2>
            </div>

            <div className="panel-body">
              {error && (
                <div className="notice notice-critical mb-5" role="alert">
                  <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
                  <span className="text-body">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Role selector */}
                <div>
                  <label className="label mb-2">{t('auth.role')}</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { value: 'patient', label: t('auth.rolePatient'), icon: User },
                      { value: 'clinician', label: t('auth.roleHealthworker'), icon: Stethoscope },
                    ].map(({ value, label, icon: Icon }) => {
                      const active = form.role === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateForm('role', value)}
                          aria-pressed={active}
                          className={`flex items-center justify-center gap-2 py-2.5 rounded-control text-body font-semibold border-2 cursor-pointer transition-colors ${
                            active
                              ? 'border-brand-600 bg-brand-50 text-brand-800'
                              : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
                          }`}
                        >
                          <Icon size={16} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-username" className="label mb-2">
                    {t('auth.username')}
                  </label>
                  <input
                    id="reg-username"
                    type="text"
                    value={form.username}
                    onChange={(e) => updateForm('username', e.target.value)}
                    className="field"
                    placeholder={t('auth.usernamePlaceholder')}
                    autoComplete="username"
                  />
                </div>

                <div>
                  <label htmlFor="reg-email" className="label mb-2">
                    {t('auth.email')}
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => updateForm('email', e.target.value)}
                    className="field"
                    placeholder={t('auth.emailPlaceholder')}
                    autoComplete="email"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-password" className="label mb-2">
                      {t('auth.password')}
                    </label>
                    <div className="relative">
                      <input
                        id="reg-password"
                        type={showPass ? 'text' : 'password'}
                        value={form.password}
                        onChange={(e) => updateForm('password', e.target.value)}
                        className="field pe-11"
                        placeholder={t('auth.passwordPlaceholder')}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        aria-label={t('auth.password')}
                        className="absolute end-1 top-1/2 -translate-y-1/2 p-2.5 text-ink-600 hover:text-ink-950 cursor-pointer bg-transparent border-none"
                      >
                        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="reg-confirm-password" className="label mb-2">
                      {t('auth.confirmPassword')}
                    </label>
                    <input
                      id="reg-confirm-password"
                      type="password"
                      value={form.confirmPassword}
                      onChange={(e) => updateForm('confirmPassword', e.target.value)}
                      className="field"
                      placeholder={t('auth.confirmPlaceholder')}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="reg-age" className="label mb-2">
                      {t('auth.age')} <span className="text-conf-critical">*</span>
                    </label>
                    <input
                      id="reg-age"
                      type="number"
                      value={form.age}
                      onChange={(e) => updateForm('age', e.target.value)}
                      className="field"
                      placeholder="—"
                      min="1"
                      max="120"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-gender" className="label mb-2">
                      {t('auth.gender')} <span className="text-conf-critical">*</span>
                    </label>
                    <select
                      id="reg-gender"
                      value={form.gender}
                      onChange={(e) => updateForm('gender', e.target.value)}
                      className="field"
                    >
                      <option value="">—</option>
                      <option value="Male">{t('auth.male')}</option>
                      <option value="Female">{t('auth.female')}</option>
                      <option value="Other">{t('auth.other')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reg-region" className="label mb-2">
                      {t('auth.region')} <span className="text-conf-critical">*</span>
                    </label>
                    <select
                      id="reg-region"
                      value={form.region}
                      onChange={(e) => updateForm('region', e.target.value)}
                      className="field"
                    >
                      <option value="">—</option>
                      {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary w-full">
                  {loading ? (
                    <span className="w-[18px] h-[18px] border-2 border-white/35 border-t-white rounded-pill animate-spin" />
                  ) : (
                    t('auth.register')
                  )}
                </button>
              </form>
            </div>

            <div className="border-t border-line px-4 py-3.5 text-meta text-ink-600 text-center">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="link">
                {t('auth.loginHere')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
