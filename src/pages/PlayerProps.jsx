import React, { useState, useEffect } from 'react';
import { useAdminMode } from '../lib/admin';
import { apiGetPool, apiSavePool } from '../lib/api';
import { useEspnSchedule } from '../lib/espnSchedule';
import { Plus, Trash2, X, RefreshCw, Loader2, Check } from 'lucide-react';

const POOL_KEY = 'player-props-v1';

// Same proven label-key lists already used for the Lineup pool's own scoring — reusing these
// rather than guessing at ESPN's field names fresh, since these are already confirmed to match
// what the box score endpoint actually returns.
const STAT_CATEGORIES = [
  { key: 'passYds', label: 'Passing Yards', catMatch: 'pass', keys: ['YDS', 'PASS YDS', 'PASSING YARDS'] },
  { key: 'passTDs', label: 'Passing TDs', catMatch: 'pass', keys: ['TD', 'PASS TD'] },
  { key: 'interceptions', label: 'Interceptions Thrown', catMatch: 'pass', keys: ['INT', 'INTERCEPTIONS'] },
  { key: 'rushYds', label: 'Rushing Yards', catMatch: 'rush', keys: ['YDS', 'RUSH YDS'] },
  { key: 'rushTDs', label: 'Rushing TDs', catMatch: 'rush', keys: ['TD', 'RUSH TD'] },
  { key: 'recYds', label: 'Receiving Yards', catMatch: 'receiv', keys: ['YDS', 'REC YDS'] },
  { key: 'receptions', label: 'Receptions', catMatch: 'receiv', keys: ['REC', 'RECEPTIONS'] },
  { key: 'recTDs', label: 'Receiving TDs', catMatch: 'receiv', keys: ['TD', 'REC TD'] },
  { key: 'totalTDs', label: 'Total TDs (rush + rec)', catMatch: null, keys: null },
];
const statConfig = (key) => STAT_CATEGORIES.find(s => s.key === key);

// A "bet" is now always a parlay — a plain single prop is just a parlay with one leg, so
// everything downstream (status, sync, storage) only has to handle one shape.
const emptyData = () => ({ bets: [], weeklyValues: {}, gamesRemaining: {}, lastSyncedAt: null });
const emptyLegDraft = () => ({ player: '', team: '', statCategory: 'rushYds', line: '', direction: 'over' });
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const seasonYear = () => {
  const now = new Date();
  const m = now.getMonth(); // 0 = Jan
  return m >= 2 ? now.getFullYear() : now.getFullYear() - 1; // NFL season "year" flips in March
};

// Pulls the first numeric value found under any of several candidate label names — the same
// defensive approach used everywhere else in the app that parses this same box score shape.
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

