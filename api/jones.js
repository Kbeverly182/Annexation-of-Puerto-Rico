import { kv } from '@vercel/kv';
import crypto from 'node:crypto';
import * as C from '../src/lib/jonesCore.js';
import { jonesKeys, withLock, syncOne } from './sync-jones.js';

// The Jones League API. One endpoint:
//   GET  /api/jones?pool=live|beta            -> { state (PINs stripped), games, rev }
//   GET  /api/jones?pool=beta&rev=1            -> { rev }   (tiny poll — pages only download the league when it moves)
//   POST /api/jones  { pool, action, ... }     -> do something (submit a claim, propose a trade, admin tools, ...)
// Every write happens inside a short lock and re-reads the league first, so 14 managers saving at once can't overwrite each other.
export const config = { maxDuration: 60 };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

const hashTeamPin = (teamId, pin) => crypto.createHash('sha256').update(`jones:${teamId}:${pin}`).digest('hex');
const poolOf = (v) => (v === 'beta' ? 'beta' : 'live');
const cleanPlayer = (p) => {
  if (!p || !p.id || !C.POSITIONS.includes(p.pos)) bad('That player is not valid.');
  return { id: String(p.id).slice(0, 40), name: String(p.name || 'Unknown').slice(0, 60), pos: p.pos, team: String(p.team || '').slice(0, 5) };
};

async function requireAdmin(body) {
  const cfg = await kv.get('admin-config');
  if (!cfg?.pinHash || body.adminHash !== cfg.pinHash) bad('Admin PIN required.', 403);
}
function requireTeam(state, body) {
  const team = (state.teams || []).find(t => t.id === body.teamId);
  if (!team) bad('Unknown team.');
  if (!team.pinHash) bad('This team has not set a PIN yet.', 403);
  if (!body.pin || hashTeamPin(team.id, String(body.pin)) !== team.pinHash) bad('Wrong PIN.', 403);
  return team;
}
const nameOf = (state, id) => (state.teams.find(t => t.id === id) || {}).name || 'a team';
const pushFeed = (state, text) => { state.feed = [...(state.feed || []), { ts: Date.now(), text }].slice(-200); };

