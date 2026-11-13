import { kv } from '@vercel/kv';
import { fetchGameStats, computeFantasyPoints, computeDstPoints, pickStat, namesMatch } from './sync-lineup.js';

// Results sync for the Thanksgiving "Poultry Bowl" pool. Reads the games the admin set up on the
// pool page (each with an ESPN game id), pulls every box score, and writes everything the pool
// needs to score entries into results.bowl.auto: per-game scores / longest field goal / field
// goals made / touchdown scorers, the four stat leaders, the longest non-defensive TD, and every
// player's + defense's fantasy points. Admin overrides (results.bowl.manual) are never touched.
export const config = { maxDuration: 60 };

const KEY_LIVE = 'poultry-bowl-v1';
const KEY_BETA = 'poultry-bowl-beta-v1'; // practice pool — synced too, when it has games

const TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27, TEN: 10, WAS: 28,
};
const ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };
const fix = (a) => ABBR_FIX[a] || a;

async function fetchRosters(abbrs) {
  const pos = {};  // athlete id -> position (QB/RB/WR/TE/K)
  const name = {}; // athlete id -> full name
  await Promise.all(abbrs.map(async (abbr) => {
    const id = TEAM_IDS[abbr];
    if (!id) return;
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`);
      if (!r.ok) return;
      const json = await r.json();
      (json.athletes || []).forEach(group => {
        (group.items || []).forEach(a => {
          if (!a.id) return;
          pos[a.id] = a.position?.abbreviation === 'PK' ? 'K' : a.position?.abbreviation;
          name[a.id] = a.fullName || a.displayName || null;
        });
      });
    } catch (e) { /* best-effort */ }
  }));
  return { pos, name };
}

async function syncOne(KEY) {
  try {
    const data = await kv.get(KEY);
    const games = (data?.config?.games || []).filter(g => g.espnId);
    if (!games.length) return ({ ok: true, updated: false, note: 'no games with an ESPN id set up yet' });

    const abbrs = [...new Set(games.flatMap(g => [g.home, g.away]))];
    const { pos, name: nameMap } = await fetchRosters(abbrs);

    const auto = { updatedAt: new Date().toISOString(), games: {}, leaders: {}, lineupScores: {}, longestTd: null, allFinal: false };
    const best = { qb: null, rb: null, wr: null, te: null };
    const board = { qb: [], rb: [], wr: [], te: [] };
    const consider = (key, id, name, value) => {
      if (!(value > 0)) return;
      board[key].push({ id, name, value });
      if (!best[key] || value > best[key].value) best[key] = { id, name, value };
    };
    let finals = 0;

    for (const g of games) {
      const gs = await fetchGameStats(g.espnId);
      const gameOut = { final: false, started: false };
      auto.games[g.id] = gameOut;
      if (!gs || !gs.scores || !gs.scores.length) continue;

      const score = (abbr) => gs.scores.find(s => fix(s.abbr) === abbr)?.score;
      gameOut.homeScore = score(g.home) ?? null;
      gameOut.awayScore = score(g.away) ?? null;
      gameOut.final = !!gs.completed;
      gameOut.started = gameOut.homeScore != null || gs.players.length > 0;
      if (gameOut.final) finals++;
      gameOut.longestFG = gs.fieldGoals.length ? Math.max(...gs.fieldGoals.map(f => f.yards)) : 0;
      gameOut.fgMade = gs.fieldGoals.length;
      gameOut.tds = (gs.scoringTds || []).map(t => ({ name: t.name, yards: t.yards, team: fix(t.team), def: !!t.def, st: /punt return|kickoff return|kick return/i.test(t.type || '') }));

      // longest TD across the whole slate for the jackpot — defensive TDs and punt/kickoff returns don't count
      gameOut.tds.filter(t => !t.def && !t.st).forEach(t => {
        if (!auto.longestTd || t.yards > auto.longestTd.yards) auto.longestTd = { name: t.name, yards: t.yards, gameId: g.id, team: t.team || null };
      });

      // Player fantasy points + stat leaders
      const rowsByPlayer = {};
      gs.players.forEach(row => {
        if (!row.playerId) return;
        (rowsByPlayer[row.playerId] = rowsByPlayer[row.playerId] || []).push(row);
      });
      for (const [playerId, rows] of Object.entries(rowsByPlayer)) {
        const isKicker = rows.some(r => (r.category || '').toLowerCase().includes('kick') && !(r.category || '').toLowerCase().includes('return'));
        let exactFGs = [];
        if (isKicker) {
          const rosterName = nameMap[playerId];
          exactFGs = gs.fieldGoals
            .filter(fg => fg.playerId === playerId || (rosterName && namesMatch(fg.kickerName, rosterName)))
            .map(fg => fg.yards);
        }
        let total = 0;
        rows.forEach(row => {
          const isK = (row.category || '').toLowerCase().includes('kick');
          total += computeFantasyPoints(row.category, row.stats, isK ? exactFGs : undefined);
        });
        auto.lineupScores[playerId] = Math.round(total * 10) / 10;

        const p = pos[playerId];
        const pname = nameMap[playerId] || null;
        const catRows = (needle) => rows.filter(r => (r.category || '').toLowerCase().includes(needle));
        if (p === 'QB') consider('qb', playerId, pname, catRows('pass').reduce((s, r) => s + pickStat(r.stats, ['YDS', 'PASS YDS', 'PASSING YARDS']), 0));
        if (p === 'RB') consider('rb', playerId, pname, catRows('rush').reduce((s, r) => s + pickStat(r.stats, ['YDS', 'RUSH YDS']), 0));
        if (p === 'WR') consider('wr', playerId, pname, catRows('receiv').reduce((s, r) => s + pickStat(r.stats, ['YDS', 'REC YDS']), 0));
        if (p === 'TE') consider('te', playerId, pname, catRows('receiv').reduce((s, r) => s + pickStat(r.stats, ['REC', 'RECEPTIONS']), 0));
      }

      // D/ST for both teams in the game
      gs.scores.forEach(s => {
        if (!s.abbr) return;
        auto.lineupScores[fix(s.abbr)] = Math.round(computeDstPoints(s.abbr, gs) * 10) / 10;
      });
    }

    Object.keys(best).forEach(k => { if (best[k]) auto.leaders[k] = best[k]; });
    // Top of each stat board (a player's stats are summed across games, so ids are unique). Used for the 20/15/10/5 Big Four scoring.
    auto.board = {};
    Object.keys(board).forEach(k => { auto.board[k] = board[k].sort((a, b) => b.value - a.value).slice(0, 12); });
    auto.allFinal = games.length === (data.config.games || []).length && finals === games.length;

    // Only write (and bump the revision) when something other than the timestamp changed.
    const strip = (a) => JSON.stringify({ ...(a || {}), updatedAt: null });
    const prevAuto = data?.results?.bowl?.auto;
    if (strip(prevAuto) === strip(auto)) return ({ ok: true, updated: false, note: 'no changes' });

    // Re-read right before writing so a save that happened during this run isn't clobbered.
    const fresh = (await kv.get(KEY)) || data;
    const next = { ...fresh, results: { ...(fresh.results || {}), bowl: { ...(fresh.results?.bowl || {}), auto } } };
    await kv.set(KEY, next);
    await kv.set(KEY + ':rev', Date.now().toString(36));
    return ({ ok: true, updated: true, syncedAt: auto.updatedAt, allFinal: auto.allFinal, leaders: auto.leaders, longestTd: auto.longestTd });
  } catch (e) {
    return ({ ok: false, error: String(e?.message || e) });
  }
}

export default async function handler(req, res) {
  // Manual "Sync now" button on the page: no secret needed (it only pulls public ESPN data), but it is
  // limited to one run every 15 seconds per pool so nobody can hammer it.
  if (req.query?.manual === '1') {
    const which = req.query?.pool === 'beta' ? KEY_BETA : KEY_LIVE;
    try {
      const last = Number(await kv.get('poultry-sync-last:' + which)) || 0;
      if (Date.now() - last < 15000) return res.status(200).json({ ok: true, throttled: true, note: 'Just synced a moment ago — try again in a few seconds.' });
      await kv.set('poultry-sync-last:' + which, Date.now());
    } catch (e) { /* throttle is best-effort */ }
    const out = await syncOne(which);
    return res.status(out.ok === false ? 500 : 200).json(out);
  }
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (providedSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const live = await syncOne(KEY_LIVE);
  let beta = null;
  try { beta = await syncOne(KEY_BETA); } catch (e) { beta = { ok: false, error: String(e?.message || e) }; }
  return res.status(live.ok === false ? 500 : 200).json({ ...live, beta });
}
