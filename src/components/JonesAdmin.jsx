import React, { useState, useMemo } from 'react';
import * as C from '../lib/jonesCore';
import { THEME as T, usePlayerPool, fmtKick, fmtWhen } from '../lib/jonesClient';
import { Panel, Btn, inputStyle, PlayerPicker } from './JonesBits';

const SLOT_KEYS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'K', 'DST'];
const slotPos = (k) => k.replace(/\d/, '');
const draftFromRoster = (list) => {
  const d = {}; const used = {};
  (list || []).forEach(p => {
    const n = (used[p.pos] = (used[p.pos] || 0) + 1);
    const key = C.SLOT_COUNTS[p.pos] > 1 ? p.pos + n : p.pos;
    d[key] = p;
  });
  return d;
};

function RosterEditor({ state, games, act }) {
  const { players, loading, progress, missingTeams, retry } = usePlayerPool();
  const [drafts, setDrafts] = useState(() => Object.fromEntries(state.teams.map(t => [t.id, draftFromRoster(C.currentRoster(state, t.id))])));
  const taken = useMemo(() => {
    const s = new Set();
    Object.values(drafts).forEach(d => Object.values(d).forEach(p => p && s.add(p.id)));
    return s;
  }, [drafts]);
  const setSlot = (tid, key, p) => setDrafts(d => ({ ...d, [tid]: { ...(d[tid] || {}), [key]: p } }));

  const randomFill = () => {
    const played = new Set();
    Object.values(games || {}).forEach(g => Object.keys(g.pts || {}).forEach(id => played.add(id)));
    const used = new Set();
    const next = {};
    const pick = (pos) => {
      let list = players.filter(p => p.pos === pos && !used.has(p.id) && played.has(p.id));
      if (!list.length) list = players.filter(p => p.pos === pos && !used.has(p.id));
      const p = list[Math.floor(Math.random() * list.length)];
      if (p) used.add(p.id);
      return p;
    };
    state.teams.forEach(t => { const d = {}; SLOT_KEYS.forEach(k => { d[k] = pick(slotPos(k)); }); next[t.id] = d; });
    setDrafts(next);
  };
  const full = (tid) => SLOT_KEYS.every(k => drafts[tid]?.[k]);
  const saveAll = () => {
    const rosters = {};
    state.teams.forEach(t => { if (full(t.id)) rosters[t.id] = SLOT_KEYS.map(k => drafts[t.id][k]); });
    if (!Object.keys(rosters).length) return act(null, null, null, 'Fill all 8 spots for at least one team first.');
    act('adminSetRosters', { rosters }, `Saved ${Object.keys(rosters).length} roster(s).`);
  };
  if (!state.teams.length) return <div style={{ color: T.muted, fontSize: 13 }}>Add the teams first.</div>;
  return (
    <div className="space-y-3">
      {loading && <div style={{ color: T.muted, fontSize: 13 }}>Loading NFL players from ESPN… {progress.loaded}/{progress.total}</div>}
      {!loading && missingTeams.length > 0 && <div style={{ color: T.gold, fontSize: 12 }}>Could not load: {missingTeams.join(', ')} <button onClick={retry} className="underline">retry</button></div>}
      <div className="flex flex-wrap gap-2">
        <Btn onClick={saveAll} disabled={loading}>Save rosters</Btn>
        {state.config.name.includes('BETA') && <Btn kind="ghost" onClick={randomFill} disabled={loading} title="Test only: fills every team with random players">🎲 Fill random rosters (beta)</Btn>}
      </div>
      {state.teams.map(t => (
        <details key={t.id} style={{ background: T.panel2, border: `1px solid ${T.line}`, borderRadius: 10, padding: '8px 12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 800 }}>{t.name} <span style={{ color: full(t.id) ? T.green : T.muted, fontWeight: 600, fontSize: 12 }}>{full(t.id) ? '✓ complete' : `${SLOT_KEYS.filter(k => drafts[t.id]?.[k]).length}/8`}</span></summary>
          <div className="grid gap-2 mt-2 sm:grid-cols-2">
            {SLOT_KEYS.map(k => (
              <div key={k}>
                <div style={{ color: T.muted, fontSize: 11, marginBottom: 2 }}>{k.replace('DST', 'D/ST')}</div>
                <PlayerPicker pool={players} pos={slotPos(k)} exclude={taken} value={drafts[t.id]?.[k] || null} onPick={(p) => setSlot(t.id, k, p)} placeholder={k === 'DST' ? 'Team name…' : 'Player name…'} />
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function TeamsEditor({ state, act }) {
  const [rows, setRows] = useState(() => (state.teams.length ? state.teams.map(t => ({ id: t.id, name: t.name, owner: t.owner || '' })) : [{ name: '', owner: '' }]));
  const upd = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input value={r.name} onChange={e => upd(i, { name: e.target.value })} placeholder="Team name" style={inputStyle} />
          <input value={r.owner} onChange={e => upd(i, { owner: e.target.value })} placeholder="Owner" style={inputStyle} />
          {r.id && state.teams.find(t => t.id === r.id)?.hasPin && <Btn small kind="ghost" onClick={() => window.confirm(`Reset ${r.name}'s PIN? They will pick a new one.`) && act('adminResetPin', { teamId: r.id }, 'PIN reset.')}>Reset PIN</Btn>}
          {!r.id && <button onClick={() => setRows(rs => rs.filter((_, k) => k !== i))} style={{ color: T.muted }}>✕</button>}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Btn kind="ghost" small onClick={() => setRows(rs => [...rs, { name: '', owner: '' }])}>+ Add team</Btn>
        <Btn onClick={() => act('adminSetTeams', { teams: rows }, 'Teams saved.')}>Save teams ({rows.filter(r => r.name.trim()).length})</Btn>
      </div>
      <div style={{ color: T.muted, fontSize: 12 }}>Each manager picks their own PIN the first time they open their team. {state.teams.length} / 14 teams.</div>
    </div>
  );
}

function RoundsEditor({ state, act }) {
  const [rows, setRows] = useState(() => state.config.rounds.map(r => ({ ...r })));
  const upd = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div style={{ color: T.muted, fontSize: 12 }}>Each round pulls every NFL game between its start and end dates (format 20270116). Trades and scoring follow these rounds.</div>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2" style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}>
          <input value={r.label} onChange={e => upd(i, { label: e.target.value })} style={inputStyle} />
          <input value={r.start} onChange={e => upd(i, { start: e.target.value })} style={inputStyle} />
          <input value={r.end} onChange={e => upd(i, { end: e.target.value })} style={inputStyle} />
        </div>
      ))}
      <Btn onClick={() => act('adminConfig', { patch: { rounds: rows } }, 'Schedule saved. Press "Sync scores now" to pull the games.')}>Save schedule</Btn>
    </div>
  );
}

export default function JonesAdmin({ pool, state, games, standings, order, act, notify }) {
  const [syncMsg, setSyncMsg] = useState('');
  const [preview, setPreview] = useState(null);
  const [adj, setAdj] = useState({ playerId: '', gameId: '', points: '', note: '' });
  const [rosterOpen, setRosterOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const isBeta = pool === 'beta';
  const win = C.tradeWindow(state, games);
  const teamName = (id) => state.teams.find(t => t.id === id)?.name || '?';
  const gameList = Object.values(games || {}).sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''));
  const rostered = useMemo(() => state.teams.flatMap(t => C.currentRoster(state, t.id).map(p => ({ ...p, teamName: t.name }))), [state]);

  const syncNow = async () => {
    setSyncMsg('Syncing…');
    try {
      const r = await fetch(`/api/sync-jones?manual=1&pool=${pool}`);
      const j = await r.json();
      setSyncMsg(j.throttled ? j.note : j.ok === false ? `Error: ${j.error}` : j.updated ? `Updated — ${j.games} games on file.` : `No changes (${j.games ?? 0} games on file).`);
      if (j.updated) notify(null, true);
    } catch (e) { setSyncMsg('Could not reach the sync.'); }
  };

  return (
    <div className="space-y-4">
      <Panel title="1 · Teams" sub="Add the 14 managers.">
        <TeamsEditor key={state.teams.map(t => t.id + t.name).join('|')} state={state} act={act} />
      </Panel>

      <Panel title="2 · Rosters (enter the draft results)" sub="Pick the 8 players each team drafted. Before the first waiver run this simply replaces the roster; after that edits are logged from now on.">
        <details onToggle={e => setRosterOpen(e.target.open)}>
          <summary style={{ cursor: 'pointer', color: T.gold, fontWeight: 800 }}>Open the roster editor</summary>
          <div className="mt-3">{rosterOpen && <RosterEditor key={state.rosterLog.length} state={state} games={games} act={act} />}</div>
        </details>
      </Panel>

      <Panel title="3 · Waivers" sub={`Runs ${state.config.waiverLabel} (set up the timer once — see the setup notes).`}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 13 }}>
            Priority order:
            <select value={state.config.priorityMode} onChange={e => act('adminConfig', { patch: { priorityMode: e.target.value } }, 'Saved.')} style={{ ...inputStyle, width: 'auto' }}>
              <option value="avg">Points per player who has played (lowest first)</option>
              <option value="raw">Plain lowest total score</option>
            </select>
            <Btn small kind="ghost" onClick={() => act('adminConfig', { patch: { tiebreakOrder: [...state.teams.map(t => t.id)].sort(() => Math.random() - 0.5) } }, 'Tiebreak order shuffled.')}>🎲 Shuffle tiebreak order</Btn>
          </div>
          <div style={{ color: T.muted, fontSize: 12 }}>Tiebreak order (used when scores tie, e.g. before any games): {(state.config.tiebreakOrder || []).map((id, i) => `${i + 1}. ${teamName(id)}`).join('  ·  ') || '—'}</div>
          <div className="flex flex-wrap gap-2">
            <Btn kind="ghost" onClick={() => setPreview(C.processWaivers(state, games, Date.now()).run)}>👀 Preview a run (changes nothing)</Btn>
            <Btn kind="green" onClick={() => window.confirm('Process all pending waiver claims right now?') && act('adminProcessWaivers', {}, 'Waivers processed.')}>▶ Process waivers now</Btn>
            <Btn kind="red" small onClick={() => window.confirm('Undo the most recent waiver run? Its claims go back to pending.') && act('adminUndoWaivers', {}, 'Last run undone.')}>Undo last run</Btn>
          </div>
          {preview && (
            <div style={{ background: T.panel2, border: `1px dashed ${T.gold}`, borderRadius: 10, padding: 10, fontSize: 13 }}>
              <b>Preview</b> — {preview.won} would win, {preview.failed} would fail.
              <div className="mt-1 space-y-1">
                {preview.results.length === 0 && <div style={{ color: T.muted }}>No pending claims.</div>}
                {preview.results.map((r, i) => (
                  <div key={i}>{r.ok ? '✅' : '❌'} <b>{teamName(r.teamId)}</b>: +{r.add.name} / −{r.drop.name}{r.reason ? <span style={{ color: T.red }}> — {r.reason}</span> : null}</div>
                ))}
              </div>
              <button onClick={() => setPreview(null)} className="underline" style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>close preview</button>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="4 · Schedule & scores" sub="Games and stats come from ESPN.">
        <div className="space-y-3">
          <RoundsEditor key={JSON.stringify(state.config.rounds)} state={state} act={act} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn kind="ghost" onClick={syncNow}>🔄 Sync scores now</Btn>
            <span style={{ color: T.muted, fontSize: 12 }}>{syncMsg}</span>
          </div>
          <div style={{ color: T.muted, fontSize: 12 }}>{gameList.length} games on file · {gameList.filter(g => g.state === 'post').length} final · {gameList.filter(g => g.state === 'in').length} in progress</div>
        </div>
      </Panel>

      <Panel title="5 · Trades" sub={`Right now: ${win.open ? 'OPEN' : 'CLOSED'} — ${win.reason}`}>
        <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 13 }}>
          Trade window:
          <select value={state.config.tradeWindow} onChange={e => act('adminConfig', { patch: { tradeWindow: e.target.value } }, 'Saved.')} style={{ ...inputStyle, width: 'auto' }}>
            <option value="auto">Automatic (open between rounds)</option>
            <option value="open">Force open</option>
            <option value="closed">Force closed</option>
          </select>
        </div>
        {state.trades.filter(t => t.status === 'pending').map(t => (
          <div key={t.id} className="flex items-center justify-between gap-2 mt-2" style={{ fontSize: 13 }}>
            <span>{teamName(t.fromTeamId)} → {teamName(t.toTeamId)}: {t.give.map(p => p.name).join(', ')} ⇄ {t.get.map(p => p.name).join(', ')}</span>
            <Btn small kind="red" onClick={() => act('adminVoidTrade', { tradeId: t.id }, 'Trade voided.')}>Void</Btn>
          </div>
        ))}
      </Panel>

      <Panel title="6 · Score corrections" sub="If ESPN misses something (for example a 2-point conversion), add or subtract points for a player in a game.">
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={adj.playerId} onChange={e => setAdj(a => ({ ...a, playerId: e.target.value }))} style={inputStyle}>
            <option value="">Player…</option>
            {rostered.map(p => <option key={p.id + p.teamName} value={p.id}>{p.name} ({C.POS_LABEL[p.pos]}) — {p.teamName}</option>)}
          </select>
          <select value={adj.gameId} onChange={e => setAdj(a => ({ ...a, gameId: e.target.value }))} style={inputStyle}>
            <option value="">Game…</option>
            {gameList.filter(g => g.state !== 'pre').map(g => <option key={g.id} value={g.id}>{g.away} @ {g.home} — {fmtKick(g.kickoff)}</option>)}
          </select>
          <input value={adj.points} onChange={e => setAdj(a => ({ ...a, points: e.target.value }))} placeholder="Points (+2 or -1)" style={inputStyle} />
          <input value={adj.note} onChange={e => setAdj(a => ({ ...a, note: e.target.value }))} placeholder="Why (shown in Activity)" style={inputStyle} />
        </div>
        <div className="mt-2"><Btn onClick={() => act('adminAddAdjustment', adj, 'Correction added.').then(ok => ok && setAdj({ playerId: '', gameId: '', points: '', note: '' }))}>Add correction</Btn></div>
        {state.adjustments.map(a => {
          const g = games[a.gameId]; const p = rostered.find(x => x.id === a.playerId);
          return (
            <div key={a.id} className="flex items-center justify-between mt-2" style={{ fontSize: 13 }}>
              <span>{p?.name || a.playerId} · {g ? `${g.away}@${g.home}` : a.gameId}: <b>{a.points > 0 ? '+' : ''}{a.points}</b> {a.note && `— ${a.note}`}</span>
              <Btn small kind="ghost" onClick={() => act('adminRemoveAdjustment', { id: a.id }, 'Removed.')}>Remove</Btn>
            </div>
          );
        })}
      </Panel>

      {isBeta && (
        <Panel title="Beta tools" tone={T.red}>
          <div style={{ color: T.muted, fontSize: 12, marginBottom: 6 }}>Clears every roster, claim, trade, waiver run and correction. Teams and PINs are kept.</div>
          <div className="flex gap-2 items-center">
            <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Type RESET" style={{ ...inputStyle, width: 140 }} />
            <Btn kind="red" disabled={confirmText !== 'RESET'} onClick={() => act('adminReset', { confirm: 'RESET' }, 'Beta league reset.')}>Reset beta</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}
