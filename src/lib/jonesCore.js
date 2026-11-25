// The Jones League — shared rules engine. Pure functions only (no network, no React), used by BOTH the
// serverless API (api/jones.js, api/sync-jones.js) and the browser pages, so the numbers always agree.
//
// Rules implemented (from "Jones League Rules"):
//  * Roster: QB, RB, RB, WR, WR, TE, K, D/ST (8 spots, no bench).
//  * Full-point scoring, each stat type floored on its own: 1 pt / 10 rush yds, 1 pt / 10 rec yds,
//    1 pt / 25 pass yds, 6 per TD, 2 per 2-pt conversion, -1 INT, -1 lost fumble.
//  * Kickers: FG <40 = 3, 40-49 = 4, 50+ = 5, XP = 1.
//  * D/ST: 10 for a shutout, 6 per defensive/special-teams TD, 2 per safety, 2 per INT and fumble recovery, 1 per sack.
//  * NOT cumulative: a position's score is the best single game by a player while on your roster.
//    RB and WR count your two best DIFFERENT players (each player's best game, top two).
//  * Waivers: lowest score picks first. Priority = points per player who has played (see priorityOrder).
//  * Trades: straight swaps, no contingencies.

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
export const SLOT_COUNTS = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
export const POS_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DST: 'D/ST' };
export const ROSTER_SIZE = 8;
export const ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };
export const fixAbbr = (a) => ABBR_FIX[a] || a;

export const mkId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Default setup ----------
export const PLAYOFF_ROUNDS = [
  { id: 'wc', label: 'Wild Card', start: '20270116', end: '20270119' },
  { id: 'div', label: 'Divisional', start: '20270123', end: '20270125' },
  { id: 'conf', label: 'Conference Championships', start: '20270130', end: '20270201' },
  { id: 'sb', label: 'Super Bowl', start: '20270208', end: '20270216' },
];
// Beta test: the last regular-season weeks, each treated as a "round".
export const BETA_ROUNDS = [
  { id: 'w13', label: 'Week 13', start: '20261203', end: '20261207' },
  { id: 'w14', label: 'Week 14', start: '20261210', end: '20261214' },
  { id: 'w15', label: 'Week 15', start: '20261217', end: '20261221' },
  { id: 'w16', label: 'Week 16', start: '20261224', end: '20261228' },
  { id: 'w17', label: 'Week 17', start: '20261231', end: '20270104' },
  { id: 'w18', label: 'Week 18', start: '20270107', end: '20270111' },
];

// Beta only: the NFL teams whose players are in the beta pool. Drawn at random for the Week 13 test — six real
// Week 13 games among these teams (like the six Wild Card games) plus LV and NYJ, who are on a bye that week
// (like the two top seeds). Players from every other NFL team are NOT part of the beta.
export const BETA_TEAMS = ['ARI', 'ATL', 'CHI', 'DET', 'HOU', 'JAX', 'KC', 'LAR', 'LV', 'NYJ', 'PHI', 'PIT', 'TEN', 'WAS'];
export const BETA_BYES = ['LV', 'NYJ'];

// null = every NFL team is allowed.
export function allowedTeams(state) {
  const a = state.config?.allowedTeams;
  if (Array.isArray(a)) return a.length ? a : null;
  return state.pool === 'beta' ? BETA_TEAMS : null;
}

export function initialState(pool) {
  return {
    version: 1,
    pool,
    config: {
      name: pool === 'beta' ? 'The Jones League (BETA TEST)' : 'The Jones League',
      rounds: pool === 'beta' ? BETA_ROUNDS : PLAYOFF_ROUNDS,
      tradeWindow: 'auto',      // 'auto' | 'open' | 'closed'
      priorityMode: 'avg',      // 'avg' = points per player who has played; 'raw' = plain lowest total
      waiverLabel: 'Wednesday 3:00 AM ET',
      tiebreakOrder: [],        // team ids; earlier = earlier waiver pick when everything else ties
      entryFee: 40,
      allowedTeams: pool === 'beta' ? BETA_TEAMS : [], // NFL teams whose players can be used ([] = all 32)
      joinOpen: true,           // managers can add their own team from the link
      maxTeams: 14,
    },
    teams: [],        // { id, name, owner, pinHash }
    rosterLog: [],    // { ts, teamId, type:'add'|'drop', player:{id,name,pos,team}, source, runId?, tradeId? }
    claims: [],       // { id, teamId, add:{...}, drop:{...}, rank, status:'pending'|'won'|'failed'|'cancelled', reason?, runId?, createdAt }
    trades: [],       // { id, fromTeamId, toTeamId, give:[player], get:[player], status:'pending'|'accepted'|'declined'|'cancelled'|'void', createdAt, resolvedAt }
    runs: [],         // waiver runs: { id, ts, order:[{teamId,priority,...}], results:[...], undone? }
    adjustments: [],  // manual score fixes: { id, playerId, gameId, points, note }
    feed: [],         // { ts, text }
  };
}

