import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceColor } from '../../utils/imageValidation';
import { LayoutDashboard, Clock, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react';

export default function ClinicianDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { getCases, getStats, loading } = useClinician();
  const [pendingCases, setPendingCases] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      getCases('pending'),
      getStats(),
    ])
      .then(([cases, statsData]) => {
        setPendingCases(cases);
        setStats(statsData);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-center gap-2.5 pb-3 border-b-2 border-ink-950">
        <LayoutDashboard size={19} className="text-ink-600 shrink-0" />
        <div>
          <h1 className="text-h1 text-ink-950 m-0">{t('clinician.dashboard.title')}</h1>
          <p className="text-meta text-ink-500 m-0">{t('clinician.dashboard.welcome')}, {user?.username}</p>
        </div>
      </header>

      {error && (
        <div className="notice notice-critical" role="alert">
          <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
          <span className="text-body">{error}</span>
        </div>
      )}

      {/* Stats — a neutral KPI strip; hierarchy comes from the numerals, not from four different hues */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label={t('clinician.dashboard.totalCases')} value={stats.total_count} />
          <StatCard label={t('clinician.dashboard.pending')} value={stats.pending_count} />
          <StatCard label={t('clinician.dashboard.reviewed')} value={stats.reviewed_count} />
          <StatCard label={t('clinician.dashboard.myReviews')} value={stats.my_feedback?.total_reviewed ?? 0} />
        </div>
      )}

      {/* My feedback breakdown */}
      {stats?.my_feedback && (
        <div className="panel panel-body">
          <h2 className="label m-0 mb-3.5">{t('clinician.dashboard.myFeedbackBreakdown')}</h2>
          <div className="flex gap-3 flex-wrap">
            <FeedbackBadge label={t('clinician.feedback.accept')} count={stats.my_feedback.accepted} tone="good" />
            <FeedbackBadge label={t('clinician.feedback.dispute')} count={stats.my_feedback.disputed} tone="caution" />
            <FeedbackBadge label={t('clinician.feedback.correct')} count={stats.my_feedback.corrected} tone="info" />
          </div>
        </div>
      )}

      {/* Pending cases list */}
      <div className="panel">
        <div className="panel-head">
          <h2 className="label m-0">{t('clinician.dashboard.pendingCases')}</h2>
          <Link to="/clinician/history" className="text-meta font-semibold text-brand-600 hover:text-brand-800 no-underline">
            {t('clinician.dashboard.viewAll')}
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
          </div>
        )}

        {!loading && pendingCases.length === 0 && (
          <div className="text-center py-12 text-body text-ink-600">
            <CheckCircle size={22} className="mx-auto mb-3 text-conf-good" />
            {t('clinician.dashboard.noPending')}
          </div>
        )}

        {!loading && pendingCases.length > 0 && (
          <div>
            {pendingCases.map((c) => (
              <CaseRow key={c.case_id} caseData={c} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="panel px-4 py-3.5">
      <div className="text-metric text-ink-950 tnum">{value}</div>
      <div className="text-meta text-ink-600 mt-1">{label}</div>
    </div>
  );
}

const FEEDBACK_TONES = {
  good: 'text-conf-good bg-conf-good-tint',
  caution: 'text-conf-caution bg-conf-caution-tint',
  info: 'text-info bg-info-tint',
};

function FeedbackBadge({ label, count, tone }) {
  return (
    <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-control text-body font-semibold ${FEEDBACK_TONES[tone]}`}>
      <span>{label}</span>
      <span className="text-meta font-bold opacity-70 tnum">{count}</span>
    </div>
  );
}

function CaseRow({ caseData, t }) {
  const confidence = caseData.confidence_score;
  const color = getConfidenceColor(confidence);

  return (
    <Link
      to={`/clinician/cases/${caseData.case_id}`}
      className="flex items-center gap-4 px-4 py-3.5 border-b border-line last:border-b-0 hover:bg-wash transition-colors no-underline group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-body font-semibold text-ink-950">{caseData.patient_username}</span>
          <span className="text-meta text-ink-500">#{String(caseData.case_id).slice(0, 8)}</span>
        </div>
        <div className="text-meta text-ink-600 truncate">
          {caseData.top_condition || t('clinician.cases.noCondition')}
        </div>
      </div>

      {confidence != null && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 bg-wash overflow-hidden">
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

      <div className="text-meta text-ink-500 shrink-0 hidden md:block">
        {new Date(caseData.created_at).toLocaleDateString()}
      </div>

      <ChevronRight size={16} className="text-ink-300 group-hover:text-brand-600 transition-colors shrink-0" />
    </Link>
  );
}
