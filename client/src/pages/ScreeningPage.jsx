import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateImageFile, validateImageDimensions } from '../utils/imageValidation';
import {
  Mic,
  MicOff,
  SkipForward,
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertCircle,
  Check,
  ImagePlus,
  X,
  Type,
} from 'lucide-react';

const STEPS = ['upload', 'voice', 'analysis'];

export default function ScreeningPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    createCase,
    uploadImage,
    submitVoice,
    submitTextInput,
    runInference,
    loading,
    error,
    setError,
  } = useScreening();
  const {
    isRecording,
    audioBlob,
    duration,
    startRecording,
    stopRecording,
    error: micError,
  } = useVoiceRecorder();

  const [step, setStep] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageErrors, setImageErrors] = useState([]);
  const [voiceLang, setVoiceLang] = useState('en');
  const [textInput, setTextInput] = useState('');
  const [caseId, setCaseId] = useState(null);
  const fileInputRef = useRef(null);

  const handleImageSelect = useCallback(
    async (file) => {
      setImageErrors([]);
      setError(null);
      const fileCheck = validateImageFile(file);
      if (!fileCheck.valid) {
        setImageErrors(fileCheck.errors);
        return;
      }
      const dimCheck = await validateImageDimensions(file);
      if (!dimCheck.valid) {
        setImageErrors(dimCheck.errors);
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    },
    [setError]
  );

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }

  async function goToVoice() {
    if (!imageFile) return;
    try {
      const id = await createCase();
      setCaseId(id);
      await uploadImage(id, imageFile);
      setStep(1);
    } catch (err) {
      // Handled in useScreening hook
    }
  }

  async function goToAnalysis(skipVoice = false) {
    try {
      const hasText = textInput.trim().length > 0;
      if (!skipVoice) {
        if (audioBlob) {
          await submitVoice(caseId, audioBlob, voiceLang, hasText ? textInput : null);
        } else if (hasText) {
          await submitTextInput(caseId, textInput, voiceLang);
        }
      }
      setStep(2);
      await runInference(caseId);
      navigate(`/results/${caseId}`);
    } catch (err) {
      setStep(0); // Bounce back to step 0 if image fails skin validation
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator — a numbered sequence, not a badge cluster */}
      <div className="flex items-center gap-2 mb-7" aria-label={t('screening.title')}>
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={`w-8 h-8 rounded-control flex items-center justify-center text-meta font-bold shrink-0 tnum ${
                i <= step ? 'bg-brand-800 text-white' : 'bg-wash text-ink-500'
              }`}
            >
              {i < step ? <Check size={14} /> : i + 1}
            </div>
            <span
              className={`text-meta hidden sm:inline font-semibold ${
                i <= step ? 'text-ink-950' : 'text-ink-300'
              }`}
            >
              {t(`screening.step${i + 1}`)}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px ${i < step ? 'bg-brand-800' : 'bg-line'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="notice notice-critical mb-5" role="alert">
          <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
          <span className="text-body">
            {error.includes('No skin detected') ? t('screening.noSkinError') : error}
          </span>
        </div>
      )}

      {/* Step 1: Image Upload */}
      {step === 0 && (
        <div className="panel panel-body">
          <h2 className="text-h2 text-ink-950 m-0 mb-1">{t('screening.uploadTitle')}</h2>
          <p className="text-body text-ink-600 mb-6 mt-1">{t('screening.uploadDesc')}</p>

          {!imagePreview ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              className="border-2 border-dashed border-line-strong rounded-panel p-12 text-center cursor-pointer hover:border-brand-600 hover:bg-wash transition-colors"
            >
              <ImagePlus size={30} className="text-ink-500 mx-auto mb-3" />
              <p className="text-body font-semibold text-ink-800 m-0">{t('screening.dragDrop')}</p>
              <p className="text-meta text-ink-500 mt-2 mb-0">{t('screening.requirements')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-frame overflow-hidden bg-wash border border-line-strong">
                <img src={imagePreview} alt="Preview" className="w-full max-h-80 object-contain" />
                <button
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    setImageErrors([]);
                  }}
                  aria-label={t('common.cancel')}
                  className="absolute top-2 end-2 w-8 h-8 bg-surface rounded-control flex items-center justify-center cursor-pointer border border-line-strong hover:border-conf-critical hover:text-conf-critical transition-colors text-ink-600"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-body text-conf-good">
                <Check size={16} />
                <span className="font-semibold">
                  {t('screening.imageReady', { name: imageFile.name })}
                </span>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files[0] && handleImageSelect(e.target.files[0])}
          />

          {imageErrors.length > 0 && (
            <div className="notice notice-critical mt-4">
              <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
              <div className="text-body">
                {imageErrors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end mt-7">
            <button onClick={goToVoice} disabled={!imageFile || loading} className="btn btn-primary">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('screening.next')} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Voice + Text Symptoms */}
      {step === 1 && (
        <div className="panel panel-body">
          <h2 className="text-h2 text-ink-950 m-0 mb-1">{t('screening.voiceTitle')}</h2>
          <p className="text-body text-ink-600 mb-6 mt-1">{t('screening.voiceDesc')}</p>

          <div className="mb-7">
            <label className="label mb-2">{t('screening.voiceLang')}</label>
            <div className="flex gap-2.5 flex-wrap">
              {[
                { code: 'en', label: 'English' },
                { code: 'ur', label: 'اردو' },
                { code: 'ro', label: t('screening.langRomanUrdu') },
              ].map((lang) => {
                const active = voiceLang === lang.code;
                return (
                  <button
                    key={lang.code}
                    onClick={() => setVoiceLang(lang.code)}
                    aria-pressed={active}
                    className={`px-4 py-2 rounded-control text-body font-semibold border-2 cursor-pointer transition-colors ${
                      active
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
                    }`}
                  >
                    {lang.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col items-center gap-5 py-8 border-y border-line">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              aria-pressed={isRecording}
              aria-label={isRecording ? t('screening.voiceStop') : t('screening.voiceRecord')}
              className={`relative w-24 h-24 rounded-pill flex items-center justify-center cursor-pointer border-none transition-colors ${
                isRecording
                  ? 'bg-conf-critical hover:opacity-90 recording-pulse'
                  : 'bg-brand-800 hover:bg-brand-700'
              }`}
            >
              {isRecording ? (
                <MicOff size={32} className="text-white" />
              ) : (
                <Mic size={32} className="text-white" />
              )}
            </button>
            <p className="text-body text-ink-600 font-semibold tnum">
              {isRecording
                ? `${t('screening.voiceStop')} — ${duration}s / 30s`
                : t('screening.voiceRecord')}
            </p>
            {audioBlob && !isRecording && (
              <div className="flex items-center gap-2 text-meta font-semibold text-conf-good bg-conf-good-tint px-3.5 py-1.5 rounded-control">
                <Check size={15} /> Recording captured ({duration}s)
              </div>
            )}
            {micError && <div className="text-meta text-conf-critical">{micError}</div>}
          </div>

          <div className="pt-6 mt-2">
            <label className="flex items-center gap-2 label mb-3">
              <Type size={14} className="text-ink-500" />
              {t('screening.textTitle')}
            </label>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={t('screening.textPlaceholder')}
              rows={4}
              className="field resize-none"
              dir="auto"
            />
          </div>

          <div className="flex justify-between mt-6 pt-6 border-t border-line">
            <button onClick={() => setStep(0)} className="btn btn-quiet">
              <ArrowLeft size={16} /> {t('screening.back')}
            </button>
            <div className="flex gap-3">
              <button onClick={() => goToAnalysis(true)} disabled={loading} className="btn btn-secondary">
                <SkipForward size={16} /> {t('screening.voiceSkip')}
              </button>
              <button
                onClick={() => goToAnalysis(false)}
                disabled={(!audioBlob && !textInput.trim()) || loading}
                className="btn btn-primary"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {t('screening.submit')} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Analysis loading */}
      {step === 2 && (
        <div className="panel panel-body text-center py-16">
          <div className="w-12 h-12 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin mx-auto mb-7" />
          <h2 className="text-h2 text-ink-950 m-0 mb-2">{t('screening.analyzing')}</h2>
          <p className="text-body text-ink-600 m-0">{t('screening.analyzingDesc')}</p>
        </div>
      )}
    </div>
  );
}
