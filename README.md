# NFL Survivor Pool

A shared survivor pool tracker: entrants pick one team to win each week, can't
reuse a team, one loss and you're out. Picks stay hidden from other entrants
until kickoff (individual games lock/reveal at their own kickoff time; the
whole week locks/reveals once the early Sunday window starts). Scores can
sync automatically from ESPN's public scoreboard feed.

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
