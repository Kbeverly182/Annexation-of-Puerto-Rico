import { kv } from '@vercel/kv';

// Runs the same player-stats sync the manual "Sync" button triggers, but server-side on a
// schedule. This is the heaviest of the three sync jobs (fetches all 32 team rosters plus
// individual game box scores), so it gets its own endpoint with its own time budget rather than
// sharing one with Survivor/Confidence.
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

async function fetchWeekGameStatus(week, seasonYear) {
  const url = buildScoreboardUrl(week, seasonYear);
  if (!url) return {};
  const res = await fetch(url);
  if (!res.ok) throw new Error(`scoreboard fetch failed: ${res.status}`);
  const json = await res.json();
  const byTeam = {}; // teamAbbr -> { gameId, completed }
  (json.events || []).forEach(ev => {
    const comp = ev.competitions?.[0];
    const completed = !!comp?.status?.type?.completed;
    (comp?.competitors || []).forEach(c => {
      const abbr = c.team?.abbreviation;
      if (abbr) byTeam[abbr] = { gameId: ev.id, completed };
    });
  });
  return byTeam;
}

// Ported from api/backup-to-sheets.js's fetchPlayerNameMap(), returning team instead of name.
const TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27, TEN: 10, WAS: 28,
};

async function fetchPlayerTeamMap() {
  const map = {}; // athlete id -> team abbr
  const entries = Object.entries(TEAM_IDS);
  const BATCH_SIZE = 8;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ([abbr, teamId]) => {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
        if (!r.ok) return;
        const json = await r.json();
        (json.athletes || []).forEach(group => {
          (group.items || []).forEach(a => { if (a.id) map[a.id] = abbr; });
        });
      } catch (e) { /* best-effort — that team's players just won't be findable this run */ }
    }));
  }
  return map;
}

