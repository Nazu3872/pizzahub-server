const express = require('express');
const { getHealth, getServiceInfo } = require('../controllers/healthController');

const router = express.Router();

router.get('/', getServiceInfo);
router.get('/health', getHealth);

module.exports = router;
