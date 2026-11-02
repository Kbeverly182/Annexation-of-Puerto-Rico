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


  // Defensive and special-teams touchdowns (interception/fumble returns, blocked kicks, punt and
  // kickoff returns). Read from ESPN's scoring plays; credited to the team that scored. Regular offensive
  // rushing, passing and receiving touchdowns are NOT counted here.
  const defTds = [];
  try {
    const idToAbbr = {};
    (json?.header?.competitions?.[0]?.competitors || []).forEach(c => { if (c.team?.id) idToAbbr[String(c.team.id)] = c.team.abbreviation; });
    (json?.scoringPlays || []).forEach(play => {
      const t = ((play?.type?.text || '') + ' ' + (play?.type?.abbreviation || '')).toLowerCase();
      const isTd = /touchdown|\btd\b/.test(t);
      // Defensive + special-teams TDs: INT/fumble returns, blocked or missed kick returns,
      // punt returns and kickoff returns. Plain rushing/passing/receiving TDs never match.
      const isDefOrST = /interception|\bint\b|fumble|blocked|missed|punt return|kickoff return|kick return|return/.test(t)
        && !/^\s*(rushing|passing|receiving)\b/.test(t);
      const txt = (play?.text || '').toLowerCase();
      const textDef = /intercept.*(for a touchdown|return.*touchdown)|fumble.*return.*touchdown|recover.*touchdown|blocked.*return.*touchdown|(punt|kickoff|kick) return.*touchdown/.test(txt) && !/pass from|run\b/.test(txt.split('intercept')[0]);
      if (!(isTd && isDefOrST) && !(isTd && textDef)) return;
      const abbr = idToAbbr[String(play?.team?.id)] || play?.team?.abbreviation || null;
      if (abbr) defTds.push({ abbr, type: play?.type?.text || 'Defensive TD' });
    });
  } catch (e) { /* defTds stays [] */ }

  // Defensive extras worth +2 each: a blocked punt / blocked field goal (credited to the team
  // that did NOT have the ball) and a safety (credited to the team that scored it).
  const defExtras = [];
  try {
    const comps = json?.header?.competitions?.[0]?.competitors || [];
    const idToAbbr2 = {};
    const abbrs = [];
    comps.forEach(c => { if (c.team?.id) idToAbbr2[String(c.team.id)] = c.team.abbreviation; if (c.team?.abbreviation) abbrs.push(c.team.abbreviation); });
    const seen = new Set();
    const isBlockedKick = (play) => {
      const t = (play?.type?.text || '').toLowerCase();
      const txt = (play?.text || '').toLowerCase();
      if (/extra point|\bpat\b|two-point|2-pt/.test(t + ' ' + txt)) return false;
      if (!/punt|field goal/.test(t)) return false;
      return /block/.test(t) || /block/.test(txt);
    };
    (json?.drives?.previous || []).concat(json?.drives?.current ? [json.drives.current] : []).forEach(drive => {
      const kickingTeam = drive?.team?.abbreviation || null;
      (drive?.plays || []).forEach(play => {
        const key = play?.id || (drive?.id + ':' + play?.sequenceNumber);
        if (isBlockedKick(play) && kickingTeam && abbrs.length === 2) {
          const blocker = abbrs.find(a => a !== kickingTeam);
          if (blocker && !seen.has('b' + key)) { seen.add('b' + key); defExtras.push({ abbr: blocker, type: 'Blocked kick', points: 2 }); }
        }
      });
    });
    (json?.scoringPlays || []).forEach(play => {
      const t = (play?.type?.text || '').toLowerCase();
      const abbr = idToAbbr2[String(play?.team?.id)] || play?.team?.abbreviation || null;
      if (!abbr) return;
      if (/safety/.test(t) && !seen.has('s' + play?.id)) { seen.add('s' + play?.id); defExtras.push({ abbr, type: 'Safety', points: 2 }); }
      // blocked kick returned for a TD: covered by drives above when present; otherwise count here
      if (isBlockedKick(play) && !seen.has('b' + play?.id) && !defExtras.some(e => e.type === 'Blocked kick' && e.abbr === abbr && seen.has('bsp' + abbr + play?.id))) {
        if (!(json?.drives?.previous || []).length) { seen.add('b' + play?.id); defExtras.push({ abbr, type: 'Blocked kick', points: 2 }); }
      }
    });
  } catch (e) { /* defExtras stays [] */ }

  // Individual field goal distances, best-effort. The aggregated boxscore.players stats only
  // give a kicker's LONGEST field goal for the game, not each one — so a kicker who made two
  // field goals of different distances can't be scored exactly from that alone. This looks at
  // ESPN's play-by-play data instead, where each field goal is its own entry with its own
  // yardage. Unofficial/reverse-engineered like the rest of this file: several plausible response
  // shapes are tried, and if none of them yield anything, fieldGoals just comes back empty and
  // the caller falls back to the existing LONG-based estimate — nothing breaks either way.
  const fieldGoals = [];
  let fieldGoalsSource = 'none';
  try {
    const candidatePlaySets = [
      { source: 'scoringPlays', plays: json?.scoringPlays || [] },
      {
        source: 'drives',
        plays: [
          ...(json?.drives?.previous || []),
          ...(json?.drives?.current ? [json.drives.current] : []),
        ].flatMap(drive => drive?.plays || []),
      },
      { source: 'plays', plays: json?.plays || [] },
    ];

    for (const { source, plays } of candidatePlaySets) {
      if (!plays || plays.length === 0) continue;
      plays.forEach(play => {
        const typeText = (play?.type?.text || play?.type?.abbreviation || '').toLowerCase();
        const text = play?.text || '';
        const isFieldGoalPlay = typeText.includes('field goal');
        if (!isFieldGoalPlay) return;
        // Only count made field goals — a blocked/missed kick still shows up as a "Field Goal"
        // type play but shouldn't score anything.
        // A scoring play, by definition, only lists kicks that actually counted - ESPN's real
        // text is plainly "[Kicker] 51 Yd Field Goal" with no "is good"/"field goal good"
        // qualifier at all, so requiring that wording (as this used to) meant every single
        // field goal was silently discarded before ever being counted. Only exclude a kick if
        // it's explicitly marked as failed - anything else here already scored.
        const isGood = play?.scoringPlay === true || !/no good|missed|blocked/i.test(text);
        if (!isGood) return;

        let yards = typeof play?.statYardage === 'number' ? play.statYardage : null;
        if (yards == null) {
          const m = text.match(/(\d+)\s*yd\.?\s*field\s*goal/i);
          if (m) yards = Number(m[1]);
        }
        if (yards == null || Number.isNaN(yards)) return;

        // Attribute to a specific kicker where possible; if we can't tell who kicked it, we
        // still record the team + distance so the caller can decide what to do with it, but
        // per-player scoring needs the athlete id specifically.
        const kicker = (play?.participants || []).find(p => (p?.type || p?.athleteType || '').toLowerCase().includes('kick'))
          || (play?.participants || [])[0]
          || null;
        const playerId = kicker?.athlete?.id || null;
        const team = play?.team?.abbreviation || null;
        // Confirmed-reliable fallback: ESPN's real text is literally "[Kicker Name] 51 Yd Field
        // Goal", so the name can be read directly from the text even when participants isn't
        // populated - callers without a playerId can still match this against a roster by name.
        const nameMatch = text.match(/^([A-Za-z.''\-\s]+?)\s+\d+\s*Yd\s*Field\s*Goal/i);
        const kickerName = nameMatch ? nameMatch[1].trim() : null;

        if (playerId || kickerName) {
          fieldGoals.push({ playerId, kickerName, team, yards });
        }
      });
      if (fieldGoals.length > 0) {
        fieldGoalsSource = source;
        break;
      }
    }
  } catch (e) {
    // fall through — fieldGoals stays [], caller uses the existing LONG-based estimate
  }

  return res.status(200).json({
    ok: true,
    gameId,
    upstreamStatus,
    playersParsed: players.length,
    players,
    teams,
    scores,
    fieldGoals,
    defTds,
    defExtras,
    fieldGoalsSource,
    // Only include the raw payload when the main player parse found nothing, so we can see the
    // real shape — keeps the response small on the (hopefully common) success path.
    raw: players.length === 0 ? json : undefined,
  });
}
