const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createScreening,
  uploadImage,
  submitVoice,
  runInference,
  getResults,
  getHistory,
} = require('../controllers/screeningController');

router.use(authenticate); // All screening routes require auth

router.post('/create', createScreening);
router.post('/:caseId/upload-image', upload.single('image'), uploadImage);
router.post('/:caseId/voice', upload.single('audio'), submitVoice);
router.post('/:caseId/inference', runInference);
router.get('/:caseId/results', getResults);
router.get('/history/list', getHistory);

module.exports = router;
