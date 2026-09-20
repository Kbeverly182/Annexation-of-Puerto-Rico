import React, { useState, useEffect } from 'react';
import { useAdminMode } from '../lib/admin';
import { apiGetPool, apiSavePool } from '../lib/api';
import { useEspnSchedule } from '../lib/espnSchedule';
import { Plus, Trash2, RefreshCw, Loader2, Check } from 'lucide-react';

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

const emptyData = () => ({ bets: [], weeklyValues: {}, gamesRemaining: {}, lastSyncedAt: null });

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

export default function PlayerProps() {
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBet, setNewBet] = useState({ player: '', team: '', statCategory: 'rushYds', line: '', direction: 'over', notes: '' });
  const [addError, setAddError] = useState('');
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
        setData(remote || emptyData());
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

  const addBet = () => {
    setAddError('');
    const player = newBet.player.trim();
    const team = newBet.team.trim().toUpperCase();
    const line = parseFloat(newBet.line);
    if (!player) { setAddError('Enter the player\'s name.'); return; }
    if (!team) { setAddError('Enter their team (e.g. DET).'); return; }
    if (isNaN(line) || line <= 0) { setAddError('Enter a valid line number.'); return; }
    const bet = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      player, team, statCategory: newBet.statCategory, line, direction: newBet.direction,
      notes: newBet.notes.trim(), createdAt: new Date().toISOString(),
    };
    persist({ ...data, bets: [...data.bets, bet] });
    setNewBet({ player: '', team: '', statCategory: 'rushYds', line: '', direction: 'over', notes: '' });
    setShowAddForm(false);
  };

  const removeBet = (id) => {
    if (deleteConfirmId !== id) { setDeleteConfirmId(id); return; }
    const nextWeeklyValues = { ...data.weeklyValues };
    delete nextWeeklyValues[id];
    persist({ ...data, bets: data.bets.filter(b => b.id !== id), weeklyValues: nextWeeklyValues });
    setDeleteConfirmId(null);
  };

  const cumulativeFor = (betId) => {
    const weeks = data.weeklyValues[betId] || {};
    return Object.values(weeks).reduce((sum, v) => sum + v, 0);
  };

  // Pulls real stats for every tracked bet's player, week by week, straight from the same
  // box-score proxy the Lineup pool already uses — self-contained here rather than sharing that
  // pool's own copy of this logic, so this page stays fully independent of anything pool-related.
  const syncAllBets = async () => {
    if (!data.bets.length) return;
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

      for (const bet of data.bets) {
        nextWeeklyValues[bet.id] = { ...(nextWeeklyValues[bet.id] || {}) };
        let remaining = 0;
        for (let w = 1; w <= 18; w++) {
          const games = weekData[w]?.games || [];
          const game = games.find(g => g.away.abbr === bet.team || g.home.abbr === bet.team);
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
          const playerRows = (boxScore.players || []).filter(p => normName(p.name) === normName(bet.player));
          if (playerRows.length === 0) continue;

          const value = Math.round(extractStat(playerRows, bet.statCategory) * 10) / 10;
          if (nextWeeklyValues[bet.id][w] !== value) {
            nextWeeklyValues[bet.id][w] = value;
            updatedCount++;
          }
        }
        nextGamesRemaining[bet.id] = remaining;
      }
      await persist({ ...data, weeklyValues: nextWeeklyValues, gamesRemaining: nextGamesRemaining, lastSyncedAt: new Date().toISOString() });
      setSyncMsg(`Synced — updated ${updatedCount} week${updatedCount === 1 ? '' : 's'} across ${data.bets.length} bet${data.bets.length === 1 ? '' : 's'}.`);
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
            onClick={() => setShowAddForm(v => !v)}
            className="px-3 py-2 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
            style={{ background: '#3D9B5C', color: '#0F1614' }}
          >
            <Plus size={14} /> Add Bet
          </button>
          <button
            onClick={syncAllBets}
            disabled={syncing || data.bets.length === 0}
            className="px-3 py-2 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
            style={{ background: '#1F2B25', border: '1px solid #E8A23D66', color: '#E8A23D', opacity: syncing || data.bets.length === 0 ? 0.5 : 1 }}
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

        {showAddForm && (
          <div className="rounded-lg p-4 space-y-2.5" style={{ background: '#1C2823', border: '1px solid #2A3830' }}>
            <div className="font-head text-sm uppercase tracking-wide mb-1" style={{ color: '#F0EDE4' }}>New Bet</div>
            <input
              value={newBet.player}
              onChange={e => setNewBet(b => ({ ...b, player: e.target.value }))}
              placeholder="Player name (e.g. David Montgomery)"
              className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            />
            <input
              value={newBet.team}
              onChange={e => setNewBet(b => ({ ...b, team: e.target.value }))}
              placeholder="Team abbreviation (e.g. DET)"
              className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            />
            <select
              value={newBet.statCategory}
              onChange={e => setNewBet(b => ({ ...b, statCategory: e.target.value }))}
              className="w-full px-3 py-2 rounded font-mono text-sm outline-none"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            >
              {STAT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <div className="flex gap-2">
              <select
                value={newBet.direction}
                onChange={e => setNewBet(b => ({ ...b, direction: e.target.value }))}
                className="px-3 py-2 rounded font-mono text-sm outline-none"
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
              >
                <option value="over">Over</option>
                <option value="under">Under</option>
              </select>
              <input
                value={newBet.line}
                onChange={e => setNewBet(b => ({ ...b, line: e.target.value }))}
                placeholder="Line (e.g. 799.5)"
                inputMode="decimal"
                className="flex-1 px-3 py-2 rounded font-mono text-sm outline-none"
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
              />
            </div>
            <input
              value={newBet.notes}
              onChange={e => setNewBet(b => ({ ...b, notes: e.target.value }))}
              placeholder="Notes (optional — sportsbook, odds, etc.)"
              className="w-full px-3 py-2 rounded font-mono text-xs outline-none"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', fontSize: '16px' }}
            />
            {addError && <div className="font-mono text-xs" style={{ color: '#E28A82' }}>{addError}</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={addBet} className="px-4 py-2 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#3D9B5C', color: '#0F1614' }}>
                Save Bet
              </button>
              <button onClick={() => { setShowAddForm(false); setAddError(''); }} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {data.bets.length === 0 ? (
          <div className="font-mono text-sm text-center py-10" style={{ color: '#5C6862' }}>
            No bets tracked yet — tap "Add Bet" to start.
          </div>
        ) : (
          <div className="space-y-3">
            {data.bets.map(bet => {
              const cfg = statConfig(bet.statCategory);
              const cumulative = cumulativeFor(bet.id);
              const remaining = bet.line - cumulative;
              const hit = bet.direction === 'over' ? cumulative >= bet.line : null; // "under" only resolves at season end, not mid-stream
              const busted = bet.direction === 'under' && cumulative > bet.line;
              const pct = Math.min(100, Math.round((cumulative / bet.line) * 100));
              const weeks = Object.entries(data.weeklyValues[bet.id] || {})
                .map(([w, v]) => ({ week: Number(w), value: v }))
                .sort((a, b) => a.week - b.week);
              const isExpanded = expandedBetId === bet.id;
              const statusColor = hit ? '#7FCB98' : busted ? '#E28A82' : '#E8A23D';
              const stillLive = !hit && !busted;
              const gamesLeft = data.gamesRemaining?.[bet.id];
              const perGame = gamesLeft > 0 ? remaining / gamesLeft : null;

              return (
                <div key={bet.id} className="rounded-lg overflow-hidden" style={{ background: '#1C2823', border: `1px solid ${hit ? '#3D9B5C88' : busted ? '#C1443A88' : '#2A3830'}` }}>
                  <button onClick={() => setExpandedBetId(id => id === bet.id ? null : bet.id)} className="w-full text-left px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-head text-sm uppercase tracking-wide truncate" style={{ color: '#F0EDE4' }}>{bet.player} <span style={{ color: '#5C6862' }}>({bet.team})</span></div>
                        <div className="font-mono text-[10px] uppercase" style={{ color: '#8A9A90' }}>
                          {bet.direction} {bet.line} {cfg?.label}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-head text-base" style={{ color: statusColor }}>
                          {hit ? 'Hit ✓' : busted ? 'Busted' : `${remaining.toFixed(1)} to go`}
                        </div>
                        <div className="font-mono text-[10px]" style={{ color: '#5C6862' }}>{cumulative.toFixed(1)} so far</div>
                      </div>
                    </div>
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: '#0F1614' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: statusColor, transition: 'width 300ms ease' }} />
                    </div>
                    {stillLive && (
                      <div className="font-mono text-[10px] mt-1.5" style={{ color: '#8A9A90' }}>
                        {gamesLeft == null ? (
                          'Sync to see pace needed per game'
                        ) : gamesLeft === 0 ? (
                          'No games remaining this season'
                        ) : bet.direction === 'over' ? (
                          <><span style={{ color: '#E8A23D' }}>{perGame.toFixed(1)}</span> {cfg?.label.toLowerCase()}/game needed — {gamesLeft} game{gamesLeft === 1 ? '' : 's'} left</>
                        ) : (
                          <>Must average under <span style={{ color: '#E8A23D' }}>{perGame.toFixed(1)}</span> {cfg?.label.toLowerCase()}/game — {gamesLeft} game{gamesLeft === 1 ? '' : 's'} left</>
                        )}
                      </div>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1" style={{ borderTop: '1px solid #2A3830' }}>
                      {bet.notes && <div className="font-mono text-[10px] mb-2 mt-2" style={{ color: '#5C6862' }}>{bet.notes}</div>}
                      {weeks.length === 0 ? (
                        <div className="font-mono text-[10px] py-2" style={{ color: '#5C6862' }}>No weeks synced yet.</div>
                      ) : (
                        <div className="space-y-1 mt-2">
                          {weeks.map(w => (
                            <div key={w.week} className="flex items-center justify-between font-mono text-xs px-2 py-1 rounded" style={{ background: '#0F1614' }}>
                              <span style={{ color: '#8A9A90' }}>Week {w.week}</span>
                              <span style={{ color: '#F0EDE4' }}>{w.value.toFixed(1)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => removeBet(bet.id)}
                        onBlur={() => setDeleteConfirmId(null)}
                        className="mt-3 font-mono text-[10px] uppercase underline flex items-center gap-1"
                        style={{ color: deleteConfirmId === bet.id ? '#E28A82' : '#5C6862' }}
                      >
                        <Trash2 size={10} /> {deleteConfirmId === bet.id ? 'Confirm delete?' : 'Delete bet'}
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
