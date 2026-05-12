// Mock predictions to return while ML pipeline isn't integrated
// These simulate what the real AI inference module would return

const MOCK_CONDITIONS = [
  'Eczema',
  'Psoriasis',
  'Vitiligo',
  'Melasma',
  'Tinea',
  'Seborrheic Dermatitis',
  'Contact Dermatitis',
];

function generateMockPrediction() {
  const topIdx = Math.floor(Math.random() * MOCK_CONDITIONS.length);
  const topConfidence = 0.65 + Math.random() * 0.3; // 0.65–0.95
  let remaining = 1 - topConfidence;

  const allScores = {};
  MOCK_CONDITIONS.forEach((condition, i) => {
    if (i === topIdx) {
      allScores[condition] = parseFloat(topConfidence.toFixed(3));
    } else {
      const share = i === MOCK_CONDITIONS.length - 1
        ? remaining
        : remaining * Math.random() * 0.5;
      allScores[condition] = parseFloat(share.toFixed(3));
      remaining -= share;
    }
  });

  return {
    model_version: 'v0.1.0-mock',
    top_condition: MOCK_CONDITIONS[topIdx],
    confidence_score: parseFloat(topConfidence.toFixed(3)),
    all_scores: allScores,
    heatmap_path: null, // Will be a real path once Grad-CAM is integrated
    inference_time_ms: Math.floor(800 + Math.random() * 2000),
  };
}

function generateMockTranscript(language) {
  const symptoms = {
    en: [
      { text: 'I have itching on my arms for two weeks', keywords: ['itching', 'arms', 'two weeks'] },
      { text: 'Red patches appeared on my face with burning', keywords: ['red patches', 'face', 'burning'] },
      { text: 'Dry flaky skin on my legs since last month', keywords: ['dry skin', 'flaky', 'legs'] },
    ],
    ur: [
      { text: 'مجھے دو ہفتوں سے بازوؤں پر خارش ہو رہی ہے', keywords: ['خارش', 'بازو', 'دو ہفتے'] },
      { text: 'چہرے پر سرخ دھبے آ گئے ہیں جلن کے ساتھ', keywords: ['سرخ دھبے', 'چہرہ', 'جلن'] },
      { text: 'ٹانگوں پر خشک جلد پچھلے مہینے سے ہے', keywords: ['خشک جلد', 'ٹانگیں', 'پچھلا مہینہ'] },
    ],
  };

  const lang = language === 'ur' ? 'ur' : 'en';
  const pick = symptoms[lang][Math.floor(Math.random() * symptoms[lang].length)];

  return {
    transcript_text: pick.text,
    language: lang,
    confidence_score: 0.82 + Math.random() * 0.15,
    keywords: pick.keywords,
  };
}

const MOCK_CLINICS = [
  {
    name: 'PIMS Hospital', city: 'Islamabad', region: 'Islamabad',
    address: 'G-8/3, Islamabad', phone: '051-9261170',
    lat: 33.6938, lng: 73.0451,
    mapsQuery: 'PIMS Hospital Islamabad',
  },
  {
    name: 'Holy Family Hospital', city: 'Rawalpindi', region: 'Punjab',
    address: 'Satellite Town, Rawalpindi', phone: '051-9290301',
    lat: 33.6007, lng: 73.0679,
    mapsQuery: 'Holy Family Hospital Rawalpindi Pakistan',
  },
  {
    name: 'Rawalpindi Teaching Hospital (RTH)', city: 'Rawalpindi', region: 'Punjab',
    address: 'Raja Bazar, Rawalpindi', phone: '051-9270871',
    lat: 33.5972, lng: 73.0479,
    mapsQuery: 'Rawalpindi Teaching Hospital RTH Rawalpindi',
  },
  {
    name: 'Benazir Bhutto Hospital', city: 'Rawalpindi', region: 'Punjab',
    address: 'Murree Road, Rawalpindi', phone: '051-9290601',
    lat: 33.6100, lng: 73.0550,
    mapsQuery: 'Benazir Bhutto Hospital Rawalpindi',
  },
  {
    name: 'Shifa International Hospital', city: 'Islamabad', region: 'Islamabad',
    address: 'H-8/4, Islamabad', phone: '051-8464646',
    lat: 33.6860, lng: 73.0238,
    mapsQuery: 'Shifa International Hospital Islamabad',
  },
  {
    name: 'Fauji Foundation Hospital', city: 'Rawalpindi', region: 'Punjab',
    address: 'Jhelum Road, Rawalpindi', phone: '051-9270942',
    lat: 33.5980, lng: 73.0530,
    mapsQuery: 'Fauji Foundation Hospital Rawalpindi',
  },
  {
    name: 'Nishtar Hospital', city: 'Multan', region: 'Punjab',
    address: 'Nishtar Road, Multan', phone: '061-9201342',
    lat: 30.1984, lng: 71.4687,
    mapsQuery: 'Nishtar Hospital Multan',
  },
  {
    name: 'Mayo Hospital', city: 'Lahore', region: 'Punjab',
    address: 'Anarkali, Lahore', phone: '042-99211137',
    lat: 31.5656, lng: 74.3199,
    mapsQuery: 'Mayo Hospital Lahore',
  },
  {
    name: 'Jinnah Hospital', city: 'Lahore', region: 'Punjab',
    address: 'Allama Iqbal Medical College, Lahore', phone: '042-99231401',
    lat: 31.5204, lng: 74.3587,
    mapsQuery: 'Jinnah Hospital Lahore',
  },
  {
    name: 'Lady Reading Hospital', city: 'Peshawar', region: 'KPK',
    address: 'Hospital Road, Peshawar', phone: '091-9211430',
    lat: 34.0123, lng: 71.5785,
    mapsQuery: 'Lady Reading Hospital Peshawar',
  },
];

module.exports = {
  generateMockPrediction,
  generateMockTranscript,
  MOCK_CLINICS,
};
