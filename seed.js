// Seed the SQLite database from the exported JSON files.
// Run once: node seed.js  (re-runnable; wipes and re-seeds songs/setlists/notes)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const ROOT = DATA_DIR; // seed JSON files live in data/ (was '..', which broke `npm run seed`)

fs.mkdirSync(DATA_DIR, { recursive: true });
// Ensure tables exist by loading server's schema via a temp open.
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT DEFAULT '',
  tags TEXT DEFAULT '[]', favorite INTEGER DEFAULT 0, visible INTEGER DEFAULT 1,
  hasChart INTEGER DEFAULT 0, chartSource TEXT DEFAULT '', minTipCents INTEGER DEFAULT 0,
  chartHtml TEXT DEFAULT '', chartSize INTEGER DEFAULT 19, chartSpacing INTEGER DEFAULT 19
);
CREATE TABLE IF NOT EXISTS setlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, date TEXT DEFAULT '', status TEXT DEFAULT 'saved');
CREATE TABLE IF NOT EXISTS setlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, setlist_id INTEGER NOT NULL, position INTEGER NOT NULL,
  title TEXT NOT NULL, artist TEXT DEFAULT '', off INTEGER DEFAULT 0,
  FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, songId INTEGER, songTitle TEXT NOT NULL,
  requester TEXT DEFAULT '', tipCents INTEGER DEFAULT 0, status TEXT DEFAULT 'queued', createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT DEFAULT '');
INSERT OR IGNORE INTO notes (id, body) VALUES (1, '');
`);

const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'songs-export-2026-11-24.json'), 'utf8'));
const setlists = JSON.parse(fs.readFileSync(path.join(ROOT, 'setlists-export-2026-11-24.json'), 'utf8'));

let charts = {};
const chartsPath = path.join(ROOT, 'charts-all.json');
if (fs.existsSync(chartsPath)) {
  charts = JSON.parse(fs.readFileSync(chartsPath, 'utf8'));
  console.log(`Loaded charts for ${Object.keys(charts).length} songs`);
} else {
  const chartsDir = path.join(ROOT, 'charts');
  if (fs.existsSync(chartsDir)) {
    for (const f of fs.readdirSync(chartsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(chartsDir, f), 'utf8'));
        charts[String(c.songId)] = c;
      } catch (e) { /* skip bad file */ }
    }
    console.log(`Loaded ${Object.keys(charts).length} charts from charts/ dir`);
  } else {
    console.log('No charts file found — seeding songs without chart HTML');
  }
}

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM setlist_entries').run();
  db.prepare('DELETE FROM setlists').run();
  db.prepare('DELETE FROM songs').run();
  db.prepare('DELETE FROM queue').run();

  const insSong = db.prepare(
    `INSERT INTO songs (id, title, artist, tags, favorite, visible, hasChart, chartSource, minTipCents, chartHtml, chartSize, chartSpacing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of songs) {
    const c = charts[String(s.id)] || null;
    insSong.run(
      s.id, s.title, s.artist || '', JSON.stringify(s.tags || []),
      s.favorite ? 1 : 0, s.visible ? 1 : 0,
      c ? 1 : (s.hasChart ? 1 : 0), s.chartSource || '',
      Number(s.minTipCents || 0),
      c ? (c.chartHtml || '') : '',
      c ? Number(c.size || 19) : 19,
      c ? Number(c.spacing || 19) : 19
    );
  }
  const insList = db.prepare('INSERT INTO setlists (id, name, date, status) VALUES (?, ?, ?, ?)');
  const insEntry = db.prepare(
    'INSERT INTO setlist_entries (setlist_id, position, title, artist, off) VALUES (?, ?, ?, ?, ?)');
  for (const sl of setlists) {
    insList.run(sl.id, sl.name, sl.date || '', sl.status || 'saved');
    (sl.songs || []).forEach((e, i) => insEntry.run(sl.id, i, e.title, e.artist || '', e.off ? 1 : 0));
  }
db.exec('COMMIT');
} catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }

const nSongs = db.prepare('SELECT COUNT(*) c FROM songs').get().c;
const nCharts = db.prepare('SELECT COUNT(*) c FROM songs WHERE hasChart = 1').get().c;
const nLists = db.prepare('SELECT COUNT(*) c FROM setlists').get().c;
const nEntries = db.prepare('SELECT COUNT(*) c FROM setlist_entries').get().c;
console.log(`Seeded: ${nSongs} songs (${nCharts} with charts), ${nLists} setlists, ${nEntries} setlist entries`);
db.close();