// ---- actions: each gets { state, games, body, pool } and returns { state? , data? }. State is a private copy; return it to save it.
const actions = {
  // ----- managers -----
  async setPin({ state, body }) {
    const team = (state.teams || []).find(t => t.id === body.teamId);
    if (!team) bad('Unknown team.');
    if (team.pinHash) bad('This team already has a PIN. Ask the commissioner to reset it.', 403);
    if (!/^\d{4,8}$/.test(String(body.pin || ''))) bad('PIN must be 4–8 digits.');
    team.pinHash = hashTeamPin(team.id, String(body.pin));
    return { state, data: { ok: true } };
  },
  async login({ state, body }) { requireTeam(state, body); return { data: { ok: true } }; },

  async addClaim({ state, body }) {
    const team = requireTeam(state, body);
    const add = cleanPlayer(body.add);
    const owner = C.ownerMap(state).get(add.id);
    if (owner) bad(`${add.name} is already on ${nameOf(state, owner)}.`);
    const drop = C.currentRoster(state, team.id).find(p => p.id === String(body.dropId));
    if (!drop) bad('The player you are dropping is not on your roster.');
    if (drop.pos !== add.pos) bad(`Rosters have exact spots, so you can only swap a ${C.POS_LABEL[drop.pos]} for a ${C.POS_LABEL[drop.pos]}.`);
    const mine = state.claims.filter(c => c.teamId === team.id && c.status === 'pending');
    if (mine.some(c => c.add.id === add.id && c.drop.id === drop.id)) bad('You already have that exact claim.');
    if (mine.length >= 30) bad('That is a lot of claims — remove some first.');
    state.claims.push({ id: C.mkId(), teamId: team.id, add, drop, rank: mine.reduce((m, c) => Math.max(m, c.rank), 0) + 1, status: 'pending', createdAt: Date.now() });
    return { state, data: { ok: true } };
  },
  async removeClaim({ state, body }) {
    const team = requireTeam(state, body);
    const c = state.claims.find(x => x.id === body.claimId && x.teamId === team.id && x.status === 'pending');
    if (!c) bad('Claim not found.');
    c.status = 'cancelled';
    state.claims.filter(x => x.teamId === team.id && x.status === 'pending').sort((a, b) => a.rank - b.rank).forEach((x, i) => { x.rank = i + 1; });
    return { state, data: { ok: true } };
  },
  async moveClaim({ state, body }) {
    const team = requireTeam(state, body);
    const list = state.claims.filter(x => x.teamId === team.id && x.status === 'pending').sort((a, b) => a.rank - b.rank);
    const i = list.findIndex(x => x.id === body.claimId);
    const j = i + (body.dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return { data: { ok: true } };
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, k) => { x.rank = k + 1; });
    return { state, data: { ok: true } };
  },

  async proposeTrade({ state, games, body }) {
    const team = requireTeam(state, body);
    const win = C.tradeWindow(state, games);
    if (!win.open) bad(`Trades are closed. ${win.reason}`);
    const other = state.teams.find(t => t.id === body.toTeamId);
    if (!other) bad('Pick a team to trade with.');
    const mine = C.currentRoster(state, team.id), theirs = C.currentRoster(state, other.id);
    const give = (body.giveIds || []).map(id => mine.find(p => p.id === String(id))).filter(Boolean);
    const get = (body.getIds || []).map(id => theirs.find(p => p.id === String(id))).filter(Boolean);
    const trade = { id: C.mkId(), fromTeamId: team.id, toTeamId: other.id, give, get, status: 'pending', createdAt: Date.now() };
    const err = C.validateTrade(state, trade);
    if (err) bad(err);
    if (state.trades.filter(t => t.status === 'pending' && t.fromTeamId === team.id).length >= 10) bad('You have too many open trade offers.');
    state.trades.push(trade);
    return { state, data: { ok: true } };
  },
  async respondTrade({ state, games, body }) {
    const team = requireTeam(state, body);
    const t = state.trades.find(x => x.id === body.tradeId && x.status === 'pending');
    if (!t) bad('That trade is no longer open.');
    if (body.response === 'cancel') {
      if (t.fromTeamId !== team.id) bad('Only the team that offered it can cancel.', 403);
      t.status = 'cancelled'; t.resolvedAt = Date.now();
      return { state, data: { ok: true } };
    }
    if (t.toTeamId !== team.id) bad('Only the team receiving the offer can answer it.', 403);
    if (body.response === 'decline') { t.status = 'declined'; t.resolvedAt = Date.now(); return { state, data: { ok: true } }; }
    if (body.response !== 'accept') bad('Unknown response.');
    const win = C.tradeWindow(state, games);
    if (!win.open) bad(`Trades are closed. ${win.reason}`);
    const err = C.validateTrade(state, t);
    if (err) { t.status = 'void'; t.resolvedAt = Date.now(); return { state, data: { ok: false, error: `Trade voided: ${err}` } }; }
    const next = C.executeTrade(state, t, Date.now());
    const tt = next.trades.find(x => x.id === t.id);
    tt.status = 'accepted'; tt.resolvedAt = Date.now();
    pushFeed(next, `Trade: ${nameOf(next, t.fromTeamId)} sends ${t.give.map(p => p.name).join(', ')} to ${nameOf(next, t.toTeamId)} for ${t.get.map(p => p.name).join(', ')}.`);
    return { state: next, data: { ok: true } };
  },

  // ----- commissioner -----
  async adminSetTeams({ state, body }) {
    await requireAdmin(body);
    const incoming = (body.teams || []).filter(t => String(t.name || '').trim());
    const keep = new Set();
    const next = [];
    for (const t of incoming) {
      const existing = t.id && state.teams.find(x => x.id === t.id);
      if (existing) { existing.name = String(t.name).trim().slice(0, 40); existing.owner = String(t.owner || '').trim().slice(0, 40); keep.add(existing.id); next.push(existing); }
      else { const id = C.mkId(); keep.add(id); next.push({ id, name: String(t.name).trim().slice(0, 40), owner: String(t.owner || '').trim().slice(0, 40) }); }
    }
    for (const old of state.teams) {
      if (!keep.has(old.id) && state.rosterLog.some(e => e.teamId === old.id)) bad(`${old.name} has a roster — clear it before removing the team.`);
    }
    state.teams = next;
    state.config.tiebreakOrder = (state.config.tiebreakOrder || []).filter(id => keep.has(id));
    next.forEach(t => { if (!state.config.tiebreakOrder.includes(t.id)) state.config.tiebreakOrder.push(t.id); });
    return { state, data: { ok: true } };
  },
  async adminResetPin({ state, body }) {
    await requireAdmin(body);
    const t = state.teams.find(x => x.id === body.teamId);
    if (!t) bad('Unknown team.');
    delete t.pinHash;
    return { state, data: { ok: true } };
  },
  async adminSetRosters({ state, body }) {
    await requireAdmin(body);
    const entries = Object.entries(body.rosters || {});
    const claimed = new Map();
    for (const [teamId, list] of entries) {
      const team = state.teams.find(t => t.id === teamId);
      if (!team) bad('Unknown team in roster list.');
      const players = (list || []).map(cleanPlayer);
      const problems = C.rosterProblems(players);
      if (problems.length) bad(`${team.name}: ${problems.join('; ')}`);
      for (const p of players) { if (claimed.has(p.id)) bad(`${p.name} is on both ${nameOf(state, claimed.get(p.id))} and ${team.name}.`); claimed.set(p.id, teamId); }
    }
    // a player can't be on a team we are NOT editing in this request
    const edited = new Set(entries.map(([id]) => id));
    const owned = C.ownerMap(state);
    for (const [pid, tid] of claimed) { const o = owned.get(pid); if (o && !edited.has(o)) bad(`Player ${pid} is already on ${nameOf(state, o)}.`); }
    const preLeague = state.runs.length === 0 && !state.trades.some(t => t.status === 'accepted');
    for (const [teamId, list] of entries) {
      const players = list.map(cleanPlayer);
      if (preLeague) state.rosterLog = state.rosterLog.filter(e => e.teamId !== teamId); // pre-league: just replace the roster outright
      const now = preLeague ? 0 : Date.now();
      if (!preLeague) C.currentRoster(state, teamId).forEach(p => state.rosterLog.push({ ts: now, teamId, type: 'drop', player: p, source: 'admin' }));
      players.forEach(p => state.rosterLog.push({ ts: now, teamId, type: 'add', player: p, source: preLeague ? 'draft' : 'admin' }));
    }
    return { state, data: { ok: true } };
  },
  async adminConfig({ state, body }) {
    await requireAdmin(body);
    const p = body.patch || {};
    const c = state.config;
    if (typeof p.name === 'string') c.name = p.name.slice(0, 60);
    if (typeof p.waiverLabel === 'string') c.waiverLabel = p.waiverLabel.slice(0, 60);
    if (['auto', 'open', 'closed'].includes(p.tradeWindow)) c.tradeWindow = p.tradeWindow;
    if (['avg', 'raw'].includes(p.priorityMode)) c.priorityMode = p.priorityMode;
    if (Array.isArray(p.tiebreakOrder)) c.tiebreakOrder = p.tiebreakOrder.filter(id => state.teams.some(t => t.id === id));
    if (Number.isFinite(Number(p.entryFee))) c.entryFee = Number(p.entryFee);
    if (Array.isArray(p.rounds)) {
      const rounds = p.rounds.map(r => ({ id: String(r.id || '').slice(0, 20), label: String(r.label || '').slice(0, 40), start: String(r.start || ''), end: String(r.end || '') }));
      if (rounds.some(r => !r.id || !/^\d{8}$/.test(r.start) || !/^\d{8}$/.test(r.end))) bad('Each round needs an id and start/end dates like 20270116.');
      c.rounds = rounds;
    }
    return { state, data: { ok: true } };
  },
  async adminProcessWaivers({ state, games, body, pool }) {
    await requireAdmin(body);
    try { await syncOne(pool); } catch (e) { /* use whatever stats we have */ }
    const fresh = (await kv.get(jonesKeys(pool).games)) || games;
    const { state: next, run } = C.processWaivers(state, fresh, Date.now());
    return { state: next, data: { ok: true, won: run.won, failed: run.failed } };
  },
  async adminUndoWaivers({ state, body }) {
    await requireAdmin(body);
    const out = C.undoLastWaiverRun(state);
    if (out.error) bad(out.error);
    return { state: out.state, data: { ok: true } };
  },
  async adminVoidTrade({ state, body }) {
    await requireAdmin(body);
    const t = state.trades.find(x => x.id === body.tradeId && x.status === 'pending');
    if (!t) bad('That trade is not pending.');
    t.status = 'void'; t.resolvedAt = Date.now();
    return { state, data: { ok: true } };
  },
  async adminAddAdjustment({ state, body }) {
    await requireAdmin(body);
    const pts = Number(body.points);
    if (!body.playerId || !body.gameId || !Number.isFinite(pts)) bad('Player, game and points are required.');
    state.adjustments.push({ id: C.mkId(), playerId: String(body.playerId), gameId: String(body.gameId), points: pts, note: String(body.note || '').slice(0, 100) });
    pushFeed(state, `Score adjustment: ${pts > 0 ? '+' : ''}${pts} — ${String(body.note || 'commissioner correction').slice(0, 100)}`);
    return { state, data: { ok: true } };
  },
  async adminRemoveAdjustment({ state, body }) {
    await requireAdmin(body);
    state.adjustments = state.adjustments.filter(a => a.id !== body.id);
    return { state, data: { ok: true } };
  },
  async adminReset({ state, body, pool }) {
    await requireAdmin(body);
    if (pool !== 'beta') bad('Only the beta league can be reset.');
    if (body.confirm !== 'RESET') bad('Type RESET to confirm.');
    state.rosterLog = []; state.claims = []; state.trades = []; state.runs = []; state.adjustments = []; state.feed = [];
    return { state, data: { ok: true } };
  },
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const pool = poolOf(req.query?.pool);
      const K = jonesKeys(pool);
      if (req.query?.rev) {
        const rev = await kv.get(K.rev);
        return res.status(200).json({ rev: rev == null ? null : String(rev) });
      }
      const rev = await kv.get(K.rev);
      const state = (await kv.get(K.state)) || C.initialState(pool);
      const games = (await kv.get(K.games)) || {};
      return res.status(200).json({ state: C.sanitizeState(state), games, rev: rev == null ? null : String(rev), serverNow: Date.now() });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', ['GET', 'POST']); return res.status(405).end('Method Not Allowed'); }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pool = poolOf(body.pool);
    const fn = actions[body.action];
    if (!fn) return res.status(400).json({ ok: false, error: 'Unknown action.' });
    const K = jonesKeys(pool);
    const out = await withLock(pool, async () => {
      const state = (await kv.get(K.state)) || C.initialState(pool);
      const games = (await kv.get(K.games)) || {};
      const result = await fn({ state, games, body, pool });
      if (result.state) {
        await kv.set(K.state, result.state);
        await kv.set(K.rev, Date.now().toString(36));
      }
      return result.data || { ok: true };
    });
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, error: e.message });
    console.error('[api/jones]', e && (e.message || e));
    return res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
  }
}
