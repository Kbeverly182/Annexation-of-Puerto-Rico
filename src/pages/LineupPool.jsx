import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, Users, Loader2, Lock, UserCircle, ArrowLeft, Trophy, Check, AlertTriangle } from 'lucide-react';
import { TEAMS, TEAM_MAP, WEEKS } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool, mergePoolData } from '../lib/api';
import { useEspnSchedule } from '../lib/espnSchedule';
import { useNflRosters } from '../lib/rosters';

const POOL_KEY = 'lineup-pool-v1';
const IDENTITY_KEY = 'my-participant-id-lineup';
const POLL_MS = 15000;

const SLOTS = [
  { key: 'QB', label: 'QB', position: 'QB' },
  { key: 'RB1', label: 'RB', position: 'RB' },
  { key: 'RB2', label: 'RB', position: 'RB' },
  { key: 'WR1', label: 'WR', position: 'WR' },
  { key: 'WR2', label: 'WR', position: 'WR' },
  { key: 'TE', label: 'TE', position: 'TE' },
  { key: 'K', label: 'K', position: 'K' },
  { key: 'DST', label: 'D/ST', position: 'DST' },
];

const emptyData = () => ({ name: "Where's The Beef? - Lineup Pick'em", participants: [], picks: {}, playerScores: {}, currentWeek: 1 });

const lastNameOf = (fullName) => {
  const parts = (fullName || '').trim().split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase();
};

