const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { deviceHeatmapDir } = require('./middleware/upload');
const { DEVICE_HEATMAP_ROUTE } = require('./utils/heatmapUrl');

const authRoutes = require('./routes/auth');
const screeningRoutes = require('./routes/screening');
const clinicRoutes = require('./routes/clinics');
const clinicianRoutes = require('./routes/clinicianRoutes');
const monitoringRoutes = require('./routes/monitoring');

const app = express();

const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.set('trust proxy', config.trustProxy);
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(uploadDir));
// Heatmaps uploaded with on-device (PWA) results: UUID names, PNG only, no directory listing
app.use(DEVICE_HEATMAP_ROUTE, express.static(deviceHeatmapDir, { index: false, dotfiles: 'deny' }));
app.use(DEVICE_HEATMAP_ROUTE, (req, res) => res.status(404).json({ error: 'Heatmap not found' }));

app.use('/api/auth', authRoutes);
app.use('/api/screening', screeningRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/clinician', clinicianRoutes);
app.use('/api/monitoring', monitoringRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
