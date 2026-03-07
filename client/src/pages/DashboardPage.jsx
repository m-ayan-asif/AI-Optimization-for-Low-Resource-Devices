import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel } from '../utils/imageValidation';
import { Plus, Clock, ArrowRight } from 'lucide-react';

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
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t('dashboard.welcome')}, {user?.username}
        </h1>
        <p className="text-gray-500 mt-1">{t('app.tagline')}</p>
      </div>

      {/* Start Screening CTA */}
      <button
        onClick={() => navigate('/screening')}
        className="w-full flex items-center justify-between bg-teal-600 hover:bg-teal-700 text-white rounded-2xl p-6 transition-colors cursor-pointer border-none text-left"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <Plus size={24} />
          </div>
          <div>
            <div className="text-lg font-semibold">{t('dashboard.startScreening')}</div>
            <div className="text-teal-100 text-sm mt-0.5">{t('screening.uploadDesc')}</div>
          </div>
        </div>
        <ArrowRight size={20} />
      </button>

      {/* Recent Screenings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('dashboard.recentScreenings')}</h2>
          {recent.length > 0 && (
            <Link to="/history" className="text-sm text-teal-600 no-underline hover:underline flex items-center gap-1">
              {t('dashboard.viewAll')} <ArrowRight size={14} />
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
          </div>
        ) : recent.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            <Clock size={32} className="mx-auto mb-3 text-gray-300" />
            <p>{t('dashboard.noScreenings')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recent.map((item) => {
              const level = getConfidenceLevel(item.confidence_score);
              return (
                <Link
                  key={item.case_id}
                  to={`/results/${item.case_id}`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 no-underline hover:border-teal-200 transition-colors"
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {item.top_condition || t('history.pending')}
                    </div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.confidence_score && (
                      <span className={`text-sm font-medium px-2.5 py-1 rounded-full confidence-${level}`}>
                        {(item.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                    <ArrowRight size={16} className="text-gray-400" />
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
