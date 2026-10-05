const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { imageUpload, audioUpload, deviceResultUpload } = require('../middleware/upload');
const {
  createScreening,
  uploadImage,
  submitVoice,
  submitTextInput,
  runInference,
  submitDeviceResult,
  getResults,
  getHistory,
} = require('../controllers/screeningController');

router.use(authenticate); // All screening routes require auth

router.post('/create', createScreening);
router.post('/:caseId/upload-image', imageUpload.single('image'), uploadImage);
router.post('/:caseId/voice', audioUpload.single('audio'), submitVoice);
router.post('/:caseId/text-input', submitTextInput);
router.post('/:caseId/inference', runInference);
router.post('/:caseId/device-result', deviceResultUpload.single('heatmap'), submitDeviceResult);
router.get('/:caseId/results', getResults);
router.get('/history/list', getHistory);

module.exports = router;