// ---------- Rosters ----------
export function rosterAt(state, teamId, ts = Infinity) {
  const m = new Map();
  for (const e of state.rosterLog || []) {
    if (e.teamId !== teamId || e.ts > ts) continue;
    if (e.type === 'add') m.set(e.player.id, e.player);
    else m.delete(e.player.id);
  }
  return [...m.values()];
}
export const currentRoster = (state, teamId) => rosterAt(state, teamId, Infinity);

export function ownerMap(state) {
  const m = new Map();
  for (const t of state.teams || []) for (const p of currentRoster(state, t.id)) m.set(p.id, t.id);
  return m;
}

export function rosterProblems(players) {
  const counts = {};
  (players || []).forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
  const problems = [];
  for (const pos of POSITIONS) {
    const want = SLOT_COUNTS[pos];
    const have = counts[pos] || 0;
    if (have !== want) problems.push(`${POS_LABEL[pos]}: need ${want}, have ${have}`);
  }
  const ids = new Set();
  (players || []).forEach(p => { if (ids.has(p.id)) problems.push(`${p.name} is listed twice`); ids.add(p.id); });
  return problems;
}

// ---------- Scoring one game (from the parsed ESPN box score) ----------
function pickStat(stats, keys) {
  for (const k of keys) {
    if (stats && stats[k] != null) {
      const raw = String(stats[k]);
      if (raw.includes('/')) { const made = parseFloat(raw.split('/')[0]); if (!isNaN(made)) return made; }
      const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}
export const kickerFgPoints = (yards) => (yards >= 50 ? 5 : yards >= 40 ? 4 : 3);

// gs = the object returned by fetchGameStats() in api/sync-lineup.js.
// twoPtIds = athlete ids credited with a successful 2-point conversion (passer, receiver or rusher).
// nameById = athlete id -> full name (used only to match kickers to their field goals when ESPN lacks an id).
export function scoreGame(gs, twoPtIds = [], nameById = {}) {
  const pts = {};
  const bump = (id, v) => { pts[id] = (pts[id] || 0) + v; };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();

  for (const row of gs.players || []) {
    const id = row.playerId;
    if (!id) continue;
    const cat = String(row.category || '').toLowerCase();
    const s = row.stats || {};
    if (cat.includes('return')) {
      if (cat.includes('intercept')) continue;
      bump(id, 0); bump(id, pickStat(s, ['TD']) * 6);
    } else if (cat.includes('pass')) {
      bump(id, Math.floor(pickStat(s, ['YDS', 'PASS YDS']) / 25) + pickStat(s, ['TD']) * 6 - pickStat(s, ['INT']));
    } else if (cat.includes('rush')) {
      bump(id, Math.floor(pickStat(s, ['YDS', 'RUSH YDS']) / 10) + pickStat(s, ['TD']) * 6);
    } else if (cat.includes('receiv')) {
      bump(id, Math.floor(pickStat(s, ['YDS', 'REC YDS']) / 10) + pickStat(s, ['TD']) * 6);
    } else if (cat.includes('fumbl')) {
      bump(id, -pickStat(s, ['LOST', 'FUM LOST']));
    } else if (/^kick/.test(cat)) {
      let fgPts = 0;
      const fgMade = pickStat(s, ['FG', 'FGM']);
      const mine = (gs.fieldGoals || []).filter(fg => (fg.playerId && String(fg.playerId) === String(id))
        || (!fg.playerId && fg.kickerName && nameById[id] && norm(fg.kickerName) === norm(nameById[id])));
      if (mine.length) fgPts = mine.reduce((sum, fg) => sum + kickerFgPoints(fg.yards), 0);
      else if (fgMade > 0) fgPts = fgMade * 3 + (pickStat(s, ['LONG']) >= 50 ? 2 : pickStat(s, ['LONG']) >= 40 ? 1 : 0); // fallback when distances aren't available
      bump(id, fgPts + pickStat(s, ['XP', 'PAT']));
    }
  }
  for (const id of twoPtIds || []) bump(id, 2);

  // D/ST for both teams
  const teamsInGame = (gs.scores || []).map(s => s.abbr).filter(Boolean);
  for (const abbr of teamsInGame) {
    const opp = (gs.scores || []).find(s => s.abbr !== abbr);
    let d = 0;
    if (opp && opp.score === 0) d += 10;
    const oppStats = (gs.teams || []).find(t => t.abbr !== abbr)?.stats || {};
    const sacks = gs.defSacks && gs.defSacks[abbr] != null ? gs.defSacks[abbr] : pickStat(oppStats, ['sacksYardsLost', 'sacks', 'Sacks', 'totalSacks']);
    const ints = pickStat(oppStats, ['interceptions', 'Interceptions']);
    const fumRec = pickStat(oppStats, ['fumblesLost', 'FumblesLost']);
    d += sacks * 1 + ints * 2 + fumRec * 2;
    d += (gs.defTds || []).filter(t => t.abbr === abbr).length * 6;
    d += (gs.defExtras || []).filter(e => e.abbr === abbr && e.type === 'Safety').length * 2;
    pts['DST-' + fixAbbr(abbr)] = d;
  }
  return pts;
}

// ---------- Standings ----------
// games: { [gameId]: { id, round, kickoff, state:'pre'|'in'|'post', pts:{playerId:points} } }
export function computeStandings(state, games, now = Date.now()) {
  const gl = Object.values(games || {}).filter(g => g && g.state && g.state !== 'pre');
  const adj = state.adjustments || [];
  const out = [];
  for (const team of state.teams || []) {
    const per = new Map(); // playerId -> { player, games:[{gameId, round, pts}] }
    for (const g of gl) {
      const kt = Date.parse(g.kickoff) || 0;
      const roster = rosterAt(state, team.id, kt);
      for (const p of roster) {
        const has = g.pts && Object.prototype.hasOwnProperty.call(g.pts, p.id);
        const myAdj = adj.filter(a => a.playerId === p.id && a.gameId === g.id);
        if (!has && !myAdj.length) continue;
        const pts = (has ? g.pts[p.id] : 0) + myAdj.reduce((s, a) => s + Number(a.points || 0), 0);
        if (!per.has(p.id)) per.set(p.id, { player: p, games: [] });
        per.get(p.id).games.push({ gameId: g.id, round: g.round, pts });
      }
    }
    const bests = [...per.values()].map(x => {
      const top = x.games.reduce((a, b) => (b.pts > a.pts ? b : a), x.games[0]);
      return { ...x, best: top.pts, bestGame: top.gameId, bestRound: top.round };
    });
    const slots = {};
    let total = 0, played = 0;
    for (const pos of POSITIONS) {
      const list = bests.filter(b => b.player.pos === pos).sort((a, b) => b.best - a.best).slice(0, SLOT_COUNTS[pos]);
      slots[pos] = list.map(b => ({ playerId: b.player.id, name: b.player.name, team: b.player.team, pts: b.best, round: b.bestRound }));
      list.forEach(b => { total += b.best; played += 1; });
    }
    out.push({ teamId: team.id, total, played, slots, per: Object.fromEntries(per) });
  }
  return out;
}

// ---------- Waiver priority ----------
// "Lowest score gets the first pick" — but in week 1 of the playoffs some teams' players are on a bye, so raw
// totals aren't fair. So priority is POINTS PER PLAYER WHO HAS PLAYED (lowest first). Ties: fewer players
// played first, then the league's tiebreak order. Set config.priorityMode = 'raw' for plain lowest total.
export function priorityOrder(state, standings) {
  const mode = state.config?.priorityMode || 'avg';
  const tbList = (state.config?.tiebreakOrder && state.config.tiebreakOrder.length ? state.config.tiebreakOrder : (state.teams || []).map(t => t.id));
  const tb = Object.fromEntries(tbList.map((id, i) => [id, i]));
  return standings
    .map(s => ({ teamId: s.teamId, total: s.total, played: s.played, key: mode === 'raw' ? s.total : (s.played ? s.total / s.played : 0) }))
    .sort((a, b) => a.key - b.key || a.played - b.played || (tb[a.teamId] ?? 999) - (tb[b.teamId] ?? 999))
    .map((x, i) => ({ ...x, priority: i + 1 }));
}

// ---------- Waiver processing ----------
// Claims are processed in passes: in each pass, every team (in priority order) gets ONE successful claim —
// its highest-ranked claim that is still valid. Invalid claims are marked failed with a reason. This is the
// "first pick, and so on" order from the rules without letting the top team take everything at once.
export function processWaivers(state, games, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state));
  const standings = computeStandings(next, games, now);
  const order = priorityOrder(next, standings);
  const runId = mkId();
  const rosters = {}; // teamId -> Map(playerId -> player)
  const owned = new Map();
  for (const t of next.teams) {
    rosters[t.id] = new Map(currentRoster(next, t.id).map(p => [p.id, p]));
    for (const p of rosters[t.id].values()) owned.set(p.id, t.id);
  }
  const teamName = (id) => next.teams.find(t => t.id === id)?.name || 'another team';
  const queues = {};
  for (const c of next.claims) if (c.status === 'pending') (queues[c.teamId] = queues[c.teamId] || []).push(c);
  Object.values(queues).forEach(q => q.sort((a, b) => a.rank - b.rank));

  const results = [];
  const fail = (c, reason) => { c.status = 'failed'; c.reason = reason; c.runId = runId; results.push({ claimId: c.id, teamId: c.teamId, ok: false, add: c.add, drop: c.drop, reason }); };
  let guard = 0;
  while (Object.values(queues).some(q => q.length) && guard++ < 200) {
    for (const o of order) {
      const q = queues[o.teamId];
      while (q && q.length) {
        const c = q.shift();
        if (!rosters[c.teamId].has(c.drop.id)) { fail(c, `${c.drop.name} is no longer on your roster`); continue; }
        if (c.add.pos !== c.drop.pos) { fail(c, 'Position mismatch'); continue; }
        if (owned.has(c.add.id)) {
          const who = owned.get(c.add.id);
          fail(c, who === '__released__' ? `${c.add.name} was just dropped — available next run` : `${c.add.name} went to ${teamName(who)}`);
          continue;
        }
        rosters[c.teamId].delete(c.drop.id); rosters[c.teamId].set(c.add.id, c.add);
        owned.set(c.drop.id, '__released__'); owned.set(c.add.id, c.teamId);
        next.rosterLog.push({ ts: now, teamId: c.teamId, type: 'drop', player: c.drop, source: 'waiver', runId });
        next.rosterLog.push({ ts: now, teamId: c.teamId, type: 'add', player: c.add, source: 'waiver', runId });
        c.status = 'won'; c.runId = runId;
        results.push({ claimId: c.id, teamId: c.teamId, ok: true, add: c.add, drop: c.drop });
        break; // one successful claim per team per pass
      }
    }
  }
  const won = results.filter(r => r.ok).length;
  const run = { id: runId, ts: now, order, results, won, failed: results.length - won };
  next.runs.push(run);
  next.feed.push({ ts: now, text: `Waivers processed: ${won} claim${won === 1 ? '' : 's'} won, ${results.length - won} failed.` });
  next.feed = next.feed.slice(-200);
  return { state: next, run };
}

