'use strict';

const { db, isConstraintError } = require('../db');
const { sendSuccess, ApiError } = require('../utils/response');

// Skills are stored as JSON text in SQLite; the API returns a real array.
function toInternship(row) {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    mode: row.mode,
    location: row.location,
    skills: JSON.parse(row.skills),
    openings: row.openings,
  };
}

function findInternshipRow(id) {
  return db.prepare('SELECT * FROM internships WHERE id = ?').get(id);
}

function notFound() {
  return new ApiError(404, 'INTERNSHIP_NOT_FOUND', 'Internship not found');
}

function duplicateId() {
  return new ApiError(409, 'DUPLICATE_ID', 'An internship with this ID already exists');
}

// Makes % and _ in the user's search text match literally instead of acting as LIKE wildcards.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// GET /api/internships?search=&domain=&mode=&page=&limit=
function listInternships(req, res) {
  const { page, limit, search, domain, mode } = req.listQuery;

  const conditions = [];
  const params = [];

  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    // SQLite LIKE is case-insensitive for English letters.
    // Skills are matched one by one with json_each, so JSON punctuation is never searched.
    conditions.push(
      `(title LIKE ? ESCAPE '\\'
        OR domain LIKE ? ESCAPE '\\'
        OR location LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM json_each(internships.skills) WHERE json_each.value LIKE ? ESCAPE '\\'))`
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  if (domain) {
    conditions.push('domain = ? COLLATE NOCASE');
    params.push(domain);
  }
  if (mode) {
    conditions.push('mode = ?');
    params.push(mode);
  }

  // Only fixed SQL text is built here; every user-supplied value travels as a ? parameter.
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM internships ${whereClause}`).get(...params);

  const offset = (page - 1) * limit;
  const rows = db
    .prepare(`SELECT * FROM internships ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  sendSuccess(res, rows.map(toInternship), {
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// GET /api/internships/:id
function getInternship(req, res) {
  const row = findInternshipRow(req.params.id);
  if (!row) throw notFound();
  sendSuccess(res, toInternship(row));
}

// POST /api/internships
function createInternship(req, res) {
  const { id, title, domain, mode, location, skills, openings } = req.validated;

  if (findInternshipRow(id)) throw duplicateId();

  try {
    db.prepare(
      'INSERT INTO internships (id, title, domain, mode, location, skills, openings) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, title, domain, mode, location, JSON.stringify(skills), openings);
  } catch (err) {
    // Two requests with the same new ID at the same moment: the database still protects us.
    if (isConstraintError(err)) throw duplicateId();
    throw err;
  }

  sendSuccess(res, toInternship(findInternshipRow(id)), { status: 201 });
}

// PUT /api/internships/:id  (the ID in the URL is never changed)
function updateInternship(req, res) {
  const { id } = req.params;
  if (!findInternshipRow(id)) throw notFound();

  const { title, domain, mode, location, skills, openings } = req.validated;
  db.prepare(
    'UPDATE internships SET title = ?, domain = ?, mode = ?, location = ?, skills = ?, openings = ? WHERE id = ?'
  ).run(title, domain, mode, location, JSON.stringify(skills), openings, id);

  sendSuccess(res, toInternship(findInternshipRow(id)));
}

// DELETE /api/internships/:id
function deleteInternship(req, res) {
  const { id } = req.params;
  if (!findInternshipRow(id)) throw notFound();

  // Applications point at this internship. Refuse to orphan them.
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM applications WHERE internship_id = ?').get(id);
  if (count > 0) {
    throw new ApiError(
      409,
      'INTERNSHIP_HAS_APPLICATIONS',
      'This internship has applications and cannot be deleted'
    );
  }

  db.prepare('DELETE FROM internships WHERE id = ?').run(id);
  sendSuccess(res, { message: 'Internship deleted successfully' });
}

module.exports = { listInternships, getInternship, createInternship, updateInternship, deleteInternship };
