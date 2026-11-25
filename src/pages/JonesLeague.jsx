import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import * as C from '../lib/jonesCore';
import { JONES_RULES } from '../lib/jonesRules';
import { useAdminMode } from '../lib/admin';
import { useLeague, usePlayerPool, jPost, fmtKick, fmtWhen, THEME as T } from '../lib/jonesClient';
import { Panel, Btn, inputStyle, PosTag, PlayerPicker } from '../components/JonesBits';
import JonesAdmin from '../components/JonesAdmin';

// The Jones League — fantasy playoff league. Route /jones/league (real) and /jones/beta (test league).
const TABS = [['standings', '🏆 Standings'], ['team', '🏈 My Team'], ['waivers', '📝 Waivers'], ['trades', '🔁 Trades'], ['activity', '📣 Activity'], ['rules', '📖 Rules']];

function useIdentity(pool) {
  const key = `jones-id-${pool}`;
  const [id, setId] = useState(() => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } });
  const save = (v) => { setId(v); try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch (e) { /* private mode */ } };
  return [id, save];
}

export default function JonesLeague({ beta }) {
  const pool = beta ? 'beta' : 'live';
  const { data, error, reload } = useLeague(pool);
  const [tab, setTab] = useState('standings');
  const [identity, setIdentity] = useIdentity(pool);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const { isAdmin, adminHash, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt, submitPrompt, exitAdmin } = useAdminMode();

  const state = data?.state;
  const games = data?.games || {};
  const standings = useMemo(() => (state ? C.computeStandings(state, games) : []), [state, games]);
  const order = useMemo(() => (state ? C.priorityOrder(state, standings) : []), [state, standings]);
  const me = state?.teams.find(t => t.id === identity?.teamId) || null;

  const flash = useCallback((msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4500); }, []);
  // One place for every "do something" button: sends it, shows the result, reloads. Returns true on success.
  const run = useCallback(async (action, payload, okMsg, errMsg) => {
    if (!action) { if (errMsg) flash(errMsg, false); return false; }
    setBusy(true);
    try {
      const r = await jPost(pool, { action, ...payload });
      await reload();
      flash(r.ok === false ? r.error : (okMsg || 'Done.'), r.ok !== false);
      return r.ok !== false;
    } catch (e) { flash(String(e.message || e), false); return false; } finally { setBusy(false); }
  }, [pool, reload, flash]);
  const asTeam = (action, payload, okMsg) => run(action, { teamId: identity?.teamId, pin: identity?.pin, ...payload }, okMsg);
  const asAdmin = (action, payload, okMsg, errMsg) => (action ? run(action, { adminHash, ...payload }, okMsg) : run(null, null, null, errMsg));
  const adminNotify = (msg, doReload) => { if (doReload) reload(); if (msg) flash(msg); };

  if (error && !data) return <Shell beta={beta}><Panel title="Could not load the league"><div style={{ color: T.red }}>{error}</div><div className="mt-2"><Btn onClick={reload}>Try again</Btn></div></Panel></Shell>;
  if (!state) return <Shell beta={beta}><div style={{ color: T.muted, padding: 40, textAlign: 'center' }}>Loading the league…</div></Shell>;

  const tabs = isAdmin ? [...TABS, ['admin', '⚙️ Admin']] : TABS;
  return (
    <Shell beta={beta} name={state.config.name}
      right={isAdmin
        ? <button onClick={exitAdmin} style={{ color: T.gold, fontSize: 12 }}>Exit admin</button>
        : <button onClick={openPrompt} style={{ color: T.muted, fontSize: 12 }}>Admin</button>}>
      {adminPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 60 }} className="flex items-center justify-center px-4">
          <div style={{ background: T.panel, border: `2px solid ${T.gold}`, borderRadius: 12, padding: 18, width: 300 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{adminPrompt.mode === 'set' ? 'Set the admin PIN' : 'Enter the admin PIN'}</div>
            <input autoFocus type="password" inputMode="numeric" placeholder="••••" value={adminPrompt.input} onChange={e => setAdminPrompt(p => ({ ...p, input: e.target.value }))} onKeyDown={e => e.key === 'Enter' && submitPrompt()} style={inputStyle} />
            {adminPrompt.error && <div style={{ color: T.red, fontSize: 12, marginTop: 4 }}>{adminPrompt.error}</div>}
            <div className="flex gap-2 mt-3"><Btn onClick={submitPrompt}>OK</Btn><Btn kind="ghost" onClick={() => setAdminPrompt(null)}>Cancel</Btn></div>
          </div>
        </div>
      )}
      {toast && <div style={{ position: 'fixed', left: 12, right: 12, bottom: 16, zIndex: 70, background: toast.ok ? '#14331F' : '#4A1712', border: `1px solid ${toast.ok ? T.green : T.red}`, color: T.cream, borderRadius: 10, padding: '10px 14px', fontSize: 14 }}>{toast.msg}</div>}

      <div className="flex gap-1 overflow-x-auto" style={{ borderBottom: `1px solid ${T.line}`, paddingBottom: 6, marginBottom: 12 }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ whiteSpace: 'nowrap', padding: '8px 12px', borderRadius: 8, fontWeight: 800, fontSize: 13, background: tab === k ? T.gold : 'transparent', color: tab === k ? '#10131F' : T.cream, border: tab === k ? 'none' : `1px solid ${T.line}` }}>{label}</button>
        ))}
      </div>

      {me && tab !== 'admin' && (
        <div className="flex items-center justify-between" style={{ fontSize: 13, marginBottom: 10, color: T.muted }}>
          <span>You’re <b style={{ color: T.gold }}>{me.name}</b></span>
          <button className="underline" onClick={() => setIdentity(null)}>not you?</button>
        </div>
      )}

      {tab === 'standings' && <Standings state={state} standings={standings} order={order} me={me} games={games} />}
      {tab === 'team' && (me ? <MyTeam state={state} standings={standings} me={me} games={games} /> : <TeamLogin state={state} onLogin={setIdentity} flash={flash} pool={pool} />)}
      {tab === 'waivers' && (me ? <Waivers state={state} order={order} me={me} asTeam={asTeam} busy={busy} /> : <TeamLogin state={state} onLogin={setIdentity} flash={flash} pool={pool} />)}
      {tab === 'trades' && (me ? <Trades state={state} games={games} me={me} asTeam={asTeam} busy={busy} /> : <TeamLogin state={state} onLogin={setIdentity} flash={flash} pool={pool} />)}
      {tab === 'activity' && <Activity state={state} />}
      {tab === 'rules' && <Rules state={state} />}
      {tab === 'admin' && isAdmin && <JonesAdmin pool={pool} state={state} games={games} standings={standings} order={order} act={asAdmin} notify={adminNotify} />}
    </Shell>
  );
}

