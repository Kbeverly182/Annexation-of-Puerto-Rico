# NFL Pools

A shared dashboard for multiple NFL pools — currently Survivor and Confidence,
with a Lineup Pick'em pool planned. Each pool has its own entrants, its own
data, and its own PIN-protected identity, but they all share one deployment
and one database.

## Structure

- `src/pages/Landing.jsx` — dashboard linking to each pool
- `src/pages/SurvivorPool.jsx` — pick one team to win each week, no repeats, one loss and you're out
- `src/pages/ConfidencePool.jsx` — rank every game 1 to N by confidence, cumulative season points
- `src/lib/` — shared code used by every pool: NFL team list, the ESPN schedule/results fetcher, PIN hashing, and the storage API helper
- `api/pool.js` — one serverless function that reads/writes any pool's data, keyed by a `?key=` query param, backed by Vercel KV

Routing uses `HashRouter` (URLs look like `yoursite.vercel.app/#/survivor`) specifically so no extra Vercel routing configuration is needed — it works out of the box on a static deploy.

## 1. Local setup

```bash
npm install
```

This won't fully run locally without a KV database connected (see step 3),
but you can preview the UI with:

```bash
npm run dev
```

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub, then:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

## 3. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (GitHub login is easiest).
2. Click **Add New → Project**, and import the GitHub repo you just pushed.
3. Vercel will auto-detect this as a Vite project — leave the default build
   settings and click **Deploy**.
4. Once it's deployed, go to your project's **Storage** tab in the Vercel
   dashboard, click **Create Database**, and choose **KV**. Connect it to
   this project — Vercel will automatically add the required environment
   variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc.).
5. Redeploy (Vercel usually does this automatically after connecting a new
   storage integration; if not, go to **Deployments** and click **Redeploy**
   on the latest one).

You'll get a permanent URL like `your-project.vercel.app` — that's the link
you send to your group.

## 4. Using the app

- Anyone with the link can add themselves as an entrant.
- The first time someone taps their name, they set a 4-digit PIN — that's
  how they "log back in" as themselves later (this is a casual deterrent,
  not real authentication).
- Picks lock and become visible to everyone once their game kicks off, or
  once the early Sunday afternoon window starts (whichever comes first) —
  whichever is sooner for that pick.
- The **Sync week scores** button pulls final scores from ESPN's public
  scoreboard and marks each pick a win or loss automatically. Ties count as
  a win for both teams. It's an unofficial feed, so the manual win/loss
  buttons are always there as a fallback.

## Notes on the pieces

- `/api/pool.js` — a Vercel serverless function that reads/writes the shared
  pool state (participants, picks, results) to Vercel KV.
- `src/App.jsx` — the entire UI and logic.
- Personal device identity (which entrant "you" are) is stored in the
  browser's `localStorage`, not in the shared database, so it stays private
  to each device.
- The app polls `/api/pool` every 15 seconds so everyone's picks stay
  roughly in sync without needing a page refresh.
