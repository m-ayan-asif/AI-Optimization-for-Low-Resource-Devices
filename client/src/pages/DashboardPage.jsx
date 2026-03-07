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
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t('dashboard.welcome')}, <span className="text-purple-600">{user?.username}</span>
        </h1>
        <p className="text-gray-400 text-sm mt-1">{t('app.tagline')}</p>
      </div>

      {/* Start Screening CTA */}
      <button
        onClick={() => navigate('/screening')}
        className="w-full flex items-center justify-between bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-2xl p-6 transition-all cursor-pointer border-none text-left shadow-lg shadow-purple-200 group"
      >
        <div className="flex items-center gap-4">
          <div className="w-13 h-13 rounded-xl bg-white/15 flex items-center justify-center backdrop-blur-sm group-hover:bg-white/20 transition-colors">
            <Activity size={26} />
          </div>
          <div>
            <div className="text-lg font-semibold">{t('dashboard.startScreening')}</div>
            <div className="text-purple-200 text-sm mt-0.5">{t('screening.uploadDesc')}</div>
          </div>
        </div>
        <ArrowRight size={20} className="text-purple-200 group-hover:translate-x-1 transition-transform" />
      </button>

      {/* Recent Screenings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <History size={18} className="text-purple-500" />
            {t('dashboard.recentScreenings')}
          </h2>
          {recent.length > 0 && (
            <Link to="/history" className="text-sm text-purple-600 font-medium no-underline hover:text-purple-700 flex items-center gap-1">
              {t('dashboard.viewAll')} <ArrowRight size={14} />
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
          </div>
        ) : recent.length === 0 ? (
          <div className="bg-white rounded-2xl border border-purple-100 p-10 text-center">
            <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
              <Clock size={24} className="text-purple-300" />
            </div>
            <p className="text-gray-400 text-sm">{t('dashboard.noScreenings')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recent.map((item) => {
              const level = getConfidenceLevel(item.confidence_score);
              return (
                <Link
                  key={item.case_id}
                  to={`/results/${item.case_id}`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-100 p-4 no-underline hover:border-purple-200 hover:shadow-sm transition-all group"
                >
                  <div>
                    <div className="font-medium text-gray-900 group-hover:text-purple-700 transition-colors">
                      {item.top_condition || t('history.pending')}
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5">
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.confidence_score && (
                      <span className={`text-sm font-semibold px-3 py-1 rounded-full confidence-${level}`}>
                        {(item.confidence_score * 100).toFixed(0)}%
                      </span>
                    )}
                    <ArrowRight size={16} className="text-gray-300 group-hover:text-purple-400 transition-colors" />
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
