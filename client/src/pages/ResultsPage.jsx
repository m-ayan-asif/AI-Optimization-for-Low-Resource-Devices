import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel, getConfidenceColor } from '../utils/imageValidation';
import { MapPin, Plus, AlertTriangle, Clock } from 'lucide-react';

export default function ResultsPage() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const { getResults, loading } = useScreening();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (caseId) {
      getResults(caseId)
        .then(setData)
        .catch((err) => setError(err.response?.data?.error || 'Failed to load'));
    }
  }, [caseId]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-6 rounded-xl text-center">
        {error}
      </div>
    );
  }

  const level = getConfidenceLevel(data.confidence_score);
  const allScores = data.all_scores || {};
  const sortedConditions = Object.entries(allScores).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('results.title')}</h1>

      {/* Top condition card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="text-sm text-gray-500 mb-1">{t('results.topCondition')}</div>
        <div className="text-2xl font-bold text-gray-900 mb-3">{data.top_condition}</div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500">{t('results.confidence')}</div>
          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(data.confidence_score * 100).toFixed(0)}%`,
                backgroundColor: getConfidenceColor(data.confidence_score),
              }}
            />
          </div>
          <span className={`text-lg font-bold confidence-${level} px-3 py-1 rounded-full`}>
            {(data.confidence_score * 100).toFixed(0)}%
          </span>
        </div>

        {data.inference_time_ms && (
          <div className="flex items-center gap-1 text-sm text-gray-400 mt-3">
            <Clock size={14} />
            {t('results.inferenceTime')} {data.inference_time_ms} {t('common.ms')}
          </div>
        )}
      </div>

      {/* All conditions breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">{t('results.allConditions')}</h3>
        <div className="space-y-3">
          {sortedConditions.map(([condition, score]) => (
            <div key={condition} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-48 shrink-0">{condition}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${(score * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-12 text-right">{(score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Extracted symptoms */}
      {data.symptoms && data.symptoms.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-3">{t('results.symptoms')}</h3>
          <div className="flex flex-wrap gap-2">
            {data.symptoms.map((s, i) => (
              <span key={i} className="px-3 py-1.5 bg-teal-50 text-teal-700 rounded-full text-sm font-medium">
                {s.keyword}
              </span>
            ))}
          </div>
          {data.transcript_text && (
            <p className="text-sm text-gray-500 mt-3 italic">"{data.transcript_text}"</p>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">{t('results.disclaimer')}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Link
          to="/clinics"
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-teal-600 text-white rounded-xl font-medium no-underline hover:bg-teal-700 transition-colors text-sm"
        >
          <MapPin size={16} /> {t('results.findClinic')}
        </Link>
        <Link
          to="/screening"
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-white text-gray-700 border border-gray-200 rounded-xl font-medium no-underline hover:bg-gray-50 transition-colors text-sm"
        >
          <Plus size={16} /> {t('results.newScreening')}
        </Link>
      </div>
    </div>
  );
}
