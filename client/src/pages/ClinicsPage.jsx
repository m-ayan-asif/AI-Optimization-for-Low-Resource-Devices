import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REGIONS, CITIES } from '../utils/constants';
import { MapPin, Phone, Navigation } from 'lucide-react';
import api from '../utils/api';

export default function ClinicsPage() {
  const { t } = useTranslation();
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchClinics();
  }, [region, city]);

  async function fetchClinics() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (region) params.append('region', region);
      if (city) params.append('city', city);
      const res = await api.get(`/clinics/nearby?${params}`);
      setClinics(res.data);
    } catch (_) {
      setClinics([]);
    } finally {
      setLoading(false);
    }
  }

  const availableCities = region ? (CITIES[region] || []) : [];

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('clinics.title')}</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select
          value={region}
          onChange={(e) => { setRegion(e.target.value); setCity(''); }}
          className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="">{t('clinics.allRegions')}</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {availableCities.length > 0 && (
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">{t('clinics.selectCity')}</option>
            {availableCities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* Clinic list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.map((clinic, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{clinic.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{clinic.city}, {clinic.region}</p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${clinic.lat},${clinic.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-sm font-medium no-underline hover:bg-teal-100 transition-colors"
                >
                  <Navigation size={14} /> {t('clinics.getDirections')}
                </a>
              </div>
              <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                <span className="flex items-center gap-1"><MapPin size={14} /> {clinic.address}</span>
                <span className="flex items-center gap-1"><Phone size={14} /> {clinic.phone}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
