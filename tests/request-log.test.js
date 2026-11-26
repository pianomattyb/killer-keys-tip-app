// Analytics log + independent custom/shout-out tip prices.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const {
  SHOW_MOST_REQUESTED, showDateFor, labelShowDate,
  createRequestLogTable, logFanRequest, exportRows, importRows, songCounts, summarize
} = require('../lib/request-log');

let fails = 0;
function ok(name, cond, detail) {
  if (cond) console.log('PASS', name);
  else { fails++; console.log('FAIL', name, detail === undefined ? '' : detail); }
}

ok('Most requested stays hidden', SHOW_MOST_REQUESTED === false);

// America/Winnipeg, 6 AM rollover. Nov 2026 is CST (UTC-6); July is CDT (UTC-5).
// Winnipeg wall times. This environment reports America/Winnipeg as UTC-5 on 2026-11-26.
ok('1am Nov is previous night', showDateFor(Date.parse('2026-11-26T06:00:00Z')) === '2026-11-25');
ok('5:59am Nov is previous night', showDateFor(Date.parse('2026-11-26T10:59:00Z')) === '2026-11-25');
ok('6am Nov rolls over', showDateFor(Date.parse('2026-11-26T11:00:00Z')) === '2026-11-26');
ok('afternoon Nov same day', showDateFor(Date.parse('2026-11-26T20:00:00Z')) === '2026-11-26');
ok('1am July is previous night', showDateFor(Date.parse('2026-07-04T06:00:00Z')) === '2026-07-03');
ok('6am July rolls over', showDateFor(Date.parse('2026-07-04T11:00:00Z')) === '2026-07-04');
ok('labelShowDate has a weekday', /[A-Za-z]{3}/.test(labelShowDate('2026-11-25')));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-log-'));
const db = new DatabaseSync(path.join(dir, 't.db'));
createRequestLogTable(db);
const t1 = Date.parse('2026-11-26T20:00:00Z'); // afternoon = Nov 26
const t2 = Date.parse('2026-11-27T07:00:00Z'); // 1am Nov 27 = Nov 26 night
logFanRequest(db, { songId: 10, title: 'Piano Man', artist: 'Billy Joel', tipCents: 1000, kind: 'song', createdAt: t1 });
logFanRequest(db, { songId: 10, title: 'Piano Man', artist: 'Billy Joel', tipCents: 500, kind: 'song', createdAt: t2 });
logFanRequest(db, { title: 'Custom: Hello', tipCents: 1500, kind: 'custom', createdAt: t1 });
logFanRequest(db, { title: 'Shout-out', tipCents: 1000, kind: 'shoutout', createdAt: t1 });
const sum = summarize(db);
ok('totals.requests=4', sum.totals.requests === 4, sum.totals);
ok('totals.tipCents=4000', sum.totals.tipCents === 4000, sum.totals);
ok('one show night (1am rolls back)', sum.totals.nights === 1, sum.nights);
ok('one catalog song tallied', sum.totals.songs === 1);
ok('Piano Man 2 req / $15', sum.songs.some(s => s.songId === 10 && s.requests === 2 && s.tipCents === 1500), sum.songs);
ok('custom + shout in the table', sum.kinds.custom.requests === 1 && sum.kinds.shoutout.requests === 1);
ok('songCounts only counts catalog songs', songCounts(db)[10] === 2 && Object.keys(songCounts(db)).length === 1);

const dumped = exportRows(db);
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-log2-'));
const db2 = new DatabaseSync(path.join(dir2, 't.db'));
createRequestLogTable(db2);
ok('importRows from {requests}', importRows(db2, { requests: dumped }) === 4);
ok('roundtrip counts match', summarize(db2).totals.tipCents === 4000 && summarize(db2).totals.requests === 4);

// ---- slim HTTP server: logging, prices, no live writes ----
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-http-'));
const songs = [
  { id: 1, title: 'Piano Man', artist: 'Billy Joel', tags: [], favorite: true, visible: true, hasChart: false, minTipCents: 3000 },
  { id: 2, title: '1979', artist: 'Smashing Pumpkins', tags: [], favorite: false, visible: true, hasChart: false, minTipCents: 0 }
];
fs.writeFileSync(path.join(dataDir, 'songs-export-2026-11-24.json'), JSON.stringify(songs));
fs.writeFileSync(path.join(dataDir, 'setlists-export-2026-11-24.json'), JSON.stringify([]));
fs.writeFileSync(path.join(dataDir, 'charts-all.json'), JSON.stringify({}));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
  globalMinCents: '0', customMinCents: '1000', shoutMinCents: '1000',
  tipGoalCents: '40000', tipGoalShow: '1', tipTallyCents: '0'
}));
fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ body: '' }));
fs.writeFileSync(path.join(dataDir, 'request-log.json'), JSON.stringify({ requests: [] }));

const PORT = 3077;
const BASE = 'http://127.0.0.1:' + PORT;
const child = spawn('node', ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(PORT) }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let buf = '';
function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const d = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(BASE + p, {
      method, headers: d ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } : {}
    }, (res) => {
      let s = '';
      res.on('data', (c) => s += c);
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(s); } catch (e) { j = { raw: s }; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    req.on('error', reject);
    if (d) req.write(d);
    req.end();
  });
}

