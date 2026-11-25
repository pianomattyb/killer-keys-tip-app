// The Killer Keys Tip & Request App — standalone server.
// Express + SQLite. Serves the frontend and a JSON API for songs,
// charts, setlists, queue, and performance notes. No login, no auth.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { sanitizeNote } = require('./lib/sanitize');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

app.use(express.json({ limit: '5mb' }));
app.get(['/fan', '/fan/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'fan.html')));
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
// Rich-text chart (Apple-Notes style): sanitized HTML. Empty = derive from chartHtml in the browser.
try { db.exec("ALTER TABLE songs ADD COLUMN noteHtml TEXT DEFAULT ''"); } catch (e) { /* already there */ }
// Viewer requests: kind = song | custom | shoutout, plus the fan's message / custom song text.
for (const col of ["kind TEXT DEFAULT 'song'", "message TEXT DEFAULT ''", "customText TEXT DEFAULT ''"]) {
  try { db.exec('ALTER TABLE queue ADD COLUMN ' + col); } catch (e) { /* already there */ }
}

const DEFAULT_SETTINGS = {
  overlayVisible: '3',
  overlayPublicUrl: 'https://killer-keys-tip-app.onrender.com/?view=overlay',
  overlayExplodeAt: '0',
  globalMinCents: '0',
  ovColorSong: '#f5b942',    // overlay colour: song requests
  ovColorCustom: '#39c2d7',  // overlay colour: custom requests
  ovColorShout: '#ff6fa5',   // overlay colour: shout-outs
  overlayTest: '',           // last Test explosion payload (JSON)
  socialYoutube: 'https://www.youtube.com/@thekillerkeysofficial', // The Killer Keys YouTube channel (button hidden if cleared)
  socialInstagram: 'https://www.instagram.com/thekillerkeys/',
  tipGoalCents: '40000',     // stream overlay tip goal (CAD), editable on the Stream Overlay page
  tipGoalShow: '1',          // 1 = show the goal bar on stream, 0 = hide it
  tipTallyCents: '0',        // running tip total since the last "Reset tally" (kept in settings so export-live carries it across deploys)
  tipTallyResetAt: '0',      // when the tally was last reset (ms)
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
  noteHtml: r.noteHtml || '',
});
// The list endpoint skips the big chart bodies unless ?full=1 (export script).
const rowToListSong = (r, full) => { const s = rowToSong(r); if (!full) { delete s.chartHtml; delete s.noteHtml; } return s; };

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
  const full = req.query.full === '1';
  res.json({ songs: rows.map((r) => Object.assign(rowToListSong(r, full), { requestCount: counts[r.id] || 0 })) });
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
    `INSERT INTO songs (title, artist, tags, favorite, visible, hasChart, chartSource, minTipCents, chartHtml, chartSize, chartSpacing, noteHtml)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(b.title).trim(), String(b.artist || '').trim(), JSON.stringify(tags),
    b.favorite ? 1 : 0, b.visible === false ? 0 : 1,
    (b.chartHtml || b.noteHtml) ? 1 : 0, String(b.chartSource || ''),
    Number(b.minTipCents || 0), String(b.chartHtml || ''),
    Number(b.chartSize || 19), Number(b.chartSpacing || 19), sanitizeNote(b.noteHtml || '')
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
    noteHtml: b.noteHtml !== undefined ? sanitizeNote(b.noteHtml) : (cur.noteHtml || ''),
  };
  // A new plain/HTML chart pasted in the song form replaces the old note so it is rebuilt from it.
  if (b.chartHtml !== undefined && b.noteHtml === undefined && String(b.chartHtml) !== (cur.chartHtml || '')) next.noteHtml = '';
  if (!next.title) return res.status(400).json({ error: 'title required' });
  next.hasChart = (next.chartHtml || next.noteHtml) ? 1 : 0;
  db.prepare(
    `UPDATE songs SET title=?, artist=?, tags=?, favorite=?, visible=?, hasChart=?, chartSource=?, minTipCents=?, chartHtml=?, chartSize=?, chartSpacing=?, noteHtml=? WHERE id=?`
  ).run(next.title, next.artist, next.tags, next.favorite, next.visible, next.hasChart,
    next.chartSource, next.minTipCents, next.chartHtml, next.chartSize, next.chartSpacing, next.noteHtml, id);
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
  const rows = db.prepare("SELECT * FROM queue WHERE status = 'queued' ORDER BY (tipCents > 0) DESC, createdAt").all();
  res.json({ queue: rows });
});
// ---- tip rules (one place, used by the viewer page and request validation) ----
// A song's own minimum ALWAYS wins (set on the song). Otherwise the global Tips-page
// setting applies. Free (0) = no tip needed; any tip given must still be $5 or more.
const TIP_FLOOR = 500, SPECIAL_MIN = 1000; // custom request / shout-out minimum
const globalMin = () => Math.max(0, Number(getSettings().globalMinCents) || 0);
const requiredFor = (song) => (song && Number(song.minTipCents) > 0 ? Number(song.minTipCents) : globalMin());
const requiredForKind = (kind, song) => (kind === 'song' ? requiredFor(song) : Math.max(SPECIAL_MIN, globalMin()));
const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

app.post('/api/queue', (req, res) => {
  const b = req.body || {};
  const kind = ['custom', 'shoutout'].includes(b.kind) ? b.kind : 'song';
  const tip = Math.max(0, Math.round(Number(b.tipCents || 0)));
  let song = null;
  if (kind === 'song') {
    if (b.songId) song = db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(b.songId));
    if (!b.songTitle && !song) return res.status(400).json({ error: 'songTitle required' });
  }
  // The performer's own "+ Add to queue" skips the fan rules; every fan request is checked here.
  if (!b.performer) {
    if (kind === 'song' && (!song || !song.visible)) return res.status(404).json({ error: 'That song is not on the board.' });
    if (kind === 'custom' && !String(b.customText || '').trim()) return res.status(400).json({ error: 'Tell us the song and artist for your custom request.' });
    const need = requiredForKind(kind, song);
    if (need > 0 && tip < need) return res.status(400).json({ error: `This request needs a tip of at least ${money(need)}.`, requiredCents: need });
    if (need === 0 && tip > 0 && tip < TIP_FLOOR) return res.status(400).json({ error: 'Tips start at $5 — go $5 or more, or send it with no tip at all.', requiredCents: 0 });
  }
  const title = kind === 'song' ? String(song ? song.title : b.songTitle) : kind === 'custom' ? 'Custom: ' + String(b.customText).trim().slice(0, 120) : 'Shout-out';
  const info = db.prepare(
    "INSERT INTO queue (songId, songTitle, requester, tipCents, status, createdAt, kind, message, customText) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)"
  ).run(song ? song.id : (b.songId || null), title, String(b.requester || '').slice(0, 60), tip, Date.now(), kind,
    String(b.message || '').slice(0, 300), String(b.customText || '').slice(0, 200));
  if (tip > 0) setSetting('tipTallyCents', Math.round((Number(getSettings().tipTallyCents) || 0) + tip)); // tip tally for the overlay goal bar
  res.status(201).json({ item: { id: Number(info.lastInsertRowid), songTitle: title, tipCents: tip, kind } });
});

// ---- viewer (fan) board: only what fans may see ----
const normT = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[\u2018\u2019\u201B`´]/g, "'").replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const bareT = (t) => normT(String(t || '').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' '));
const titleKeys = (t) => { const a = normT(t), b2 = bareT(t); const k = new Set([a, b2, a.replace(/ /g, ''), b2.replace(/ /g, '')]); k.delete(''); return [...k]; };
app.get('/api/fan', (req, res) => {
  const lists = db.prepare('SELECT * FROM setlists ORDER BY id').all().filter((l) => l.viewers === null || l.viewers === undefined || l.viewers !== 0);
  let keys = null;
  if (lists.length) {
    keys = new Set();
    for (const l of lists) for (const e of db.prepare('SELECT title FROM setlist_entries WHERE setlist_id = ? AND (off IS NULL OR off = 0)').all(l.id)) titleKeys(e.title).forEach((k) => keys.add(k));
  }
  const gm = globalMin();
  const songs = db.prepare('SELECT id, title, artist, tags, favorite, minTipCents FROM songs WHERE visible = 1 ORDER BY title COLLATE NOCASE').all()
    .filter((r) => !keys || titleKeys(r.title).some((k) => keys.has(k)))
    .map((r) => ({ id: r.id, title: r.title, artist: r.artist || '', tags: JSON.parse(r.tags || '[]'), favorite: !!r.favorite,
      ownMinCents: Number(r.minTipCents) || 0, requiredCents: Number(r.minTipCents) > 0 ? Number(r.minTipCents) : gm }));
  const st0 = getSettings();
  res.json({ social: { youtube: st0.socialYoutube || '', instagram: st0.socialInstagram || '' }, songs, globalMinCents: gm, specialMinCents: Math.max(SPECIAL_MIN, gm), tipFloorCents: TIP_FLOOR,
    viewerSetlists: lists.map((l) => l.name), version: fanVersion() });
});
// A cheap change stamp so View as Fan can refresh only when something changed.
const fanVersion = () => {
  const a = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(LENGTH(title)+LENGTH(artist)+LENGTH(tags)+favorite*7+visible*13+minTipCents),0) h FROM songs').get();
  const l = db.prepare('SELECT COALESCE(SUM(id*31+COALESCE(viewers,1)),0) h FROM setlists').get();
  const e = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(COALESCE(off,0)*position),0) h FROM setlist_entries').get();
  const st = getSettings();
  return [a.n, a.h, l.h, e.n, e.h, globalMin(), (st.socialYoutube || '').length + ':' + (st.socialInstagram || '').length + ':' + (st.socialYoutube || '').slice(-6) + (st.socialInstagram || '').slice(-6)].join('.');
};
app.get('/api/fan/version', (req, res) => res.json({ version: fanVersion() }));

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
  if (b.globalMinCents !== undefined) {
    const v = Math.round(Number(b.globalMinCents));
    if (!(v >= 0 && v <= 100000)) return res.status(400).json({ error: 'Global minimum must be between $0 and $1000' });
    if (v > 0 && v < 500) return res.status(400).json({ error: 'Tips start at $5 — pick Free or $5 or more' });
    setSetting('globalMinCents', v);
  }
  if (b.overlayPublicUrl !== undefined) {
    const u = String(b.overlayPublicUrl).trim();
    if (u && !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'Public address must start with http:// or https://' });
    setSetting('overlayPublicUrl', u || DEFAULT_SETTINGS.overlayPublicUrl);
  }
  for (const k of ['ovColorSong', 'ovColorCustom', 'ovColorShout']) {
    if (b[k] === undefined) continue;
    const v = String(b[k]).trim();
    if (!/^#[0-9a-f]{6}$/i.test(v)) return res.status(400).json({ error: 'Colours must look like #f5b942' });
    setSetting(k, v.toLowerCase());
  }
  for (const k of ['socialYoutube', 'socialInstagram']) {
    if (b[k] === undefined) continue;
    const v = String(b[k]).trim();
    if (v && !/^https:\/\/[^\s<>"']+$/i.test(v)) return res.status(400).json({ error: 'Links must start with https://' });
    setSetting(k, v);
  }
  if (b.tipGoalCents !== undefined) {
    const v = Math.round(Number(b.tipGoalCents));
    if (!(v >= 100 && v <= 10000000)) return res.status(400).json({ error: 'Goal must be between $1 and $100,000' });
    setSetting('tipGoalCents', v);
  }
  if (b.tipGoalShow !== undefined) setSetting('tipGoalShow', b.tipGoalShow && b.tipGoalShow !== '0' ? '1' : '0');
  res.json({ settings: getSettings() });
});
// Tip tally: every tipped queue request adds to it (see POST /api/queue); only this resets it.
app.post('/api/tally/reset', (req, res) => {
  setSetting('tipTallyCents', 0); setSetting('tipTallyResetAt', Date.now());
  res.json({ settings: getSettings() });
});
app.post('/api/overlay/explode', (req, res) => {
  const b = req.body || {};
  const tip = Math.max(0, Math.min(100000, Math.round(Number(b.tipCents) || 0)));
  const test = { tipCents: tip, title: String(b.title || 'Piano Man').slice(0, 80), artist: String(b.artist || 'Billy Joel').slice(0, 80),
    requester: String(b.requester || 'Test fan').slice(0, 40), kind: ['custom', 'shoutout'].includes(b.kind) ? b.kind : 'song' };
  const t = Date.now();
  setSetting('overlayTest', JSON.stringify(test)); setSetting('overlayExplodeAt', t);
  res.json({ ok: true, explodeAt: t, test });
});
app.get('/api/overlay', (req, res) => {
  const st = getSettings();
  const rows = db.prepare("SELECT q.*, s.artist FROM queue q LEFT JOIN songs s ON s.id = q.songId WHERE q.status = 'queued' ORDER BY (q.tipCents > 0) DESC, q.tipCents DESC, q.createdAt").all();
  let test = null; try { test = st.overlayTest ? JSON.parse(st.overlayTest) : null; } catch (e) { test = null; }
  // newest requests (any position in the line) so the overlay can celebrate each new arrival once
  const recent = [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
    .map((r) => ({ id: r.id, songTitle: r.songTitle, artist: r.artist || '', requester: r.requester || '', tipCents: r.tipCents || 0, kind: r.kind || 'song' }));
  res.json({ visible: Number(st.overlayVisible), explodeAt: Number(st.overlayExplodeAt), test, recent,
    colors: { song: st.ovColorSong, custom: st.ovColorCustom, shoutout: st.ovColorShout },
    goal: { show: st.tipGoalShow !== '0', goalCents: Number(st.tipGoalCents) || 40000, tallyCents: Number(st.tipTallyCents) || 0, resetAt: Number(st.tipTallyResetAt) || 0 },
    queue: rows.slice(0, Number(st.overlayVisible)), total: rows.length });
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
        `INSERT INTO songs (id, title, artist, tags, favorite, visible, hasChart, chartSource, minTipCents, chartHtml, chartSize, chartSpacing, noteHtml)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const sg of songs) {
        const c = charts[String(sg.id)] || null;
        insSong.run(sg.id, sg.title, sg.artist || '', JSON.stringify(sg.tags || []),
          sg.favorite ? 1 : 0, sg.visible ? 1 : 0,
          c ? 1 : (sg.hasChart ? 1 : 0), sg.chartSource || '', Number(sg.minTipCents || 0),
          c ? (c.chartHtml || '') : '', c ? Number(c.size || 19) : 19, c ? Number(c.spacing || 19) : 19,
          c ? sanitizeNote(c.noteHtml || '') : '');
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
