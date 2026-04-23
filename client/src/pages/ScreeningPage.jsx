import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useScreening } from '../hooks/useScreening';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateImageFile, validateImageDimensions } from '../utils/imageValidation';
import { Upload, Mic, MicOff, SkipForward, ArrowLeft, ArrowRight, Loader2, AlertCircle, Check, ImagePlus, X } from 'lucide-react';

const STEPS = ['upload', 'voice', 'analysis'];

export default function ScreeningPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createCase, uploadImage, submitVoice, runInference, loading, error, setError } = useScreening();
  const { isRecording, audioBlob, duration, startRecording, stopRecording, clearRecording, error: micError } = useVoiceRecorder();

  const [step, setStep] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageErrors, setImageErrors] = useState([]);
  const [voiceLang, setVoiceLang] = useState('en');
  const [caseId, setCaseId] = useState(null);
  const fileInputRef = useRef(null);

  const handleImageSelect = useCallback(async (file) => {
    setImageErrors([]);
    const fileCheck = validateImageFile(file);
    if (!fileCheck.valid) { setImageErrors(fileCheck.errors); return; }
    const dimCheck = await validateImageDimensions(file);
    if (!dimCheck.valid) { setImageErrors(dimCheck.errors); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }, []);

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
      // error is already set in the hook; no-op here keeps TS happy
    }
  }

  async function goToAnalysis(skipVoice = false) {
    try {
      if (!skipVoice && audioBlob) {
        await submitVoice(caseId, audioBlob, voiceLang);
      }
      setStep(2);
      await runInference(caseId);
      navigate(`/results/${caseId}`);
    } catch (err) {
      setStep(1); // bounce back so the user sees the error banner
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-3 flex-1">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
              i < step ? 'bg-purple-600 text-white shadow-md shadow-purple-200' :
              i === step ? 'bg-purple-600 text-white shadow-md shadow-purple-200 ring-4 ring-purple-100' :
              'bg-gray-100 text-gray-400'
            }`}>
              {i < step ? <Check size={16} /> : i + 1}
            </div>
            <span className={`text-sm hidden sm:inline font-medium ${
              i <= step ? 'text-purple-700' : 'text-gray-300'
            }`}>
              {t(`screening.step${i + 1}`)}
            </span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 rounded ${i < step ? 'bg-purple-400' : 'bg-gray-100'}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mb-5 flex items-center gap-2 border border-red-100">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Step 1: Image Upload */}
      {step === 0 && (
        <div className="bg-white rounded-2xl border border-purple-100 p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">{t('screening.uploadTitle')}</h2>
          <p className="text-gray-400 text-sm mb-6">{t('screening.uploadDesc')}</p>

          {!imagePreview ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-purple-200 rounded-2xl p-14 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/30 transition-all group"
            >
              <div className="w-16 h-16 rounded-2xl bg-purple-50 flex items-center justify-center mx-auto mb-4 group-hover:bg-purple-100 transition-colors">
                <ImagePlus size={28} className="text-purple-400" />
              </div>
              <p className="text-gray-600 font-medium">{t('screening.dragDrop')}</p>
              <p className="text-gray-300 text-sm mt-2">{t('screening.requirements')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-gray-50 border border-gray-100">
                <img src={imagePreview} alt="Preview" className="w-full max-h-80 object-contain" />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); setImageErrors([]); }}
                  className="absolute top-3 right-3 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center cursor-pointer border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-all text-gray-500"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check size={16} />
                <span className="font-medium">Image ready — {imageFile.name}</span>
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
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl mt-4 border border-red-100">
              {imageErrors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}

          <div className="flex justify-end mt-8">
            <button
              onClick={goToVoice}
              disabled={!imageFile || loading}
              className="flex items-center gap-2 px-7 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 disabled:opacity-40 transition-all cursor-pointer text-sm font-semibold border-none shadow-md shadow-purple-200"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {t('screening.next')} <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Voice Symptoms */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-purple-100 p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-1">{t('screening.voiceTitle')}</h2>
          <p className="text-gray-400 text-sm mb-6">{t('screening.voiceDesc')}</p>

          {/* Language selector */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-600 mb-2">{t('screening.voiceLang')}</label>
            <div className="flex gap-3">
              {[{ code: 'en', label: 'English' }, { code: 'ur', label: 'اردو' }].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setVoiceLang(lang.code)}
                  className={`px-5 py-2.5 rounded-xl text-sm font-medium border-2 cursor-pointer transition-all ${
                    voiceLang === lang.code
                      ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recording controls */}
          <div className="flex flex-col items-center gap-5 py-10">
            <div className="relative">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`relative w-24 h-24 rounded-full flex items-center justify-center cursor-pointer border-none transition-all ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200 recording-pulse'
                    : 'bg-gradient-to-br from-purple-500 to-purple-700 hover:from-purple-600 hover:to-purple-800 shadow-lg shadow-purple-200'
                }`}
              >
                {isRecording ? <MicOff size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
              </button>
            </div>
            <p className="text-sm text-gray-500 font-medium">
              {isRecording ? `${t('screening.voiceStop')} — ${duration}s / 30s` : t('screening.voiceRecord')}
            </p>
            {audioBlob && !isRecording && (
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 px-4 py-2 rounded-full">
                <Check size={16} /> Recording captured ({duration}s)
              </div>
            )}
            {micError && <div className="text-sm text-red-500">{micError}</div>}
          </div>

          <div className="flex justify-between mt-6 pt-6 border-t border-gray-100">
            <button
              onClick={() => setStep(0)}
              className="flex items-center gap-2 px-4 py-2.5 text-gray-500 hover:text-gray-700 cursor-pointer bg-transparent border-none text-sm font-medium"
            >
              <ArrowLeft size={16} /> {t('screening.back')}
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => goToAnalysis(true)}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 text-gray-500 cursor-pointer bg-white border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <SkipForward size={16} /> {t('screening.voiceSkip')}
              </button>
              <button
                onClick={() => goToAnalysis(false)}
                disabled={!audioBlob || loading}
                className="flex items-center gap-2 px-7 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 disabled:opacity-40 transition-all cursor-pointer text-sm font-semibold border-none shadow-md shadow-purple-200"
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
        <div className="bg-white rounded-2xl border border-purple-100 p-16 text-center shadow-sm">
          <div className="w-16 h-16 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-8"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('screening.analyzing')}</h2>
          <p className="text-gray-400 text-sm">{t('screening.analyzingDesc')}</p>
        </div>
      )}
    </div>
  );
}
