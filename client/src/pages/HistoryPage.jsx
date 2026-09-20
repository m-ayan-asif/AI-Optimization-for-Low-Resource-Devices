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
      <header className="flex items-center gap-2.5 pb-3 mb-6 border-b-2 border-ink-950">
        <History size={19} className="text-ink-600" />
        <h1 className="text-h1 text-ink-950 m-0">{t('history.title')}</h1>
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="panel panel-body text-center py-12">
          <Clock size={22} className="text-ink-300 mx-auto mb-3" />
          <p className="text-body text-ink-600 m-0">{t('history.empty')}</p>
        </div>
      ) : (
        <div className="panel">
          {items.map((item) => {
            const level = item.confidence_score ? getConfidenceLevel(item.confidence_score) : null;
            const reviewed = item.status === 'reviewed';
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
                  <div className="flex items-center gap-2.5 text-meta text-ink-500 mt-1">
                    <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    <span
                      className={`px-2 py-0.5 rounded-control text-label font-semibold ${
                        reviewed ? 'bg-conf-good-tint text-conf-good' : 'bg-wash text-ink-600'
                      }`}
                    >
                      {reviewed ? t('history.reviewed') : t('history.pending')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {level && (
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
  );
}
