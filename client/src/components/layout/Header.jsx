import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Menu, X, Globe, LogOut } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const { t, i18n } = useTranslation();
  const { user, logout, isAuthenticated } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isRtl = i18n.language === 'ur';

  function toggleLanguage() {
    const next = i18n.language === 'en' ? 'ur' : 'en';
    i18n.changeLanguage(next);
    document.documentElement.dir = next === 'ur' ? 'rtl' : 'ltr';
  }

  const navLinks = isAuthenticated
    ? user?.role === 'clinician'
      ? [
          { to: '/clinician/dashboard', label: t('nav.clinicianDashboard') },
          { to: '/clinician/history', label: t('nav.clinicianHistory') },
        ]
      : [
          { to: '/dashboard', label: t('nav.home') },
          { to: '/screening', label: t('nav.screening') },
          { to: '/history', label: t('nav.history') },
          { to: '/clinics', label: t('nav.clinics') },
        ]
    : [];

  const isActive = (path) => location.pathname === path;

  return (
    /* The chassis: one solid brand surface, opaque. No blur, no transparency. */
    <header className="chassis bg-brand-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Identity */}
        <Link
          to={
            isAuthenticated
              ? user?.role === 'clinician'
                ? '/clinician/dashboard'
                : '/dashboard'
              : '/login'
          }
          className="flex items-center gap-2.5 no-underline shrink-0"
        >
          <img src="/src/assets/logo.png" alt="" className="w-7 h-7 object-contain" />
          <span className="text-h2 font-bold text-white">{t('app.name')}</span>
        </Link>

        {/* Desktop nav — the active item is marked by a rule, not a pill */}
        <nav className="hidden md:flex items-center gap-1 flex-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3 h-14 flex items-center text-meta font-semibold no-underline border-b-2 transition-colors ${
                isActive(link.to)
                  ? 'text-white border-white'
                  : 'text-brand-100 border-transparent hover:text-white'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-meta font-semibold text-white bg-white/10 hover:bg-white/20 border-none cursor-pointer transition-colors"
            title="Switch language"
          >
            <Globe size={14} />
            <span>{isRtl ? 'EN' : 'اردو'}</span>
          </button>

          {isAuthenticated && (
            <>
              <span className="hidden md:inline text-meta text-brand-100 px-1">
                {user?.username}
              </span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-meta font-semibold text-brand-100 hover:text-white hover:bg-white/10 bg-transparent border-none cursor-pointer transition-colors"
                title={t('nav.logout')}
              >
                <LogOut size={14} />
                <span className="hidden md:inline">{t('nav.logout')}</span>
              </button>
            </>
          )}

          <button
            className="md:hidden p-2 cursor-pointer bg-transparent border-none text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="md:hidden bg-brand-900">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`block px-4 py-3 text-body font-semibold no-underline border-s-4 ${
                isActive(link.to)
                  ? 'text-white border-white bg-white/5'
                  : 'text-brand-100 border-transparent'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