// Undo the most recent waiver run (only while nothing else has happened to rosters since).
export function undoLastWaiverRun(state) {
  const run = state.runs[state.runs.length - 1];
  if (!run || run.undone) return { error: 'There is no waiver run to undo.' };
  const later = state.rosterLog.some(e => e.ts > run.ts && e.runId !== run.id);
  if (later) return { error: 'Rosters have changed since that run (a trade or edit), so it cannot be undone safely.' };
  const next = JSON.parse(JSON.stringify(state));
  next.rosterLog = next.rosterLog.filter(e => e.runId !== run.id);
  next.claims.forEach(c => { if (c.runId === run.id) { c.status = 'pending'; delete c.reason; delete c.runId; } });
  next.runs[next.runs.length - 1].undone = true;
  next.feed.push({ ts: Date.now(), text: 'The last waiver run was undone by the commissioner.' });
  return { state: next };
}

// ---------- Trades ----------
export function validateTrade(state, t) {
  if (!t.fromTeamId || !t.toTeamId || t.fromTeamId === t.toTeamId) return 'Pick another team to trade with.';
  if (!t.give?.length || !t.get?.length) return 'Choose at least one player on each side.';
  const from = new Map(currentRoster(state, t.fromTeamId).map(p => [p.id, p]));
  const to = new Map(currentRoster(state, t.toTeamId).map(p => [p.id, p]));
  for (const p of t.give) if (!from.has(p.id)) return `${p.name} is no longer on the proposing team.`;
  for (const p of t.get) if (!to.has(p.id)) return `${p.name} is no longer on the other team.`;
  for (const pos of POSITIONS) {
    const a = t.give.filter(p => p.pos === pos).length, b = t.get.filter(p => p.pos === pos).length;
    if (a !== b) return `Rosters have exact spots, so each side must send the same number of ${POS_LABEL[pos]}s (you gave ${a}, receive ${b}).`;
  }
  return null;
}

