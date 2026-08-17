import { kv } from '@vercel/kv';

// Runs the same game-results sync the manual "Sync" button triggers, but server-side on a
// schedule. Split into its own endpoint (rather than combined with the other two pools) so a
// slow pool can never crowd out a fast one within Vercel's per-function time limit.
export const config = { maxDuration: 60 };

const PRESEASON_DATE_RANGES = {
  101: { start: '20260813', end: '20260819' },
  102: { start: '20260820', end: '20260826' },
  103: { start: '20260827', end: '20260908' },
};

function defaultSeasonYear() {
  const now = new Date();
  const m = now.getMonth() + 1;
  return m <= 2 ? now.getFullYear() - 1 : now.getFullYear();
}

function buildScoreboardUrl(week, seasonYear) {
  const n = Number(week);
  if (n > 100) {
    const range = PRESEASON_DATE_RANGES[n];
    if (!range) return null;
    return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1000&dates=${range.start}-${range.end}&seasontype=1`;
  }
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${n}&seasontype=2&dates=${seasonYear}`;
}

// Ported from src/lib/espnSchedule.js fetchWeekResults(), the gameResults half specifically.
async function fetchWeekGameResults(week, seasonYear) {
  const url = buildScoreboardUrl(week, seasonYear);
  if (!url) return {};
  const res = await fetch(url);
  if (!res.ok) throw new Error(`scoreboard fetch failed: ${res.status}`);
  const json = await res.json();
  const gameResults = {}; // gameId -> { winnerAbbr: string|null (null = tie), completed: true }
  (json.events || []).forEach(ev => {
    const comp = ev.competitions?.[0];
    if (!comp || !comp.status?.type?.completed) return;
    const competitors = comp.competitors || [];
    const isTie = competitors.length === 2 && Number(competitors[0].score) === Number(competitors[1].score);
    let winnerAbbr = null;
    competitors.forEach(c => {
      if (!isTie && c.winner && c.team?.abbreviation) winnerAbbr = c.team.abbreviation;
    });
    gameResults[ev.id] = { winnerAbbr: isTie ? null : winnerAbbr, completed: true };
  });
  return gameResults;
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (providedSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    const data = await kv.get('confidence-pool-v1');
    if (!data) return res.status(200).json({ ok: true, updated: 0, note: 'no pool data yet' });

    const seasonYear = defaultSeasonYear();
    const next = { ...data, results: { ...(data.results || {}) } };
    let updated = 0;

    for (const week of Object.keys(data.picks || {})) {
      const gameResults = await fetchWeekGameResults(week, seasonYear);
      if (Object.keys(gameResults).length === 0) continue;
      const existing = next.results[week] || {};
      const merged = { ...existing };
      let weekChanged = false;
      Object.entries(gameResults).forEach(([gameId, result]) => {
        if (JSON.stringify(existing[gameId]) !== JSON.stringify(result)) {
          merged[gameId] = result;
          weekChanged = true;
          updated++;
        }
      });
      if (weekChanged) next.results[week] = merged;
    }

    if (updated > 0) await kv.set('confidence-pool-v1', next);
    return res.status(200).json({ ok: true, syncedAt: new Date().toISOString(), updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
