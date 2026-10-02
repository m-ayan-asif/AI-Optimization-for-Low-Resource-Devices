import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel } from '../utils/imageValidation';
import { Plus, Clock, ArrowRight, Activity, History } from 'lucide-react';

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { getHistory } = useScreening();
  const navigate = useNavigate();
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then((data) => setRecent(data.slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-7">
      {/* Welcome */}
      <div>
        <h1 className="text-h1 text-ink-950 m-0">
          {t('dashboard.welcome')}, <span className="text-brand-700">{user?.username}</span>
        </h1>
        <p className="text-body text-ink-600 mt-1 mb-0">{t('app.tagline')}</p>
      </div>

      {/* Start Screening CTA — the one flat brand surface on this page */}
      <button
        onClick={() => navigate('/screening')}
        className="w-full flex items-center justify-between gap-4 bg-brand-800 hover:bg-brand-700 text-white rounded-panel p-5 sm:p-6 transition-colors cursor-pointer border-none text-start"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-11 h-11 rounded-control bg-white/15 flex items-center justify-center shrink-0">
            <Activity size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-h2 font-semibold">{t('dashboard.startScreening')}</div>
            <div className="text-meta text-brand-100 mt-0.5">{t('screening.uploadDesc')}</div>
          </div>
        </div>
        <ArrowRight size={20} className="text-brand-100 shrink-0" />
      </button>

      {/* Recent Screenings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2 text-ink-950 m-0 flex items-center gap-2">
            <History size={17} className="text-ink-600" />
            {t('dashboard.recentScreenings')}
          </h2>
          {recent.length > 0 && (
            <Link to="/history" className="text-meta font-semibold text-brand-600 hover:text-brand-800 no-underline flex items-center gap-1">
              {t('dashboard.viewAll')} <ArrowRight size={14} />
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
          </div>
        ) : recent.length === 0 ? (
          <div className="panel panel-body text-center py-10">
            <Clock size={22} className="text-ink-300 mx-auto mb-3" />
            <p className="text-body text-ink-600 m-0">{t('dashboard.noScreenings')}</p>
          </div>
        ) : (
          <div className="panel">
            {recent.map((item) => {
              const level = getConfidenceLevel(item.confidence_score);
              return (
                <Link
                  key={item.case_id}
                  to={`/results/${item.case_id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-line last:border-b-0 no-underline hover:bg-wash transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="text-body font-semibold text-ink-950 truncate">
                      {item.top_condition || t('history.pending')}
                    </div>
                    <div className="text-meta text-ink-500 mt-0.5">
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.confidence_score && (
                      <span className={`text-meta font-semibold px-2.5 py-1 rounded-control tnum confidence-${level}`}>
                        {(item.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                    <ArrowRight size={16} className="text-ink-300 group-hover:text-brand-600 transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
