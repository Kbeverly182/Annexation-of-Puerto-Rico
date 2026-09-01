import { kv } from '@vercel/kv';
import { google } from 'googleapis';

const POOL_KEYS = [
  { key: 'survivor-pool-v1', label: 'Survivor' },
  { key: 'confidence-pool-v1', label: 'Confidence' },
  { key: 'lineup-pool-v1', label: 'Lineup' },
];

// ESPN's internal numeric team IDs, needed to fetch each team's roster.
const TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27, TEN: 10, WAS: 28,
};

// Builds a map of ESPN athlete id -> full name by fetching all 32 team rosters, same source
// the app itself uses client-side. Fetched in small batches (not all 32 at once) since firing
// every request simultaneously reliably gets rate-limited by ESPN's edge, same lesson learned
// building the app's own roster picker. Best-effort: a team that fails to fetch just means
// those players fall back to showing their raw ID instead of blocking the whole backup.
async function fetchPlayerNameMap() {
  const map = {};
  const entries = Object.entries(TEAM_IDS);
  const BATCH_SIZE = 5;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ([, teamId]) => {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
        if (!res.ok) return;
        const json = await res.json();
        (json.athletes || []).forEach(group => {
          (group.items || []).forEach(a => {
            if (a.id) map[a.id] = a.fullName || a.displayName || null;
          });
        });
      } catch (e) {
        // best-effort — skip this team, its players just show their raw id in the sheet
      }
    }));
    if (i + BATCH_SIZE < entries.length) await new Promise(r => setTimeout(r, 250));
  }
  return map;
}

// Mirrors the app's own preseason date ranges (src/lib/teams.js) — kept as a plain copy here
// since this serverless function runs separately from the frontend bundle.
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

// Builds a map of ESPN game id -> "AWAY @ HOME" by fetching the scoreboard for each week that
// actually has confidence picks in it (usually just a handful of weeks, not all of them, so
// this stays cheap — one request per represented week, not one per game).
async function fetchMatchupMap(weeks, seasonYear) {
  const map = {};
  for (const week of weeks) {
    const url = buildScoreboardUrl(week, seasonYear);
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      (json.events || []).forEach(ev => {
        const competitors = ev.competitions?.[0]?.competitors || [];
        if (competitors.length !== 2) return;
        const away = competitors.find(c => c.homeAway === 'away');
        const home = competitors.find(c => c.homeAway === 'home');
        if (away && home) {
          map[ev.id] = `${away.team?.abbreviation || '?'} @ ${home.team?.abbreviation || '?'}`;
        }
      });
    } catch (e) {
      // best-effort — that week's games just fall back to showing "Game {id}" in the sheet
    }
  }
  return map;
}

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variable — see setup guide.');
  }
  // Vercel's env var UI often stores multi-line keys with literal "\n" sequences instead of
  // real newlines — convert them back, or the JWT signing silently fails.
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Creates the two tabs this backup relies on if they don't already exist, so a fresh sheet
// works out of the box without any manual tab setup.
async function ensureTabsExist(sheets, spreadsheetId, tabNames) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets || []).map(s => s.properties.title));
  const toAdd = tabNames.filter(name => !existing.has(name));
  if (toAdd.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toAdd.map(title => ({ addSheet: { properties: { title } } })) },
    });
  }
}

// Matches the app's own week-labeling convention (encoded preseason weeks 101/102/103).
function weekLabel(week) {
  const n = Number(week);
  return n > 100 ? `PRE ${n - 100}` : String(week);
}

