import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel } from '../utils/imageValidation';
import { Clock, ArrowRight } from 'lucide-react';

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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('history.title')}</h1>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <Clock size={40} className="mx-auto mb-3 text-gray-300" />
          <p>{t('history.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const level = item.confidence_score ? getConfidenceLevel(item.confidence_score) : null;
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
                  <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.status === 'reviewed'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.status === 'reviewed' ? t('history.reviewed') : t('history.pending')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {level && (
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
  );
}
