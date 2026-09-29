const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { telemetryLimiter } = require('../middleware/telemetryLimiter');
const { recordTelemetry } = require('../controllers/monitoringController');

router.use(authenticate);

// POST /api/monitoring/:caseId/telemetry
router.post('/:caseId/telemetry', telemetryLimiter, recordTelemetry);

module.exports = router;
