-- Internship Board schema (SQLite)
-- Safe to run many times: every statement uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS internships (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    domain TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('Remote', 'Hybrid', 'On-site')),
    location TEXT NOT NULL,
    skills TEXT NOT NULL,            -- JSON text, e.g. '["HTML","CSS"]' (SQLite has no array type)
    openings INTEGER NOT NULL CHECK (openings >= 0)
);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    internship_id TEXT NOT NULL,
    applicant_name TEXT NOT NULL,
    applicant_email TEXT NOT NULL COLLATE NOCASE,   -- NOCASE: John@x.com and john@x.com count as the same person
    resume_url TEXT CHECK (resume_url IS NULL OR length(resume_url) <= 2048),    -- added in Task 3 (the API requires it for new applications)
    cover_letter TEXT CHECK (cover_letter IS NULL OR length(cover_letter) <= 2000), -- added in Task 3, optional
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (internship_id, applicant_email),

    FOREIGN KEY (internship_id)
        REFERENCES internships(id)
);

CREATE INDEX IF NOT EXISTS idx_internships_domain ON internships(domain);
CREATE INDEX IF NOT EXISTS idx_internships_mode ON internships(mode);
