import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateImageFile, validateImageDimensions } from '../utils/imageValidation';
import { Upload, Camera, Mic, MicOff, SkipForward, ArrowLeft, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

const STEPS = ['upload', 'voice', 'analysis'];

export default function ScreeningPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createCase, uploadImage, submitVoice, runInference, loading, error } = useScreening();
  const { isRecording, audioBlob, duration, startRecording, stopRecording, clearRecording, error: micError } = useVoiceRecorder();

  const [step, setStep] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageErrors, setImageErrors] = useState([]);
  const [voiceLang, setVoiceLang] = useState('en');
  const [voiceTranscript, setVoiceTranscript] = useState(null);
  const [caseId, setCaseId] = useState(null);
  const fileInputRef = useRef(null);

  // Step 1: Image handling
  const handleImageSelect = useCallback(async (file) => {
    setImageErrors([]);
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
  }, []);

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImageSelect(file);
  }

  // Step transitions
  async function goToVoice() {
    if (!imageFile) return;
    try {
      const id = await createCase();
      setCaseId(id);
      await uploadImage(id, imageFile);
      setStep(1);
    } catch (_) {}
  }

  async function goToAnalysis(skipVoice = false) {
    try {
      if (!skipVoice && audioBlob) {
        const result = await submitVoice(caseId, audioBlob, voiceLang);
        setVoiceTranscript(result);
      }
      setStep(2);
      // Run inference
      await runInference(caseId);
      // Navigate to results
      navigate(`/results/${caseId}`);
    } catch (_) {}
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              i <= step ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${i <= step ? 'text-teal-700 font-medium' : 'text-gray-400'}`}>
              {t(`screening.step${i + 1}`)}
            </span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mb-4 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Step 1: Image Upload */}
      {step === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <h2 className="text-xl font-semibold mb-2">{t('screening.uploadTitle')}</h2>
          <p className="text-gray-500 text-sm mb-6">{t('screening.uploadDesc')}</p>

          {!imagePreview ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-colors"
            >
              <Upload size={40} className="mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 font-medium">{t('screening.dragDrop')}</p>
              <p className="text-gray-400 text-sm mt-2">{t('screening.requirements')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden bg-gray-100">
                <img src={imagePreview} alt="Preview" className="w-full max-h-80 object-contain" />
              </div>
              <button
                onClick={() => { setImageFile(null); setImagePreview(null); setImageErrors([]); }}
                className="text-sm text-gray-500 hover:text-red-500 cursor-pointer bg-transparent border-none"
              >
                Remove and re-upload
              </button>
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
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mt-4">
              {imageErrors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}

          <div className="flex justify-end mt-6">
            <button
              onClick={goToVoice}
              disabled={!imageFile || loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors cursor-pointer text-sm font-medium border-none"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('screening.next')} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Voice Symptoms */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <h2 className="text-xl font-semibold mb-2">{t('screening.voiceTitle')}</h2>
          <p className="text-gray-500 text-sm mb-6">{t('screening.voiceDesc')}</p>

          {/* Language selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('screening.voiceLang')}</label>
            <div className="flex gap-3">
              {[{ code: 'en', label: 'English' }, { code: 'ur', label: 'اردو' }].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setVoiceLang(lang.code)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border-2 cursor-pointer transition-colors ${
                    voiceLang === lang.code
                      ? 'border-teal-600 bg-teal-50 text-teal-700'
                      : 'border-gray-200 bg-white text-gray-600'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recording controls */}
          <div className="flex flex-col items-center gap-4 py-8">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-20 h-20 rounded-full flex items-center justify-center cursor-pointer border-none transition-colors ${
                isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              {isRecording ? <MicOff size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
            </button>
            <p className="text-sm text-gray-500">
              {isRecording ? `${t('screening.voiceStop')} (${duration}s / 30s)` : t('screening.voiceRecord')}
            </p>
            {audioBlob && !isRecording && (
              <div className="text-sm text-green-600 font-medium">Recording captured ({duration}s)</div>
            )}
            {micError && <div className="text-sm text-red-500">{micError}</div>}
          </div>

          <div className="flex justify-between mt-6">
            <button
              onClick={() => setStep(0)}
              className="flex items-center gap-2 px-4 py-2.5 text-gray-600 hover:text-gray-900 cursor-pointer bg-transparent border-none text-sm"
            >
              <ArrowLeft size={16} /> {t('screening.back')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => goToAnalysis(true)}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 text-gray-500 hover:text-gray-700 cursor-pointer bg-transparent border border-gray-200 rounded-lg text-sm"
              >
                <SkipForward size={16} /> {t('screening.voiceSkip')}
              </button>
              <button
                onClick={() => goToAnalysis(false)}
                disabled={!audioBlob || loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors cursor-pointer text-sm font-medium border-none"
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
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-teal-600 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold mb-2">{t('screening.analyzing')}</h2>
          <p className="text-gray-500 text-sm">{t('screening.analyzingDesc')}</p>
        </div>
      )}
    </div>
  );
}
