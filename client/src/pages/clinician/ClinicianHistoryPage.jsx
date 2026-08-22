import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceColor } from '../../utils/imageValidation';
import { History, ChevronRight, CheckCircle2, XCircle, PenLine, AlertCircle } from 'lucide-react';

const DECISION_ICONS = {
  accept: <CheckCircle2 size={14} className="text-green-500" />,
  dispute: <XCircle size={14} className="text-amber-500" />,
  correct: <PenLine size={14} className="text-blue-500" />,
};

const DECISION_CLASSES = {
  accept: 'text-green-700 bg-green-50 border-green-200',
  dispute: 'text-amber-700 bg-amber-50 border-amber-200',
  correct: 'text-blue-700 bg-blue-50 border-blue-200',
};

export default function ClinicianHistoryPage() {
  const { t } = useTranslation();
  const { getCases, loading } = useClinician();
  const [cases, setCases] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  useEffect(() => {
    getCases()
      .then(setCases)
      .catch((err) => setError(err.message || 'Failed to load history'));
  }, []);

  const filtered = filter === 'all'
    ? cases
    : cases.filter((c) => {
        if (filter === 'pending') return c.status === 'pending';
        return c.decision === filter;
      });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
          <History size={20} className="text-purple-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('clinician.history.title')}</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'accept', 'dispute', 'correct'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all cursor-pointer ${
              filter === f
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-purple-200 hover:text-purple-600'
            }`}
          >
            {t(`clinician.history.filter.${f}`)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            {t('clinician.history.empty')}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <HistoryRow key={c.case_id} caseData={c} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ caseData, t }) {
  const confidence = caseData.confidence_score;
  const color = getConfidenceColor(confidence);
  const decision = caseData.decision;

  return (
    <Link
      to={`/clinician/cases/${caseData.case_id}`}
      className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors no-underline group"
    >
      {/* Status indicator */}
      <div className="shrink-0">
        {caseData.status === 'pending' ? (
          <div className="w-2 h-2 rounded-full bg-amber-400" title={t('history.pending')} />
        ) : (
          <div className="w-2 h-2 rounded-full bg-green-400" title={t('history.reviewed')} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-900">{caseData.patient_username}</span>
          <span className="text-xs text-gray-400">#{String(caseData.case_id).slice(0, 8)}</span>
        </div>
        <div className="text-sm text-gray-500 truncate">
          {caseData.top_condition || t('clinician.cases.noCondition')}
        </div>
      </div>

      {/* Decision badge */}
      {decision && (
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold shrink-0 ${DECISION_CLASSES[decision]}`}>
          {DECISION_ICONS[decision]}
          {t(`clinician.feedback.${decision}`)}
        </div>
      )}

      {/* Confidence */}
      {confidence != null && (
        <div className="flex items-center gap-2 shrink-0 hidden md:flex">
          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(confidence * 100).toFixed(0)}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-sm font-medium text-gray-600 w-9 text-right">
            {(confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}

      <div className="text-xs text-gray-400 shrink-0 hidden lg:block">
        {new Date(caseData.created_at).toLocaleDateString()}
      </div>

      <ChevronRight size={16} className="text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" />
    </Link>
  );
}
