import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REGIONS, CITIES } from '../utils/constants';
import { MapPin, Phone, Navigation, Building2 } from 'lucide-react';
import api from '../utils/api';

export default function ClinicsPage() {
  const { t } = useTranslation();
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchClinics(); }, [region, city]);

  async function fetchClinics() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (region) params.append('region', region);
      if (city) params.append('city', city);
      const res = await api.get(`/clinics/nearby?${params}`);
      setClinics(res.data);
    } catch (_) { setClinics([]); }
    finally { setLoading(false); }
  }

  const availableCities = region ? (CITIES[region] || []) : [];
  const selectClass = "flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-400 transition-all";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
          <Building2 size={20} className="text-purple-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('clinics.title')}</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={region} onChange={(e) => { setRegion(e.target.value); setCity(''); }} className={selectClass}>
          <option value="">{t('clinics.allRegions')}</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {availableCities.length > 0 && (
          <select value={city} onChange={(e) => setCity(e.target.value)} className={selectClass}>
            <option value="">{t('clinics.selectCity')}</option>
            {availableCities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Clinic list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.map((clinic, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 hover:border-purple-200 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{clinic.name}</h3>
                  <p className="text-sm text-gray-400 mt-0.5">{clinic.city}, {clinic.region}</p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${clinic.lat},${clinic.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium no-underline hover:bg-purple-100 transition-colors shrink-0 border border-purple-100"
                >
                  <Navigation size={14} /> {t('clinics.getDirections')}
                </a>
              </div>
              <div className="flex items-center gap-5 mt-3 pt-3 border-t border-gray-50 text-sm text-gray-400">
                <span className="flex items-center gap-1.5"><MapPin size={14} /> {clinic.address}</span>
                <span className="flex items-center gap-1.5"><Phone size={14} /> {clinic.phone}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
