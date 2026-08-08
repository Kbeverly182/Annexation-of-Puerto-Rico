// Proxies ESPN's game summary endpoint from the server (not the browser) so we're not subject
// to CORS or the kind of client-side restrictions that make this endpoint hard to test directly.
// The exact shape of ESPN's boxscore.players[] response is reverse-engineered from community
// documentation, not officially confirmed — this endpoint always returns the raw JSON alongside
// the best-effort parse, so if the parse comes back empty we can see exactly what ESPN actually
// sent back and fix the parsing logic without guessing blind.

export default async function handler(req, res) {
  const { gameId } = req.query;
  if (!gameId || typeof gameId !== 'string') {
    return res.status(400).json({ error: 'gameId query param is required' });
  }

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.espn.com/',
    'Origin': 'https://www.espn.com',
  };

  const candidateUrls = [
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(gameId)}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?region=us&lang=en&contentorigin=espn&event=${encodeURIComponent(gameId)}`,
  ];

  let upstreamStatus = null;
  let json = null;
  let lastError = null;
  const attempts = [];
  for (const url of candidateUrls) {
    try {
      const r = await fetch(url, { headers: commonHeaders });
      attempts.push({ url, status: r.status });
      if (r.ok) {
        upstreamStatus = r.status;
        json = await r.json();
        break;
      }
      lastError = `${r.status}`;
    } catch (e) {
      attempts.push({ url, error: String(e) });
      lastError = String(e);
    }
  }

  if (!json) {
    return res.status(200).json({
      ok: false,
      gameId,
      error: `All ESPN endpoints failed (last: ${lastError})`,
      attempts,
      players: [],
    });
  }

  // Best-effort parse of the documented boxscore.players[] shape:
  // boxscore.players: [ { team: {abbreviation}, statistics: [ { name, labels: [...], athletes: [ { athlete: {id, displayName}, stats: [...] } ] } ] } ]
  const players = [];
  try {
    const teamBlocks = json?.boxscore?.players || [];
    teamBlocks.forEach(teamBlock => {
      const teamAbbr = teamBlock.team?.abbreviation || null;
      (teamBlock.statistics || []).forEach(category => {
        const catName = category.name || category.type || 'unknown';
        const labels = category.labels || category.keys || [];
        (category.athletes || []).forEach(entry => {
          const athleteId = entry.athlete?.id || null;
          const athleteName = entry.athlete?.displayName || entry.athlete?.shortName || null;
          const statValues = entry.stats || [];
          const row = {};
          labels.forEach((label, i) => { row[label] = statValues[i]; });
          players.push({ playerId: athleteId, name: athleteName, team: teamAbbr, category: catName, stats: row });
        });
      });
    });
  } catch (e) {
    // fall through — players stays [], raw JSON below still lets us diagnose the real shape
  }

  // Team-level stats (sacks, interceptions, fumble recoveries, etc.) — needed for D/ST scoring,
  // which lives separately from individual player stats. Shape: boxscore.teams: [ { team: {abbreviation}, statistics: [ { name/label, displayValue } ] } ]
  const teams = [];
  try {
    const teamStatBlocks = json?.boxscore?.teams || [];
    teamStatBlocks.forEach(tb => {
      const abbr = tb.team?.abbreviation || null;
      const statMap = {};
      (tb.statistics || []).forEach(s => {
        const key = s.name || s.label || s.abbreviation || '';
        if (key) statMap[key] = s.displayValue ?? s.value;
      });
      teams.push({ abbr, stats: statMap });
    });
  } catch (e) {
    // fall through — teams stays []
  }

  // Final scores per team, for D/ST points-allowed scoring.
  const scores = [];
  try {
    const competitors = json?.header?.competitions?.[0]?.competitors || [];
    competitors.forEach(c => {
      scores.push({ abbr: c.team?.abbreviation || null, score: c.score != null ? Number(c.score) : null, homeAway: c.homeAway || null });
    });
  } catch (e) {
    // fall through — scores stays []
  }

  return res.status(200).json({
    ok: true,
    gameId,
    upstreamStatus,
    playersParsed: players.length,
    players,
    teams,
    scores,
    // Only include the raw payload when parsing found nothing, so we can see the real shape —
    // keeps the response small on the (hopefully common) success path.
    raw: players.length === 0 ? json : undefined,
  });
}
