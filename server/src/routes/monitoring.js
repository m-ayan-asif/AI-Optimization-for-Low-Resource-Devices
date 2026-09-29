const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { recordTelemetry } = require('../controllers/monitoringController');

router.use(authenticate);
router.post('/:caseId/telemetry', recordTelemetry);

module.exports = router;
