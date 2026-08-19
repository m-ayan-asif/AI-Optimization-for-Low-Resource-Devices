import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceLevel, getConfidenceColor } from '../../utils/imageValidation';
import {
  ArrowLeft, Eye, EyeOff, User, FileText, Clock, CheckCircle2,
  AlertTriangle, XCircle, PenLine, ShieldAlert, AlertCircle, Mic, Type
} from 'lucide-react';

const LOW_CONFIDENCE_THRESHOLD = 0.5;

export default function CaseReviewPage() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const navigate = useNavigate();
  const { getCaseDetail, submitFeedback, loading } = useClinician();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);

  const [decision, setDecision] = useState('');
  const [correctedDiagnosis, setCorrectedDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (caseId) {
      getCaseDetail(caseId)
        .then((d) => {
          setData(d);
          // Pre-fill existing feedback if present
          if (d.decision) {
            setDecision(d.decision);
            setCorrectedDiagnosis(d.corrected_diagnosis || '');
            setNotes(d.feedback_notes || '');
          }
        })
        .catch((err) => setError(err.message || 'Failed to load case'));
    }
  }, [caseId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');

    if (!decision) {
      setSubmitError(t('clinician.feedback.decisionRequired'));
      return;
    }
    if (decision === 'correct' && !correctedDiagnosis.trim()) {
      setSubmitError(t('clinician.feedback.correctedDiagnosisRequired'));
      return;
    }

    setSubmitting(true);
    try {
      await submitFeedback(caseId, {
        decision,
        corrected_diagnosis: correctedDiagnosis.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err.message || t('clinician.feedback.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-600 p-6 rounded-2xl text-center border border-red-100">{error}</div>
    );
  }

  if (!data) return null;

  const isLowConfidence = data.confidence_score < LOW_CONFIDENCE_THRESHOLD;
  const level = getConfidenceLevel(data.confidence_score);
  const allScores = data.all_scores || {};
  const sortedConditions = Object.entries(allScores).sort((a, b) => b[1] - a[1]);

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{t('clinician.feedback.submitted')}</h2>
        <p className="text-gray-500 text-sm">{t('clinician.feedback.submittedDesc')}</p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={() => navigate('/clinician/dashboard')}
            className="px-5 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors cursor-pointer border-none"
          >
            {t('clinician.dashboard.title')}
          </button>
          <button
            onClick={() => navigate('/clinician/history')}
            className="px-5 py-2.5 bg-white text-gray-600 border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
          >
            {t('clinician.history.title')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link + title */}
      <div className="flex items-center gap-3">
        <Link
          to="/clinician/dashboard"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors no-underline"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
            <FileText size={20} className="text-purple-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('clinician.cases.reviewTitle')}</h1>
            <p className="text-xs text-gray-400">{t('clinician.cases.caseId')}: {caseId}</p>
          </div>
        </div>
      </div>

      {/* Patient info */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-purple-500" />
          <h3 className="font-semibold text-gray-900">{t('clinician.cases.patientInfo')}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoItem label={t('clinician.cases.username')} value={data.patient_username} />
          <InfoItem label={t('auth.age')} value={data.age || '—'} />
          <InfoItem label={t('auth.gender')} value={data.gender ? t(`auth.${data.gender.toLowerCase()}`) : '—'} />
          <InfoItem label={t('auth.region')} value={data.region || '—'} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-300 mt-4 pt-4 border-t border-gray-50">
          <Clock size={12} />
          {t('clinician.cases.submitted')}: {new Date(data.created_at).toLocaleString()}
        </div>
      </div>

      {/* Low confidence warning */}
      {isLowConfidence && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex gap-4">
          <ShieldAlert size={22} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800 mb-1">{t('results.unidentified')}</h3>
            <p className="text-sm text-red-700 leading-relaxed">{t('results.unidentifiedDesc')}</p>
          </div>
        </div>
      )}

      {/* Top condition */}
      <div className={`bg-white rounded-2xl border p-7 shadow-sm ${isLowConfidence ? 'border-red-200 opacity-80' : 'border-purple-100'}`}>
        <div className="text-sm text-gray-400 font-medium uppercase tracking-wide mb-1">{t('results.topCondition')}</div>
        <div className="text-2xl font-bold text-gray-900 mb-4">
          {isLowConfidence ? t('results.inconclusive') : (data.top_condition || '—')}
        </div>

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

      {/* Grad-CAM heatmap */}
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
              {showHeatmap ? <EyeOff size={16} /> : <Eye size={16} />}
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
      {sortedConditions.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-7">
          <h3 className="font-semibold text-gray-900 mb-5">{t('results.allConditions')}</h3>
          <div className="space-y-3.5">
            {sortedConditions.map(([condition, score], i) => (
              <div key={condition} className="flex items-center gap-4">
                <span className={`text-sm w-44 shrink-0 ${i === 0 && !isLowConfidence ? 'font-semibold text-purple-700' : 'text-gray-600'}`}>
                  {condition}
                </span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full animate-grow ${i === 0 && !isLowConfidence ? 'bg-purple-500' : 'bg-purple-200'}`}
                    style={{ width: `${(score * 100).toFixed(0)}%` }}
                  />
                </div>
                <span className={`text-sm w-12 text-right font-medium ${i === 0 && !isLowConfidence ? 'text-purple-600' : 'text-gray-400'}`}>
                  {(score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice / text transcript */}
      {data.transcript_id && (
        <div className="bg-white rounded-2xl border border-gray-100 p-7">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              {data.transcript_audio_path
                ? <Mic size={18} className="text-purple-500" />
                : <Type size={18} className="text-purple-500" />}
              {data.transcript_audio_path ? 'Patient Voice Description' : 'Patient Written Description'}
            </h3>
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-50 text-purple-600 border border-purple-100">
              {data.transcript_language === 'ur' ? 'Urdu' : 'English'}
            </span>
          </div>

          {data.transcript_text ? (
            <p className="text-sm text-gray-700 leading-relaxed italic bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
              "{data.transcript_text}"
            </p>
          ) : (
            <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
              Audio recorded — transcription not yet available. Run <code className="font-mono text-xs bg-gray-200 px-1 rounded">download_asr_model.py</code> to enable Whisper transcription.
            </p>
          )}

          {data.symptoms && data.symptoms.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Extracted Keywords</p>
              <div className="flex flex-wrap gap-2">
                {data.symptoms.map((s, i) => (
                  <span key={i} className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-sm font-medium border border-purple-100">
                    {s.keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Existing feedback indicator */}
      {data.decision && !submitted && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-blue-500 shrink-0" />
          <p className="text-sm text-blue-800">
            {t('clinician.feedback.alreadyReviewed', { reviewer: data.reviewer_username || t('clinician.feedback.you') })}
          </p>
        </div>
      )}

      {/* Feedback form */}
      <div className="bg-white rounded-2xl border border-purple-100 p-7 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <PenLine size={18} className="text-purple-500" />
          <h3 className="font-semibold text-gray-900">{t('clinician.feedback.title')}</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Decision buttons */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-3">{t('clinician.feedback.decision')}</label>
            <div className="grid grid-cols-3 gap-3">
              <DecisionButton
                value="accept"
                current={decision}
                onClick={() => setDecision('accept')}
                icon={<CheckCircle2 size={16} />}
                label={t('clinician.feedback.accept')}
                activeClass="border-green-500 bg-green-50 text-green-700"
              />
              <DecisionButton
                value="dispute"
                current={decision}
                onClick={() => setDecision('dispute')}
                icon={<XCircle size={16} />}
                label={t('clinician.feedback.dispute')}
                activeClass="border-amber-500 bg-amber-50 text-amber-700"
              />
              <DecisionButton
                value="correct"
                current={decision}
                onClick={() => setDecision('correct')}
                icon={<PenLine size={16} />}
                label={t('clinician.feedback.correct')}
                activeClass="border-blue-500 bg-blue-50 text-blue-700"
              />
            </div>
          </div>

          {/* Corrected diagnosis — only show when decision is 'correct' */}
          {decision === 'correct' && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">
                {t('clinician.feedback.correctedDiagnosis')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={correctedDiagnosis}
                onChange={(e) => setCorrectedDiagnosis(e.target.value)}
                placeholder={t('clinician.feedback.correctedDiagnosisPlaceholder')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all bg-gray-50/50 placeholder-gray-300"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">
              {t('clinician.feedback.notes')}
              <span className="text-gray-400 font-normal ml-1">({t('common.optional')})</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('clinician.feedback.notesPlaceholder')}
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all bg-gray-50/50 placeholder-gray-300 resize-none"
            />
          </div>

          {submitError && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !decision}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all disabled:opacity-50 cursor-pointer text-sm shadow-md shadow-purple-200 flex items-center justify-center gap-2 border-none"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              t('clinician.feedback.submit')
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function InfoItem({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-400 font-medium mb-0.5">{label}</div>
      <div className="text-sm text-gray-800 font-medium">{value || '—'}</div>
    </div>
  );
}

function DecisionButton({ value, current, onClick, icon, label, activeClass }) {
  const isActive = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 text-sm font-semibold transition-all cursor-pointer bg-white ${
        isActive ? activeClass : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
