import { kv } from '@vercel/kv';
import { fetchGameStats } from './sync-lineup.js';
import { scoreGame, fixAbbr, processWaivers } from '../src/lib/jonesCore.js';

// The Jones League — stats sync + weekly waiver run.
//   /api/sync-jones                      (cron, every ~15 min) pulls ESPN scores/stats for both pools (live + beta)
//   /api/sync-jones?manual=1&pool=beta   the "Sync scores now" button (no secret, 15 s throttle)
//   /api/sync-jones?task=waivers[&pool=live|beta|both][&force=1]
//        the WEDNESDAY-NIGHT job: syncs stats first, then processes every pending waiver claim.
// Needs ?secret=CRON_SECRET (or the Authorization header) like the other sync jobs.
export const config = { maxDuration: 60 };

export const jonesKeys = (pool) => ({
  state: `jones:${pool}:state`,
  games: `jones:${pool}:games`,
  rev: `jones:${pool}:rev`,
  lock: `jones:${pool}:lock`,
});

const TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27, TEN: 10, WAS: 28,
};
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.espn.com/',
  Origin: 'https://www.espn.com',
};

async function fetchScoreboard(round) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=${round.start}-${round.end}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`scoreboard ${round.id}: ${r.status}`);
  const json = await r.json();
  return (json.events || []).map(ev => {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === 'home');
    const away = comp?.competitors?.find(c => c.homeAway === 'away');
    return {
      id: String(ev.id),
      round: round.id,
      kickoff: ev.date,
      state: comp?.status?.type?.state || ev.status?.type?.state || 'pre', // 'pre' | 'in' | 'post'
      completed: !!comp?.status?.type?.completed,
      home: fixAbbr(home?.team?.abbreviation),
      away: fixAbbr(away?.team?.abbreviation),
      homeScore: home?.score != null ? Number(home.score) : null,
      awayScore: away?.score != null ? Number(away.score) : null,
    };
  });
}

// Successful 2-point conversions: ESPN doesn't put these in the box score, so we read the play-by-play.
// Best effort — if one is ever missed the commissioner can add a manual score adjustment on the Admin tab.
async function fetchTwoPointers(gameId) {
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(gameId)}`, { headers: HEADERS });
    if (!r.ok) return [];
    const json = await r.json();
    const plays = [
      ...(json.scoringPlays || []),
      ...((json.drives?.previous || []).concat(json.drives?.current ? [json.drives.current] : [])).flatMap(d => d?.plays || []),
    ];
    const seen = new Set();
    const ids = [];
    for (const play of plays) {
      const txt = ((play?.type?.text || '') + ' ' + (play?.text || '')).toLowerCase();
      if (!/(two|2)[- ]?(point|pt)/.test(txt)) continue;
      if (/fail|no good|incomplete|intercept|stopped|unsuccessful|not good|short of/.test(txt)) continue;
      if (!(play?.scoringPlay === true || /good|succe|convers|scores?\b|is good/.test(txt))) continue;
      const key = play?.id || txt.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      (play?.participants || []).forEach(p => { const id = p?.athlete?.id; if (id) ids.push(String(id)); });
    }
    return ids;
  } catch (e) { return []; }
}

const nameCache = {};
async function namesForTeams(abbrs) {
  const out = {};
  await Promise.all(abbrs.map(async (abbr) => {
    const id = TEAM_IDS[abbr];
    if (!id) return;
    if (!nameCache[abbr]) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`);
        const json = r.ok ? await r.json() : {};
        nameCache[abbr] = {};
        (json.athletes || []).forEach(g => (g.items || []).forEach(a => { if (a.id) nameCache[abbr][a.id] = a.fullName || a.displayName; }));
      } catch (e) { nameCache[abbr] = {}; }
    }
    Object.assign(out, nameCache[abbr]);
  }));
  return out;
}

