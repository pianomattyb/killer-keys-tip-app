// The Killer Keys Tip & Request App — standalone server.
// Express + SQLite. Serves the frontend and a JSON API for songs,
// charts, setlists, queue, and performance notes. No login, no auth.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  favorite INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  hasChart INTEGER DEFAULT 0,
  chartSource TEXT DEFAULT '',
  minTipCents INTEGER DEFAULT 0,
  chartHtml TEXT DEFAULT '',
  chartSize INTEGER DEFAULT 19,
  chartSpacing INTEGER DEFAULT 19
);
CREATE TABLE IF NOT EXISTS setlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT DEFAULT '',
  status TEXT DEFAULT 'saved'
);
CREATE TABLE IF NOT EXISTS setlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setlist_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  off INTEGER DEFAULT 0,
  FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  songId INTEGER,
  songTitle TEXT NOT NULL,
  requester TEXT DEFAULT '',
  tipCents INTEGER DEFAULT 0,
  status TEXT DEFAULT 'queued',
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT DEFAULT ''
);
INSERT OR IGNORE INTO notes (id, body) VALUES (1, '');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);
// Columns added after the first deploy: add them in place so an existing
// database keeps its rows (no wipe needed).
try { db.exec('ALTER TABLE setlists ADD COLUMN viewers INTEGER DEFAULT 1'); } catch (e) { /* already there */ }

const DEFAULT_SETTINGS = {
  overlayVisible: '3',
  overlayPublicUrl: 'https://killer-keys-tip-app.onrender.com/?view=overlay',
  overlayExplodeAt: '0',
};
const getSettings = () => {
  const out = Object.assign({}, DEFAULT_SETTINGS);
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
};
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));

// ---- helpers ----
const rowToSong = (r) => ({
  id: r.id, title: r.title, artist: r.artist,
  tags: JSON.parse(r.tags || '[]'),
  favorite: !!r.favorite, visible: !!r.visible,
  hasChart: !!r.hasChart, chartSource: r.chartSource || '',
  minTipCents: r.minTipCents || 0,
  chartHtml: r.chartHtml || '', chartSize: r.chartSize || 19,
  chartSpacing: r.chartSpacing || 19,
});

// ---- songs ----
app.get('/api/songs', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const tag = (req.query.tag || '').trim();
  const fav = req.query.favorite === '1';
  const visibleOnly = req.query.visible !== '0';
  let rows = db.prepare('SELECT * FROM songs ORDER BY title COLLATE NOCASE').all();
  if (visibleOnly) rows = rows.filter((r) => r.visible);
  if (fav) rows = rows.filter((r) => r.favorite);
  if (tag && tag !== 'All') {
    if (tag === 'Most requested') { /* no request counts yet; fall through to all */ }
    else { const t = tag.toLowerCase(); rows = rows.filter((r) => JSON.parse(r.tags || '[]').some((x) => String(x).toLowerCase() === t)); }
  }
  if (q) {
    rows = rows.filter((r) =>
      r.title.toLowerCase().includes(q) || (r.artist || '').toLowerCase().includes(q));
  }
  const counts = {};
  for (const c of db.prepare('SELECT songId, COUNT(*) n FROM queue WHERE songId IS NOT NULL GROUP BY songId').all()) counts[c.songId] = c.n;
  if (tag === 'Most requested') rows = rows.filter((r) => counts[r.id]).sort((a, b) => counts[b.id] - counts[a.id]);
  res.json({ songs: rows.map((r) => Object.assign(rowToSong(r), { requestCount: counts[r.id] || 0 })) });
});

app.get('/api/songs/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'song not found' });
  res.json({ song: rowToSong(r) });
});

