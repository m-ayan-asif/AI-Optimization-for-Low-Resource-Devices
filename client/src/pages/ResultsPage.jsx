import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { getConfidenceColor } from '../utils/imageValidation';
import {
  MapPin,
  Plus,
  AlertTriangle,
  Clock,
  Eye,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  PenLine,
  Stethoscope,
  Mic,
  Info,
} from 'lucide-react';

const OUT_OF_SCOPE_THRESHOLD = 0.3;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// Tier boundaries, drawn as a scale beneath the confidence gauge so the
// reading can be judged against the thresholds that produced it.
const SCALE_TICKS = [30, 60, 80];

export default function ResultsPage() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const { getResults, loading } = useScreening();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);

  useEffect(() => {
    if (caseId) {
      getResults(caseId)
        .then(setData)
        .catch((err) => setError(err.response?.data?.error || 'Failed to load'));
    }
  }, [caseId]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-9 h-9 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
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

  const isOutOfScope = (data.confidence_score || 0) <= OUT_OF_SCOPE_THRESHOLD;
  const isLowConfidence = !isOutOfScope && (data.confidence_score || 0) < LOW_CONFIDENCE_THRESHOLD;
  const confColor = getConfidenceColor(data.confidence_score);
  const confPercent = (data.confidence_score * 100).toFixed(0);
  const allScores = data.all_scores || {};
  const sortedConditions = Object.entries(allScores).sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-2xl mx-auto pb-6">
      {/* ── Report masthead ────────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-4 pb-3 border-b-2 border-ink-950">
        <h1 className="text-h1 text-ink-950 m-0">{t('results.title')}</h1>
        {data.inference_time_ms && (
          <span className="flex items-center gap-1.5 text-meta text-ink-500 shrink-0 tnum">
            <Clock size={13} />
            {t('results.inferenceTime')} {data.inference_time_ms} {t('common.ms')}
          </span>
        )}
      </header>

      {/* ── The reading ─────────────────────────────────────────────────
          Deliberately not a card. It sits on the page behind a rule in its
          own tier colour, so it outranks every panel below it. */}
      <section
        className="border-s-4 ps-5 mt-7"
        style={{ borderColor: confColor }}
        aria-label={t('results.topCondition')}
      >
        <p className="label m-0">{t('results.topCondition')}</p>
        <p className="text-display text-ink-950 m-0 mt-2">
          {isOutOfScope ? t('results.clearOrOutOfScope') : data.top_condition}
        </p>

        <div className="mt-6">
          <div className="flex items-end justify-between gap-4">
            <span className="label m-0">{t('results.confidence')}</span>
            <span className="text-metric tnum" style={{ color: confColor }}>
              {confPercent}%
            </span>
          </div>

          {/* Gauge — square ends, not a pill, so it reads as a measurement */}
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

        {isOutOfScope ? (
          <p className="text-meta text-ink-600 mt-3 mb-0">{t('results.outOfScopeNote')}</p>
        ) : isLowConfidence ? (
          <p className="text-meta text-ink-600 mt-3 mb-0">
            {t('results.lowConfidenceNote', { condition: data.top_condition })}
          </p>
        ) : null}
      </section>

      {/* ── Qualifier on the reading ───────────────────────────────────── */}
      {isOutOfScope ? (
        <div className="notice notice-neutral mt-6">
          <Info size={19} className="text-ink-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-h2 text-ink-950 m-0">{t('results.outOfScopeTitle')}</h2>
            <p className="text-body text-ink-800 m-0 mt-1">{t('results.outOfScopeDesc')}</p>
          </div>
        </div>
      ) : isLowConfidence ? (
        <div className="notice notice-caution mt-6">
          <ShieldAlert size={19} className="text-conf-caution shrink-0 mt-0.5" />
          <div>
            <h2 className="text-h2 text-ink-950 m-0">{t('results.unidentified')}</h2>
            <p className="text-body text-ink-800 m-0 mt-1">{t('results.unidentifiedDesc')}</p>
          </div>
        </div>
      ) : null}

      {/* ── Grad-CAM heatmap ───────────────────────────────────────────── */}
      {data.heatmap_url && (
        <section className="panel mt-6">
          <div className="panel-head">
            <h2 className="label m-0 flex items-center gap-2">
              <Eye size={14} className="text-ink-600" />
              {t('results.heatmap')}
            </h2>
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className="text-meta font-semibold text-brand-600 hover:text-brand-800 cursor-pointer bg-transparent border-none p-0"
            >
              {showHeatmap ? 'Hide' : 'Show'}
            </button>
          </div>
          {showHeatmap && (
            <div className="panel-body">
              <div className="rounded-frame overflow-hidden border border-line-strong bg-wash">
                <img
                  src={data.heatmap_url}
                  alt="Grad-CAM Heatmap"
                  className="w-full object-contain max-h-96"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
              <p className="text-meta text-ink-600 mt-3 mb-0">{t('results.heatmapDesc')}</p>
            </div>
          )}
        </section>
      )}

      {/* ── Full differential ──────────────────────────────────────────── */}
      <section className="panel mt-6">
        <div className="panel-head">
          <h2 className="label m-0">{t('results.allConditions')}</h2>
        </div>
        <div>
          {sortedConditions.map(([condition, score], i) => {
            const isTop = i === 0 && !isOutOfScope;
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
      </section>

      {/* ── Reported symptoms ──────────────────────────────────────────── */}
      {data.transcript_id && (
        <section className="panel mt-6">
          <div className="panel-head">
            <h2 className="label m-0 flex items-center gap-2">
              <Mic size={14} className="text-ink-600" />
              {t('results.symptoms')}
            </h2>
            {data.transcript_language && (
              <span className="text-meta font-semibold text-ink-600">
                {data.transcript_language === 'ur' ? 'Urdu' : 'English'}
              </span>
            )}
          </div>

          <div className="panel-body">
            {data.transcript_text ? (
              <p className="inset text-body text-ink-950 px-4 py-3 m-0">
                "{data.transcript_text}"
              </p>
            ) : (
              <p className="inset text-body text-ink-600 px-4 py-3 m-0">
                Voice recorded — transcription processing.
              </p>
            )}

            {data.symptoms && data.symptoms.length > 0 && (
              <div className="mt-4 pt-4 border-t border-line">
                <p className="label m-0 mb-2.5">Keywords</p>
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
        </section>
      )}

      {/* ── Clinician review ───────────────────────────────────────────── */}
      {data.clinician_decision && <ClinicianReviewCard data={data} t={t} />}

      {/* ── Disclaimer — medical text, kept at full body size ──────────── */}
      <div className="notice notice-caution mt-6">
        <AlertTriangle size={19} className="text-conf-caution shrink-0 mt-0.5" />
        <p className="text-body text-ink-950 m-0">{t('results.disclaimer')}</p>
      </div>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 mt-7">
        <Link to="/clinics" className="btn btn-primary flex-1">
          <MapPin size={16} /> {t('results.findClinic')}
        </Link>
        <Link to="/screening" className="btn btn-secondary flex-1">
          <Plus size={16} /> {t('results.newScreening')}
        </Link>
      </div>
    </div>
  );
}

const DECISION_CONFIG = {
  accept: {
    icon: <CheckCircle2 size={16} className="text-conf-good shrink-0" />,
    label: (t) => t('clinician.feedback.accept'),
    tone: 'text-conf-good',
    rule: 'var(--color-conf-good)',
  },
  dispute: {
    icon: <XCircle size={16} className="text-conf-caution shrink-0" />,
    label: (t) => t('clinician.feedback.dispute'),
    tone: 'text-conf-caution',
    rule: 'var(--color-conf-caution)',
  },
  correct: {
    icon: <PenLine size={16} className="text-info shrink-0" />,
    label: (t) => t('clinician.feedback.correct'),
    tone: 'text-info',
    rule: 'var(--color-info)',
  },
};

function ClinicianReviewCard({ data, t }) {
  const cfg = DECISION_CONFIG[data.clinician_decision];
  if (!cfg) return null;

  return (
    <section className="panel mt-6 border-s-4" style={{ borderInlineStartColor: cfg.rule }}>
      <div className="panel-head">
        <h2 className="label m-0 flex items-center gap-2">
          <Stethoscope size={14} className="text-ink-600" />
          {t('results.clinicianReview')}
        </h2>
        <span className={`flex items-center gap-1.5 text-meta font-semibold ${cfg.tone}`}>
          {cfg.icon}
          {cfg.label(t)}
        </span>
      </div>

      <div className="panel-body space-y-4">
        {data.corrected_diagnosis && (
          <div>
            <p className="label m-0 mb-1">{t('results.clinicianCorrectedDiagnosis')}</p>
            <p className="text-h2 text-ink-950 m-0">{data.corrected_diagnosis}</p>
          </div>
        )}

        {data.clinician_notes && (
          <div>
            <p className="label m-0 mb-1">{t('results.clinicianNotes')}</p>
            <p className="text-body text-ink-800 m-0">{data.clinician_notes}</p>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-meta text-ink-500 pt-3 border-t border-line">
          <Clock size={13} />
          {t('results.reviewedBy')} {data.reviewer_username} ·{' '}
          {new Date(data.reviewed_at).toLocaleString()}
        </div>
      </div>
    </section>
  );
}
