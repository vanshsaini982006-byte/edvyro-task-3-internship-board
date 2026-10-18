-- Seed data: the five authoritative internship records (IDs must not change).
-- INSERT OR IGNORE makes this repeatable: rows that already exist are left untouched,
-- so running it again never overwrites or duplicates data.

INSERT OR IGNORE INTO internships (id, title, domain, mode, location, skills, openings) VALUES
  ('INT-101', 'Frontend Intern',            'Full Stack Development', 'Remote',  'India',     '["HTML","CSS","JavaScript"]',            3),
  ('INT-102', 'API Engineering Intern',     'Full Stack Development', 'Hybrid',  'Pune',      '["Node.js","SQL","Testing"]',            2),
  ('INT-103', 'UI/UX Intern',               'UI/UX',                  'Remote',  'India',     '["Figma","Research","Accessibility"]',   1),
  ('INT-104', 'Data Analyst Intern',        'Data Analytics',         'On-site', 'Bengaluru', '["Excel","SQL","Data visualisation"]',   2),
  ('INT-105', 'Security Operations Intern', 'Cyber Security',         'Remote',  'India',     '["Linux","Logs","Networking"]',          1);