export async function syncOne(pool) {
  try {
    const K = jonesKeys(pool);
    const state = await kv.get(K.state);
    const rounds = state?.config?.rounds || [];
    if (!rounds.length) return { ok: true, updated: false, note: 'league not set up yet' };

    const prev = (await kv.get(K.games)) || {};
    const next = { ...prev };
    const boards = await Promise.all(rounds.map(r => fetchScoreboard(r).catch(() => null)));
    const needStats = [];
    for (const events of boards) {
      for (const ev of events || []) {
        const old = prev[ev.id] || {};
        next[ev.id] = { ...old, ...ev };
        if (ev.state !== 'pre' && !(old.final && old.pts && ev.completed)) needStats.push(ev.id);
      }
    }
    // Pull box scores for games that have started and aren't already finished-and-saved (a few at a time).
    for (let i = 0; i < needStats.length; i += 4) {
      await Promise.all(needStats.slice(i, i + 4).map(async (id) => {
        const g = next[id];
        const gs = await fetchGameStats(id);
        if (!gs || (!gs.players?.length && !gs.scores?.length)) return;
        const twoPt = await fetchTwoPointers(id);
        let nameById = {};
        if ((gs.fieldGoals || []).some(f => !f.playerId)) nameById = await namesForTeams([g.home, g.away].filter(Boolean));
        g.pts = scoreGame(gs, twoPt, nameById);
        g.final = !!gs.completed;
      }));
    }
    const strip = (o) => JSON.stringify(o);
    if (strip(prev) === strip(next)) return { ok: true, updated: false, note: 'no changes', games: Object.keys(next).length };
    await kv.set(K.games, next);
    await kv.set(K.rev, Date.now().toString(36));
    return { ok: true, updated: true, games: Object.keys(next).length, fetchedStats: needStats.length, syncedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Take the pool's write lock (so a waiver run can't collide with a manager saving a claim).
export async function withLock(pool, fn) {
  const K = jonesKeys(pool);
  for (let i = 0; i < 20; i++) {
    const got = await kv.set(K.lock, '1', { nx: true, ex: 20 });
    if (got) {
      try { return await fn(); } finally { await kv.del(K.lock); }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('The league is busy — try again in a moment.');
}

export async function runWaivers(pool, { force = false } = {}) {
  const K = jonesKeys(pool);
  await syncOne(pool); // fresh stats first, so waiver priority is based on current scores
  return withLock(pool, async () => {
    const state = await kv.get(K.state);
    if (!state) return { ok: true, skipped: 'league not set up' };
    if (!force && !(state.claims || []).some(c => c.status === 'pending')) return { ok: true, skipped: 'no pending claims' };
    const last = state.runs?.[state.runs.length - 1];
    if (!force && last && !last.undone && Date.now() - last.ts < 12 * 3600 * 1000) return { ok: true, skipped: 'waivers already ran in the last 12 hours' };
    const games = (await kv.get(K.games)) || {};
    const { state: next, run } = processWaivers(state, games, Date.now());
    await kv.set(K.state, next);
    await kv.set(K.rev, Date.now().toString(36));
    return { ok: true, ran: true, won: run.won, failed: run.failed };
  });
}

export default async function handler(req, res) {
  const pools = req.query?.pool === 'beta' ? ['beta'] : req.query?.pool === 'live' ? ['live'] : ['live', 'beta'];

  if (req.query?.manual === '1') {
    const pool = pools[0];
    try {
      const last = Number(await kv.get('jones-sync-last:' + pool)) || 0;
      if (Date.now() - last < 15000) return res.status(200).json({ ok: true, throttled: true, note: 'Just synced a moment ago — try again in a few seconds.' });
      await kv.set('jones-sync-last:' + pool, Date.now());
    } catch (e) { /* throttle is best-effort */ }
    const out = await syncOne(pool);
    return res.status(out.ok === false ? 500 : 200).json(out);
  }

  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (provided !== process.env.CRON_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const out = {};
  for (const pool of pools) {
    try {
      out[pool] = req.query?.task === 'waivers' ? await runWaivers(pool, { force: req.query?.force === '1' }) : await syncOne(pool);
    } catch (e) { out[pool] = { ok: false, error: String((e && e.message) || e) }; }
  }
  return res.status(200).json({ ok: Object.values(out).every(o => o.ok !== false), ...out });
}
