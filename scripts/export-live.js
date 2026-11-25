// Export the LIVE app's data into the seed files in data/ so a Render deploy
// (which wipes app.db and re-seeds from data/) loses nothing.
// Run right before pushing:  node scripts/export-live.js [baseUrl] [outDir]
// Then commit the changed data/*.json together with the code.
const fs = require('fs');
const path = require('path');
const BASE = (process.argv[2] || 'https://killer-keys-tip-app.onrender.com').replace(/\/$/, '');
const OUT = process.argv[3] || path.join(__dirname, '..', 'data');

async function get(p) {
  for (let i = 0; i < 6; i++) { // free tier cold start can take ~50 s
    try {
      const r = await fetch(BASE + p, { signal: AbortSignal.timeout(70000) });
      if (r.ok) return r.json();
      if (r.status === 404 && p === '/api/settings') return { settings: {} }; // older build
      throw new Error('HTTP ' + r.status);
    } catch (e) { if (i === 5) throw e; await new Promise((s) => setTimeout(s, 5000)); }
  }
}

(async () => {
  const { songs } = await get('/api/songs?visible=0&full=1');
  const { setlists } = await get('/api/setlists');
  const { settings } = await get('/api/settings');
  const notes = await get('/api/notes');
  if (!Array.isArray(songs) || songs.length < 100) throw new Error('refusing to export: only ' + (songs || []).length + ' songs came back');
  const songRows = songs.map((s) => ({
    artist: s.artist || '', chartSource: s.chartSource || null, favorite: !!s.favorite,
    hasChart: !!s.hasChart, id: s.id, minTipCents: s.minTipCents || 0, tags: s.tags || [],
    title: s.title, visible: !!s.visible,
  })).sort((a, b) => a.id - b.id);
  const charts = {};
  for (const s of songs) {
    if (!s.chartHtml && !s.noteHtml) continue;
    charts[String(s.id)] = { title: s.title, artist: s.artist || '', chartHtml: s.chartHtml || '', size: s.chartSize || 19, spacing: s.chartSpacing || 19 };
    if (s.noteHtml) charts[String(s.id)].noteHtml = s.noteHtml; // rich-text (Apple-Notes style) chart
  }
  if (Object.keys(charts).length < 100) throw new Error('refusing to export: only ' + Object.keys(charts).length + ' charts came back');
  const lists = setlists.map((l) => ({ date: l.date || '', id: l.id, name: l.name, status: l.status || 'saved', viewers: l.viewers !== false,
    songs: l.songs.map((e) => ({ artist: e.artist || '', off: !!e.off, title: e.title })) }));
  const st = Object.assign({}, settings); delete st.overlayExplodeAt;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'songs-export-2026-11-24.json'), JSON.stringify(songRows));
  fs.writeFileSync(path.join(OUT, 'charts-all.json'), JSON.stringify(charts));
  fs.writeFileSync(path.join(OUT, 'setlists-export-2026-11-24.json'), JSON.stringify(lists));
  fs.writeFileSync(path.join(OUT, 'settings.json'), JSON.stringify(st, null, 1));
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify({ body: notes.body || '' }));
  console.log(`exported ${songRows.length} songs (${Object.keys(charts).length} charts), ${lists.length} setlists (${lists.map((l) => l.name + ': ' + l.songs.length).join(', ')}) to ${OUT}`);
})().catch((e) => { console.error('EXPORT FAILED:', e.message); process.exit(1); });