app.post('/api/songs', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'title required' });
  const tags = Array.isArray(b.tags) ? b.tags : [];
  const info = db.prepare(
    `INSERT INTO songs (title, artist, tags, favorite, visible, hasChart, chartSource, minTipCents, chartHtml, chartSize, chartSpacing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(b.title).trim(), String(b.artist || '').trim(), JSON.stringify(tags),
    b.favorite ? 1 : 0, b.visible === false ? 0 : 1,
    b.chartHtml ? 1 : 0, String(b.chartSource || ''),
    Number(b.minTipCents || 0), String(b.chartHtml || ''),
    Number(b.chartSize || 19), Number(b.chartSpacing || 19)
  );
  const r = db.prepare('SELECT * FROM songs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ song: rowToSong(r) });
});

app.put('/api/songs/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'song not found' });
  const b = req.body || {};
  const next = {
    title: b.title !== undefined ? String(b.title).trim() : cur.title,
    artist: b.artist !== undefined ? String(b.artist).trim() : cur.artist,
    tags: b.tags !== undefined ? JSON.stringify(b.tags) : cur.tags,
    favorite: b.favorite !== undefined ? (b.favorite ? 1 : 0) : cur.favorite,
    visible: b.visible !== undefined ? (b.visible ? 1 : 0) : cur.visible,
    chartSource: b.chartSource !== undefined ? String(b.chartSource) : cur.chartSource,
    minTipCents: b.minTipCents !== undefined ? Number(b.minTipCents) : cur.minTipCents,
    chartHtml: b.chartHtml !== undefined ? String(b.chartHtml) : cur.chartHtml,
    chartSize: b.chartSize !== undefined ? Number(b.chartSize) : cur.chartSize,
    chartSpacing: b.chartSpacing !== undefined ? Number(b.chartSpacing) : cur.chartSpacing,
  };
  if (!next.title) return res.status(400).json({ error: 'title required' });
  next.hasChart = next.chartHtml ? 1 : 0;
  db.prepare(
    `UPDATE songs SET title=?, artist=?, tags=?, favorite=?, visible=?, hasChart=?, chartSource=?, minTipCents=?, chartHtml=?, chartSize=?, chartSpacing=? WHERE id=?`
  ).run(next.title, next.artist, next.tags, next.favorite, next.visible, next.hasChart,
    next.chartSource, next.minTipCents, next.chartHtml, next.chartSize, next.chartSpacing, id);
  res.json({ song: rowToSong(db.prepare('SELECT * FROM songs WHERE id = ?').get(id)) });
});

app.delete('/api/songs/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- setlists ----
app.get('/api/setlists', (req, res) => {
  const lists = db.prepare('SELECT * FROM setlists ORDER BY id').all().map((s) => {
    const entries = db.prepare(
      'SELECT title, artist, off FROM setlist_entries WHERE setlist_id = ? ORDER BY position'
    ).all(s.id);
    return { id: s.id, name: s.name, date: s.date, status: s.status, viewers: s.viewers === null || s.viewers === undefined ? true : !!s.viewers, songs: entries };
  });
  res.json({ setlists: req.query.public === '1' ? lists.filter((l) => l.viewers) : lists });
});

app.get('/api/setlists/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM setlists WHERE id = ?').get(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'setlist not found' });
  const entries = db.prepare(
    'SELECT title, artist, off FROM setlist_entries WHERE setlist_id = ? ORDER BY position'
  ).all(s.id);
  res.json({ setlist: { id: s.id, name: s.name, date: s.date, status: s.status, viewers: s.viewers !== 0, songs: entries } });
});

app.post('/api/setlists', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO setlists (name, date, status) VALUES (?, ?, ?)')
    .run(String(b.name).trim(), String(b.date || ''), 'saved');
  const id = Number(info.lastInsertRowid);
  const songs = Array.isArray(b.songs) ? b.songs : [];
  const ins = db.prepare(
    'INSERT INTO setlist_entries (setlist_id, position, title, artist, off) VALUES (?, ?, ?, ?, ?)');
  songs.forEach((e, i) => ins.run(id, i, String(e.title || ''), String(e.artist || ''), e.off ? 1 : 0));
  res.status(201).json({ setlist: { id, name: String(b.name).trim(), date: String(b.date || ''), status: 'saved', songs } });
});

app.put('/api/setlists/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare('SELECT * FROM setlists WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'setlist not found' });
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE setlists SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.date !== undefined) db.prepare('UPDATE setlists SET date = ? WHERE id = ?').run(String(b.date), id);
  if (b.viewers !== undefined) db.prepare('UPDATE setlists SET viewers = ? WHERE id = ?').run(b.viewers ? 1 : 0, id);
  if (b.offIndex !== undefined) {
    const row = db.prepare('SELECT id FROM setlist_entries WHERE setlist_id = ? ORDER BY position LIMIT 1 OFFSET ?').get(id, Number(b.offIndex));
    if (row) db.prepare('UPDATE setlist_entries SET off = ? WHERE id = ?').run(b.off ? 1 : 0, row.id);
  }
  if (Array.isArray(b.songs)) {
    db.prepare('DELETE FROM setlist_entries WHERE setlist_id = ?').run(id);
    const ins = db.prepare(
      'INSERT INTO setlist_entries (setlist_id, position, title, artist, off) VALUES (?, ?, ?, ?, ?)');
    b.songs.forEach((e, i) => ins.run(id, i, String(e.title || ''), String(e.artist || ''), e.off ? 1 : 0));
  }
  if (b.toggleOff !== undefined && b.title) {
    db.prepare('UPDATE setlist_entries SET off = ? WHERE setlist_id = ? AND title = ?')
      .run(b.toggleOff ? 1 : 0, id, String(b.title));
  }
  const entries = db.prepare(
    'SELECT title, artist, off FROM setlist_entries WHERE setlist_id = ? ORDER BY position'
  ).all(id);
  const cur = db.prepare('SELECT * FROM setlists WHERE id = ?').get(id);
  res.json({ setlist: { id, name: cur.name, date: cur.date, status: cur.status, viewers: cur.viewers !== 0, songs: entries } });
});

app.delete('/api/setlists/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM setlist_entries WHERE setlist_id = ?').run(id);
  db.prepare('DELETE FROM setlists WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- queue ----
app.get('/api/queue', (req, res) => {
  const rows = db.prepare("SELECT * FROM queue WHERE status = 'queued' ORDER BY createdAt").all();
  res.json({ queue: rows });
});
app.post('/api/queue', (req, res) => {
  const b = req.body || {};
  if (!b.songTitle) return res.status(400).json({ error: 'songTitle required' });
  const info = db.prepare(
    "INSERT INTO queue (songId, songTitle, requester, tipCents, status, createdAt) VALUES (?, ?, ?, ?, 'queued', ?)"
  ).run(b.songId || null, String(b.songTitle), String(b.requester || ''), Number(b.tipCents || 0), Date.now());
  res.status(201).json({ item: { id: Number(info.lastInsertRowid), songTitle: String(b.songTitle) } });
});
app.post('/api/queue/:id/:action', (req, res) => {
  const id = Number(req.params.id);
  const action = req.params.action;
  if (action === 'delete') { db.prepare('DELETE FROM queue WHERE id = ?').run(id); return res.json({ ok: true }); }
  const status = action === 'play' ? 'played' : action === 'decline' ? 'declined' : 'queued';
  db.prepare('UPDATE queue SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

// ---- settings / stream overlay ----
app.get('/api/settings', (req, res) => res.json({ settings: getSettings() }));
app.put('/api/settings', (req, res) => {
  const b = req.body || {};
  if (b.overlayVisible !== undefined) setSetting('overlayVisible', Math.max(1, Math.min(10, Number(b.overlayVisible) || 3)));
  if (b.overlayPublicUrl !== undefined) {
    const u = String(b.overlayPublicUrl).trim();
    if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'Public address must start with http:// or https://' });
    setSetting('overlayPublicUrl', u || DEFAULT_SETTINGS.overlayPublicUrl);
  }
  res.json({ settings: getSettings() });
});
app.post('/api/overlay/explode', (req, res) => { const t = Date.now(); setSetting('overlayExplodeAt', t); res.json({ ok: true, explodeAt: t }); });
app.get('/api/overlay', (req, res) => {
  const st = getSettings();
  const rows = db.prepare("SELECT q.*, s.artist FROM queue q LEFT JOIN songs s ON s.id = q.songId WHERE q.status = 'queued' ORDER BY (q.tipCents > 0) DESC, q.tipCents DESC, q.createdAt").all();
  res.json({ visible: Number(st.overlayVisible), explodeAt: Number(st.overlayExplodeAt), queue: rows.slice(0, Number(st.overlayVisible)), total: rows.length });
});

// ---- notes ----
app.get('/api/notes', (req, res) => {
  const r = db.prepare('SELECT body FROM notes WHERE id = 1').get();
  res.json({ body: r ? r.body : '' });
});
app.put('/api/notes', (req, res) => {
  db.prepare('UPDATE notes SET body = ? WHERE id = 1').run(String((req.body || {}).body || ''));
  res.json({ ok: true });
});

// ---- auto-seed on first run ----
(function autoSeed() {
  try {
    const count = db.prepare('SELECT COUNT(*) c FROM songs').get().c;
    if (count > 0) return;
    const songsPath = path.join(DATA_DIR, 'songs-export-2026-11-24.json');
    const listsPath = path.join(DATA_DIR, 'setlists-export-2026-11-24.json');
    const chartsPath = path.join(DATA_DIR, 'charts-all.json');
    if (!fs.existsSync(songsPath)) { console.log('autoSeed: no seed files, starting empty'); return; }
    const songs = JSON.parse(fs.readFileSync(songsPath, 'utf8'));
    const setlists = fs.existsSync(listsPath) ? JSON.parse(fs.readFileSync(listsPath, 'utf8')) : [];
    let charts = {};
    if (fs.existsSync(chartsPath)) charts = JSON.parse(fs.readFileSync(chartsPath, 'utf8'));
    db.exec('BEGIN');
    try {
      const insSong = db.prepare(
        `INSERT INTO songs (id, title, artist, tags, favorite, visible, hasChart, chartSource, minTipCents, chartHtml, chartSize, chartSpacing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const sg of songs) {
        const c = charts[String(sg.id)] || null;
        insSong.run(sg.id, sg.title, sg.artist || '', JSON.stringify(sg.tags || []),
          sg.favorite ? 1 : 0, sg.visible ? 1 : 0,
          c ? 1 : (sg.hasChart ? 1 : 0), sg.chartSource || '', Number(sg.minTipCents || 0),
          c ? (c.chartHtml || '') : '', c ? Number(c.size || 19) : 19, c ? Number(c.spacing || 19) : 19);
      }
      const insList = db.prepare('INSERT INTO setlists (id, name, date, status) VALUES (?, ?, ?, ?)');
      const insEntry = db.prepare(
        'INSERT INTO setlist_entries (setlist_id, position, title, artist, off) VALUES (?, ?, ?, ?, ?)');
      for (const sl of setlists) {
        insList.run(sl.id, sl.name, sl.date || '', sl.status || 'saved');
        if (sl.viewers === false) db.prepare('UPDATE setlists SET viewers = 0 WHERE id = ?').run(sl.id);
        (sl.songs || []).forEach((e, i) => insEntry.run(sl.id, i, e.title, e.artist || '', e.off ? 1 : 0));
      }
      const setsPath = path.join(DATA_DIR, 'settings.json');
      if (fs.existsSync(setsPath)) {
        const st = JSON.parse(fs.readFileSync(setsPath, 'utf8'));
        for (const [k, v] of Object.entries(st)) if (k !== 'overlayExplodeAt') setSetting(k, v);
      }
      const notesPath = path.join(DATA_DIR, 'notes.json');
      if (fs.existsSync(notesPath)) db.prepare('UPDATE notes SET body = ? WHERE id = 1').run(String(JSON.parse(fs.readFileSync(notesPath, 'utf8')).body || ''));
      db.exec('COMMIT');
      console.log(`autoSeed: seeded ${songs.length} songs, ${setlists.length} setlists`);
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  } catch (e) { console.log('autoSeed failed:', e.message); }
})();

// ---- health ----
app.get('/api/health', (req, res) => {
  const songs = db.prepare('SELECT COUNT(*) c FROM songs').get().c;
  const setlists = db.prepare('SELECT COUNT(*) c FROM setlists').get().c;
  res.json({ ok: true, songs, setlists });
});

app.listen(PORT, () => console.log(`Killer Keys Tip App listening on port ${PORT}`));