const normName = (s) => (s || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();

// Sums a stat across every row this player has in this one game that matches the given
// category — a player can have more than one row (e.g. a RB who also caught passes), so a
// single-row lookup would silently miss part of their stat line.
function sumStatForPlayer(playerRows, catMatch, keys) {
  return playerRows
    .filter(r => catMatch === null || (r.category || '').toLowerCase().includes(catMatch))
    .reduce((sum, r) => sum + pickStat(r.stats, keys), 0);
}

function extractStat(playerRows, statKey) {
  if (statKey === 'totalTDs') {
    const rushTD = sumStatForPlayer(playerRows, 'rush', ['TD', 'RUSH TD']);
    const recTD = sumStatForPlayer(playerRows, 'receiv', ['TD', 'REC TD']);
    return rushTD + recTD;
  }
  const cfg = statConfig(statKey);
  if (!cfg) return 0;
  return sumStatForPlayer(playerRows, cfg.catMatch, cfg.keys);
}

// One leg's progress toward its own line — everything a leg's row needs to render, computed in
// one place so the summary (parlay-level) and the detail (per-leg) views can't disagree.
function legStatus(leg, weeklyValues, gamesRemaining) {
  const weeks = weeklyValues[leg.id] || {};
  const cumulative = Object.values(weeks).reduce((sum, v) => sum + v, 0);
  const remaining = leg.line - cumulative;
  const hit = leg.direction === 'over' ? cumulative >= leg.line : null; // "under" only resolves at season end, not mid-stream
  const busted = leg.direction === 'under' && cumulative > leg.line;
  const gamesLeft = gamesRemaining[leg.id];
  const perGame = gamesLeft > 0 ? remaining / gamesLeft : null;
  const pct = Math.min(100, Math.round((cumulative / leg.line) * 100));
  return { cumulative, remaining, hit, busted, gamesLeft, perGame, pct };
}

export default function PlayerProps() {
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [buildingParlay, setBuildingParlay] = useState(null); // null | { legs: [...], notes: '' } — the in-progress parlay while adding legs
  const [legDraft, setLegDraft] = useState(emptyLegDraft());
  const [legError, setLegError] = useState('');
  const [expandedBetId, setExpandedBetId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const year = seasonYear();
  const { ensureSchedule } = useEspnSchedule(1, year);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const remote = await apiGetPool(POOL_KEY);
        const raw = remote || emptyData();
        // Old-format bets (from before parlays existed) had no legs array — wrap each one as a
        // single-leg parlay, keeping the same id so any already-synced weeklyValues/gamesRemaining
        // for it keep working unchanged.
        const migrated = {
          ...raw,
          bets: (raw.bets || []).map(b => b.legs ? b : {
            id: b.id,
            legs: [{ id: b.id, player: b.player, team: b.team, statCategory: b.statCategory, line: b.line, direction: b.direction }],
            notes: b.notes || '',
            createdAt: b.createdAt,
          }),
        };
        setData(migrated);
      } catch (e) {
        setData(emptyData());
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const persist = async (next) => {
    setData(next);
    try {
      await apiSavePool(POOL_KEY, next);
      setSaveError(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (e) {
      setSaveError(true);
    }
  };

  const startParlay = () => {
    setBuildingParlay({ legs: [], notes: '' });
    setLegDraft(emptyLegDraft());
    setLegError('');
  };

  const cancelParlay = () => {
    setBuildingParlay(null);
    setLegError('');
  };

  const addLegToParlay = () => {
    setLegError('');
    const player = legDraft.player.trim();
    const team = legDraft.team.trim().toUpperCase();
    const line = parseFloat(legDraft.line);
    if (!player) { setLegError('Enter the player\'s name.'); return; }
    if (!team) { setLegError('Enter their team (e.g. DET).'); return; }
    if (isNaN(line) || line <= 0) { setLegError('Enter a valid line number.'); return; }
    const leg = { id: newId(), player, team, statCategory: legDraft.statCategory, line, direction: legDraft.direction };
    setBuildingParlay(p => ({ ...p, legs: [...p.legs, leg] }));
    setLegDraft(emptyLegDraft());
  };

  const removeLegFromDraft = (legId) => {
    setBuildingParlay(p => ({ ...p, legs: p.legs.filter(l => l.id !== legId) }));
  };

  const finishParlay = () => {
    if (!buildingParlay || buildingParlay.legs.length === 0) return;
    const parlay = { id: newId(), legs: buildingParlay.legs, notes: buildingParlay.notes.trim(), createdAt: new Date().toISOString() };
    persist({ ...data, bets: [...data.bets, parlay] });
    setBuildingParlay(null);
  };

  const removeBet = (id) => {
    if (deleteConfirmId !== id) { setDeleteConfirmId(id); return; }
    const parlay = data.bets.find(b => b.id === id);
    const nextWeeklyValues = { ...data.weeklyValues };
    const nextGamesRemaining = { ...(data.gamesRemaining || {}) };
    (parlay?.legs || []).forEach(leg => { delete nextWeeklyValues[leg.id]; delete nextGamesRemaining[leg.id]; });
    persist({ ...data, bets: data.bets.filter(b => b.id !== id), weeklyValues: nextWeeklyValues, gamesRemaining: nextGamesRemaining });
    setDeleteConfirmId(null);
  };

  // Pulls real stats for every leg of every tracked parlay, week by week, straight from the same
  // box-score proxy the Lineup pool already uses — self-contained here rather than sharing that
  // pool's own copy of this logic, so this page stays fully independent of anything pool-related.
  const syncAllBets = async () => {
    const allLegs = data.bets.flatMap(b => b.legs);
    if (allLegs.length === 0) return;
    setSyncing(true);
    setSyncMsg('');
    try {
      // Make sure every regular-season week up to now has been fetched. Using each week's
      // returned data directly (not the schedule state variable) — state updates from
      // ensureSchedule don't retroactively change what this already-running function sees, so
      // reading `schedule` here would still show whatever it was when this sync started, even
      // after every fetch has actually landed.
      const weekData = {};
      for (let w = 1; w <= 18; w++) weekData[w] = await ensureSchedule(w);

      const nextWeeklyValues = { ...data.weeklyValues };
      const nextGamesRemaining = { ...(data.gamesRemaining || {}) };
      const gameCache = {};
      let updatedCount = 0;
      const now = Date.now();

      for (const leg of allLegs) {
        nextWeeklyValues[leg.id] = { ...(nextWeeklyValues[leg.id] || {}) };
        let remaining = 0;
        for (let w = 1; w <= 18; w++) {
          const games = weekData[w]?.games || [];
          const game = games.find(g => g.away.abbr === leg.team || g.home.abbr === leg.team);
          if (!game) continue; // bye week — not played, not remaining, just doesn't exist
          const started = game.completed || now >= new Date(game.kickoff).getTime();
          if (!started) { remaining++; continue; }

          if (!gameCache[game.id]) {
            try {
              const res = await fetch(`/api/playerstats?gameId=${game.id}`);
              gameCache[game.id] = await res.json();
            } catch (e) {
              gameCache[game.id] = { players: [] };
            }
          }
          const boxScore = gameCache[game.id];
          const playerRows = (boxScore.players || []).filter(p => normName(p.name) === normName(leg.player));
          if (playerRows.length === 0) continue;

          const value = Math.round(extractStat(playerRows, leg.statCategory) * 10) / 10;
          if (nextWeeklyValues[leg.id][w] !== value) {
            nextWeeklyValues[leg.id][w] = value;
            updatedCount++;
          }
        }
        nextGamesRemaining[leg.id] = remaining;
      }
      await persist({ ...data, weeklyValues: nextWeeklyValues, gamesRemaining: nextGamesRemaining, lastSyncedAt: new Date().toISOString() });
      setSyncMsg(`Synced — updated ${updatedCount} week${updatedCount === 1 ? '' : 's'} across ${allLegs.length} leg${allLegs.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setSyncMsg('Sync failed — try again in a bit.');
    } finally {
      setSyncing(false);
    }
  };

  if (adminPrompt) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center px-4">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
          .font-display { font-family: 'Anton', sans-serif; } .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; } .font-mono { font-family: 'IBM Plex Mono', monospace; }`}</style>
        <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #2A3830' }}>
          <div className="font-head text-sm uppercase tracking-wide mb-2" style={{ color: '#F0EDE4' }}>
            {adminPrompt.mode === 'set' ? 'Set the admin PIN' : 'Enter admin PIN'}
          </div>
          <div className="font-mono text-xs mb-3" style={{ color: '#8A9A90' }}>
            {adminPrompt.mode === 'set' ? 'No PIN set yet — this creates the one shared across your pools too.' : 'Same PIN you use on your pools.'}
          </div>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              inputMode="numeric"
              maxLength={8}
              value={adminPrompt.input}
              onChange={e => setAdminPrompt(p => ({ ...p, input: e.target.value.replace(/\D/g, '').slice(0, 8), error: '' }))}
              onKeyDown={e => e.key === 'Enter' && submitAdminPrompt()}
              placeholder="••••"
              className="w-24 px-2 py-1.5 rounded font-mono text-sm tracking-widest text-center"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            />
            <button onClick={submitAdminPrompt} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
              {adminPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
            </button>
          </div>
          {adminPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{adminPrompt.error}</div>}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center px-4">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
          .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; } .font-mono { font-family: 'IBM Plex Mono', monospace; }`}</style>
        <div className="w-full max-w-sm text-center">
          <div className="font-head text-lg uppercase tracking-wide mb-2" style={{ color: '#F0EDE4' }}>Private</div>
          <div className="font-mono text-xs mb-4" style={{ color: '#8A9A90' }}>This page requires the admin PIN.</div>
          <button onClick={openAdminPrompt} className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
            Enter PIN
          </button>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#E8A23D]" size={28} />
      </div>
    );
  }

  const totalLegs = data.bets.reduce((sum, b) => sum + b.legs.length, 0);

  return (
    <div style={{ background: '#0F1614', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      <div className="sticky top-0 z-20 px-5 sm:px-8 py-4" style={{ background: 'linear-gradient(180deg,#0F1614 70%,transparent)' }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="font-display uppercase" style={{ fontSize: '22px', color: '#E8A23D', letterSpacing: '1px' }}>Player Props</div>
          <button onClick={exitAdmin} className="font-mono text-[10px] uppercase underline" style={{ color: '#5C6862' }}>Log out</button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={startParlay}
            disabled={!!buildingParlay}
            className="px-3 py-2 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
            style={{ background: '#3D9B5C', color: '#0F1614', opacity: buildingParlay ? 0.5 : 1 }}
          >
            <Plus size={14} /> Add Parlay
          </button>
          <button
            onClick={syncAllBets}
            disabled={syncing || totalLegs === 0}
            className="px-3 py-2 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
            style={{ background: '#1F2B25', border: '1px solid #E8A23D66', color: '#E8A23D', opacity: syncing || totalLegs === 0 ? 0.5 : 1 }}
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync Latest Stats'}
          </button>
        </div>
        {syncMsg && <div className="font-mono text-xs" style={{ color: '#7FCB98' }}>{syncMsg}</div>}
        {data.lastSyncedAt && (
          <div className="font-mono text-[10px] -mt-4" style={{ color: '#5C6862' }}>
            Last synced {new Date(data.lastSyncedAt).toLocaleString()}
          </div>
        )}

        {buildingParlay && (
          <div className="rounded-lg p-4 space-y-3" style={{ background: '#1C2823', border: '1px solid #E8A23D66' }}>
            <div className="font-head text-sm uppercase tracking-wide" style={{ color: '#F0EDE4' }}>
              New Parlay — {buildingParlay.legs.length} leg{buildingParlay.legs.length === 1 ? '' : 's'} added
            </div>

            {buildingParlay.legs.length > 0 && (
              <div className="space-y-1.5">
                {buildingParlay.legs.map(leg => (
                  <div key={leg.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded font-mono text-xs" style={{ background: '#0F1614' }}>
                    <span style={{ color: '#F0EDE4' }}>
                      {leg.player} ({leg.team}) — {leg.direction} {leg.line} {statConfig(leg.statCategory)?.label}
                    </span>
                    <button onClick={() => removeLegFromDraft(leg.id)} style={{ color: '#5C6862' }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1" style={{ borderTop: buildingParlay.legs.length > 0 ? '1px solid #2A3830' : 'none' }}>
              <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>Add a leg</div>
              <input
                value={legDraft.player}
                onChange={e => setLegDraft(b => ({ ...b, player: e.target.value }))}
                placeholder="Player name (e.g. David Montgomery)"
                className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
              />
              <input
                value={legDraft.team}
                onChange={e => setLegDraft(b => ({ ...b, team: e.target.value }))}
                placeholder="Team abbreviation (e.g. DET)"
                className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
              />
              <select
                value={legDraft.statCategory}
                onChange={e => setLegDraft(b => ({ ...b, statCategory: e.target.value }))}
                className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
              >
                {STAT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <div className="flex gap-2">
                <select
                  value={legDraft.direction}
                  onChange={e => setLegDraft(b => ({ ...b, direction: e.target.value }))}
                  className="px-3 py-2 rounded font-mono text-sm outline-none"
                  style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
                >
                  <option value="over">Over</option>
                  <option value="under">Under</option>
                </select>
                <input
                  value={legDraft.line}
                  onChange={e => setLegDraft(b => ({ ...b, line: e.target.value }))}
                  placeholder="Line (e.g. 799.5)"
                  inputMode="decimal"
                  className="flex-1 px-3 py-2 rounded font-mono text-sm outline-none"
                  style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
                />
              </div>
              {legError && <div className="font-mono text-xs" style={{ color: '#E28A82' }}>{legError}</div>}
              <button onClick={addLegToParlay} className="w-full px-4 py-2 rounded font-head text-xs uppercase tracking-wide flex items-center justify-center gap-1.5" style={{ background: '#1F2B25', border: '1px solid #3D9B5C88', color: '#7FCB98' }}>
                <Plus size={14} /> Add This Leg
              </button>
            </div>

            <input
              value={buildingParlay.notes}
              onChange={e => setBuildingParlay(p => ({ ...p, notes: e.target.value }))}
              placeholder="Notes (optional — sportsbook, odds, stake, etc.)"
              className="w-full px-3 py-2 rounded font-mono text-xs outline-none"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={finishParlay}
                disabled={buildingParlay.legs.length === 0}
                className="px-4 py-2 rounded font-head text-xs uppercase tracking-wide"
                style={{ background: '#3D9B5C', color: '#0F1614', opacity: buildingParlay.legs.length === 0 ? 0.5 : 1 }}
              >
                Finish Parlay
              </button>
              <button onClick={cancelParlay} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {data.bets.length === 0 ? (
          <div className="font-mono text-sm text-center py-10" style={{ color: '#5C6862' }}>
            No parlays tracked yet — tap "Add Parlay" to start.
          </div>
        ) : (
          <div className="space-y-3">
            {data.bets.map(bet => {
              const legStatuses = bet.legs.map(leg => ({ leg, status: legStatus(leg, data.weeklyValues, data.gamesRemaining || {}) }));
              const anyBusted = legStatuses.some(l => l.status.busted);
              const allHit = legStatuses.every(l => l.status.hit);
              const parlayColor = anyBusted ? '#E28A82' : allHit ? '#7FCB98' : '#E8A23D';
              const parlayLabel = anyBusted ? 'Busted' : allHit ? 'All legs hit ✓' : `${legStatuses.filter(l => l.status.hit).length} of ${bet.legs.length} legs hit`;
              const isExpanded = expandedBetId === bet.id;
              const isParlay = bet.legs.length > 1;

              return (
                <div key={bet.id} className="rounded-lg overflow-hidden" style={{ background: '#1C2823', border: `1px solid ${anyBusted ? '#C1443A88' : allHit ? '#3D9B5C88' : '#2A3830'}` }}>
                  <button onClick={() => setExpandedBetId(id => id === bet.id ? null : bet.id)} className="w-full text-left px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-head text-sm uppercase tracking-wide" style={{ color: '#F0EDE4' }}>
                          {isParlay ? `Parlay — ${bet.legs.length} legs` : `${bet.legs[0].player} (${bet.legs[0].team})`}
                        </div>
                        {!isParlay && (
                          <div className="font-mono text-[10px] uppercase" style={{ color: '#8A9A90' }}>
                            {bet.legs[0].direction} {bet.legs[0].line} {statConfig(bet.legs[0].statCategory)?.label}
                          </div>
                        )}
                      </div>
                      <div className="font-head text-sm shrink-0" style={{ color: parlayColor }}>{parlayLabel}</div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 space-y-3" style={{ borderTop: '1px solid #2A3830' }}>
                      {bet.notes && <div className="font-mono text-[10px] mt-2" style={{ color: '#5C6862' }}>{bet.notes}</div>}
                      {legStatuses.map(({ leg, status }) => {
                        const cfg = statConfig(leg.statCategory);
                        const weeks = Object.entries(data.weeklyValues[leg.id] || {}).map(([w, v]) => ({ week: Number(w), value: v })).sort((a, b) => a.week - b.week);
                        const legColor = status.hit ? '#7FCB98' : status.busted ? '#E28A82' : '#E8A23D';
                        const stillLive = !status.hit && !status.busted;
                        return (
                          <div key={leg.id} className="rounded p-3" style={{ background: '#0F1614' }}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-head text-xs uppercase tracking-wide truncate" style={{ color: '#F0EDE4' }}>{leg.player} <span style={{ color: '#5C6862' }}>({leg.team})</span></div>
                                <div className="font-mono text-[9px] uppercase" style={{ color: '#8A9A90' }}>{leg.direction} {leg.line} {cfg?.label}</div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-head text-sm" style={{ color: legColor }}>
                                  {status.hit ? 'Hit ✓' : status.busted ? 'Busted' : `${status.remaining.toFixed(1)} to go`}
                                </div>
                                <div className="font-mono text-[9px]" style={{ color: '#5C6862' }}>{status.cumulative.toFixed(1)} so far</div>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#1C2823' }}>
                              <div style={{ width: `${status.pct}%`, height: '100%', background: legColor, transition: 'width 300ms ease' }} />
                            </div>
                            {stillLive && (
                              <div className="font-mono text-[9px] mt-1.5" style={{ color: '#8A9A90' }}>
                                {status.gamesLeft == null ? (
                                  'Sync to see pace needed per game'
                                ) : status.gamesLeft === 0 ? (
                                  'No games remaining this season'
                                ) : leg.direction === 'over' ? (
                                  <><span style={{ color: '#E8A23D' }}>{status.perGame.toFixed(1)}</span> {cfg?.label.toLowerCase()}/game needed — {status.gamesLeft} game{status.gamesLeft === 1 ? '' : 's'} left</>
                                ) : (
                                  <>Must average under <span style={{ color: '#E8A23D' }}>{status.perGame.toFixed(1)}</span> {cfg?.label.toLowerCase()}/game — {status.gamesLeft} game{status.gamesLeft === 1 ? '' : 's'} left</>
                                )}
                              </div>
                            )}
                            {weeks.length > 0 && (
                              <div className="space-y-1 mt-2">
                                {weeks.map(w => (
                                  <div key={w.week} className="flex items-center justify-between font-mono text-[10px] px-2 py-1 rounded" style={{ background: '#1C2823' }}>
                                    <span style={{ color: '#8A9A90' }}>Week {w.week}</span>
                                    <span style={{ color: '#F0EDE4' }}>{w.value.toFixed(1)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => removeBet(bet.id)}
                        onBlur={() => setDeleteConfirmId(null)}
                        className="font-mono text-[10px] uppercase underline flex items-center gap-1"
                        style={{ color: deleteConfirmId === bet.id ? '#E28A82' : '#5C6862' }}
                      >
                        <Trash2 size={10} /> {deleteConfirmId === bet.id ? 'Confirm delete?' : `Delete ${isParlay ? 'parlay' : 'bet'}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {saveError && (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs" style={{ background: '#1C2823', border: '1px solid #C1443A', color: '#E28A82' }}>
          Save failed — check your connection and try again.
        </div>
      )}
      {justSaved && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs" style={{ background: '#1C2823', border: '1px solid #3D9B5C', color: '#7FCB98' }}>
          <Check size={12} /> Saved
        </div>
      )}
    </div>
  );
}
