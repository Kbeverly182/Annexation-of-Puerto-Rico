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

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(gameId)}`;

  let upstreamStatus = null;
  let json = null;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; nfl-pool-app/1.0)',
        'Accept': 'application/json',
      },
    });
    upstreamStatus = r.status;
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(200).json({
        ok: false,
        gameId,
        upstreamStatus,
        error: `ESPN summary endpoint returned ${r.status}`,
        bodyPreview: text.slice(0, 500),
        players: [],
      });
    }
    json = await r.json();
  } catch (e) {
    return res.status(200).json({ ok: false, gameId, upstreamStatus, error: String(e), players: [] });
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

  return res.status(200).json({
    ok: true,
    gameId,
    upstreamStatus,
    playersParsed: players.length,
    players,
    // Only include the raw payload when parsing found nothing, so we can see the real shape —
    // keeps the response small on the (hopefully common) success path.
    raw: players.length === 0 ? json : undefined,
  });
}