function Shell({ children, beta, name, right }) {
  return (
    <div style={{ background: T.bg, color: T.cream, minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(180deg,#16213F 0%,#0A1020 100%)', borderBottom: `3px solid ${T.gold}` }}>
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div>
            <Link to="/jones" style={{ color: T.muted, fontSize: 12, textDecoration: 'none' }}>← Jones League home</Link>
            <div style={{ fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', color: T.gold, fontSize: 28, letterSpacing: 1.5, textTransform: 'uppercase', lineHeight: 1.1 }}>{name || 'The Jones League'}</div>
          </div>
          {right}
        </div>
        {beta && <div style={{ background: T.gold, color: '#10131F', textAlign: 'center', fontWeight: 800, fontSize: 12, padding: '4px 8px', letterSpacing: 1 }}>🧪 BETA TEST — practice league, nothing here counts</div>}
      </div>
      <div className="max-w-5xl mx-auto px-4 py-4" style={{ paddingBottom: 90 }}>{children}</div>
    </div>
  );
}

// ---------------- Login ----------------
function TeamLogin({ state, onLogin, flash, pool }) {
  const [pick, setPick] = useState(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  if (!state.teams.length) return <Panel title="No teams yet"><div style={{ color: T.muted }}>The commissioner hasn’t added the teams yet.</div></Panel>;
  const submit = async () => {
    setBusy(true);
    try {
      if (!pick.hasPin) await jPost(pool, { action: 'setPin', teamId: pick.id, pin });
      else await jPost(pool, { action: 'login', teamId: pick.id, pin });
      onLogin({ teamId: pick.id, pin });
      flash(pick.hasPin ? 'Welcome back.' : 'PIN saved — remember it!');
    } catch (e) { flash(String(e.message || e), false); } finally { setBusy(false); }
  };
  return (
    <Panel title="Which team is yours?" sub="Tap your team, then enter your PIN (the first time you pick one).">
      <div className="grid gap-2 sm:grid-cols-2">
        {state.teams.map(t => (
          <button key={t.id} onClick={() => { setPick(t); setPin(''); }} style={{ textAlign: 'left', background: pick?.id === t.id ? '#2A3560' : T.panel2, border: `1px solid ${pick?.id === t.id ? T.gold : T.line}`, borderRadius: 10, padding: '10px 12px' }}>
            <b>{t.name}</b> <span style={{ color: T.muted, fontSize: 12 }}>{t.owner}</span>
            <div style={{ fontSize: 11, color: t.hasPin ? T.muted : T.gold }}>{t.hasPin ? 'PIN required' : 'Not claimed yet — pick a PIN'}</div>
          </button>
        ))}
      </div>
      {pick && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input autoFocus type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder={pick.hasPin ? 'Your PIN' : 'Choose a 4–8 digit PIN'} style={{ ...inputStyle, width: 220 }} />
          <Btn onClick={submit} disabled={busy || pin.length < 4}>{pick.hasPin ? 'Open my team' : 'Claim this team'}</Btn>
          {pick.hasPin && <span style={{ color: T.muted, fontSize: 12 }}>Forgot it? The commissioner can reset it.</span>}
        </div>
      )}
    </Panel>
  );
}

// ---------------- Standings ----------------
function Standings({ state, standings, order, me, games }) {
  const prio = Object.fromEntries(order.map(o => [o.teamId, o.priority]));
  const rows = [...standings].sort((a, b) => b.total - a.total || b.played - a.played);
  let rank = 0, last = null;
  const ranked = rows.map((r, i) => { if (last === null || r.total !== last) rank = i + 1; last = r.total; return { ...r, rank }; });
  const cols = [['QB', 0], ['RB', 0], ['RB', 1], ['WR', 0], ['WR', 1], ['TE', 0], ['K', 0], ['DST', 0]];
  const gl = Object.values(games);
  if (!state.teams.length) return <Panel title="Standings"><div style={{ color: T.muted }}>The league hasn’t been set up yet.</div></Panel>;
  return (
    <div className="space-y-3">
      <Panel title="Standings" sub="Each position counts its BEST single game while on your roster — totals do not pile up. Higher is better.">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ color: T.muted, fontSize: 11, textTransform: 'uppercase' }}>
                <th align="left" style={{ padding: '4px 6px' }}>#</th><th align="left">Team</th><th>Total</th>
                {cols.map(([p, i], k) => <th key={k}>{C.POS_LABEL[p]}{C.SLOT_COUNTS[p] > 1 ? i + 1 : ''}</th>)}
                <th title="Waiver priority for the next run (1 = first pick)">Waiver #</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(r => {
                const t = state.teams.find(x => x.id === r.teamId);
                const mine = me && me.id === r.teamId;
                return (
                  <tr key={r.teamId} style={{ background: mine ? '#26305A' : 'transparent', borderTop: `1px solid ${T.line}` }}>
                    <td style={{ padding: '8px 6px', fontWeight: 800, color: r.rank === 1 ? T.gold : T.cream }}>{r.rank}</td>
                    <td style={{ whiteSpace: 'nowrap', paddingRight: 8 }}><b>{t?.name}</b><div style={{ color: T.muted, fontSize: 11 }}>{t?.owner}</div></td>
                    <td align="center" style={{ fontWeight: 900, fontSize: 18, color: T.gold }}>{C.fmtPts(r.total)}</td>
                    {cols.map(([p, i], k) => {
                      const s = r.slots[p][i];
                      return <td key={k} align="center" style={{ padding: '4px 2px' }}>{s ? <><div style={{ fontWeight: 800 }}>{C.fmtPts(s.pts)}</div><div style={{ color: T.muted, fontSize: 10, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div></> : <span style={{ color: T.muted }}>–</span>}</td>;
                    })}
                    <td align="center" style={{ color: T.muted }}>{prio[r.teamId]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Games" sub={`${gl.filter(g => g.state === 'post').length} final · ${gl.filter(g => g.state === 'in').length} live · ${gl.filter(g => g.state === 'pre').length} upcoming`}>
        <div className="grid gap-1 sm:grid-cols-2" style={{ fontSize: 13 }}>
          {gl.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')).filter(g => g.state !== 'pre' || Date.parse(g.kickoff) - Date.now() < 7 * 864e5).slice(-14).map(g => (
            <div key={g.id} className="flex justify-between" style={{ background: T.panel2, borderRadius: 8, padding: '6px 10px' }}>
              <span>{g.away} @ {g.home}</span>
              <span style={{ color: g.state === 'in' ? T.green : T.muted }}>{g.state === 'pre' ? fmtKick(g.kickoff) : `${g.awayScore ?? 0}–${g.homeScore ?? 0}${g.state === 'in' ? ' LIVE' : ' F'}`}</span>
            </div>
          ))}
          {gl.length === 0 && <div style={{ color: T.muted }}>No games loaded yet.</div>}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- My team ----------------
function MyTeam({ state, standings, me, games }) {
  const st = standings.find(s => s.teamId === me.id);
  const roster = C.currentRoster(state, me.id);
  const rounds = state.config.rounds;
  const label = (rid) => rounds.find(r => r.id === rid)?.label || rid;
  const counted = new Set(C.POSITIONS.flatMap(p => (st?.slots[p] || []).map(s => s.playerId)));
  return (
    <div className="space-y-3">
      <Panel title={me.name} sub={`Team total ${C.fmtPts(st?.total || 0)} · ${st?.played || 0} of 8 spots have scored`}>
        {roster.length === 0 && <div style={{ color: T.muted }}>Your roster hasn’t been entered yet.</div>}
        <div className="grid gap-2 sm:grid-cols-2">
          {C.POSITIONS.flatMap(pos => roster.filter(p => p.pos === pos)).map(p => {
            const per = st?.per[p.id];
            const best = per ? Math.max(...per.games.map(g => g.pts)) : null;
            return (
              <div key={p.id} style={{ background: T.panel2, border: `1px solid ${counted.has(p.id) ? T.green : T.line}`, borderRadius: 10, padding: '10px 12px' }}>
                <div className="flex items-center justify-between"><span><PosTag pos={p.pos} /> <b>{p.name}</b> <span style={{ color: T.muted, fontSize: 12 }}>{p.team}</span></span>
                  <span style={{ fontWeight: 900, fontSize: 18, color: counted.has(p.id) ? T.green : T.muted }}>{best == null ? '–' : C.fmtPts(best)}</span></div>
                <div style={{ color: T.muted, fontSize: 12, marginTop: 4 }}>
                  {per ? per.games.map(g => `${label(g.round)}: ${C.fmtPts(g.pts)}`).join('  ·  ') : 'Hasn’t played yet while on your roster'}
                </div>
                {counted.has(p.id) && <div style={{ color: T.green, fontSize: 11, marginTop: 2 }}>✓ counting toward your total (best game)</div>}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Waivers ----------------
function Waivers({ state, order, me, asTeam, busy }) {
  const { players, loading, progress, retry, missingTeams } = usePlayerPool();
  const roster = C.currentRoster(state, me.id);
  const owned = useMemo(() => new Set([...C.ownerMap(state).keys()]), [state]);
  const [dropId, setDropId] = useState('');
  const [add, setAdd] = useState(null);
  const drop = roster.find(p => p.id === dropId);
  const myClaims = state.claims.filter(c => c.teamId === me.id && c.status === 'pending').sort((a, b) => a.rank - b.rank);
  const lastRun = state.runs[state.runs.length - 1];
  const nm = (id) => state.teams.find(t => t.id === id)?.name || '?';
  const myPrio = order.find(o => o.teamId === me.id)?.priority;

  return (
    <div className="space-y-3">
      <Panel title="Waivers" sub={`Processed ${state.config.waiverLabel}. The lowest score picks first. You are currently #${myPrio} of ${order.length}.`}>
        <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.5 }}>
          Queue as many claims as you want and rank them. Each claim is <b style={{ color: T.cream }}>add a player + drop a player at the same position</b>. Every pass through the order, each team gets one successful claim — your top-ranked claim that’s still available.
        </div>
      </Panel>

      <Panel title="Your claims">
        {myClaims.length === 0 && <div style={{ color: T.muted, fontSize: 13 }}>No claims queued.</div>}
        {myClaims.map((c, i) => (
          <div key={c.id} className="flex items-center justify-between gap-2" style={{ borderTop: i ? `1px solid ${T.line}` : 'none', padding: '8px 0', fontSize: 14 }}>
            <span><b style={{ color: T.gold }}>{i + 1}.</b> <span style={{ color: T.green }}>+ {c.add.name}</span> <span style={{ color: T.muted, fontSize: 12 }}>{c.add.team}</span> &nbsp; <span style={{ color: T.red }}>− {c.drop.name}</span></span>
            <span className="flex gap-1">
              <Btn small kind="ghost" disabled={busy || i === 0} onClick={() => asTeam('moveClaim', { claimId: c.id, dir: -1 })}>↑</Btn>
              <Btn small kind="ghost" disabled={busy || i === myClaims.length - 1} onClick={() => asTeam('moveClaim', { claimId: c.id, dir: 1 })}>↓</Btn>
              <Btn small kind="red" disabled={busy} onClick={() => asTeam('removeClaim', { claimId: c.id }, 'Claim removed.')}>✕</Btn>
            </span>
          </div>
        ))}
      </Panel>

      <Panel title="Add a claim" sub="Step 1: who do you drop? Step 2: who do you want?">
        {roster.length === 0 ? <div style={{ color: T.muted }}>Your roster is empty.</div> : (
          <div className="space-y-2">
            <select value={dropId} onChange={e => { setDropId(e.target.value); setAdd(null); }} style={inputStyle}>
              <option value="">1 · Drop…</option>
              {C.POSITIONS.flatMap(pos => roster.filter(p => p.pos === pos)).map(p => <option key={p.id} value={p.id}>{C.POS_LABEL[p.pos]} — {p.name} ({p.team})</option>)}
            </select>
            {drop && (
              <>
                {loading && <div style={{ color: T.muted, fontSize: 12 }}>Loading the NFL player list… {progress.loaded}/{progress.total}</div>}
                {!loading && missingTeams.length > 0 && <div style={{ color: T.gold, fontSize: 12 }}>Couldn’t load: {missingTeams.join(', ')} <button onClick={retry} className="underline">retry</button></div>}
                <PlayerPicker pool={players} pos={drop.pos} exclude={owned} value={add} onPick={setAdd} placeholder={`2 · Search for a ${C.POS_LABEL[drop.pos]} to add…`} />
                <Btn disabled={!add || busy} onClick={async () => { const ok = await asTeam('addClaim', { add, dropId: drop.id }, 'Claim added to your queue.'); if (ok) { setAdd(null); } }}>Add claim</Btn>
              </>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Waiver order" sub={state.config.priorityMode === 'raw' ? 'Lowest total score first.' : 'Lowest points per player who has played goes first (fair when some teams are on a bye).'}>
        <div className="flex flex-wrap gap-2" style={{ fontSize: 12 }}>
          {order.map(o => <span key={o.teamId} style={{ background: o.teamId === me.id ? '#26305A' : T.panel2, border: `1px solid ${T.line}`, borderRadius: 999, padding: '3px 10px' }}><b style={{ color: T.gold }}>{o.priority}</b> {nm(o.teamId)}</span>)}
        </div>
      </Panel>

      {lastRun && (
        <Panel title="Last waiver run" sub={`${fmtWhen(lastRun.ts)} · ${lastRun.won} won · ${lastRun.failed} failed${lastRun.undone ? ' · UNDONE' : ''}`}>
          <div className="space-y-1" style={{ fontSize: 13 }}>
            {lastRun.results.map((r, i) => <div key={i}>{r.ok ? '✅' : '❌'} <b>{nm(r.teamId)}</b>: +{r.add.name} / −{r.drop.name}{r.reason ? <span style={{ color: T.muted }}> — {r.reason}</span> : null}</div>)}
            {lastRun.results.length === 0 && <div style={{ color: T.muted }}>There were no claims.</div>}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------- Trades ----------------
function Trades({ state, games, me, asTeam, busy }) {
  const win = C.tradeWindow(state, games);
  const [toId, setToId] = useState('');
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const nm = (id) => state.teams.find(t => t.id === id)?.name || '?';
  const mine = C.currentRoster(state, me.id);
  const theirs = toId ? C.currentRoster(state, toId) : [];
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const incoming = state.trades.filter(t => t.status === 'pending' && t.toTeamId === me.id);
  const outgoing = state.trades.filter(t => t.status === 'pending' && t.fromTeamId === me.id);
  const history = state.trades.filter(t => t.status !== 'pending').slice(-8).reverse();
  const names = (l) => l.map(p => `${p.name} (${C.POS_LABEL[p.pos]})`).join(', ');
  const counts = (ids, list) => C.POSITIONS.map(pos => list.filter(p => ids.includes(p.id) && p.pos === pos).length);
  const balanced = give.length > 0 && get.length > 0 && counts(give, mine).join() === counts(get, theirs).join();

  return (
    <div className="space-y-3">
      <Panel title="Trades" tone={win.open ? T.green : T.red} sub={win.open ? `OPEN — ${win.reason}` : `CLOSED — ${win.reason}`}>
        <div style={{ color: T.muted, fontSize: 13 }}>No trade may have a contingency — the trade is at face value. No money can be offered and no post-trade agreements can be made. Each side must send the same number of players at each position.</div>
      </Panel>

      {incoming.length > 0 && (
        <Panel title="Offers to you" tone={T.gold}>
          {incoming.map(t => (
            <div key={t.id} style={{ padding: '8px 0', borderTop: `1px solid ${T.line}`, fontSize: 14 }}>
              <b>{nm(t.fromTeamId)}</b> offers <span style={{ color: T.green }}>{names(t.give)}</span> for your <span style={{ color: T.red }}>{names(t.get)}</span>
              <div className="flex gap-2 mt-2"><Btn kind="green" small disabled={busy || !win.open} onClick={() => asTeam('respondTrade', { tradeId: t.id, response: 'accept' }, 'Trade accepted!')}>Accept</Btn><Btn kind="ghost" small disabled={busy} onClick={() => asTeam('respondTrade', { tradeId: t.id, response: 'decline' }, 'Declined.')}>Decline</Btn></div>
            </div>
          ))}
        </Panel>
      )}
      {outgoing.length > 0 && (
        <Panel title="Your open offers">
          {outgoing.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2" style={{ padding: '6px 0', fontSize: 14 }}>
              <span>To <b>{nm(t.toTeamId)}</b>: {names(t.give)} ⇄ {names(t.get)}</span>
              <Btn small kind="ghost" disabled={busy} onClick={() => asTeam('respondTrade', { tradeId: t.id, response: 'cancel' }, 'Offer cancelled.')}>Cancel</Btn>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Offer a trade">
        <div className="space-y-3">
          <select value={toId} onChange={e => { setToId(e.target.value); setGet([]); }} style={inputStyle}>
            <option value="">Trade with…</option>
            {state.teams.filter(t => t.id !== me.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {toId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div style={{ color: T.muted, fontSize: 12, marginBottom: 4 }}>You send</div>
                {C.POSITIONS.flatMap(pos => mine.filter(p => p.pos === pos)).map(p => (
                  <label key={p.id} className="flex items-center gap-2" style={{ padding: '4px 0', fontSize: 14 }}><input type="checkbox" checked={give.includes(p.id)} onChange={() => toggle(give, setGive, p.id)} /><PosTag pos={p.pos} /> {p.name}</label>))}</div>
              <div><div style={{ color: T.muted, fontSize: 12, marginBottom: 4 }}>You get</div>
                {C.POSITIONS.flatMap(pos => theirs.filter(p => p.pos === pos)).map(p => (
                  <label key={p.id} className="flex items-center gap-2" style={{ padding: '4px 0', fontSize: 14 }}><input type="checkbox" checked={get.includes(p.id)} onChange={() => toggle(get, setGet, p.id)} /><PosTag pos={p.pos} /> {p.name}</label>))}</div>
            </div>
          )}
          {toId && !balanced && (give.length > 0 || get.length > 0) && <div style={{ color: T.gold, fontSize: 12 }}>Each side must send the same number of players at each position.</div>}
          <Btn disabled={!balanced || busy || !win.open} onClick={async () => { const ok = await asTeam('proposeTrade', { toTeamId: toId, giveIds: give, getIds: get }, 'Offer sent.'); if (ok) { setGive([]); setGet([]); } }}>Send offer</Btn>
        </div>
      </Panel>

      {history.length > 0 && (
        <Panel title="Recent trades">
          {history.map(t => <div key={t.id} style={{ fontSize: 13, padding: '3px 0', color: t.status === 'accepted' ? T.cream : T.muted }}>{t.status === 'accepted' ? '✅' : '✖'} {nm(t.fromTeamId)} ⇄ {nm(t.toTeamId)}: {names(t.give)} for {names(t.get)} <i>({t.status})</i></div>)}
        </Panel>
      )}
    </div>
  );
}

// ---------------- Activity / Rules ----------------
function Activity({ state }) {
  return (
    <div className="space-y-3">
      <Panel title="League activity">
        {state.feed.length === 0 && <div style={{ color: T.muted }}>Nothing yet.</div>}
        {[...state.feed].reverse().slice(0, 60).map((f, i) => <div key={i} style={{ fontSize: 13, padding: '4px 0', borderTop: i ? `1px solid ${T.line}` : 'none' }}><span style={{ color: T.muted }}>{fmtWhen(f.ts)}</span> — {f.text}</div>)}
      </Panel>
    </div>
  );
}
function Rules({ state }) {
  return (
    <div className="space-y-3">
      {JONES_RULES.map(sec => (
        <Panel key={sec.heading} title={sec.heading}>
          {sec.body.map((t, i) => <p key={i} style={{ fontSize: 14, lineHeight: 1.55, marginTop: i ? 8 : 0 }}>{t}</p>)}
        </Panel>
      ))}
      <div style={{ color: T.muted, fontSize: 12 }}>Entry ${state.config.entryFee} per team.</div>
    </div>
  );
}
