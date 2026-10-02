import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { REGIONS, CITIES } from '../utils/constants';
import { MapPin, Phone, Navigation, Building2, Map, List } from 'lucide-react';
import api from '../utils/api';

// Plain Leaflet — no react-leaflet wrapper needed, works with any React version
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default marker icon paths broken by Vite/Webpack bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom violet marker icon to match the app's brand mark
const purpleIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function ClinicsPage() {
  const { t } = useTranslation();
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [activeClinic, setActiveClinic] = useState(null);

  // Leaflet refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

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

  // Initialize the Leaflet map once when showMap becomes true
  useEffect(() => {
    if (!showMap || !mapContainerRef.current) return;

    // Don't create a second map on the same container
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [30.3753, 69.3451], // Center of Pakistan
      zoom: 5,
      scrollWheelZoom: true,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    // Force a size recalculation after render
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [showMap]);

  // Update markers whenever clinics or map changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (clinics.length === 0) return;

    // Add new markers
    clinics.forEach((clinic, i) => {
      const marker = L.marker([clinic.lat, clinic.lng], { icon: purpleIcon })
        .addTo(map)
        .bindPopup(`
          <div>
            <div class="clinic-popup-name">${clinic.name}</div>
            <div class="clinic-popup-address">${clinic.address}</div>
            <div class="clinic-popup-address">${clinic.city}, ${clinic.region}</div>
            <div class="clinic-popup-phone">📞 ${clinic.phone}</div>
            <a
              href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.mapsQuery || clinic.name + ' ' + clinic.address)}"
              target="_blank"
              rel="noopener noreferrer"
              class="clinic-popup-directions"
            >
              ↗ Get Directions
            </a>
          </div>
        `);

      marker.on('click', () => setActiveClinic(i));
      markersRef.current.push(marker);
    });

    // Fit map bounds to show all markers
    const bounds = L.latLngBounds(clinics.map((c) => [c.lat, c.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
  }, [clinics, showMap]);

  // When a clinic card is clicked, open its popup on the map
  const handleClinicClick = useCallback((clinic, index) => {
    setActiveClinic(index);
    if (showMap && markersRef.current[index]) {
      markersRef.current[index].openPopup();
      const map = mapInstanceRef.current;
      if (map) {
        map.setView([clinic.lat, clinic.lng], 13, { animate: true });
      }
    }
  }, [showMap]);

  const availableCities = region ? (CITIES[region] || []) : [];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-3 mb-6 border-b-2 border-ink-950">
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 size={19} className="text-ink-600 shrink-0" />
          <h1 className="text-h1 text-ink-950 m-0 truncate">{t('clinics.title')}</h1>
        </div>

        {/* Map / List toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowMap(true)}
            aria-pressed={showMap}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-meta font-semibold border-2 cursor-pointer transition-colors ${
              showMap
                ? 'border-brand-600 bg-brand-50 text-brand-800'
                : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
            }`}
          >
            <Map size={14} /> Map
          </button>
          <button
            onClick={() => setShowMap(false)}
            aria-pressed={!showMap}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-control text-meta font-semibold border-2 cursor-pointer transition-colors ${
              !showMap
                ? 'border-brand-600 bg-brand-50 text-brand-800'
                : 'border-line-strong bg-surface text-ink-600 hover:border-ink-300'
            }`}
          >
            <List size={14} /> List
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <select value={region} onChange={(e) => { setRegion(e.target.value); setCity(''); }} className="field flex-1">
          <option value="">{t('clinics.allRegions')}</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {availableCities.length > 0 && (
          <select value={city} onChange={(e) => setCity(e.target.value)} className="field flex-1">
            <option value="">{t('clinics.selectCity')}</option>
            {availableCities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Map */}
      {showMap && (
        <div className="mb-6 rounded-panel overflow-hidden border border-line-strong">
          <div ref={mapContainerRef} style={{ height: '420px', width: '100%' }} />
        </div>
      )}

      {/* Clinic list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-line-strong border-t-brand-800 rounded-pill animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {clinics.length === 0 && (
            <div className="panel panel-body text-center py-12">
              <MapPin size={22} className="text-ink-300 mx-auto mb-3" />
              <p className="text-body text-ink-600 m-0">No clinics found for the selected filters.</p>
            </div>
          )}
          {clinics.map((clinic, i) => (
            <div
              key={i}
              onClick={() => handleClinicClick(clinic, i)}
              className={`panel p-5 cursor-pointer transition-colors ${
                activeClinic === i ? 'border-brand-600 bg-brand-50' : 'hover:border-line-strong'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-body font-semibold text-ink-950 m-0">{clinic.name}</h3>
                  <p className="text-meta text-ink-500 mt-0.5 mb-0">{clinic.city}, {clinic.region}</p>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.mapsQuery || clinic.name + ' ' + clinic.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 text-brand-800 rounded-control text-meta font-semibold no-underline hover:bg-brand-100 transition-colors shrink-0"
                >
                  <Navigation size={14} /> {t('clinics.getDirections')}
                </a>
              </div>
              <div className="flex items-center gap-5 mt-3 pt-3 border-t border-line text-meta text-ink-600">
                <span className="flex items-center gap-1.5"><MapPin size={13} /> {clinic.address}</span>
                <span className="flex items-center gap-1.5"><Phone size={13} /> {clinic.phone}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
