import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceColor } from '../../utils/imageValidation';
import { LayoutDashboard, Clock, CheckCircle, AlertCircle, ChevronRight, Activity } from 'lucide-react';

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
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
          <LayoutDashboard size={20} className="text-purple-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('clinician.dashboard.title')}</h1>
          <p className="text-sm text-gray-400">{t('clinician.dashboard.welcome')}, {user?.username}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity size={18} className="text-purple-500" />}
            label={t('clinician.dashboard.totalCases')}
            value={stats.total_count}
            bg="bg-purple-50"
          />
          <StatCard
            icon={<Clock size={18} className="text-amber-500" />}
            label={t('clinician.dashboard.pending')}
            value={stats.pending_count}
            bg="bg-amber-50"
          />
          <StatCard
            icon={<CheckCircle size={18} className="text-green-500" />}
            label={t('clinician.dashboard.reviewed')}
            value={stats.reviewed_count}
            bg="bg-green-50"
          />
          <StatCard
            icon={<Activity size={18} className="text-blue-500" />}
            label={t('clinician.dashboard.myReviews')}
            value={stats.my_feedback?.total_reviewed ?? 0}
            bg="bg-blue-50"
          />
        </div>
      )}

      {/* My feedback breakdown */}
      {stats?.my_feedback && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">{t('clinician.dashboard.myFeedbackBreakdown')}</h2>
          <div className="flex gap-4 flex-wrap">
            <FeedbackBadge label={t('clinician.feedback.accept')} count={stats.my_feedback.accepted} color="text-green-700 bg-green-50 border-green-200" />
            <FeedbackBadge label={t('clinician.feedback.dispute')} count={stats.my_feedback.disputed} color="text-amber-700 bg-amber-50 border-amber-200" />
            <FeedbackBadge label={t('clinician.feedback.correct')} count={stats.my_feedback.corrected} color="text-blue-700 bg-blue-50 border-blue-200" />
          </div>
        </div>
      )}

      {/* Pending cases list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900">{t('clinician.dashboard.pendingCases')}</h2>
          <Link
            to="/clinician/history"
            className="text-sm text-purple-600 font-medium no-underline hover:text-purple-700"
          >
            {t('clinician.dashboard.viewAll')}
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
          </div>
        )}

        {!loading && pendingCases.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            <CheckCircle size={36} className="mx-auto mb-3 text-green-300" />
            {t('clinician.dashboard.noPending')}
          </div>
        )}

        {!loading && pendingCases.length > 0 && (
          <div className="divide-y divide-gray-50">
            {pendingCases.map((c) => (
              <CaseRow key={c.case_id} caseData={c} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bg }) {
  return (
    <div className={`${bg} rounded-2xl p-5 border border-white shadow-sm`}>
      <div className="mb-3">{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1 font-medium">{label}</div>
    </div>
  );
}

function FeedbackBadge({ label, count, color }) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold ${color}`}>
      <span>{label}</span>
      <span className="text-xs font-bold opacity-70">{count}</span>
    </div>
  );
}

function CaseRow({ caseData, t }) {
  const confidence = caseData.confidence_score;
  const color = getConfidenceColor(confidence);

  return (
    <Link
      to={`/clinician/cases/${caseData.case_id}`}
      className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors no-underline group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-gray-900">{caseData.patient_username}</span>
          <span className="text-xs text-gray-400">#{String(caseData.case_id).slice(0, 8)}</span>
        </div>
        <div className="text-sm text-gray-500 truncate">
          {caseData.top_condition || t('clinician.cases.noCondition')}
        </div>
      </div>

      {confidence != null && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${(confidence * 100).toFixed(0)}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-sm font-semibold text-gray-700 w-10 text-right">
            {(confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}

      <div className="text-xs text-gray-400 shrink-0 hidden md:block">
        {new Date(caseData.created_at).toLocaleDateString()}
      </div>

      <ChevronRight size={16} className="text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" />
    </Link>
  );
}
