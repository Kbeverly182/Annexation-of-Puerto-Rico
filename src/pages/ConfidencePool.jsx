import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, ChevronLeft, ChevronRight, Users, Loader2, RefreshCw, AlertCircle, Lock, UserCircle, ArrowLeft, ListOrdered, Trophy } from 'lucide-react';
import { WEEKS } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool } from '../lib/api';
import { useEspnSchedule, fetchWeekResults } from '../lib/espnSchedule';

const POOL_KEY = 'confidence-pool-v1';
const IDENTITY_KEY = 'my-participant-id-confidence';
const POLL_MS = 15000;

const emptyData = () => ({ name: 'Confidence Pool', participants: [], picks: {}, results: {}, currentWeek: 1 });

export default function ConfidencePool() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [viewWeek, setViewWeek] = useState(1);
  const [newName, setNewName] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const saveTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const { schedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);

  useEffect(() => {
    (async () => {
      try {
        const remote = await apiGetPool(POOL_KEY);
        const parsed = remote || emptyData();
        setData(parsed);
        setViewWeek(parsed.currentWeek || 1);
      } catch (e) {
        setData(emptyData());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(IDENTITY_KEY);
      if (stored) setMyId(stored);
    } catch (e) { /* ignore */ }
    finally { setMyIdLoaded(true); }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      if (skipNextPoll.current) { skipNextPoll.current = false; return; }
      try {
        const remote = await apiGetPool(POOL_KEY);
        if (remote) setData(remote);
      } catch (e) { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  if (loading || !data) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#E8A23D]" size={28} />
      </div>
    );
  }

  const persist = (next) => {
    setData(next);
    skipNextPoll.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiSavePool(POOL_KEY, next);
        setSaveError(false);
      } catch (e) {
        setSaveError(true);
      }
    }, 250);
  };

  const addParticipant = () => {
    const name = newName.trim();
    if (!name) return;
    persist({ ...data, participants: [...data.participants, { id: uid(), name, pin: null }] });
    setNewName('');
  };
  const removeParticipant = (id) => {
    const next = { ...data, participants: data.participants.filter(p => p.id !== id) };
    for (const w of WEEKS) { if (next.picks[w]) delete next.picks[w][id]; }
    persist(next);
  };
  const setCurrentWeek = (w) => persist({ ...data, currentWeek: w });
  const saveTitle = () => {
    const t = titleDraft.trim() || 'Confidence Pool';
    persist({ ...data, name: t });
    setEditingTitle(false);
  };

  const chooseMe = (id) => {
    setMyId(id);
    try { localStorage.setItem(IDENTITY_KEY, id); } catch (e) { /* non-fatal */ }
  };
  const forgetMe = () => {
    setMyId(null);
    try { localStorage.removeItem(IDENTITY_KEY); } catch (e) { /* non-fatal */ }
  };
  const handleNameTap = (p) => {
    setClaimPrompt({ participantId: p.id, mode: p.pin ? 'enter' : 'set', input: '', error: '' });
  };
  const submitClaim = () => {
    if (!claimPrompt) return;
    const { participantId, mode, input } = claimPrompt;
    if (!/^\d{4}$/.test(input)) {
      setClaimPrompt(c => ({ ...c, error: 'PIN must be 4 digits', input: '' }));
      return;
    }
    const participant = data.participants.find(p => p.id === participantId);
    if (!participant) { setClaimPrompt(null); return; }
    const hashed = hashPin(input);
    if (mode === 'set') {
      persist({ ...data, participants: data.participants.map(p => p.id === participantId ? { ...p, pin: hashed } : p) });
      chooseMe(participantId);
      setClaimPrompt(null);
    } else if (hashed === participant.pin) {
      chooseMe(participantId);
      setClaimPrompt(null);
    } else {
      setClaimPrompt(c => ({ ...c, error: 'Wrong PIN', input: '' }));
    }
  };
  const resetPin = (id) => {
    if (resetConfirmId !== id) { setResetConfirmId(id); return; }
    persist({ ...data, participants: data.participants.map(p => p.id === id ? { ...p, pin: null } : p) });
    setResetConfirmId(null);
  };

  const isPickLocked = (week, team) => {
    const lockTime = lockTimeForPick(week, team);
    return lockTime !== null && now >= lockTime;
  };
  const weekLocked = isPickLocked(viewWeek, undefined);
  const isRevealed = (pid) => {
    if (myId && pid === myId) return true;
    return weekLocked;
  };

  const games = schedule[viewWeek]?.games || [];
  const maxConfidence = games.length;

  const setGamePick = (week, pid, gameId, field, value) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    next.picks[week][pid] = { ...(next.picks[week][pid] || {}) };
    const prev = next.picks[week][pid][gameId] || {};
    next.picks[week][pid][gameId] = { ...prev, [field]: value };
    persist(next);
  };

  const usedConfidence = (pid, week, excludeGameId) => {
    const wk = data.picks[week]?.[pid] || {};
    const used = new Set();
    Object.entries(wk).forEach(([gid, pk]) => {
      if (gid !== excludeGameId && pk?.confidence) used.add(pk.confidence);
    });
    return used;
  };

  const syncResults = async (week) => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { gameResults, completedGames } = await fetchWeekResults(week, seasonYear);
      if (completedGames === 0) {
        setSyncMsg(`No finished games yet for week ${week} — try again after kickoff.`);
        return;
      }
      const next = { ...data, results: { ...data.results, [week]: { ...(data.results?.[week] || {}), ...gameResults } } };
      persist(next);
      setSyncMsg(`Synced ${completedGames} finished game${completedGames === 1 ? '' : 's'} for week ${week}.`);
    } catch (e) {
      setSyncMsg('Could not reach the ESPN score feed.');
    } finally {
      setSyncing(false);
    }
  };

  // Season point total for a participant
  const seasonTotal = (pid) => {
    let total = 0;
    for (const w of WEEKS) {
      const weekPicks = data.picks[w]?.[pid] || {};
      const weekResults = data.results?.[w] || {};
      Object.entries(weekPicks).forEach(([gid, pk]) => {
        const res = weekResults[gid];
        if (res?.completed && pk?.winner && pk?.confidence) {
          if (res.winnerAbbr === pk.winner) total += pk.confidence;
        }
      });
    }
    return total;
  };

  const leaderboard = [...data.participants]
    .map(p => ({ ...p, total: seasonTotal(p.id) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ background: '#0F1614', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Oswald', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #3A4A42; border-radius: 4px; }
        select { color-scheme: dark; }
      `}</style>

      <div style={{ background: 'linear-gradient(180deg,#17211D,#0F1614)', borderBottom: '1px solid #2A3830' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto mb-3">
          <Link to="/" className="font-mono text-xs flex items-center gap-1.5 w-fit" style={{ color: '#8A9A90' }}>
            <ArrowLeft size={12} /> All Pools
          </Link>
        </div>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: '#E8A23D22', border: '2px solid #E8A23D' }}>
              <ListOrdered size={20} color="#E8A23D" />
            </div>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => e.key === 'Enter' && saveTitle()}
                className="font-head text-xl sm:text-2xl bg-transparent border-b outline-none min-w-0"
                style={{ borderColor: '#E8A23D', color: '#F0EDE4' }}
              />
            ) : (
              <button
                onClick={() => { setTitleDraft(data.name); setEditingTitle(true); }}
                className="font-head text-xl sm:text-2xl tracking-wide flex items-center gap-2 min-w-0 text-left"
              >
                <span className="truncate uppercase">{data.name}</span>
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#8A9A90' }}>Current Week</div>
            <div className="font-display text-3xl leading-none" style={{ color: '#E8A23D', letterSpacing: '1px' }}>
              {String(data.currentWeek).padStart(2, '0')}<span style={{ color: '#5C6862', fontSize: '0.5em' }}> / 18</span>
            </div>
          </div>
        </div>
        {saveError && (
          <div className="max-w-5xl mx-auto mt-3 font-mono text-xs px-3 py-1.5 rounded" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82', width: 'fit-content' }}>
            Sync failed — retrying
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 space-y-8">

        {/* Add participant */}
        <div>
          <div className="font-head uppercase text-sm tracking-widest mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
            <Users size={14} /> Entrants
          </div>
          <div className="flex gap-2 mb-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addParticipant()}
              placeholder="Add a name…"
              className="flex-1 px-3 py-2 rounded outline-none font-head text-sm"
              style={{ background: '#1F2B25', border: '1px solid #2A3830', color: '#F0EDE4' }}
            />
            <button
              onClick={addParticipant}
              className="px-4 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1"
              style={{ background: '#E8A23D', color: '#0F1614' }}
            >
              <Plus size={16} /> Add
            </button>
          </div>
          {data.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.participants.map(p => (
                <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs" style={{ background: '#17211D', border: '1px solid #2A3830', color: '#8A9A90' }}>
                  {p.pin ? <Lock size={10} color="#E8A23D" /> : <Lock size={10} color="#3A4A42" />}
                  {p.name}
                  {p.pin && (
                    <button onClick={() => resetPin(p.id)} className="underline" style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}>
                      {resetConfirmId === p.id ? 'Confirm reset?' : 'Reset PIN'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {data.participants.length === 0 ? (
          <div className="text-center py-16 font-head uppercase tracking-wide" style={{ color: '#5C6862' }}>
            Add your first entrant to kick off the pool
          </div>
        ) : (
          <>
            {/* Identity banner */}
            {myIdLoaded && (
              myId && data.participants.some(p => p.id === myId) ? (
                <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', color: '#8A9A90' }}>
                  <UserCircle size={14} color="#E8A23D" />
                  You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                  <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
                </div>
              ) : claimPrompt ? (
                <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830' }}>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8A9A90' }}>
                    {claimPrompt.mode === 'set'
                      ? <>Set a 4-digit PIN for <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === claimPrompt.participantId)?.name}</span>.</>
                      : <>Enter the PIN for <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === claimPrompt.participantId)?.name}</span>.</>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      inputMode="numeric"
                      maxLength={4}
                      value={claimPrompt.input}
                      onChange={e => setClaimPrompt(c => ({ ...c, input: e.target.value.replace(/\D/g, '').slice(0, 4), error: '' }))}
                      onKeyDown={e => e.key === 'Enter' && submitClaim()}
                      placeholder="••••"
                      className="w-20 px-2 py-1.5 rounded font-mono text-sm tracking-widest text-center"
                      style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                    />
                    <button onClick={submitClaim} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
                      {claimPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
                    </button>
                    <button onClick={() => setClaimPrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
                  </div>
                  {claimPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{claimPrompt.error}</div>}
                </div>
              ) : (
                <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830' }}>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8A9A90' }}>Which entrant are you?</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map(p => (
                      <button key={p.id} onClick={() => handleNameTap(p)} className="px-2.5 py-1 rounded font-head text-xs uppercase flex items-center gap-1" style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}>
                        {p.pin && <Lock size={10} color="#E8A23D" />}
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* Week tabs */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => setViewWeek(w => Math.max(1, w - 1))} className="p-1 rounded" style={{ color: '#8A9A90' }}><ChevronLeft size={18} /></button>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {WEEKS.map(w => (
                    <button
                      key={w}
                      onClick={() => setViewWeek(w)}
                      className="shrink-0 w-9 h-9 rounded font-mono text-sm flex items-center justify-center"
                      style={{
                        background: w === viewWeek ? '#E8A23D' : '#1F2B25',
                        color: w === viewWeek ? '#0F1614' : '#8A9A90',
                        border: w === data.currentWeek ? '1px solid #E8A23D' : '1px solid #2A3830',
                        fontWeight: w === viewWeek ? 700 : 400,
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <button onClick={() => setViewWeek(w => Math.min(18, w + 1))} className="p-1 rounded" style={{ color: '#8A9A90' }}><ChevronRight size={18} /></button>
              </div>
              {viewWeek !== data.currentWeek && (
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#E8A23D' }}>
                  Set week {viewWeek} as current week
                </button>
              )}
            </div>

            {/* Sync + status */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-head uppercase text-sm tracking-widest" style={{ color: '#8A9A90' }}>
                Week {viewWeek} — {games.length} games, {maxConfidence} pts max
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-xs flex items-center gap-1" style={{ color: '#5C6862' }}>
                  Season
                  <input type="number" value={seasonYear} onChange={e => setSeasonYear(Number(e.target.value))} className="w-16 px-1.5 py-1 rounded font-mono text-xs" style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }} />
                </label>
                <button
                  onClick={() => syncResults(viewWeek)}
                  disabled={syncing}
                  className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
                  style={{ background: '#1F2B25', border: '1px solid #E8A23D', color: '#E8A23D', opacity: syncing ? 0.6 : 1 }}
                >
                  <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing…' : `Sync week ${viewWeek} results`}
                </button>
              </div>
            </div>
            {syncMsg && (
              <div className="font-mono text-xs flex items-start gap-1.5 -mt-4" style={{ color: '#E8A23D' }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {syncMsg}
              </div>
            )}

            {/* Picks for viewing/editing */}
            <div className="space-y-4">
              {data.participants.map(p => {
                const isMe = myId === p.id;
                const revealed = isRevealed(p.id);
                const weekPicks = data.picks[viewWeek]?.[p.id] || {};
                const total = seasonTotal(p.id);
                return (
                  <div key={p.id} className="rounded px-4 py-3" style={{ background: '#17211D', border: isMe ? '1px solid #E8A23D88' : '1px solid #2A3830' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-head text-sm">{p.name}</div>
                      <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>Season: {total} pts</div>
                    </div>
                    {!revealed ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs uppercase" style={{ color: '#5C6862' }}>
                        <Lock size={12} /> Hidden until the week locks
                      </div>
                    ) : games.length === 0 ? (
                      <div className="font-mono text-xs" style={{ color: '#5C6862' }}>Loading matchups…</div>
                    ) : (
                      <div className="space-y-1.5">
                        {games.map(g => {
                          const pick = weekPicks[g.id] || {};
                          const gameLocked = isPickLocked(viewWeek, undefined) || isPickLocked(viewWeek, g.away.abbr) || isPickLocked(viewWeek, g.home.abbr);
                          const used = usedConfidence(p.id, viewWeek, g.id);
                          const result = data.results?.[viewWeek]?.[g.id];
                          const correct = result?.completed && pick.winner && pick.confidence && result.winnerAbbr === pick.winner;
                          const wrong = result?.completed && pick.winner && pick.confidence && result.winnerAbbr !== pick.winner;
                          return (
                            <div key={g.id} className="flex items-center gap-2 flex-wrap font-mono text-xs">
                              <button
                                onClick={() => setGamePick(viewWeek, p.id, g.id, 'winner', g.away.abbr)}
                                disabled={gameLocked}
                                className="px-2 py-1 rounded"
                                style={{
                                  background: pick.winner === g.away.abbr ? '#E8A23D' : '#0F1614',
                                  color: pick.winner === g.away.abbr ? '#0F1614' : '#F0EDE4',
                                  border: '1px solid #2A3830',
                                }}
                              >
                                {g.away.abbr}
                              </button>
                              <span style={{ color: '#5C6862' }}>@</span>
                              <button
                                onClick={() => setGamePick(viewWeek, p.id, g.id, 'winner', g.home.abbr)}
                                disabled={gameLocked}
                                className="px-2 py-1 rounded"
                                style={{
                                  background: pick.winner === g.home.abbr ? '#E8A23D' : '#0F1614',
                                  color: pick.winner === g.home.abbr ? '#0F1614' : '#F0EDE4',
                                  border: '1px solid #2A3830',
                                }}
                              >
                                {g.home.abbr}
                              </button>
                              <select
                                value={pick.confidence || ''}
                                onChange={e => setGamePick(viewWeek, p.id, g.id, 'confidence', Number(e.target.value))}
                                disabled={gameLocked}
                                className="px-1.5 py-1 rounded"
                                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                              >
                                <option value="">pts</option>
                                {Array.from({ length: maxConfidence }, (_, i) => i + 1).map(n => (
                                  <option key={n} value={n} disabled={used.has(n)}>{n}</option>
                                ))}
                              </select>
                              {correct && <span style={{ color: '#7FCB98' }}>✓ +{pick.confidence}</span>}
                              {wrong && <span style={{ color: '#E28A82' }}>✗ 0</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={() => removeParticipant(p.id)} className="mt-2 font-mono text-[10px] underline" style={{ color: '#5C6862' }}>
                      Remove entrant
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Leaderboard */}
            <div>
              <div className="font-head uppercase text-sm tracking-widest mb-3 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                <Trophy size={14} /> Season Leaderboard
              </div>
              <div className="space-y-1.5">
                {leaderboard.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 rounded px-3 py-2" style={{ background: '#17211D', border: '1px solid #2A3830' }}>
                    <div className="font-mono text-xs w-6" style={{ color: '#5C6862' }}>{i + 1}</div>
                    <div className="font-head text-sm flex-1">{p.name}</div>
                    <div className="font-mono text-sm" style={{ color: '#E8A23D' }}>{p.total} pts</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
