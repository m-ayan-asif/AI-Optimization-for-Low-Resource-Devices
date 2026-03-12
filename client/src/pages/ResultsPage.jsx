import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceLevel, getConfidenceColor } from '../utils/imageValidation';
import { MapPin, Plus, AlertTriangle, Clock, FileText, Eye } from 'lucide-react';

export default function ResultsPage() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const { getResults, loading } = useScreening();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);

  useEffect(() => {
    if (caseId) {
      getResults(caseId).then(setData).catch((err) => setError(err.response?.data?.error || 'Failed to load'));
    }
  }, [caseId]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return <div className="bg-red-50 text-red-600 p-6 rounded-2xl text-center border border-red-100">{error}</div>;
  }

  const level = getConfidenceLevel(data.confidence_score);
  const allScores = data.all_scores || {};
  const sortedConditions = Object.entries(allScores).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
          <FileText size={20} className="text-purple-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('results.title')}</h1>
      </div>

      {/* Top condition card */}
      <div className="bg-white rounded-2xl border border-purple-100 p-7 shadow-sm">
        <div className="text-sm text-gray-400 font-medium uppercase tracking-wide mb-1">{t('results.topCondition')}</div>
        <div className="text-2xl font-bold text-gray-900 mb-4">{data.top_condition}</div>

        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-400 w-20">{t('results.confidence')}</div>
          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full animate-grow"
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
          <div className="flex items-center gap-1.5 text-sm text-gray-300 mt-4 pt-4 border-t border-gray-50">
            <Clock size={14} />
            {t('results.inferenceTime')} {data.inference_time_ms} {t('common.ms')}
          </div>
        )}
      </div>

      {/* Grad-CAM Heatmap */}
      {data.heatmap_url && (
        <div className="bg-white rounded-2xl border border-purple-100 p-7 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Eye size={18} className="text-purple-500" />
              {t('results.heatmap')}
            </h3>
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className="text-sm text-purple-600 font-medium cursor-pointer bg-transparent border-none hover:text-purple-700"
            >
              {showHeatmap ? 'Hide' : 'Show'}
            </button>
          </div>
          {showHeatmap && (
            <>
              <div className="rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
                <img
                  src={data.heatmap_url}
                  alt="Grad-CAM Heatmap"
                  className="w-full object-contain max-h-96"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
              <p className="text-sm text-gray-400 mt-3">{t('results.heatmapDesc')}</p>
            </>
          )}
        </div>
      )}

      {/* All conditions breakdown */}
      <div className="bg-white rounded-2xl border border-gray-100 p-7">
        <h3 className="font-semibold text-gray-900 mb-5">{t('results.allConditions')}</h3>
        <div className="space-y-3.5">
          {sortedConditions.map(([condition, score], i) => (
            <div key={condition} className="flex items-center gap-4">
              <span className={`text-sm w-44 shrink-0 ${i === 0 ? 'font-semibold text-purple-700' : 'text-gray-600'}`}>{condition}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full animate-grow ${i === 0 ? 'bg-purple-500' : 'bg-purple-200'}`}
                  style={{ width: `${(score * 100).toFixed(0)}%` }}
                />
              </div>
              <span className={`text-sm w-12 text-right font-medium ${i === 0 ? 'text-purple-600' : 'text-gray-400'}`}>
                {(score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Extracted symptoms */}
      {data.symptoms && data.symptoms.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-7">
          <h3 className="font-semibold text-gray-900 mb-4">{t('results.symptoms')}</h3>
          <div className="flex flex-wrap gap-2">
            {data.symptoms.map((s, i) => (
              <span key={i} className="px-3.5 py-1.5 bg-purple-50 text-purple-700 rounded-full text-sm font-medium border border-purple-100">
                {s.keyword}
              </span>
            ))}
          </div>
          {data.transcript_text && (
            <p className="text-sm text-gray-400 mt-3 italic leading-relaxed">"{data.transcript_text}"</p>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex gap-3.5">
        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 leading-relaxed">{t('results.disclaimer')}</p>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-4">
        <Link
          to="/clinics"
          className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-semibold no-underline hover:from-purple-700 hover:to-purple-800 transition-all text-sm shadow-md shadow-purple-200"
        >
          <MapPin size={16} /> {t('results.findClinic')}
        </Link>
        <Link
          to="/screening"
          className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white text-gray-600 border border-gray-200 rounded-xl font-semibold no-underline hover:bg-purple-50 hover:border-purple-200 hover:text-purple-700 transition-all text-sm"
        >
          <Plus size={16} /> {t('results.newScreening')}
        </Link>
      </div>
    </div>
  );
}
