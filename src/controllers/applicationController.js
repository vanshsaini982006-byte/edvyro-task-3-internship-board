'use strict';

const { db, isConstraintError, runInTransaction } = require('../db');
const { sendSuccess, ApiError } = require('../utils/response');

function duplicateApplication() {
  return new ApiError(409, 'DUPLICATE_APPLICATION', 'This applicant has already applied for this internship');
}

// POST /api/applications
// Duplicate rule: the same email (compared without regard to letter case) cannot apply
// to the same internship twice. The UNIQUE (internship_id, applicant_email) constraint in
// the database enforces this; the lookup below only produces a friendlier error first.
function createApplication(req, res) {
  const { internshipId, applicantName, applicantEmail, resumeUrl, coverLetter } = req.validated;

  // Check + insert run in one transaction, so the internship cannot disappear in between.
  const applicationId = runInTransaction(() => {
    const internship = db.prepare('SELECT id FROM internships WHERE id = ?').get(internshipId);
    if (!internship) {
      throw new ApiError(404, 'INTERNSHIP_NOT_FOUND', 'Internship not found');
    }

    const existing = db
      .prepare('SELECT id FROM applications WHERE internship_id = ? AND applicant_email = ?')
      .get(internshipId, applicantEmail);
    if (existing) throw duplicateApplication();

    try {
      const result = db
        .prepare(
          'INSERT INTO applications (internship_id, applicant_name, applicant_email, resume_url, cover_letter) VALUES (?, ?, ?, ?, ?)'
        )
        .run(internshipId, applicantName, applicantEmail, resumeUrl, coverLetter);
      return Number(result.lastInsertRowid);
    } catch (err) {
      // The UNIQUE rule is the final safety net.
      if (isConstraintError(err)) throw duplicateApplication();
      throw err;
    }
  });

  // Privacy: log only the internship ID and request ID. Never the name, email, resume link or cover letter.
  req.app.locals.logger.info('application submitted', { requestId: req.id, internshipId });

  sendSuccess(
    res,
    { message: 'Application submitted successfully', application_id: applicationId, internship_id: internshipId },
    { status: 201 }
  );
}

module.exports = { createApplication };