// Ported from api/playerstats.js — kept in sync with that file's parsing logic.
async function fetchGameStats(gameId) {
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.espn.com/',
    'Origin': 'https://www.espn.com',
  };
  const urls = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(gameId)}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?region=us&lang=en&contentorigin=espn&event=${encodeURIComponent(gameId)}`,
  ];
  let json = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: commonHeaders });
      if (r.ok) { json = await r.json(); break; }
    } catch (e) { /* try next url */ }
  }
  if (!json) return { players: [], teams: [], scores: [], fieldGoals: [] };

  const players = [];
  try {
    (json?.boxscore?.players || []).forEach(teamBlock => {
      const teamAbbr = teamBlock.team?.abbreviation || null;
      (teamBlock.statistics || []).forEach(category => {
        const catName = category.name || category.type || 'unknown';
        const labels = category.labels || category.keys || [];
        (category.athletes || []).forEach(entry => {
          const athleteId = entry.athlete?.id || null;
          const statValues = entry.stats || [];
          const row = {};
          labels.forEach((label, i) => { row[label] = statValues[i]; });
          players.push({ playerId: athleteId, team: teamAbbr, category: catName, stats: row });
        });
      });
    });
  } catch (e) { /* players stays [] */ }

  const teams = [];
  try {
    (json?.boxscore?.teams || []).forEach(tb => {
      const abbr = tb.team?.abbreviation || null;
      const statMap = {};
      (tb.statistics || []).forEach(s => {
        const key = s.name || s.label || s.abbreviation || '';
        if (key) statMap[key] = s.displayValue ?? s.value;
      });
      teams.push({ abbr, stats: statMap });
    });
  } catch (e) { /* teams stays [] */ }

  const scores = [];
  try {
    (json?.header?.competitions?.[0]?.competitors || []).forEach(c => {
      scores.push({ abbr: c.team?.abbreviation || null, score: c.score != null ? Number(c.score) : null });
    });
  } catch (e) { /* scores stays [] */ }

  const fieldGoals = [];
  try {
    const candidatePlaySets = [
      json?.scoringPlays || [],
      [...(json?.drives?.previous || []), ...(json?.drives?.current ? [json.drives.current] : [])].flatMap(d => d?.plays || []),
      json?.plays || [],
    ];
    for (const plays of candidatePlaySets) {
      if (!plays || plays.length === 0) continue;
      plays.forEach(play => {
        const typeText = (play?.type?.text || play?.type?.abbreviation || '').toLowerCase();
        if (!typeText.includes('field goal')) return;
        const text = play?.text || '';
        const isGood = play?.scoringPlay === true || /is good/i.test(text) || /field goal good/i.test(text);
        if (!isGood) return;
        let yards = typeof play?.statYardage === 'number' ? play.statYardage : null;
        if (yards == null) {
          const m = text.match(/(\d+)\s*yd\.?\s*field\s*goal/i);
          if (m) yards = Number(m[1]);
        }
        if (yards == null || Number.isNaN(yards)) return;
        const kicker = (play?.participants || []).find(p => (p?.type || p?.athleteType || '').toLowerCase().includes('kick'))
          || (play?.participants || [])[0] || null;
        const playerId = kicker?.athlete?.id || null;
        if (playerId) fieldGoals.push({ playerId, yards });
      });
      if (fieldGoals.length > 0) break;
    }
  } catch (e) { /* fieldGoals stays [] */ }

  return { players, teams, scores, fieldGoals };
}

// Ported verbatim from src/pages/LineupPool.jsx's scoring functions.
const SLOTS = [
  { key: 'QB' }, { key: 'RB1' }, { key: 'RB2' }, { key: 'WR1' }, { key: 'WR2' },
  { key: 'TE' }, { key: 'K' }, { key: 'DST' },
];

function pickStat(stats, keys) {
  for (const k of keys) {
    if (stats[k] != null) {
      const raw = String(stats[k]);
      if (raw.includes('/')) {
        const made = parseFloat(raw.split('/')[0]);
        if (!isNaN(made)) return made;
      }
      const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

function computeFantasyPoints(category, stats, exactFieldGoals) {
  const cat = (category || '').toLowerCase();
  if (cat.includes('pass')) {
    const yds = pickStat(stats, ['YDS', 'PASS YDS', 'PASSING YARDS']);
    const td = pickStat(stats, ['TD', 'PASS TD']);
    const int = pickStat(stats, ['INT', 'INTERCEPTIONS']);
    return yds / 25 + td * 6 + int * -2;
  }
  if (cat.includes('rush')) {
    const yds = pickStat(stats, ['YDS', 'RUSH YDS']);
    const td = pickStat(stats, ['TD', 'RUSH TD']);
    return yds / 10 + td * 6;
  }
  if (cat.includes('receiv')) {
    const rec = pickStat(stats, ['REC', 'RECEPTIONS']);
    const yds = pickStat(stats, ['YDS', 'REC YDS']);
    const td = pickStat(stats, ['TD', 'REC TD']);
    return rec * 1 + yds / 10 + td * 6;
  }
  if (cat.includes('fumbl')) {
    return pickStat(stats, ['LOST', 'FUM LOST']) * -2;
  }
  if (cat.includes('kick')) {
    const xpPoints = pickStat(stats, ['XP', 'PAT']) * 1;
    if (exactFieldGoals && exactFieldGoals.length > 0) {
      return exactFieldGoals.reduce((sum, yards) => sum + Math.max(yards / 10, 3.0), 0) + xpPoints;
    }
    const fgMade = pickStat(stats, ['FG', 'FGM']);
    const longFg = pickStat(stats, ['LONG']);
    const perFgPoints = longFg > 0 ? Math.max(longFg / 10, 3.0) : 3.0;
    return fgMade * perFgPoints + xpPoints;
  }
  return 0;
}

function pointsAllowedScore(pa) {
  if (pa === 0) return 10;
  if (pa <= 6) return 7;
  if (pa <= 13) return 4;
  if (pa <= 20) return 1;
  if (pa <= 27) return 0;
  if (pa <= 34) return -1;
  return -4;
}

function computeDstPoints(teamAbbr, gameResult) {
  let points = 0;
  const oppScore = gameResult.scores?.find(s => s.abbr !== teamAbbr);
  if (oppScore?.score != null) points += pointsAllowedScore(oppScore.score);
  const teamStats = gameResult.teams?.find(t => t.abbr === teamAbbr)?.stats || {};
  const sacks = pickStat(teamStats, ['sacksYardsLost', 'sacks', 'Sacks', 'totalSacks']);
  const ints = pickStat(teamStats, ['interceptions', 'Interceptions', 'defensiveInterceptions']);
  const fumRec = pickStat(teamStats, ['fumblesRecovered', 'FumblesRecovered']);
  points += sacks * 1 + ints * 2 + fumRec * 2;
  return points;
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
    const data = await kv.get('lineup-pool-v1');
    if (!data) return res.status(200).json({ ok: true, updated: 0, note: 'no pool data yet' });

    const seasonYear = defaultSeasonYear();
    const weeks = Object.keys(data.picks || {});
    if (weeks.length === 0) return res.status(200).json({ ok: true, updated: 0, note: 'no picks yet' });

    const playerTeamMap = await fetchPlayerTeamMap();
    const gameStatsCache = {};
    const next = { ...data, playerScores: { ...(data.playerScores || {}) } };
    let updated = 0;

    for (const week of weeks) {
      const gameStatus = await fetchWeekGameStatus(week, seasonYear);
      const weekPicks = data.picks[week] || {};
      const nextWeekScores = { ...(next.playerScores[week] || {}) };
      let weekChanged = false;

      const values = new Set();
      Object.values(weekPicks).forEach(entry => {
        SLOTS.forEach(s => {
          if (entry[s.key]) values.add(JSON.stringify([s.key === 'DST' ? 'DST' : 'PLAYER', entry[s.key]]));
        });
      });

      for (const packed of values) {
        const [kind, value] = JSON.parse(packed);
        const team = kind === 'DST' ? value : playerTeamMap[value];
        if (!team) continue;
        const status = gameStatus[team];
        if (!status || !status.completed) continue;

        if (!gameStatsCache[status.gameId]) gameStatsCache[status.gameId] = await fetchGameStats(status.gameId);
        const gameData = gameStatsCache[status.gameId];

        if (kind === 'DST') {
          const points = Math.round(computeDstPoints(team, gameData) * 10) / 10;
          if (nextWeekScores[value] !== points) { nextWeekScores[value] = points; weekChanged = true; updated++; }
        } else {
          const rows = gameData.players.filter(p => p.playerId === value);
          if (rows.length === 0) continue;
          const exactFGs = gameData.fieldGoals.filter(fg => fg.playerId === value).map(fg => fg.yards);
          let total = 0;
          rows.forEach(row => {
            total += computeFantasyPoints(row.category, row.stats, (row.category || '').toLowerCase().includes('kick') ? exactFGs : undefined);
          });
          const points = Math.round(total * 10) / 10;
          if (nextWeekScores[value] !== points) { nextWeekScores[value] = points; weekChanged = true; updated++; }
        }
      }

      if (weekChanged) next.playerScores[week] = nextWeekScores;
    }

    if (updated > 0) await kv.set('lineup-pool-v1', next);
    return res.status(200).json({ ok: true, syncedAt: new Date().toISOString(), updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
