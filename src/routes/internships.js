'use strict';

const express = require('express');
const controller = require('../controllers/internshipController');
const {
  validateListQuery,
  validateCreateInternship,
  validateUpdateInternship,
} = require('../middleware/validation');

const router = express.Router();

router.get('/', validateListQuery, controller.listInternships);
router.get('/:id', controller.getInternship);
router.post('/', validateCreateInternship, controller.createInternship);
router.put('/:id', validateUpdateInternship, controller.updateInternship);
router.delete('/:id', controller.deleteInternship);

module.exports = router;
