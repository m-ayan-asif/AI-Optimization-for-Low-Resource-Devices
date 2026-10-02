import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceColor } from '../../utils/imageValidation';
import { History, ChevronRight, CheckCircle2, XCircle, PenLine, AlertCircle } from 'lucide-react';

const DECISION_ICONS = {
  accept: <CheckCircle2 size={14} className="text-conf-good" />,
  dispute: <XCircle size={14} className="text-conf-caution" />,
  correct: <PenLine size={14} className="text-info" />,
};

const DECISION_CLASSES = {
  accept: 'text-conf-good bg-conf-good-tint',
  dispute: 'text-conf-caution bg-conf-caution-tint',
  correct: 'text-info bg-info-tint',
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
      <header className="flex items-center gap-2.5 pb-3 border-b-2 border-ink-950">
        <History size={19} className="text-ink-600" />
        <h1 className="text-h1 text-ink-950 m-0">{t('clinician.history.title')}</h1>
      </header>

      {error && (
        <div className="notice notice-critical" role="alert">
          <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
          <span className="text-body">{error}</span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending', 'accept', 'dispute', 'correct'].map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className={`px-3.5 py-1.5 rounded-control text-meta font-semibold border-2 cursor-pointer transition-colors ${
                active
                  ? 'border-brand-600 bg-brand-50 text-brand-800'
                  : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
              }`}
            >
              {t(`clinician.history.filter.${f}`)}
            </button>
          );
        })}
      </div>

      <div className="panel">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-body text-ink-600">
            {t('clinician.history.empty')}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div>
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
      className="flex items-center gap-4 px-4 py-3.5 border-b border-line last:border-b-0 hover:bg-wash transition-colors no-underline group"
    >
      {/* Status indicator */}
      <div
        className={`w-2 h-2 rounded-pill shrink-0 ${caseData.status === 'pending' ? 'bg-conf-caution' : 'bg-conf-good'}`}
        title={caseData.status === 'pending' ? t('history.pending') : t('history.reviewed')}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-body font-semibold text-ink-950">{caseData.patient_username}</span>
          <span className="text-meta text-ink-500">#{String(caseData.case_id).slice(0, 8)}</span>
        </div>
        <div className="text-meta text-ink-600 truncate">
          {caseData.top_condition || t('clinician.cases.noCondition')}
        </div>
      </div>

      {/* Decision badge */}
      {decision && (
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-control text-label font-semibold shrink-0 ${DECISION_CLASSES[decision]}`}>
          {DECISION_ICONS[decision]}
          {t(`clinician.feedback.${decision}`)}
        </div>
      )}

      {/* Confidence */}
      {confidence != null && (
        <div className="flex items-center gap-2 shrink-0 hidden md:flex">
          <div className="w-16 h-1.5 bg-wash overflow-hidden">
            <div
              className="h-full"
              style={{ width: `${(confidence * 100).toFixed(0)}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-meta font-semibold text-ink-800 w-9 text-end tnum">
            {(confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}

      <div className="text-meta text-ink-500 shrink-0 hidden lg:block">
        {new Date(caseData.created_at).toLocaleDateString()}
      </div>

      <ChevronRight size={16} className="text-ink-300 group-hover:text-brand-600 transition-colors shrink-0" />
    </Link>
  );
}
