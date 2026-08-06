import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, X, Check, Minus, Skull, Trophy, Pencil, ChevronLeft, ChevronRight, Users, Loader2, RefreshCw, AlertCircle, Lock, UserCircle } from 'lucide-react';

const TEAMS = [
  ['BUF', 'Buffalo Bills'], ['MIA', 'Miami Dolphins'], ['NE', 'New England Patriots'], ['NYJ', 'New York Jets'],
  ['BAL', 'Baltimore Ravens'], ['CIN', 'Cincinnati Bengals'], ['CLE', 'Cleveland Browns'], ['PIT', 'Pittsburgh Steelers'],
  ['HOU', 'Houston Texans'], ['IND', 'Indianapolis Colts'], ['JAX', 'Jacksonville Jaguars'], ['TEN', 'Tennessee Titans'],
  ['DEN', 'Denver Broncos'], ['KC', 'Kansas City Chiefs'], ['LV', 'Las Vegas Raiders'], ['LAC', 'Los Angeles Chargers'],
  ['DAL', 'Dallas Cowboys'], ['NYG', 'New York Giants'], ['PHI', 'Philadelphia Eagles'], ['WAS', 'Washington Commanders'],
  ['CHI', 'Chicago Bears'], ['DET', 'Detroit Lions'], ['GB', 'Green Bay Packers'], ['MIN', 'Minnesota Vikings'],
  ['ATL', 'Atlanta Falcons'], ['CAR', 'Carolina Panthers'], ['NO', 'New Orleans Saints'], ['TB', 'Tampa Bay Buccaneers'],
  ['ARI', 'Arizona Cardinals'], ['LAR', 'Los Angeles Rams'], ['SF', 'San Francisco 49ers'], ['SEA', 'Seattle Seahawks'],
];
const TEAM_MAP = Object.fromEntries(TEAMS);
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
const ESPN_ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };
const POLL_MS = 15000;

const emptyData = () => ({ name: 'Survivor Pool', participants: [], picks: {}, currentWeek: 1 });

function uid() { return Math.random().toString(36).slice(2, 10); }