function waitListen() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start timeout\n' + buf)), 20000);
    const on = (c) => {
      buf += c.toString();
      if (/listening on port/.test(buf)) { clearTimeout(t); resolve(); }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
}

(async () => {
  try {
    await waitListen();
    const fan = (await call('GET', '/api/fan')).body;
    ok('fan default custom/shout $10', fan.customMinCents === 1000 && fan.shoutMinCents === 1000, fan);

    let r = await call('POST', '/api/queue', { songId: 2, songTitle: '1979', tipCents: 0, requester: 'A' });
    ok('free song accepted at $0', r.status === 201, r);
    r = await call('POST', '/api/queue', { kind: 'shoutout', tipCents: 500, requester: 'A', customText: 'x' });
    ok('shout $5 rejected at $10 min', r.status === 400, r);
    r = await call('POST', '/api/queue', { kind: 'shoutout', tipCents: 1000, requester: 'A' });
    ok('shout $10 accepted', r.status === 201, r);
    r = await call('POST', '/api/queue', { kind: 'custom', customText: 'Hello — Band', tipCents: 1000, requester: 'A' });
    ok('custom $10 accepted', r.status === 201, r);

    r = await call('PUT', '/api/settings', { customMinCents: 2000, shoutMinCents: 500 });
    ok('set custom $20 / shout $5', r.status === 200, r);
    r = await call('PUT', '/api/settings', { customMinCents: 300 });
    ok('custom $3 refused', r.status === 400, r);
    const fan2 = (await call('GET', '/api/fan')).body;
    ok('fan shows split mins', fan2.customMinCents === 2000 && fan2.shoutMinCents === 500, fan2);
    r = await call('POST', '/api/queue', { kind: 'custom', customText: 'Hello — Band', tipCents: 1000, requester: 'A' });
    ok('custom $10 rejected when min is $20', r.status === 400, r);
    r = await call('POST', '/api/queue', { kind: 'custom', customText: 'Hello — Band', tipCents: 2000, requester: 'A' });
    ok('custom $20 accepted', r.status === 201, r);
    r = await call('POST', '/api/queue', { kind: 'shoutout', tipCents: 500, requester: 'A' });
    ok('shout $5 accepted after change', r.status === 201, r);
    r = await call('POST', '/api/queue', { songId: 2, songTitle: '1979', tipCents: 0, requester: 'A' });
    ok('song price stays independent (still free)', r.status === 201, r);

    r = await call('POST', '/api/queue', { songId: 2, songTitle: '1979', tipCents: 0, performer: true });
    ok('performer add bypasses', r.status === 201, r);

    const beforeQ = (await call('GET', '/api/queue')).body.queue;
    const ids = beforeQ.map((x) => x.id);
    ok('queue has rows to delete', ids.length > 0);
    for (const id of ids) await call('POST', `/api/queue/${id}/delete`);
    const afterQ = (await call('GET', '/api/queue')).body.queue;
    ok('queue cleared', afterQ.length === 0, afterQ);

    const an = (await call('GET', '/api/analytics')).body;
    ok('analytics survives queue delete', an.totals.requests >= 6, an.totals);
    ok('performer add was not logged', an.totals.requests === 6, an.totals);
    ok('showMostRequested flag false on API', an.showMostRequested === false);
    const ex = (await call('GET', '/api/analytics/export')).body;
    ok('export has 6 rows', Array.isArray(ex.requests) && ex.requests.length === 6, ex.requests && ex.requests.length);

    // persist prices + log through a fresh autoSeed
    const expDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-exp-'));
    const st = (await call('GET', '/api/settings')).body.settings;
    fs.writeFileSync(path.join(expDir, 'settings.json'), JSON.stringify(st, null, 1));
    fs.writeFileSync(path.join(expDir, 'request-log.json'), JSON.stringify(ex));
    fs.writeFileSync(path.join(expDir, 'songs-export-2026-11-24.json'), JSON.stringify(songs));
    fs.writeFileSync(path.join(expDir, 'setlists-export-2026-11-24.json'), JSON.stringify([]));
    fs.writeFileSync(path.join(expDir, 'charts-all.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(expDir, 'notes.json'), JSON.stringify({ body: '' }));
    const PORT2 = 3078;
    const child2 = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: Object.assign({}, process.env, { DATA_DIR: expDir, PORT: String(PORT2) }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      let b = '';
      const t = setTimeout(() => reject(new Error('server2 timeout ' + b)), 20000);
      const on = (c) => { b += c.toString(); if (/listening on port/.test(b)) { clearTimeout(t); resolve(); } };
      child2.stdout.on('data', on); child2.stderr.on('data', on);
    });
    const an2 = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3078/api/analytics', (res) => {
        let s = ''; res.on('data', (c) => s += c); res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
    const fan3 = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3078/api/fan', (res) => {
        let s = ''; res.on('data', (c) => s += c); res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
    ok('fresh seed keeps 6 log rows', an2.totals.requests === 6, an2.totals);
    ok('fresh seed keeps custom $20 / shout $5', fan3.customMinCents === 2000 && fan3.shoutMinCents === 500, fan3);
    child2.kill('SIGTERM');
  } catch (e) {
    fails++; console.log('FAIL http block', e && e.stack || e);
  } finally {
    try { child.kill('SIGTERM'); } catch (e) {}
    console.log('FAILS', fails);
    process.exit(fails ? 1 : 0);
  }
})();