export default async function handler(req, res) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return res.status(500).json({ ok: false, error: 'Missing GOOGLE_SHEET_ID environment variable — see setup guide.' });
  }

  // Optional protection: if you set a CRON_SECRET env var, only requests carrying it are
  // accepted. Vercel automatically includes this as an Authorization header for its own
  // scheduled Cron calls. Leave CRON_SECRET unset if you don't need this (the endpoint just
  // re-runs a safe, non-destructive read-and-copy operation either way).
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (providedSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    const sheets = getSheetsClient();
    const now = new Date().toISOString();

    const pools = {};
    for (const { key, label } of POOL_KEYS) {
      pools[label] = await kv.get(key);
    }

    await ensureTabsExist(sheets, sheetId, [
      'Raw Backup', 'Entrants', 'Survivor Picks', 'Confidence Picks', 'Lineup Picks',
    ]);

    // Raw Backup tab: one row per pool with the complete, untouched JSON for that pool.
    // This is the real safety net — even if every other tab or feature breaks, this alone
    // is enough to reconstruct everything by hand if it ever came to that.
    const rawRows = [['Pool', 'Last Synced', 'Raw JSON']];
    for (const { label } of POOL_KEYS) {
      rawRows.push([label, now, JSON.stringify(pools[label] || {})]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Raw Backup!A1',
      valueInputOption: 'RAW',
      requestBody: { values: rawRows },
    });

    // Entrants tab: a quick human-readable reference across all three pools — who's in each
    // one, their real name and email, and whether they've claimed a PIN yet.
    const entrantRows = [['Pool', 'Display Name', 'Real Name', 'Email', 'PIN Set?']];
    for (const { label } of POOL_KEYS) {
      const data = pools[label];
      (data?.participants || []).forEach(p => {
        entrantRows.push([label, p.name || '', p.realName || '', p.email || '', p.pin ? 'Yes' : 'No']);
      });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Entrants!A1',
      valueInputOption: 'RAW',
      requestBody: { values: entrantRows },
    });

    // Survivor Picks: one row per entrant per week — fully readable, since team abbreviations
    // are stored directly (no lookup needed).
    const survivorData = pools['Survivor'];
    const survivorRows = [['Week', 'Entrant', 'Team Picked', 'Result']];
    (survivorData?.participants || []).forEach(p => {
      Object.keys(survivorData?.picks || {})
        .sort((a, b) => Number(a) - Number(b))
        .forEach(week => {
          const pick = survivorData.picks[week]?.[p.id];
          if (pick?.team) {
            survivorRows.push([weekLabel(week), p.name || '', pick.team, pick.result || 'pending']);
          }
        });
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Survivor Picks!A1',
      valueInputOption: 'RAW',
      requestBody: { values: survivorRows },
    });

    // Confidence Picks: one row per entrant per game. Matchups are resolved from ESPN's live
    // scoreboard for each represented week (fetched below) — the app itself only stores the
    // game id for each pick, not the matchup, so without this lookup the sheet would just show
    // raw ids.
    const confidenceData = pools['Confidence'];
    const confidenceWeeks = Object.keys(confidenceData?.picks || {});
    const matchupMap = await fetchMatchupMap(confidenceWeeks, defaultSeasonYear());
    const confidenceRows = [['Week', 'Entrant', 'Matchup', 'Team Picked', 'Confidence Rank', 'Tiebreaker Guess']];
    (confidenceData?.participants || []).forEach(p => {
      Object.keys(confidenceData?.picks || {})
        .sort((a, b) => Number(a) - Number(b))
        .forEach(week => {
          const entry = confidenceData.picks[week]?.[p.id];
          if (!entry) return;
          const order = entry.order || [];
          order.forEach((gameId, idx) => {
            const winner = entry.winners?.[gameId];
            if (winner) {
              confidenceRows.push([weekLabel(week), p.name || '', matchupMap[gameId] || `Game ${gameId}`, winner, order.length - idx, entry.tiebreaker ?? '']);
            }
          });
        });
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Confidence Picks!A1',
      valueInputOption: 'RAW',
      requestBody: { values: confidenceRows },
    });

    // Lineup Picks: one row per entrant per roster slot per week. Player names are resolved
    // from ESPN's live rosters (fetched fresh below) — the app itself never saves player names
    // anywhere, only their ESPN id, so without this lookup the sheet would just show raw ids.
    const playerNames = await fetchPlayerNameMap();
    const lineupData = pools['Lineup'];
    const lineupRows = [['Week', 'Entrant', 'Slot', 'Player', 'Points']];
    (lineupData?.participants || []).forEach(p => {
      Object.keys(lineupData?.picks || {})
        .sort((a, b) => Number(a) - Number(b))
        .forEach(week => {
          const weekPicks = lineupData.picks[week]?.[p.id];
          if (!weekPicks) return;
          Object.entries(weekPicks)
            .filter(([slot]) => slot !== 'confirmedSignature') // metadata, not an actual roster slot
            .forEach(([slot, value]) => {
              if (!value) return;
              const points = lineupData.playerScores?.[week]?.[value];
              const displayValue = slot === 'DST' ? `${value} D/ST` : (playerNames[value] || `Unknown player (id ${value})`);
              lineupRows.push([weekLabel(week), p.name || '', slot, displayValue, points != null ? points : '']);
            });
        });
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Lineup Picks!A1',
      valueInputOption: 'RAW',
      requestBody: { values: lineupRows },
    });

    return res.status(200).json({ ok: true, syncedAt: now, pools: POOL_KEYS.map(p => p.label) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
