const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { getCases, getCaseDetail, submitFeedback, getStats } = require('../controllers/clinicianController');

// All clinician routes require authentication + clinician role
router.use(authenticate);
router.use(requireRole('clinician'));

router.get('/stats', getStats);
router.get('/cases', getCases);
router.get('/cases/:caseId', getCaseDetail);
router.post('/cases/:caseId/feedback', submitFeedback);

module.exports = router;
