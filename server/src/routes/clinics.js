const express = require('express');
const router = express.Router();
const { getNearby } = require('../controllers/clinicController');

router.get('/nearby', getNearby);

module.exports = router;
