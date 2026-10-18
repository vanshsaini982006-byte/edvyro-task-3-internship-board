'use strict';

// Opens the SQLite database file, creates the tables and seeds the starter data.
// Uses Node's built-in `node:sqlite` module, so there is nothing native to compile
// (no node-gyp / Visual Studio build tools needed on Windows).

const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('This project uses the built-in node:sqlite module, which needs Node.js 22.13 or newer.');
  console.error(`You are running Node.js ${process.versions.node}. Please upgrade Node.js and try again.`);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
// A relative DATABASE_PATH is resolved from the project folder, not from where you run the command.
const databasePath = path.resolve(projectRoot, process.env.DATABASE_PATH || './database/internship-board.db');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON;'); // make SQLite enforce the applications -> internships link

function readSqlFile(fileName) {
  return fs.readFileSync(path.join(projectRoot, 'database', fileName), 'utf8');
}

function runInTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Inserts the five starter internships. Existing rows are never overwritten (INSERT OR IGNORE).
function seedDatabase() {
  db.exec(readSqlFile('seed.sql'));
}

// Task 3 added resume_url and cover_letter to applications. A Task 2 database file already has the
// table without them, and CREATE TABLE IF NOT EXISTS will not change it, so add the columns here.
// Safe to repeat: a column that already exists is skipped. Existing rows are kept (the new columns are NULL).
function migrateApplicationColumns() {
  const existing = db.prepare('PRAGMA table_info(applications)').all().map((column) => column.name);
  if (!existing.includes('resume_url')) {
    db.exec('ALTER TABLE applications ADD COLUMN resume_url TEXT CHECK (resume_url IS NULL OR length(resume_url) <= 2048)');
  }
  if (!existing.includes('cover_letter')) {
    db.exec('ALTER TABLE applications ADD COLUMN cover_letter TEXT CHECK (cover_letter IS NULL OR length(cover_letter) <= 2000)');
  }
}

function initialiseDatabase() {
  // 1. Tables: CREATE TABLE IF NOT EXISTS, so existing data is untouched.
  db.exec(readSqlFile('schema.sql'));
  migrateApplicationColumns();

  // 2. Seed only the FIRST time this database file is created.
  //    (PRAGMA user_version is a number SQLite stores inside the database file; it starts at 0.)
  //    Without this, an internship you deleted would come back after every restart.
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version === 0) {
    runInTransaction(() => {
      seedDatabase();
      db.exec('PRAGMA user_version = 1');
    });
  }
}

// True for UNIQUE / PRIMARY KEY / FOREIGN KEY / CHECK violations (SQLite result code 19).
function isConstraintError(err) {
  return Boolean(err) && typeof err.errcode === 'number' && (err.errcode & 0xff) === 19;
}

function closeDatabase() {
  if (db.isOpen) {
    db.close();
  }
}

initialiseDatabase();

// `npm run db:init` and `npm run db:seed` run this file directly.
if (require.main === module) {
  if (process.argv.includes('--seed')) {
    seedDatabase();
    console.log('Seed data applied. Existing records were left untouched.');
  }
  console.log(`Database ready: ${databasePath}`);
  closeDatabase();
}

module.exports = { db, databasePath, seedDatabase, isConstraintError, closeDatabase, runInTransaction };
