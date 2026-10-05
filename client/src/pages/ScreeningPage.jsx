import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateImageFile, validateImageDimensions } from '../utils/imageValidation';
import { getClientDeviceSpecs } from '../utils/telemetry';
import api from '../utils/api';
import { getModePreference, setModePreference, shouldRunOnDevice, onDeviceSupported } from '../ondevice/mode';
import {
  Smartphone,
  Server,
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

// The on-device models (ONNX Runtime + transformers.js, several MB of JS) load only when a screening needs them.
const loadSkin = () => import('../ondevice/skinModel');
const loadAsrClient = () => import('../ondevice/asr');
const loadOutbox = () => import('../ondevice/outbox');
const isNetworkError = (err) => !err?.response;

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
    errorCode,
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
  const [modePref, setModePref] = useState(getModePreference);
  const onDevice = shouldRunOnDevice(modePref);
  const [deviceAnalysis, setDeviceAnalysis] = useState(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState(null); // { code, msg }
  const [progressText, setProgressText] = useState('');
  const fileInputRef = useRef(null);

  function chooseMode(mode) {
    setModePref(mode);
    setModePreference(mode);
    setDeviceAnalysis(null);
    setDeviceError(null);
  }

  // Runs the image model on the phone; returns null (and shows the guard message) when a guard rejects the photo.
  async function analyzeOnDevice(file) {
    setProgressText(t('screening.loadingModel'));
    try {
      const { analyzeImage } = await loadSkin();
      return await analyzeImage(file);
    } catch (err) {
      setDeviceError({ code: err.code || null, msg: err.message || t('common.error') });
      return null;
    } finally {
      setProgressText('');
    }
  }

  async function transcribeOnDevice(blob) {
    const [{ transcribeOnDevice: run, onAsrProgress }, { blobToPcm16k }] = await Promise.all([
      loadAsrClient(),
      import('../ondevice/audio'),
    ]);
    const unsubscribe = onAsrProgress((p) => {
      if (p.total) setProgressText(t('screening.downloadingSpeech', { pct: Math.round((100 * p.loaded) / p.total) }));
    });
    try {
      setProgressText(t('screening.transcribing'));
      const pcm = await blobToPcm16k(blob);
      return (await run(pcm)).text;
    } finally {
      unsubscribe();
      setProgressText('');
    }
  }

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
    setDeviceError(null);
    if (onDevice) {
      setDeviceBusy(true);
      const analysis = await analyzeOnDevice(imageFile);
      setDeviceBusy(false);
      if (!analysis) return;
      setDeviceAnalysis(analysis);
      loadAsrClient().then((m) => m.loadAsr()).catch(() => {}); // warm Whisper while the user records
      setStep(1);
      return;
    }
    try {
      const id = await createCase();
      setCaseId(id);
      await uploadImage(id, imageFile);
      setStep(1);
    } catch {
      // Error handled by hook
    }
  }

  // On-device path: transcribe on the phone, keep the screening in the outbox, upload it now if we can.
  async function finishOnDevice(skipVoice) {
    setStep(2);
    setDeviceBusy(true);
    const useAudio = !skipVoice && audioBlob;
    let transcript = null;
    if (useAudio) {
      try {
        transcript = await transcribeOnDevice(audioBlob);
      } catch (err) {
        // e.g. not enough memory for Whisper: the server transcribes the audio when the screening uploads
        console.warn('On-device transcription failed, leaving it to the server:', err);
      }
    }
    setProgressText(t('screening.savingOffline'));
    const outbox = await loadOutbox();
    const record = {
      imageBlob: imageFile,
      imageName: imageFile.name,
      audioBlob: useAudio ? audioBlob : null,
      transcript,
      language: voiceLang === 'en' ? 'en' : 'ur',
      text: skipVoice ? '' : textInput,
      prediction: deviceAnalysis.prediction,
      heatmapBlob: deviceAnalysis.heatmap,
    };
    const localId = await outbox.saveScreening(record);
    let target = `/results/local/${localId}`;
    if (navigator.onLine) {
      try {
        const serverCaseId = await outbox.uploadScreening({ ...record, id: localId });
        api.post(`/monitoring/${serverCaseId}/telemetry`, getClientDeviceSpecs()).catch(() => {});
        target = `/results/${serverCaseId}`;
      } catch (err) {
        if (!isNetworkError(err)) console.warn('Upload rejected, kept on the device:', err.response?.data);
      }
    }
    setDeviceBusy(false);
    setProgressText('');
    navigate(target);
  }

  // Server path failed because inference is down or we are offline: analyse on the phone instead of giving up.
  async function fallBackToDevice(id) {
    const analysis = await analyzeOnDevice(imageFile);
    if (!analysis) return false;
    const form = new FormData();
    form.append('prediction', JSON.stringify(analysis.prediction));
    form.append('heatmap', analysis.heatmap, 'heatmap.png');
    await api.post(`/screening/${id}/device-result`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    return true;
  }

  async function goToAnalysis(skipVoice = false) {
    if (onDevice && deviceAnalysis) {
      await finishOnDevice(skipVoice);
      return;
    }
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
      try {
        await runInference(caseId);
      } catch (err) {
        const unavailable = isNetworkError(err) || [502, 503, 504].includes(err.response?.status);
        if (!unavailable || !onDeviceSupported()) throw err;
        setError(null);
        if (!(await fallBackToDevice(caseId))) throw err;
      }

      // Asynchronous, unblocking telemetry dispatch
      const clientMetrics = getClientDeviceSpecs();
      api.post(`/monitoring/${caseId}/telemetry`, clientMetrics).catch((telErr) => {
      console.warn('Telemetry submission non-fatal warning:', telErr.message);
});

      navigate(`/results/${caseId}`);
    } catch {
      // On pre-inference guard failure (e.g. non-skin or blurry), navigate back to upload step
      setStep(0);
    }
  }

  const shownError = deviceError?.msg || error;
  const shownCode = deviceError ? deviceError.code : errorCode;
  const busy = loading || deviceBusy;

  function renderErrorMessage() {
    if (!shownError) return null;
    if (shownCode === 'NO_SKIN_DETECTED') return t('errors.noSkinDetected');
    if (shownCode === 'IMAGE_TOO_BLURRY') return t('errors.imageTooBlurry');
    if (shownCode === 'FILE_TOO_LARGE') return t('errors.fileTooLarge');
    if (shownCode === 'EMPTY_FILE') return t('errors.emptyFile');
    return shownError;
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* ── Step Indicator ── */}
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

      {shownError && (
        <div className="notice notice-critical mb-5" role="alert">
          <AlertCircle size={18} className="text-conf-critical shrink-0 mt-px" />
          <span className="text-body">{renderErrorMessage()}</span>
        </div>
      )}

      {/* ── Step 1: Image Upload ── */}
      {step === 0 && (
        <div className="panel panel-body">
          {onDeviceSupported() && (
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="label m-0">{t('screening.processingLabel')}</span>
              {[
                { mode: 'device', icon: <Smartphone size={14} />, label: t('screening.processingDevice') },
                { mode: 'server', icon: <Server size={14} />, label: t('screening.processingServer') },
              ].map((o) => {
                const active = (o.mode === 'device') === onDevice;
                return (
                  <button
                    key={o.mode}
                    onClick={() => chooseMode(o.mode)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-meta font-semibold border-2 cursor-pointer transition-colors ${
                      active
                        ? 'border-brand-600 bg-brand-50 text-brand-800'
                        : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
                    }`}
                  >
                    {o.icon} {o.label}
                  </button>
                );
              })}
              {onDevice && <p className="text-meta text-ink-500 m-0 w-full">{t('screening.processingDeviceHint')}</p>}
            </div>
          )}

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
            {progressText && <span className="text-meta text-ink-500 self-center me-3">{progressText}</span>}
            <button onClick={goToVoice} disabled={!imageFile || busy} className="btn btn-primary">
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('screening.next')} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Voice & Text Symptoms ── */}
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
              <button onClick={() => goToAnalysis(true)} disabled={busy} className="btn btn-secondary">
                <SkipForward size={16} /> {t('screening.voiceSkip')}
              </button>
              <button
                onClick={() => goToAnalysis(false)}
                disabled={(!audioBlob && !textInput.trim()) || busy}
                className="btn btn-primary"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {t('screening.submit')} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: Analysis Spinner ── */}
      {step === 2 && (
        <div className="panel panel-body text-center py-16">
          <div className="w-12 h-12 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin mx-auto mb-7" />
          <h2 className="text-h2 text-ink-950 m-0 mb-2">{t('screening.analyzing')}</h2>
          <p className="text-body text-ink-600 m-0">{progressText || t('screening.analyzingDesc')}</p>
        </div>
      )}
    </div>
  );
}
