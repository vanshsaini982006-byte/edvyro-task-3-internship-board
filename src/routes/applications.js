'use strict';

const express = require('express');
const controller = require('../controllers/applicationController');
const { validateApplicationBody } = require('../middleware/validation');

const router = express.Router();

router.post('/', validateApplicationBody, controller.createApplication);

module.exports = router;
