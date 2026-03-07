import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel } from '../utils/imageValidation';
import { Clock, ArrowRight, History } from 'lucide-react';

export default function HistoryPage() {
  const { t } = useTranslation();
  const { getHistory } = useScreening();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
          <History size={20} className="text-purple-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('history.title')}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-purple-100 p-14 text-center">
          <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
            <Clock size={28} className="text-purple-300" />
          </div>
          <p className="text-gray-400">{t('history.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const level = item.confidence_score ? getConfidenceLevel(item.confidence_score) : null;
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
                  <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.status === 'reviewed'
                        ? 'bg-green-50 text-green-600 border border-green-100'
                        : 'bg-gray-50 text-gray-500 border border-gray-100'
                    }`}>
                      {item.status === 'reviewed' ? t('history.reviewed') : t('history.pending')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {level && (
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
  );
}
