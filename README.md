# The Killer Keys — Tip & Request App (standalone)

A standalone public web app — the same tip/request app Matthew uses, rebuilt
outside Muse so it opens in any browser with no login.

## What it does

- **Song Board** — searchable list of the 896 visible songs, with era/tag filters
  (Favorites, All, 60s–2020s, Country, Medleys, Bangers, Most requested).
- **Add song** — title, artist, tags, optional pasted chart. Saves to the database.
- **Edit song & chart** — click any song to edit its title, artist, tags, minimum
  tip, chart source link, and chord chart (HTML). Saves to the database.
- **Setlists** — Killer Keys Full Show (666) and matts show (362), in order, with
  in-setlist search, add/remove songs.
- **Performer Queue** — the live request queue (empty state: "The queue is empty.").
- **Performance Notes** — a notes page, saved to the database.

No Stripe, no payments — the request board is free; tips are handled separately.

## Run locally

```sh
npm install
node seed.js   # seeds SQLite from data/*.json (songs, setlists, charts)
node server.js # listens on http://localhost:3000
```

On first run the server auto-seeds from `data/` if the database is empty,
so a fresh deploy works with no manual step.

## Deploy to Render (free tier)

1. Push this folder to a GitHub repo (e.g. `pianomattyb/killer-keys-tip-app`).
2. In Render, New → Web Service → connect the repo. Render reads `render.yaml`
   (Node 24, `npm install`, `node server.js`).
3. The service auto-seeds on first boot from `data/` and serves the app.
4. The public URL is the Render service URL — no login, no expiry.

## Data

- `data/songs-export-2026-11-24.json` — 1,133 songs (from the Muse artifact).
- `data/setlists-export-2026-11-24.json` — Full Show (666) + matts show (362).
- `data/charts-all.json` — 420 chord charts keyed by song id.
- `data/app.db` — the live SQLite database (created by seed.js / auto-seed;
  git-ignored, do not commit).

## Before every push/deploy: export live data first

A Render deploy wipes `data/app.db` and re-seeds from `data/*.json`. Any edit made
on the live app since the last deploy (hidden songs, min tips, charts, setlist
on/off, overlay settings, notes) is lost unless it is in the seed files. So, right
before pushing:

```sh
node scripts/export-live.js            # pulls the live API into data/*.json
git add data && git commit -m "Seed: live data export"
```

Then push. The queue is not exported (it is per-show).

## UI tests (Wix-like iframe)

`tests/ui/` loads the app inside a mock Wix page (outer page -> filesusr-style
iframe with `allow="fullscreen"` -> app iframe, 1200 px) and clicks every tab and
button at 1280 px and 390 px with headless Chrome (`pip install playwright`).
Serve `tests/ui` on 127.0.0.1:8100 and :8101 (`python3 -m http.server`), then run
`tests/ui/run.sh`.

## Persistence note (Render free tier)

The SQLite file lives on the service disk. It persists across restarts but a
new deploy resets the disk to the repo state, so edits made after the last
deploy are lost on redeploy. For durable edits, either avoid redeploying
while the board is in active use, or move the database to Render's free
PostgreSQL and point the server at `DATABASE_URL`. The seed files in `data/`
are always the fallback: a fresh boot re-seeds the full catalogue, setlists
and charts.
