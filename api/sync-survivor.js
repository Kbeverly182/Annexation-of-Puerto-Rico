import { kv } from '@vercel/kv';

// Runs the same win/loss sync the manual "Sync" button triggers, but server-side on a schedule.
// Split into its own endpoint (rather than combined with the other two pools) so a slow pool
// can never crowd out a fast one within Vercel's per-function time limit.
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

// Ported from src/lib/espnSchedule.js fetchWeekResults(). One deliberate difference: that
// version applies a small ESPN_ABBR_FIX mapping for a handful of team abbreviations that differ
// from what the app's own team list expects; that mapping isn't duplicated here since guessing
// it wrong would be worse than leaving it out — any affected team's picks simply won't find a
// match and stay unsynced this run (safe failure) rather than risk matching the wrong team.
async function fetchWeekResults(week, seasonYear) {
  const url = buildScoreboardUrl(week, seasonYear);
  if (!url) return {};
  const res = await fetch(url);
  if (!res.ok) throw new Error(`scoreboard fetch failed: ${res.status}`);
  const json = await res.json();
  const results = {}; // teamAbbr -> 'win' | 'loss'
  (json.events || []).forEach(ev => {
    const comp = ev.competitions?.[0];
    if (!comp || !comp.status?.type?.completed) return;
    const competitors = comp.competitors || [];
    const isTie = competitors.length === 2 && Number(competitors[0].score) === Number(competitors[1].score);
    competitors.forEach(c => {
      const abbr = c.team?.abbreviation;
      if (abbr) results[abbr] = isTie ? 'win' : (c.winner ? 'win' : 'loss');
    });
  });
  return results;
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
    const data = await kv.get('survivor-pool-v1');
    if (!data) return res.status(200).json({ ok: true, updated: 0, note: 'no pool data yet' });

    const seasonYear = defaultSeasonYear();
    const next = { ...data, picks: { ...data.picks } };
    let updated = 0;

    for (const week of Object.keys(next.picks)) {
      const results = await fetchWeekResults(week, seasonYear);
      if (Object.keys(results).length === 0) continue;
      const weekPicks = { ...next.picks[week] };
      let weekChanged = false;
      Object.keys(weekPicks).forEach(pid => {
        const pick = weekPicks[pid];
        if (!pick?.team) return;
        const newResult = results[pick.team];
        if (newResult && pick.result !== newResult) {
          weekPicks[pid] = { ...pick, result: newResult };
          weekChanged = true;
          updated++;
        }
      });
      if (weekChanged) next.picks[week] = weekPicks;
    }

    if (updated > 0) await kv.set('survivor-pool-v1', next);
    return res.status(200).json({ ok: true, syncedAt: new Date().toISOString(), updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
