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
    ? [
        { to: '/dashboard', label: t('nav.home') },
        { to: '/screening', label: t('nav.screening') },
        { to: '/history', label: t('nav.history') },
        { to: '/clinics', label: t('nav.clinics') },
      ]
    : [];

  const isActive = (path) => location.pathname === path;

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to={isAuthenticated ? '/dashboard' : '/login'} className="flex items-center gap-2 no-underline">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">SS</span>
          </div>
          <span className="font-bold text-lg text-gray-900">{t('app.name')}</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3 py-2 rounded-lg text-sm font-medium no-underline transition-colors ${
                isActive(link.to)
                  ? 'bg-teal-50 text-teal-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer bg-white"
            title="Switch language"
          >
            <Globe size={16} />
            <span>{isRtl ? 'EN' : 'اردو'}</span>
          </button>

          {isAuthenticated && (
            <>
              <span className="hidden md:inline text-sm text-gray-500">{user?.username}</span>
              <button
                onClick={logout}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer bg-white border-none"
                title={t('nav.logout')}
              >
                <LogOut size={16} />
                <span className="hidden md:inline">{t('nav.logout')}</span>
              </button>
            </>
          )}

          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-2 cursor-pointer bg-white border-none"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-gray-100 bg-white px-4 py-2">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm no-underline ${
                isActive(link.to) ? 'bg-teal-50 text-teal-700' : 'text-gray-600'
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
