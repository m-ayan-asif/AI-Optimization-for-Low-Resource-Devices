import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useClinician } from '../../hooks/useClinician';
import { getConfidenceColor } from '../../utils/imageValidation';
import {
  ArrowLeft, Eye, EyeOff, User, FileText, Clock, CheckCircle2,
  AlertTriangle, XCircle, PenLine, ShieldAlert, AlertCircle, Mic, Type
} from 'lucide-react';

const LOW_CONFIDENCE_THRESHOLD = 0.5;

// Tier boundaries, drawn beneath the confidence gauge — matches ResultsPage
// so the reading is legible the same way on both sides of a review.
const SCALE_TICKS = [30, 60, 80];

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
        <div className="w-10 h-10 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="notice notice-critical max-w-2xl mx-auto" role="alert">
        <AlertTriangle size={18} className="text-conf-critical shrink-0 mt-px" />
        <span className="text-body">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const isLowConfidence = data.confidence_score < LOW_CONFIDENCE_THRESHOLD;
  const confColor = getConfidenceColor(data.confidence_score);
  const confPercent = (data.confidence_score * 100).toFixed(0);
  const allScores = data.all_scores || {};
  const sortedConditions = Object.entries(allScores).sort((a, b) => b[1] - a[1]);

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16 space-y-4">
        <CheckCircle2 size={36} className="text-conf-good mx-auto" />
        <h2 className="text-h1 text-ink-950 m-0">{t('clinician.feedback.submitted')}</h2>
        <p className="text-body text-ink-600 m-0">{t('clinician.feedback.submittedDesc')}</p>
        <div className="flex gap-3 justify-center pt-2">
          <button onClick={() => navigate('/clinician/dashboard')} className="btn btn-primary">
            {t('clinician.dashboard.title')}
          </button>
          <button onClick={() => navigate('/clinician/history')} className="btn btn-secondary">
            {t('clinician.history.title')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link + title */}
      <header className="flex items-center gap-3 pb-3 border-b-2 border-ink-950">
        <Link
          to="/clinician/dashboard"
          aria-label={t('screening.back')}
          className="p-1.5 -ms-1.5 rounded-control text-ink-500 hover:text-ink-950 hover:bg-wash transition-colors no-underline"
        >
          <ArrowLeft size={18} />
        </Link>
        <FileText size={19} className="text-ink-600 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-h1 text-ink-950 m-0">{t('clinician.cases.reviewTitle')}</h1>
          <p className="text-meta text-ink-500 m-0 tnum">{t('clinician.cases.caseId')}: {caseId}</p>
        </div>
      </header>

      {/* Patient info */}
      <div className="panel">
        <div className="panel-head">
          <h2 className="label m-0 flex items-center gap-2">
            <User size={14} className="text-ink-600" />
            {t('clinician.cases.patientInfo')}
          </h2>
        </div>
        <div className="panel-body">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label={t('clinician.cases.username')} value={data.patient_username} />
            <InfoItem label={t('auth.age')} value={data.age || '—'} />
            <InfoItem label={t('auth.gender')} value={data.gender ? t(`auth.${data.gender.toLowerCase()}`) : '—'} />
            <InfoItem label={t('auth.region')} value={data.region || '—'} />
          </div>
          <div className="flex items-center gap-1.5 text-meta text-ink-500 mt-4 pt-4 border-t border-line">
            <Clock size={13} />
            {t('clinician.cases.submitted')}: {new Date(data.created_at).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Low confidence warning */}
      {isLowConfidence && (
        <div className="notice notice-critical">
          <ShieldAlert size={19} className="text-conf-critical shrink-0 mt-0.5" />
          <div>
            <h2 className="text-h2 text-ink-950 m-0">{t('results.unidentified')}</h2>
            <p className="text-body text-ink-800 m-0 mt-1">{t('results.unidentifiedDesc')}</p>
          </div>
        </div>
      )}

      {/* The reading — same treatment as the patient-facing results screen */}
      <section
        className="border-s-4 ps-5"
        style={{ borderColor: confColor }}
        aria-label={t('results.topCondition')}
      >
        <p className="label m-0">{t('results.topCondition')}</p>
        <p className="text-display text-ink-950 m-0 mt-2">
          {isLowConfidence ? t('results.inconclusive') : (data.top_condition || '—')}
        </p>

        <div className="mt-6">
          <div className="flex items-end justify-between gap-4">
            <span className="label m-0">{t('results.confidence')}</span>
            <span className="text-metric tnum" style={{ color: confColor }}>
              {confPercent}%
            </span>
          </div>
          <div className="h-2.5 bg-wash mt-2 overflow-hidden">
            <div
              className="h-full animate-grow"
              style={{ width: `${confPercent}%`, backgroundColor: confColor }}
            />
          </div>
          <div className="relative h-1.5" aria-hidden="true">
            {SCALE_TICKS.map((p) => (
              <span
                key={p}
                className="absolute top-0 w-px h-1.5 bg-line-strong"
                style={{ insetInlineStart: `${p}%` }}
              />
            ))}
          </div>
        </div>

        {data.inference_time_ms && (
          <div className="flex items-center gap-1.5 text-meta text-ink-500 mt-4">
            <Clock size={13} />
            {t('results.inferenceTime')} {data.inference_time_ms} {t('common.ms')}
          </div>
        )}
      </section>

      {/* Grad-CAM heatmap */}
      {data.heatmap_url && (
        <div className="panel">
          <div className="panel-head">
            <h2 className="label m-0 flex items-center gap-2">
              <Eye size={14} className="text-ink-600" />
              {t('results.heatmap')}
            </h2>
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              aria-label={t('results.heatmap')}
              className="text-brand-600 hover:text-brand-800 cursor-pointer bg-transparent border-none p-0"
            >
              {showHeatmap ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {showHeatmap && (
            <div className="panel-body">
              <div className="rounded-frame overflow-hidden border border-line-strong bg-wash">
                <img
                  src={data.heatmap_url}
                  alt="Grad-CAM Heatmap"
                  className="w-full object-contain max-h-96"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
              <p className="text-meta text-ink-600 mt-3 mb-0">{t('results.heatmapDesc')}</p>
            </div>
          )}
        </div>
      )}

      {/* All conditions breakdown */}
      {sortedConditions.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2 className="label m-0">{t('results.allConditions')}</h2>
          </div>
          <div>
            {sortedConditions.map(([condition, score], i) => {
              const isTop = i === 0 && !isLowConfidence;
              return (
                <div
                  key={condition}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-line last:border-b-0"
                >
                  <span
                    className={`text-body flex-1 min-w-0 sm:flex-none sm:w-44 ${
                      isTop ? 'font-semibold text-ink-950' : 'text-ink-600'
                    }`}
                  >
                    {condition}
                  </span>
                  <span
                    className={`text-meta w-11 text-end tnum order-2 sm:order-none ${
                      isTop ? 'font-semibold text-ink-950' : 'text-ink-500'
                    }`}
                  >
                    {(score * 100).toFixed(0)}%
                  </span>
                  <div className="w-full order-3 sm:order-none sm:w-auto sm:flex-1 h-1.5 bg-wash overflow-hidden">
                    <div
                      className="h-full animate-grow"
                      style={{
                        width: `${(score * 100).toFixed(0)}%`,
                        backgroundColor: isTop ? confColor : 'var(--color-line-strong)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Voice / text transcript */}
      {data.transcript_id && (
        <div className="panel">
          <div className="panel-head">
            <h2 className="label m-0 flex items-center gap-2">
              {data.transcript_audio_path
                ? <Mic size={14} className="text-ink-600" />
                : <Type size={14} className="text-ink-600" />}
              {data.transcript_audio_path ? 'Patient Voice Description' : 'Patient Written Description'}
            </h2>
            <span className="text-label font-semibold text-ink-600 bg-wash rounded-control px-2.5 py-1">
              {data.transcript_language === 'ur' ? 'Urdu' : 'English'}
            </span>
          </div>

          <div className="panel-body">
            {data.transcript_text ? (
              <p className="inset text-body text-ink-950 px-4 py-3 m-0">
                "{data.transcript_text}"
              </p>
            ) : (
              <p className="inset text-body text-ink-600 px-4 py-3 m-0">
                Audio recorded — transcription not yet available. Run{' '}
                <code className="font-mono text-meta bg-line rounded-frame px-1">download_asr_model.py</code>{' '}
                to enable Whisper transcription.
              </p>
            )}

            {data.symptoms && data.symptoms.length > 0 && (
              <div className="mt-4 pt-4 border-t border-line">
                <p className="label m-0 mb-2.5">Extracted Keywords</p>
                <div className="flex flex-wrap gap-2">
                  {data.symptoms.map((s, i) => (
                    <span
                      key={i}
                      className="text-meta font-semibold text-ink-800 bg-wash border border-line-strong rounded-control px-2.5 py-1"
                    >
                      {s.keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Existing feedback indicator */}
      {data.decision && !submitted && (
        <div className="notice notice-info">
          <AlertCircle size={18} className="text-info shrink-0 mt-px" />
          <p className="text-body text-ink-950 m-0">
            {t('clinician.feedback.alreadyReviewed', { reviewer: data.reviewer_username || t('clinician.feedback.you') })}
          </p>
        </div>
      )}

      {/* Feedback form */}
      <div className="panel">
        <div className="panel-head">
          <h2 className="label m-0 flex items-center gap-2">
            <PenLine size={14} className="text-ink-600" />
            {t('clinician.feedback.title')}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="panel-body space-y-5">
          {/* Decision buttons */}
          <div>
            <label className="label mb-3">{t('clinician.feedback.decision')}</label>
            <div className="grid grid-cols-3 gap-3">
              <DecisionButton
                value="accept"
                current={decision}
                onClick={() => setDecision('accept')}
                icon={<CheckCircle2 size={16} />}
                label={t('clinician.feedback.accept')}
                activeClass="border-conf-good bg-conf-good-tint text-conf-good"
              />
              <DecisionButton
                value="dispute"
                current={decision}
                onClick={() => setDecision('dispute')}
                icon={<XCircle size={16} />}
                label={t('clinician.feedback.dispute')}
                activeClass="border-conf-caution bg-conf-caution-tint text-conf-caution"
              />
              <DecisionButton
                value="correct"
                current={decision}
                onClick={() => setDecision('correct')}
                icon={<PenLine size={16} />}
                label={t('clinician.feedback.correct')}
                activeClass="border-info bg-info-tint text-info"
              />
            </div>
          </div>

          {/* Corrected diagnosis — only show when decision is 'correct' */}
          {decision === 'correct' && (
            <div>
              <label className="label mb-2">
                {t('clinician.feedback.correctedDiagnosis')} <span className="text-conf-critical">*</span>
              </label>
              <input
                type="text"
                value={correctedDiagnosis}
                onChange={(e) => setCorrectedDiagnosis(e.target.value)}
                placeholder={t('clinician.feedback.correctedDiagnosisPlaceholder')}
                className="field"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label mb-2">
              {t('clinician.feedback.notes')}
              <span className="text-ink-500 font-normal normal-case ms-1">({t('common.optional')})</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('clinician.feedback.notesPlaceholder')}
              rows={3}
              className="field resize-none"
            />
          </div>

          {submitError && (
            <div className="notice notice-critical">
              <AlertTriangle size={16} className="text-conf-critical shrink-0 mt-px" />
              <span className="text-body">{submitError}</span>
            </div>
          )}

          <button type="submit" disabled={submitting || !decision} className="btn btn-primary w-full">
            {submitting ? (
              <span className="w-[18px] h-[18px] border-2 border-white/35 border-t-white rounded-pill animate-spin" />
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
      <div className="label mb-1">{label}</div>
      <div className="text-body font-semibold text-ink-950">{value || '—'}</div>
    </div>
  );
}

function DecisionButton({ value, current, onClick, icon, label, activeClass }) {
  const isActive = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-control border-2 text-body font-semibold cursor-pointer transition-colors bg-surface ${
        isActive ? activeClass : 'border-line-strong text-ink-600 hover:border-ink-300'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
