// Permanent fan-request log for Analytics (and, later, Most requested).
// Independent of the live queue: play / delete / clear never remove these rows.
// Show "nights" use America/Winnipeg and roll to the next date at 6:00 AM,
// so a request at 1 AM still counts on the night that started the evening before.
const TZ = 'America/Winnipeg';
const SHOW_MOST_REQUESTED = false; // flip to true the night after the first show

function showDateFor(ms) {
  const shifted = new Date(Number(ms) - 6 * 60 * 60 * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(shifted).map((p) => [p.type, p.value])
  );
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function labelShowDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 18, 0, 0));
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function createRequestLogTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    songId INTEGER,
    title TEXT NOT NULL,
    artist TEXT DEFAULT '',
    tipCents INTEGER DEFAULT 0,
    kind TEXT DEFAULT 'song',
    createdAt INTEGER NOT NULL,
    showDate TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS request_log_song ON request_log(songId)');
  db.exec('CREATE INDEX IF NOT EXISTS request_log_show ON request_log(showDate)');
}

function logFanRequest(db, rec) {
  const createdAt = Number(rec.createdAt) || Date.now();
  const kind = rec.kind === 'custom' || rec.kind === 'shoutout' ? rec.kind : 'song';
  const tip = Math.max(0, Math.round(Number(rec.tipCents) || 0));
  const title = String(rec.title || (kind === 'shoutout' ? 'Shout-out' : 'Request')).slice(0, 160);
  const artist = String(rec.artist || '').slice(0, 120);
  const songId = rec.songId ? Number(rec.songId) : null;
  const info = db.prepare(
    'INSERT INTO request_log (songId, title, artist, tipCents, kind, createdAt, showDate) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(songId, title, artist, tip, kind, createdAt, showDateFor(createdAt));
  return Number(info.lastInsertRowid);
}

function exportRows(db) {
  return db.prepare(
    'SELECT id, songId, title, artist, tipCents, kind, createdAt, showDate FROM request_log ORDER BY id'
  ).all().map((r) => ({
    id: r.id,
    songId: r.songId == null ? null : r.songId,
    title: r.title,
    artist: r.artist || '',
    tipCents: r.tipCents || 0,
    kind: r.kind || 'song',
    createdAt: r.createdAt,
    showDate: r.showDate
  }));
}

function importRows(db, data) {
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.requests) ? data.requests : []);
  const ins = db.prepare(
    'INSERT INTO request_log (id, songId, title, artist, tipCents, kind, createdAt, showDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  let n = 0;
  for (const r of rows) {
    const createdAt = Number(r.createdAt) || Date.now();
    const kind = r.kind === 'custom' || r.kind === 'shoutout' ? r.kind : 'song';
    ins.run(
      r.id != null ? Number(r.id) : null,
      r.songId ? Number(r.songId) : null,
      String(r.title || '').slice(0, 160) || 'Request',
      String(r.artist || '').slice(0, 120),
      Math.max(0, Math.round(Number(r.tipCents) || 0)),
      kind,
      createdAt,
      r.showDate || showDateFor(createdAt)
    );
    n++;
  }
  return n;
}

function songCounts(db) {
  const counts = {};
  for (const r of db.prepare(
    "SELECT songId, COUNT(*) n FROM request_log WHERE kind = 'song' AND songId IS NOT NULL GROUP BY songId"
  ).all()) counts[r.songId] = r.n;
  return counts;
}

function summarize(db) {
  const rows = exportRows(db);
  const totals = { requests: rows.length, tipCents: 0, nights: 0, songs: 0 };
  const kinds = { song: { requests: 0, tipCents: 0 }, custom: { requests: 0, tipCents: 0 }, shoutout: { requests: 0, tipCents: 0 } };
  const nightMap = new Map();
  const songMap = new Map();
  for (const r of rows) {
    totals.tipCents += r.tipCents;
    const k = kinds[r.kind] ? r.kind : 'song';
    kinds[k].requests++;
    kinds[k].tipCents += r.tipCents;
    if (!nightMap.has(r.showDate)) nightMap.set(r.showDate, { showDate: r.showDate, label: labelShowDate(r.showDate), requests: 0, tipCents: 0 });
    const night = nightMap.get(r.showDate);
    night.requests++;
    night.tipCents += r.tipCents;
    const key = (r.kind === 'song' && r.songId) ? 's:' + r.songId : r.kind + ':' + r.title.toLowerCase();
    if (!songMap.has(key)) songMap.set(key, { songId: r.kind === 'song' ? r.songId : null, title: r.title, artist: r.artist || '', kind: r.kind, requests: 0, tipCents: 0 });
    const s = songMap.get(key);
    s.requests++;
    s.tipCents += r.tipCents;
    if (r.title && r.kind === 'song') s.title = r.title;
    if (r.artist && r.kind === 'song') s.artist = r.artist;
  }
  const nights = [...nightMap.values()].sort((a, b) => a.showDate < b.showDate ? 1 : -1);
  const songs = [...songMap.values()].sort((a, b) => b.requests - a.requests || b.tipCents - a.tipCents || a.title.localeCompare(b.title));
  totals.nights = nights.length;
  totals.songs = songs.filter((s) => s.kind === 'song').length;
  return { showMostRequested: SHOW_MOST_REQUESTED, totals, kinds, nights, songs };
}

module.exports = {
  TZ, SHOW_MOST_REQUESTED, showDateFor, labelShowDate,
  createRequestLogTable, logFanRequest, exportRows, importRows, songCounts, summarize
};