export function executeTrade(state, trade, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state));
  for (const p of trade.give) {
    next.rosterLog.push({ ts: now, teamId: trade.fromTeamId, type: 'drop', player: p, source: 'trade', tradeId: trade.id });
    next.rosterLog.push({ ts: now, teamId: trade.toTeamId, type: 'add', player: p, source: 'trade', tradeId: trade.id });
  }
  for (const p of trade.get) {
    next.rosterLog.push({ ts: now, teamId: trade.toTeamId, type: 'drop', player: p, source: 'trade', tradeId: trade.id });
    next.rosterLog.push({ ts: now, teamId: trade.fromTeamId, type: 'add', player: p, source: 'trade', tradeId: trade.id });
  }
  const moved = new Set([...trade.give, ...trade.get].map(p => p.id));
  next.trades.forEach(t => {
    if (t.id !== trade.id && t.status === 'pending' && [...t.give, ...t.get].some(p => moved.has(p.id))) { t.status = 'void'; t.resolvedAt = now; }
  });
  // (A pending claim that depended on a player who just moved is checked again at waiver time and marked failed.)
  return next;
}

// Trades are open right after the last game of a round, until the next round's first kickoff.
export function tradeWindow(state, games, now = Date.now()) {
  const mode = state.config?.tradeWindow || 'auto';
  if (mode === 'open') return { open: true, reason: 'The commissioner opened the trade window.' };
  if (mode === 'closed') return { open: false, reason: 'The commissioner closed the trade window.' };
  const rounds = (state.config?.rounds || []).slice().sort((a, b) => a.start.localeCompare(b.start));
  const byRound = {};
  Object.values(games || {}).forEach(g => { (byRound[g.round] = byRound[g.round] || []).push(g); });
  const firstKick = (r) => Math.min(...(byRound[r.id] || []).map(g => Date.parse(g.kickoff)).filter(Boolean));
  let current = null;
  for (const r of rounds) { const fk = firstKick(r); if (isFinite(fk) && fk <= now) current = r; }
  if (!current) return { open: true, reason: 'No games have kicked off yet.' };
  const gs = byRound[current.id] || [];
  const allFinal = gs.length > 0 && gs.every(g => g.state === 'post');
  const idx = rounds.findIndex(r => r.id === current.id);
  if (!allFinal) return { open: false, reason: `Closed while ${current.label} games are being played. Opens after the last game.` };
  if (idx === rounds.length - 1) return { open: false, reason: 'The final round is complete.' };
  return { open: true, reason: `${current.label} is complete — open until ${rounds[idx + 1].label} kicks off.` };
}

// ---------- Misc ----------
export const sanitizeState = (state) => ({
  ...state,
  teams: (state.teams || []).map(({ pinHash, ...t }) => ({ ...t, hasPin: !!pinHash })),
});

export const fmtPts = (n) => (Math.round(Number(n || 0) * 10) / 10).toString();