export default function LineupPool() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [viewWeek, setViewWeek] = useState(1);
  const [newName, setNewName] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [playerSearch, setPlayerSearch] = useState({}); // { `${pid}-${slotKey}`: searchText }
  const [openCombo, setOpenCombo] = useState(null); // which slot's suggestion list is open
  const [statsDebug, setStatsDebug] = useState(null);
  const [statsDebugLoading, setStatsDebugLoading] = useState(false);
  const [statsDebugFilter, setStatsDebugFilter] = useState('');
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const { schedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);
  const { rosters, loading: rostersLoading, progress: rostersProgress, missingTeams, retry: retryRosters } = useNflRosters();

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
        const remote = await apiGetPool(POOL_KEY).catch(() => null);
        const merged = mergePoolData(next, remote);
        await apiSavePool(POOL_KEY, merged);
        setData(merged);
        setSaveError(false);
        setJustSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), 1500);
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
    const t = titleDraft.trim() || "Lineup Pick'em";
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
    const resetterName = myId ? data.participants.find(x => x.id === myId)?.name : null;
    persist({
      ...data,
      participants: data.participants.map(p => p.id === id
        ? { ...p, pin: null, lastPinReset: { byName: resetterName || 'an unclaimed device', at: new Date().toISOString() } }
        : p),
    });
    setResetConfirmId(null);
  };

  const games = schedule[viewWeek]?.games || [];
  const teamsPlayingThisWeek = new Set(games.flatMap(g => [g.away.abbr, g.home.abbr]));
  const rosterById = Object.fromEntries(rosters.map(r => [r.id, r]));

  const slotTeamAbbr = (value, position) => {
    if (!value) return null;
    if (position === 'DST') return value;
    return rosterById[value]?.team || null;
  };
  const isSlotLocked = (position, value) => {
    const team = slotTeamAbbr(value, position);
    if (!team) return false;
    const lockTime = lockTimeForPick(viewWeek, team);
    return lockTime !== null && now >= lockTime;
  };
  const isPickRevealed = (pid) => {
    if (myId && pid === myId) return true;
    const weekPicks = data.picks[viewWeek]?.[pid] || {};
    const filled = SLOTS.filter(s => weekPicks[s.key]);
    if (filled.length === 0) return false;
    return filled.every(s => isSlotLocked(s.position, weekPicks[s.key]));
  };

  const usedByParticipant = (pid, excludeWeek, excludeSlotKey) => {
    const used = new Set();
    for (const w of WEEKS) {
      const weekPicks = data.picks[w]?.[pid];
      if (!weekPicks) continue;
      SLOTS.forEach(s => {
        if (w === excludeWeek && s.key === excludeSlotKey) return;
        if (weekPicks[s.key]) used.add(weekPicks[s.key]);
      });
    }
    return used;
  };

  const setSlot = (week, pid, slotKey, value) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prev = next.picks[week][pid] || {};
    next.picks[week][pid] = { ...prev, [slotKey]: value };
    persist(next);
  };

  const setPlayerScore = (week, playerKey, value) => {
    const next = { ...data, playerScores: { ...data.playerScores } };
    next.playerScores[week] = { ...(next.playerScores[week] || {}), [playerKey]: value === '' ? undefined : Number(value) };
    persist(next);
  };

  const playerLabel = (value, position) => {
    if (!value) return '';
    if (position === 'DST') return `${value} D/ST`;
    const p = rosterById[value];
    return p ? `${p.name} (${p.team})` : value;
  };

  const seasonTotal = (pid) => {
    let total = 0;
    for (const w of WEEKS) {
      const weekPicks = data.picks[w]?.[pid];
      if (!weekPicks) continue;
      SLOTS.forEach(s => {
        const val = weekPicks[s.key];
        if (val && data.playerScores?.[w]?.[val] != null) total += data.playerScores[w][val];
      });
    }
    return total;
  };

  const leaderboard = [...data.participants]
    .map(p => ({ ...p, total: seasonTotal(p.id) }))
    .sort((a, b) => b.total - a.total);

  const pickedThisWeek = new Map();
  data.participants.forEach(p => {
    const weekPicks = data.picks[viewWeek]?.[p.id] || {};
    SLOTS.forEach(s => {
      const val = weekPicks[s.key];
      if (val && !pickedThisWeek.has(val)) {
        pickedThisWeek.set(val, { label: playerLabel(val, s.position), position: s.position });
      }
    });
  });

  const testPlayerStatsSync = async () => {
    setStatsDebugLoading(true);
    setStatsDebug(null);
    try {
      // Test against whatever's actually been played — preseason first (that's what exists
      // right now), falling back to the pool's regular-season week once real games exist there.
      const candidates = [
        { label: 'Preseason Week 1', seasontype: 1, week: 1 },
        { label: 'Preseason Week 2', seasontype: 1, week: 2 },
        { label: `Regular Season Week ${viewWeek}`, seasontype: 2, week: viewWeek },
      ];
      let completedGames = [];
      let sourceLabel = '';
      for (const c of candidates) {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${c.seasontype}&week=${c.week}&dates=${seasonYear}`);
        const json = await res.json();
        const found = (json.events || []).filter(ev => ev.competitions?.[0]?.status?.type?.completed);
        if (found.length > 0) {
          completedGames = found;
          sourceLabel = c.label;
          break;
        }
      }

      if (completedGames.length === 0) {
        setStatsDebug([{ gameId: '—', matchup: 'No completed games found yet', ok: false, error: 'Checked preseason weeks 1-2 and this pool\'s current week — none have finished. Try again once a game has actually been played.' }]);
        return;
      }

      const results = [];
      for (const ev of completedGames.slice(0, 3)) {
        const comp = ev.competitions[0];
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const home = comp.competitors.find(c => c.homeAway === 'home');
        const matchup = `${sourceLabel}: ${away?.team?.abbreviation} @ ${home?.team?.abbreviation}`;
        try {
          const res = await fetch(`/api/playerstats?gameId=${ev.id}`);
          const json = await res.json();
          results.push({ gameId: ev.id, matchup, ...json });
        } catch (e) {
          results.push({ gameId: ev.id, matchup, ok: false, error: String(e) });
        }
      }
      setStatsDebug(results);
    } catch (e) {
      setStatsDebug([{ gameId: '—', matchup: 'Lookup failed', ok: false, error: String(e) }]);
    } finally {
      setStatsDebugLoading(false);
    }
  };

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
            <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: '#5C686222', border: '2px solid #8A9A90' }}>
              <Users size={20} color="#8A9A90" />
            </div>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => e.key === 'Enter' && saveTitle()}
                className="font-head text-xl sm:text-2xl bg-transparent border-b outline-none min-w-0"
                style={{ borderColor: '#8A9A90', color: '#F0EDE4' }}
              />
            ) : (
              <button
                onClick={() => { setTitleDraft(data.name); setEditingTitle(true); }}
                className="font-head text-lg sm:text-xl tracking-wide flex items-center gap-2 min-w-0 text-left"
              >
                <span className="truncate uppercase">{data.name}</span>
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#8A9A90' }}>Current Week</div>
            <div className="font-display text-3xl leading-none" style={{ color: '#8A9A90', letterSpacing: '1px' }}>
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
              style={{ background: '#8A9A90', color: '#0F1614' }}
            >
              <Plus size={16} /> Add
            </button>
          </div>
          {data.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.participants.map(p => (
                <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs" style={{ background: '#17211D', border: '1px solid #2A3830', color: '#8A9A90' }}>
                  {p.pin ? <Lock size={10} color="#7FCB98" /> : <Lock size={10} color="#3A4A42" />}
                  {p.name}
                  {p.pin && (
                    <button onClick={() => resetPin(p.id)} className="underline" style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}>
                      {resetConfirmId === p.id ? 'Confirm reset?' : 'Reset PIN'}
                    </button>
                  )}
                  {p.lastPinReset && (
                    <span title={new Date(p.lastPinReset.at).toLocaleString()} style={{ color: '#5C6862', fontSize: '9px' }}>
                      (reset by {p.lastPinReset.byName}, {new Date(p.lastPinReset.at).toLocaleDateString()})
                    </span>
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
                  <UserCircle size={14} color="#7FCB98" />
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
                    <button onClick={submitClaim} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#8A9A90', color: '#0F1614' }}>
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
                        {p.pin && <Lock size={10} color="#7FCB98" />}
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
                        background: w === viewWeek ? '#8A9A90' : '#1F2B25',
                        color: w === viewWeek ? '#0F1614' : '#8A9A90',
                        border: w === data.currentWeek ? '1px solid #8A9A90' : '1px solid #2A3830',
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
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#8A9A90' }}>
                  Set week {viewWeek} as current week
                </button>
              )}
              {rostersLoading && (
                <div className="font-mono text-xs mt-2 flex items-center gap-1.5" style={{ color: '#5C6862' }}>
                  <Loader2 size={10} className="animate-spin" /> Loading player rosters ({rostersProgress.loaded}/{rostersProgress.total} teams)…
                </div>
              )}
              {!rostersLoading && missingTeams.length > 0 && (
                <div className="font-mono text-xs mt-2 flex items-center gap-2 flex-wrap" style={{ color: '#E28A82' }}>
                  <AlertTriangle size={12} />
                  Couldn't load rosters for: {missingTeams.join(', ')} — those players won't show up in search yet.
                  <button onClick={retryRosters} className="underline" style={{ color: '#E8A23D' }}>Retry</button>
                </div>
              )}
            </div>

            {/* Lineups */}
            <div className="space-y-4">
              {data.participants.map(p => {
                const isMe = myId === p.id;
                const revealed = isPickRevealed(p.id);
                const weekPicks = data.picks[viewWeek]?.[p.id] || {};
                const total = seasonTotal(p.id);
                return (
                  <div key={p.id} className="rounded px-4 py-3" style={{ background: '#17211D', border: isMe ? '1px solid #8A9A9088' : '1px solid #2A3830' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-head text-sm">{p.name}</div>
                      <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>Season: {total} pts</div>
                    </div>
                    {!revealed ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs uppercase" style={{ color: '#5C6862' }}>
                        <Lock size={12} /> Hidden until kickoff
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {SLOTS.map(s => {
                          const value = weekPicks[s.key];
                          const locked = isSlotLocked(s.position, value);
                          const used = usedByParticipant(p.id, viewWeek, s.key);
                          const searchKey = `${p.id}-${s.key}`;
                          const searchText = playerSearch[searchKey] || '';
                          const options = s.position === 'DST'
                            ? TEAMS
                              .filter(([abbr]) => teamsPlayingThisWeek.has(abbr) && !used.has(abbr))
                              .map(([abbr]) => ({ value: abbr, label: `${abbr} — ${TEAM_MAP[abbr]}` }))
                              .sort((a, b) => a.label.localeCompare(b.label))
                            : rosters
                              .filter(r => r.position === s.position && teamsPlayingThisWeek.has(r.team) && !used.has(r.id))
                              .filter(r => !searchText || r.name.toLowerCase().includes(searchText.toLowerCase()))
                              .sort((a, b) => lastNameOf(a.name).localeCompare(lastNameOf(b.name)))
                              .map(r => ({ value: r.id, label: `${r.name} (${r.team})` }));
                          return (
                            <div key={s.key} className="flex items-center gap-2 font-mono text-xs">
                              <span className="w-9 shrink-0 font-head" style={{ color: '#8A9A90' }}>{s.label}</span>
                              {locked ? (
                                <span className="flex-1 flex items-center gap-1.5" style={{ color: '#F0EDE4' }}>
                                  <Lock size={10} color="#5C6862" /> {value ? playerLabel(value, s.position) : '— no pick —'}
                                </span>
                              ) : s.position === 'DST' ? (
                                <select
                                  value={value || ''}
                                  onChange={e => setSlot(viewWeek, p.id, s.key, e.target.value || undefined)}
                                  className="flex-1 px-1.5 py-1 rounded min-w-[140px]"
                                  style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                                >
                                  <option value="">— pick a D/ST —</option>
                                  {options.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="relative flex-1">
                                  <input
                                    value={openCombo === searchKey ? searchText : (value ? playerLabel(value, s.position) : '')}
                                    onFocus={() => setOpenCombo(searchKey)}
                                    onChange={e => setPlayerSearch(ps => ({ ...ps, [searchKey]: e.target.value }))}
                                    onBlur={() => setTimeout(() => setOpenCombo(c => (c === searchKey ? null : c)), 150)}
                                    placeholder={`search ${s.label}…`}
                                    className="w-full px-1.5 py-1 rounded"
                                    style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                                  />
                                  {openCombo === searchKey && (
                                    <div
                                      className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded"
                                      style={{ background: '#0F1614', border: '1px solid #2A3830' }}
                                    >
                                      {options.length === 0 ? (
                                        <div className="px-2 py-1.5" style={{ color: '#5C6862' }}>No matches</div>
                                      ) : (
                                        options.map(o => (
                                          <button
                                            key={o.value}
                                            type="button"
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => {
                                              setSlot(viewWeek, p.id, s.key, o.value);
                                              setPlayerSearch(ps => ({ ...ps, [searchKey]: '' }));
                                              setOpenCombo(null);
                                            }}
                                            className="w-full text-left px-2 py-1.5"
                                            style={{ color: '#F0EDE4' }}
                                          >
                                            {o.label}
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
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

            {/* Diagnostic: test auto-stats fetch */}
            <div className="rounded px-4 py-3" style={{ background: '#17211D', border: '1px dashed #5C6862' }}>
              <div className="font-head uppercase text-sm tracking-widest mb-1 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                Auto-Stats Test (beta)
              </div>
              <div className="font-mono text-[10px] mb-2" style={{ color: '#5C6862' }}>
                Diagnostic only — fetches raw player stats for this week's games from ESPN and shows exactly what comes back. Doesn't fill in scores yet.
              </div>
              <button
                onClick={testPlayerStatsSync}
                disabled={statsDebugLoading}
                className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide"
                style={{ background: '#1F2B25', border: '1px solid #8A9A90', color: '#8A9A90', opacity: statsDebugLoading ? 0.6 : 1 }}
              >
                {statsDebugLoading ? 'Searching for a completed game…' : 'Test fetch against the most recent completed game'}
              </button>
              {statsDebug && (
                <div className="mt-3 space-y-2">
                  {statsDebug.some(r => r.players?.length > 0) && (
                    <input
                      value={statsDebugFilter}
                      onChange={e => setStatsDebugFilter(e.target.value)}
                      placeholder="Search parsed players by name…"
                      className="w-full px-2 py-1.5 rounded font-mono text-xs mb-2"
                      style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                    />
                  )}
                  {statsDebug.map(r => {
                    const filtered = (r.players || []).filter(
                      p => !statsDebugFilter || (p.name || '').toLowerCase().includes(statsDebugFilter.toLowerCase())
                    );
                    return (
                      <div key={r.gameId} className="rounded px-2.5 py-2 font-mono text-[10px]" style={{ background: '#0F1614', border: '1px solid #2A3830' }}>
                        <div className="mb-1" style={{ color: r.ok ? '#7FCB98' : '#E28A82' }}>
                          {r.matchup} — {r.ok ? `parsed ${r.playersParsed} player stat rows` : `error: ${r.error}`}
                        </div>
                        {filtered.length > 0 && (
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {filtered.map((p, i) => (
                              <div key={i} className="px-2 py-1 rounded" style={{ background: '#17211D' }}>
                                <div style={{ color: '#F0EDE4' }}>{p.name} <span style={{ color: '#5C6862' }}>({p.team} — {p.category})</span></div>
                                <div style={{ color: '#8A9A90' }}>{JSON.stringify(p.stats)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {r.raw && (
                          <pre className="overflow-x-auto whitespace-pre-wrap" style={{ color: '#5C6862', maxHeight: '150px', overflowY: 'auto' }}>
                            {JSON.stringify(r.raw, null, 1).slice(0, 2000)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Score entry */}
            <div>
              <div className="font-head uppercase text-sm tracking-widest mb-1 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                Week {viewWeek} Scores
              </div>
              <div className="font-mono text-[10px] mb-3" style={{ color: '#5C6862' }}>
                Enter each rostered player's fantasy points once their game is final. Points apply automatically to everyone who started them.
              </div>
              {pickedThisWeek.size === 0 ? (
                <div className="font-mono text-xs" style={{ color: '#5C6862' }}>Nobody's set a lineup yet this week.</div>
              ) : (
                <div className="space-y-1.5">
                  {Array.from(pickedThisWeek.entries()).map(([key, info]) => (
                    <div key={key} className="flex items-center gap-2 font-mono text-xs rounded px-2.5 py-1.5" style={{ background: '#17211D', border: '1px solid #2A3830' }}>
                      <span className="w-8 shrink-0" style={{ color: '#5C6862' }}>{info.position}</span>
                      <span className="flex-1" style={{ color: '#F0EDE4' }}>{info.label}</span>
                      <input
                        type="number"
                        value={data.playerScores?.[viewWeek]?.[key] ?? ''}
                        onChange={e => setPlayerScore(viewWeek, key, e.target.value)}
                        placeholder="pts"
                        className="w-16 px-1.5 py-1 rounded text-right"
                        style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#8A9A90' }}
                      />
                    </div>
                  ))}
                </div>
              )}
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
                    <div className="font-mono text-sm" style={{ color: '#8A9A90' }}>{p.total} pts</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Saved indicator */}
      {justSaved && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs" style={{ background: '#17211D', border: '1px solid #3D9B5C', color: '#7FCB98' }}>
          <Check size={12} /> Saved
        </div>
      )}
    </div>
  );
}
