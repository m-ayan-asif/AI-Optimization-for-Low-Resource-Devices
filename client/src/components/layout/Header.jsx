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
    <header className="bg-white/80 backdrop-blur-md border-b border-purple-100 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to={isAuthenticated ? '/dashboard' : '/login'} className="flex items-center gap-2.5 no-underline">
            <img src="/src/assets/logo.png" alt="SkinSense" className="w-9 h-9 rounded-lg object-contain" />
          <span className="font-bold text-lg text-gray-900 tracking-tight">{t('app.name')}</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium no-underline transition-all duration-200 ${
                isActive(link.to)
                  ? 'bg-purple-50 text-purple-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-purple-200 hover:bg-purple-50 transition-colors cursor-pointer bg-white text-purple-700"
            title="Switch language"
          >
            <Globe size={15} />
            <span className="font-medium">{isRtl ? 'EN' : 'اردو'}</span>
          </button>

          {isAuthenticated && (
            <>
              <span className="hidden md:inline text-sm text-gray-400 px-2">{user?.username}</span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-500 hover:bg-red-50 transition-colors cursor-pointer bg-white border border-transparent hover:border-red-200"
                title={t('nav.logout')}
              >
                <LogOut size={15} />
                <span className="hidden md:inline">{t('nav.logout')}</span>
              </button>
            </>
          )}

          <button
            className="md:hidden p-2 cursor-pointer bg-white border-none text-gray-600"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <nav className="md:hidden border-t border-purple-50 bg-white px-4 py-3 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMobileOpen(false)}
              className={`block px-4 py-2.5 rounded-lg text-sm no-underline font-medium ${
                isActive(link.to) ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'
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