// Not cryptographic — just avoids storing PINs as plain text in shared storage.
function hashPin(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function defaultSeasonYear() {
  const now = new Date();
  const m = now.getMonth() + 1;
  return m <= 2 ? now.getFullYear() - 1 : now.getFullYear();
}

async function apiGetPool() {
  const res = await fetch('/api/pool');
  if (!res.ok) throw new Error('failed to load pool');
  const json = await res.json();
  return json.data;
}
async function apiSavePool(data) {
  const res = await fetch('/api/pool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('failed to save pool');
  return res.json();
}

export default function App() {
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
  const [schedule, setSchedule] = useState({});
  const [now, setNow] = useState(Date.now());
  const saveTimer = useRef(null);
  const skipNextPoll = useRef(false);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const remote = await apiGetPool();
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

  // Personal identity lives on this device only (localStorage), not in the shared pool data
  useEffect(() => {
    try {
      const stored = localStorage.getItem('my-participant-id');
      if (stored) setMyId(stored);
    } catch (e) {
      // ignore — private browsing etc.
    } finally {
      setMyIdLoaded(true);
    }
  }, []);

  // Clock tick, so lock/reveal times update live without a refresh
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Poll for changes other people make, so the shared leaderboard stays live
  useEffect(() => {
    const t = setInterval(async () => {
      if (skipNextPoll.current) { skipNextPoll.current = false; return; }
      try {
        const remote = await apiGetPool();
        if (remote) setData(remote);
      } catch (e) {
        // silent — keep showing last known state
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { setSchedule({}); }, [seasonYear]);

  const ensureSchedule = useCallback(async (week) => {
    setSchedule(prev => {
      if (prev[week]?.loaded || prev[week]?.loading) return prev;
      return { ...prev, [week]: { loading: true } };
    });
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${seasonYear}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      const teamKickoff = {};
      const kickoffTimes = [];
      (json.events || []).forEach(ev => {
        const comp = ev.competitions?.[0];
        const dateStr = comp?.date || ev.date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        (comp.competitors || []).forEach(c => {
          const rawAbbr = c.team?.abbreviation;
          const abbr = ESPN_ABBR_FIX[rawAbbr] || rawAbbr;
          if (abbr) teamKickoff[abbr] = dateStr;
        });
        const etHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d));
        kickoffTimes.push({ date: d, etHour });
      });
      const windowGames = kickoffTimes.filter(k => k.etHour >= 12).sort((a, b) => a.date - b.date);
      const massThreshold = windowGames.length
        ? windowGames[0].date.toISOString()
        : (kickoffTimes.length ? kickoffTimes.sort((a, b) => a.date - b.date)[0].date.toISOString() : null);
      setSchedule(prev => ({ ...prev, [week]: { loading: false, loaded: true, teamKickoff, massThreshold } }));
    } catch (e) {
      setSchedule(prev => ({ ...prev, [week]: { loading: false, loaded: true, teamKickoff: {}, massThreshold: null, error: true } }));
    }
  }, [seasonYear]);

  useEffect(() => { ensureSchedule(viewWeek); }, [viewWeek, seasonYear, ensureSchedule]);

  if (loading || !data) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#E8A23D]" size={28} />
      </div>
    );
  }

  const eliminatedAtWeek = (pid) => {
    for (const w of WEEKS) {
      const p = data.picks[w]?.[pid];
      if (p && p.result === 'loss') return w;
    }
    return null;
  };
  const usedTeams = (pid, uptoWeek) => {
    const used = new Set();
    for (const w of WEEKS) {
      if (w > uptoWeek) continue;
      const p = data.picks[w]?.[pid];
      if (p && p.team) used.add(p.team);
    }
    return used;
  };

  const aliveCount = data.participants.filter(p => eliminatedAtWeek(p.id) === null).length;
  const outCount = data.participants.length - aliveCount;

  const persist = (next) => {
    setData(next);
    skipNextPoll.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await apiSavePool(next);
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
  const setPick = (week, pid, team) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prev = next.picks[week][pid] || {};
    next.picks[week][pid] = { team, result: prev.result || 'pending' };
    persist(next);
  };
  const setResult = (week, pid, result) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prev = next.picks[week][pid] || { team: '' };
    next.picks[week][pid] = { ...prev, result };
    persist(next);
  };
  const setCurrentWeek = (w) => persist({ ...data, currentWeek: w });

  const saveTitle = () => {
    const t = titleDraft.trim() || 'Survivor Pool';
    persist({ ...data, name: t });
    setEditingTitle(false);
  };

  const chooseMe = (id) => {
    setMyId(id);
    try { localStorage.setItem('my-participant-id', id); } catch (e) { /* non-fatal */ }
  };
  const forgetMe = () => {
    setMyId(null);
    try { localStorage.removeItem('my-participant-id'); } catch (e) { /* non-fatal */ }
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
    } else {
      if (hashed === participant.pin) {
        chooseMe(participantId);
        setClaimPrompt(null);
      } else {
        setClaimPrompt(c => ({ ...c, error: 'Wrong PIN', input: '' }));
      }
    }
  };
  const resetPin = (id) => {
    if (resetConfirmId !== id) { setResetConfirmId(id); return; }
    persist({ ...data, participants: data.participants.map(p => p.id === id ? { ...p, pin: null } : p) });
    setResetConfirmId(null);
  };

  const lockTimeForPick = (week, team) => {
    const sch = schedule[week];
    if (!sch || !sch.loaded) return null;
    const mass = sch.massThreshold ? new Date(sch.massThreshold).getTime() : null;
    const teamTime = team && sch.teamKickoff[team] ? new Date(sch.teamKickoff[team]).getTime() : null;
    if (teamTime && mass) return Math.min(teamTime, mass);
    return teamTime ?? mass;
  };
  const isPickLocked = (week, team) => {
    const lockTime = lockTimeForPick(week, team);
    return lockTime !== null && now >= lockTime;
  };
  const isRevealed = (week, pid, team) => {
    if (myId && pid === myId) return true;
    return isPickLocked(week, team);
  };

  const syncScores = async (week) => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${seasonYear}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      const resultMap = {};
      let completedGames = 0;
      (json.events || []).forEach(ev => {
        const comp = ev.competitions?.[0];
        if (!comp?.status?.type?.completed) return;
        completedGames++;
        const competitors = comp.competitors || [];
        const isTie = competitors.length === 2 && Number(competitors[0].score) === Number(competitors[1].score);
        competitors.forEach(c => {
          const rawAbbr = c.team?.abbreviation;
          const abbr = ESPN_ABBR_FIX[rawAbbr] || rawAbbr;
          if (abbr) resultMap[abbr] = isTie ? 'win' : (c.winner ? 'win' : 'loss');
        });
      });

      if (completedGames === 0) {
        setSyncMsg(`No finished games yet for week ${week} — try again after kickoff.`);
        return;
      }

      const next = { ...data, picks: { ...data.picks } };
      next.picks[week] = { ...(next.picks[week] || {}) };
      let updated = 0;
      data.participants.forEach(p => {
        const pick = next.picks[week][p.id];
        if (pick?.team && resultMap[pick.team]) {
          next.picks[week][p.id] = { ...pick, result: resultMap[pick.team] };
          updated++;
        }
      });
      persist(next);
      setSyncMsg(`Synced ${completedGames} finished game${completedGames === 1 ? '' : 's'} — updated ${updated} pick${updated === 1 ? '' : 's'}.`);
    } catch (e) {
      setSyncMsg('Could not reach the ESPN score feed. You can still mark results manually below.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ background: '#0F1614', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Oswald', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .perf-left { position: relative; }
        .perf-left::before {
          content: '';
          position: absolute; left: -1px; top: 0; bottom: 0; width: 1px;
          background-image: repeating-linear-gradient(to bottom, #0F1614 0 6px, #3A4A42 6px 12px);
        }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #3A4A42; border-radius: 4px; }
        select { color-scheme: dark; }
      `}</style>

      {/* Scoreboard header */}
      <div style={{ background: 'linear-gradient(180deg,#17211D,#0F1614)', borderBottom: '1px solid #2A3830' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: '#3D9B5C22', border: '2px solid #3D9B5C' }}>
              <Trophy size={20} color="#3D9B5C" />
            </div>
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => e.key === 'Enter' && saveTitle()}
                className="font-head text-xl sm:text-2xl bg-transparent border-b outline-none min-w-0"
                style={{ borderColor: '#3D9B5C', color: '#F0EDE4' }}
              />
            ) : (
              <button
                onClick={() => { setTitleDraft(data.name); setEditingTitle(true); }}
                className="font-head text-xl sm:text-2xl tracking-wide flex items-center gap-2 min-w-0 text-left"
              >
                <span className="truncate uppercase">{data.name}</span>
                <Pencil size={14} color="#8A9A90" className="shrink-0" />
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

        <div className="max-w-5xl mx-auto mt-4 flex gap-2 font-mono text-xs uppercase">
          <div className="px-3 py-1.5 rounded" style={{ background: '#3D9B5C1a', border: '1px solid #3D9B5C44', color: '#7FCB98' }}>
            Alive {aliveCount}
          </div>
          <div className="px-3 py-1.5 rounded" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
            Out {outCount}
          </div>
          <div className="px-3 py-1.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', color: '#8A9A90' }}>
            Entrants {data.participants.length}
          </div>
          {saveError && (
            <div className="px-3 py-1.5 rounded ml-auto" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
              Sync failed — retrying
            </div>
          )}
        </div>
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
              style={{ background: '#3D9B5C', color: '#0F1614' }}
            >
              <Plus size={16} /> Add
            </button>
          </div>
          {data.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.participants.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs"
                  style={{ background: '#17211D', border: '1px solid #2A3830', color: '#8A9A90' }}
                >
                  {p.pin ? <Lock size={10} color="#7FCB98" /> : <Lock size={10} color="#3A4A42" />}
                  {p.name}
                  {p.pin && (
                    <button
                      onClick={() => resetPin(p.id)}
                      className="underline"
                      style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}
                    >
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
                  <UserCircle size={14} color="#7FCB98" />
                  You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                  <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
                </div>
              ) : claimPrompt ? (
                <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830' }}>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8A9A90' }}>
                    {claimPrompt.mode === 'set'
                      ? <>Set a 4-digit PIN for <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === claimPrompt.participantId)?.name}</span> — you'll use it to switch back to this name later.</>
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
                    <button
                      onClick={submitClaim}
                      className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide"
                      style={{ background: '#3D9B5C', color: '#0F1614' }}
                    >
                      {claimPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
                    </button>
                    <button
                      onClick={() => setClaimPrompt(null)}
                      className="font-mono text-xs underline"
                      style={{ color: '#5C6862' }}
                    >
                      Cancel
                    </button>
                  </div>
                  {claimPrompt.error && (
                    <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{claimPrompt.error}</div>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830' }}>
                  <div className="font-mono text-xs mb-2" style={{ color: '#8A9A90' }}>
                    Which entrant are you? This keeps your picks hidden from others until kickoff.
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleNameTap(p)}
                        className="px-2.5 py-1 rounded font-head text-xs uppercase flex items-center gap-1"
                        style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                      >
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
                <button onClick={() => setViewWeek(w => Math.max(1, w - 1))} className="p-1 rounded" style={{ color: '#8A9A90' }}>
                  <ChevronLeft size={18} />
                </button>
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
                <button onClick={() => setViewWeek(w => Math.min(18, w + 1))} className="p-1 rounded" style={{ color: '#8A9A90' }}>
                  <ChevronRight size={18} />
                </button>
              </div>
              {viewWeek !== data.currentWeek && (
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#E8A23D' }}>
                  Set week {viewWeek} as current week
                </button>
              )}
            </div>

            {/* This week's picks */}
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="font-head uppercase text-sm tracking-widest" style={{ color: '#8A9A90' }}>
                  Week {viewWeek} picks
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-mono text-xs flex items-center gap-1" style={{ color: '#5C6862' }}>
                    Season
                    <input
                      type="number"
                      value={seasonYear}
                      onChange={e => setSeasonYear(Number(e.target.value))}
                      className="w-16 px-1.5 py-1 rounded font-mono text-xs"
                      style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                    />
                  </label>
                  <button
                    onClick={() => syncScores(viewWeek)}
                    disabled={syncing}
                    className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
                    style={{ background: '#1F2B25', border: '1px solid #3D9B5C', color: '#7FCB98', opacity: syncing ? 0.6 : 1 }}
                  >
                    <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                    {syncing ? 'Syncing…' : `Sync week ${viewWeek} scores`}
                  </button>
                </div>
              </div>
              {syncMsg && (
                <div className="mb-3 font-mono text-xs flex items-start gap-1.5" style={{ color: '#E8A23D' }}>
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  {syncMsg}
                </div>
              )}
              <div className="space-y-2">
                {data.participants.map(p => {
                  const elimWeek = eliminatedAtWeek(p.id);
                  const isOutByNow = elimWeek !== null && elimWeek < viewWeek;
                  const pick = data.picks[viewWeek]?.[p.id];
                  const used = usedTeams(p.id, viewWeek - 1);
                  if (pick?.team) used.delete(pick.team);

                  const isMe = myId === p.id;
                  const locked = isPickLocked(viewWeek, pick?.team);
                  const revealed = isRevealed(viewWeek, p.id, pick?.team);
                  const scheduleReady = schedule[viewWeek]?.loaded;

                  return (
                    <div
                      key={p.id}
                      className="perf-left flex items-center gap-3 rounded-r px-4 py-3 flex-wrap"
                      style={{
                        background: isOutByNow ? '#17211D88' : '#17211D',
                        border: isMe ? '1px solid #3D9B5C88' : '1px solid #2A3830',
                        opacity: isOutByNow ? 0.55 : 1,
                      }}
                    >
                      <div className="w-28 shrink-0 font-head text-sm truncate flex items-center gap-1.5">
                        {isOutByNow && <Skull size={13} color="#C1443A" />}
                        {p.name}
                      </div>

                      {isOutByNow ? (
                        <div className="font-mono text-xs uppercase" style={{ color: '#C1443A' }}>
                          Eliminated — week {elimWeek}
                        </div>
                      ) : !revealed ? (
                        <div className="flex-1 flex items-center gap-1.5 font-mono text-xs uppercase" style={{ color: '#5C6862' }}>
                          <Lock size={12} />
                          {scheduleReady ? 'Hidden until kickoff' : 'Checking kickoff time…'}
                        </div>
                      ) : (
                        <>
                          <select
                            value={pick?.team || ''}
                            onChange={e => setPick(viewWeek, p.id, e.target.value)}
                            disabled={locked}
                            className="px-2 py-1.5 rounded font-mono text-sm flex-1 min-w-[140px]"
                            style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4', opacity: locked ? 0.7 : 1 }}
                          >
                            <option value="">— pick a team —</option>
                            {TEAMS.map(([abbr, full]) => (
                              <option key={abbr} value={abbr} disabled={used.has(abbr)}>
                                {abbr} — {full}{used.has(abbr) ? ' (used)' : ''}
                              </option>
                            ))}
                          </select>
                          {locked && (
                            <span className="font-mono text-[10px] uppercase flex items-center gap-1" style={{ color: '#5C6862' }}>
                              <Lock size={10} /> Locked
                            </span>
                          )}
                          <div className="flex gap-1 shrink-0">
                            {['win', 'pending', 'loss'].map(r => (
                              <button
                                key={r}
                                onClick={() => setResult(viewWeek, p.id, r)}
                                title={r}
                                className="w-8 h-8 rounded flex items-center justify-center"
                                style={{
                                  background: (pick?.result || 'pending') === r
                                    ? (r === 'win' ? '#3D9B5C' : r === 'loss' ? '#C1443A' : '#E8A23D')
                                    : '#1F2B25',
                                  border: '1px solid #2A3830',
                                }}
                              >
                                {r === 'win' && <Check size={14} color={(pick?.result) === 'win' ? '#0F1614' : '#5C6862'} />}
                                {r === 'loss' && <X size={14} color={(pick?.result) === 'loss' ? '#0F1614' : '#5C6862'} />}
                                {r === 'pending' && <Minus size={14} color={(pick?.result || 'pending') === 'pending' ? '#0F1614' : '#5C6862'} />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      <button onClick={() => removeParticipant(p.id)} className="ml-auto shrink-0 p-1 rounded" style={{ color: '#5C6862' }}>
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Elimination chain */}
            <div>
              <div className="font-head uppercase text-sm tracking-widest mb-3" style={{ color: '#8A9A90' }}>
                Season chain
              </div>
              <div className="space-y-2">
                {data.participants.map(p => {
                  const elimWeek = eliminatedAtWeek(p.id);
                  const wins = WEEKS.filter(w => data.picks[w]?.[p.id]?.result === 'win').length;
                  return (
                    <div key={p.id} className="rounded px-3 py-2.5" style={{ background: '#17211D', border: '1px solid #2A3830' }}>
                      <div className="flex items-center gap-3 mb-1.5">
                        <div className="w-24 shrink-0 font-head text-sm truncate flex items-center gap-1.5">
                          {elimWeek !== null ? <Skull size={12} color="#C1443A" /> : <Trophy size={12} color="#3D9B5C" />}
                          {p.name}
                        </div>
                        <div className="font-mono text-xs" style={{ color: '#5C6862' }}>{wins}-{elimWeek ? 1 : 0}</div>
                      </div>
                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {WEEKS.map(w => {
                          const pk = data.picks[w]?.[p.id];
                          const isElimHere = elimWeek === w;
                          const grey = elimWeek !== null && w > elimWeek;
                          const shown = isRevealed(w, p.id, pk?.team);
                          let bg = '#1F2B25', border = '#2A3830', txt = '#5C6862';
                          if (shown && pk?.result === 'win') { bg = '#3D9B5C22'; border = '#3D9B5C'; txt = '#7FCB98'; }
                          if (shown && isElimHere) { bg = '#C1443A22'; border = '#C1443A'; txt = '#E28A82'; }
                          return (
                            <div
                              key={w}
                              title={shown ? `Week ${w}${pk?.team ? ': ' + TEAM_MAP[pk.team] : ''}` : `Week ${w}: hidden until kickoff`}
                              className="shrink-0 w-9 h-9 rounded font-mono text-[10px] flex items-center justify-center"
                              style={{ background: bg, border: `1px solid ${border}`, color: txt, opacity: grey ? 0.3 : 1 }}
                            >
                              {!pk?.team ? '·' : shown ? pk.team : <Lock size={10} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
