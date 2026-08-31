import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, Check, Minus, Skull, Bomb, Trophy, Pencil, ChevronLeft, ChevronRight, Users, Loader2, RefreshCw, AlertCircle, Lock, UserCircle, ArrowLeft, Download, Coins } from 'lucide-react';
import { TEAMS, TEAM_MAP, WEEKS, ALL_WEEKS, weekLabel, weeksForSeason, isPreseasonWeek } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool, mergePoolData } from '../lib/api';
import { useEspnSchedule, fetchWeekResults } from '../lib/espnSchedule';
import { useAdminMode } from '../lib/admin';
import PoolTicker from '../components/PoolTicker';
import PoolChat from '../components/PoolChat';
import PoolRules from '../components/PoolRules';

const POOL_KEY = 'survivor-pool-v1';
const IDENTITY_KEY = 'my-participant-id-survivor';
const POLL_MS = 15000;

const emptyData = () => ({ name: 'Survivor Pool', participants: [], picks: {}, currentWeek: 1 });

const SURVIVOR_ENTRY_FEE = 20;
const SURVIVOR_RULES = [
  {
    heading: 'How it works',
    body: [
      'Each week, pick one NFL team you think will win.',
      'You can only use each team once all season — no repeats.',
      'If your team loses, you\'re eliminated for the rest of the season.',
      'If your team ties, you survive — a tie counts as a win, not a loss.',
      'Last person(s) standing wins the pool.',
    ],
  },
  {
    heading: 'Picks & locking',
    body: [
      'Early games (Thursday, Saturday, international) lock at their own kickoff time.',
      'All Sunday 1pm-or-later games — including Sunday Night and Monday Night — lock together, all at once, when the early Sunday window starts.',
      'Your pick stays hidden from everyone else until it locks.',
      'If you don\'t submit a pick before your deadline, you\'re automatically eliminated that week, same as a loss.',
    ],
  },
  {
    heading: 'Joining',
    body: [
      'This pool is single entry — one entry per person.',
      'Entries close once Week 1\'s picks lock. No new entrants can join after that point for the rest of the season.',
    ],
  },
];

export default function SurvivorPool() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [viewWeek, setViewWeek] = useState(1);
  const [newName, setNewName] = useState('');
  const [newRealName, setNewRealName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const titleContainerRef = useRef(null);
  const titleTextRef = useRef(null);
  const [titleFontSize, setTitleFontSize] = useState(30);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [bombPhase, setBombPhase] = useState(null); // null | 'pulse' | 'explode' | 'skull'
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createEntryError, setCreateEntryError] = useState('');
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [backupStatus, setBackupStatus] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showAvailability, setShowAvailability] = useState(false);
  const [pickConfirm, setPickConfirm] = useState(null); // { week, pid, team, participantName, prevTeam }
  const [now, setNow] = useState(Date.now());
  const [justSaved, setJustSaved] = useState(false);
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const bombTriggeredRef = useRef(false);
  const { schedule, ensureSchedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);
  // Pinned independently of viewWeek so the join-deadline check works no matter what week
  // someone's currently looking at. Regular season Week 1 is the actual start of the season
  // now that preseason beta-testing is over.
  const { lockTimeForPick: lockTimeForPickWeek1 } = useEspnSchedule(1, seasonYear);
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();

  // Initial load
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

  // Personal identity lives on this device only (localStorage), not in the shared pool data
  useEffect(() => {
    try {
      const stored = localStorage.getItem(IDENTITY_KEY);
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

  // Shrinks the pool title's font size until it actually fits on one line, by measuring the
  // real rendered width rather than guessing from character count (a character-count estimate
  // can't account for how wide any given letter actually renders in this font, so it can still
  // overflow for some names while being unnecessarily small for others).
  useEffect(() => {
    const measure = () => {
      const container = titleContainerRef.current;
      const el = titleTextRef.current;
      if (!container || !el) return;
      let size = 30;
      el.style.fontSize = `${size}px`;
      while (el.scrollWidth > container.clientWidth && size > 12) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      setTitleFontSize(size);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [data?.name, isAdmin]);

  // Eagerly load schedule data for every week up to and including whichever one is being viewed
  // — not just the viewed week itself. This matters when someone browses ahead to a future week
  // to plan picks in advance: without this, we'd have no live kickoff data for the weeks in
  // between, and could only guess whether they're "over" based on position rather than fact.
  useEffect(() => {
    const seasonWeeks = weeksForSeason(viewWeek);
    const viewIdx = seasonWeeks.indexOf(viewWeek);
    const weeksToLoad = viewIdx >= 0 ? seasonWeeks.slice(0, viewIdx + 1) : [viewWeek];
    weeksToLoad.forEach(w => ensureSchedule(w));
  }, [viewWeek, seasonYear, ensureSchedule]);

  // Poll for changes other people make, so the shared leaderboard stays live
  useEffect(() => {
    const t = setInterval(async () => {
      if (skipNextPoll.current) { skipNextPoll.current = false; return; }
      try {
        const remote = await apiGetPool(POOL_KEY);
        if (remote) setData(remote);
      } catch (e) {
        // silent — keep showing last known state
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Fires the "you're eliminated" bomb animation every time the page loads while identified as
  // an eliminated participant — no memory of past plays, so it's not affected by cache/storage
  // at all. This has to duplicate a small piece of the real elimination check (rather than
  // calling eliminatedAtWeek directly) since that function is declared below the loading guard
  // and so isn't safely available up here alongside the other hooks.
  useEffect(() => {
    // Gate on a ref checked first, before anything else. The app polls for updates
    // periodically, which hands this effect a new `data` object every time and makes it re-run
    // mid-animation — without this early bail, a poll landing partway through would re-execute
    // the whole check again while a previous run's timers are still in flight. The ref only
    // guards against re-firing within this one page load (it resets on every fresh load, unlike
    // sessionStorage), so the animation still plays fresh every single time someone opens the
    // page as an eliminated entrant.
    if (bombTriggeredRef.current) return;
    if (!data || !myId) return;
    const seasonWeeks = weeksForSeason(viewWeek);
    const viewIdx = seasonWeeks.indexOf(viewWeek);
    const weeksToCheck = viewIdx >= 0 ? seasonWeeks.slice(0, viewIdx + 1) : seasonWeeks;
    let elimWeek = null;
    for (const w of weeksToCheck) {
      const p = data.picks?.[w]?.[myId];
      if (p && p.result === 'loss') { elimWeek = w; break; }
      const lockTime = lockTimeForPick(w, undefined);
      if ((!p || !p.team) && lockTime !== null && now >= lockTime) { elimWeek = w; break; }
    }
    if (elimWeek === null) return;
    // Mark as triggered before scheduling anything, so any re-run of this effect from here on
    // (e.g. from the next poll) hits the guard above and never touches these timers again.
    bombTriggeredRef.current = true;
    setBombPhase('pulse');
    setTimeout(() => setBombPhase('explode'), 2400);
    setTimeout(() => setBombPhase('skull'), 2800);
    setTimeout(() => setBombPhase(null), 4800);
  }, [data, myId, viewWeek]);

  if (loading || !data) {
    return (
      <div style={{ background: '#0F1614' }} className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-[#E8A23D]" size={28} />
      </div>
    );
  }

  // A week counts as "over" once its own 1pm-Sunday-style deadline has actually passed —
  // checked against real, live kickoff data for that specific week (eagerly loaded above for
  // every week up to the one being viewed). Deliberately NOT based on relative position to
  // data.currentWeek or viewWeek: position-based comparisons break in two different ways —
  // comparing to data.currentWeek wrongly treats every preseason week as "over" the moment the
  // pool is created (since that defaults to plain "1" until manually advanced), and comparing
  // to viewWeek wrongly treats earlier not-yet-played weeks as "over" whenever someone browses
  // ahead to plan a future week's pick. Checking each week's actual deadline avoids both.
  const isWeekDefinitivelyOver = (w) => {
    const lockTime = lockTimeForPick(w, undefined);
    return lockTime !== null && now >= lockTime;
  };

  // Only ever checks weeks up to and including the one being viewed — future weeks within the
  // same season (e.g. PRE 2/3 while looking at PRE 1) are never examined, so nobody gets falsely
  // eliminated for not yet having a pick in a week that hasn't opened up yet.
  const eliminatedAtWeek = (pid) => {
    const seasonWeeks = weeksForSeason(viewWeek);
    const viewIdx = seasonWeeks.indexOf(viewWeek);
    const weeksToCheck = viewIdx >= 0 ? seasonWeeks.slice(0, viewIdx + 1) : seasonWeeks;
    for (const w of weeksToCheck) {
      const p = data.picks[w]?.[pid];
      if (p && p.result === 'loss') return w;
      if ((!p || !p.team) && isWeekDefinitivelyOver(w)) return w;
    }
    return null;
  };
  const usedTeams = (pid, uptoWeek) => {
    const used = new Set();
    for (const w of weeksForSeason(viewWeek)) {
      if (w > uptoWeek) continue;
      const p = data.picks[w]?.[pid];
      if (p && p.team) used.add(p.team);
    }
    return used;
  };

  const aliveCount = data.participants.filter(p => eliminatedAtWeek(p.id) === null).length;
  // myId being set doesn't guarantee it still points to a real entrant — a full pool reset (or
  // manual removal) can leave a stale id sitting in someone's localStorage. Treat that the same
  // as not being signed in at all, everywhere it matters, rather than just where it happened to
  // already get double-checked.
  const myIdValid = !!(myId && data.participants.some(p => p.id === myId));
  const outCount = data.participants.length - aliveCount;

  const lastNameOf = (name) => {
    const parts = (name || '').trim().split(/\s+/);
    return (parts[parts.length - 1] || '').toLowerCase();
  };
  const sortedParticipants = [...data.participants].sort((a, b) => {
    const aOut = eliminatedAtWeek(a.id) !== null;
    const bOut = eliminatedAtWeek(b.id) !== null;
    if (aOut !== bOut) return aOut ? 1 : -1;
    return lastNameOf(a.name).localeCompare(lastNameOf(b.name));
  });

  const aliveParticipants = data.participants.filter(p => eliminatedAtWeek(p.id) === null);
  const seasonWeeksForView = weeksForSeason(viewWeek);
  const viewWeekIdx = seasonWeeksForView.indexOf(viewWeek);
  const prevWeekInSeason = viewWeekIdx > 0 ? seasonWeeksForView[viewWeekIdx - 1] : viewWeek;
  const teamAvailability = TEAMS.map(([abbr, full]) => {
    const availableCount = aliveParticipants.filter(p => !usedTeams(p.id, viewWeek - 1).has(abbr)).length;
    const pct = aliveParticipants.length ? Math.round((availableCount / aliveParticipants.length) * 100) : 0;
    return { abbr, full, availableCount, pct };
  }).sort((a, b) => b.pct - a.pct || a.abbr.localeCompare(b.abbr));

  const persist = (next, removedIds = [], removedMessageIds = []) => {
    setData(next);
    skipNextPoll.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const remote = await apiGetPool(POOL_KEY).catch(() => null);
        let merged = mergePoolData(next, remote);
        // The merge above unions participants (and chat messages) from both copies to protect
        // concurrent additions — but that can't distinguish "removed on purpose" from "exists on
        // the server but not here yet," so it'll silently re-add anything just deleted. Force
        // those specific ids back out.
        if (removedIds.length) {
          merged = { ...merged, participants: merged.participants.filter(p => !removedIds.includes(p.id)) };
        }
        if (removedMessageIds.length) {
          merged = { ...merged, chatMessages: (merged.chatMessages || []).filter(m => !removedMessageIds.includes(m.id)) };
        }
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

  const week1JoinDeadline = lockTimeForPickWeek1(1, undefined);
  const joinClosed = !isAdmin && week1JoinDeadline !== null && now >= week1JoinDeadline;

  const addParticipant = () => {
    if (joinClosed && !isAdmin) return;
    const name = newName.trim();
    const realName = newRealName.trim();
    const email = newEmail.trim();
    if (!name || !realName || !email) return;
    const norm = s => (s || '').trim().toLowerCase();
    // Real name is the actual "one entry per person" signal — email is dropped from this check
    // since it's common for two different people (e.g. spouses) to share one email address, and
    // that shouldn't block a second legitimate entrant.
    const isDuplicate = data.participants.some(p => norm(p.realName) === norm(realName));
    if (isDuplicate) {
      setCreateEntryError('This pool only allows one entry per person — that name is already registered.');
      return;
    }
    setCreateEntryError('');
    const newP = { id: uid(), name, realName, pin: null, email };
    persist({ ...data, participants: [...data.participants, newP] });
    setNewName('');
    setNewRealName('');
    setNewEmail('');
    setShowCreateForm(false);
    setClaimPrompt({ participantId: newP.id, mode: 'set', input: '', error: '' });
  };
  const removeParticipant = (id) => {
    const next = { ...data, participants: data.participants.filter(p => p.id !== id) };
    for (const w of ALL_WEEKS) { if (next.picks[w]) delete next.picks[w][id]; }
    persist(next, [id]);
  };
  const setPick = (week, pid, team) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    // Always reset to pending on a genuine pick change — the caller (requestPick) already only
    // invokes this when the team is actually different, so there's never a legitimate reason to
    // carry over the previous team's result. Keeping it (as this used to) meant changing a pick
    // away from a team that had already lost left the stale "loss" attached to the new team too,
    // so someone correctly moved off a loser would still show as eliminated until the next sync.
    next.picks[week][pid] = { team, result: 'pending' };
    persist(next);
  };
  const requestPick = (week, pid, team, participantName, prevTeam) => {
    if (prevTeam === team) return;
    // Safety backstop: refuse to even open the confirmation if this specific team's game has
    // already locked, regardless of which UI path got us here. The button-level disabled state
    // should already prevent this, but this makes it impossible to slip through either way.
    if (!isAdmin && isPickLocked(week, team)) return;
    setPickConfirm({ week, pid, team, participantName, prevTeam });
  };
  const confirmPickNow = () => {
    if (!pickConfirm) return;
    setPick(pickConfirm.week, pickConfirm.pid, pickConfirm.team);
    setPickConfirm(null);
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
    if (!isAdmin) { setEditingTitle(false); return; }
    const t = titleDraft.trim() || 'Survivor Pool';
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
    const resetterName = myId ? data.participants.find(x => x.id === myId)?.name : null;
    persist({
      ...data,
      participants: data.participants.map(p => p.id === id
        ? { ...p, pin: null, lastPinReset: { byName: resetterName || 'an unclaimed device', at: new Date().toISOString() } }
        : p),
    });
    setResetConfirmId(null);
  };

  const exportEmails = () => {
    const rows = data.participants.map(p =>
      `"${(p.name || '').replace(/"/g, '""')}","${(p.realName || '').replace(/"/g, '""')}","${p.email || ''}"`
    );
    const csv = 'Display Name,Real Name,Email\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(data.name || 'pool').replace(/[^a-z0-9]+/gi, '-')}-emails.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Backs up all three pools at once (not just this one) to the connected Google Sheet — same
  // endpoint the daily automatic backup uses, just triggered on demand. If CRON_SECRET is set
  // on the server, VITE_BACKUP_SECRET (same value, safe to expose client-side) is sent along so
  // this button keeps working alongside the protected automatic backup.
  const runBackup = async () => {
    setBackupStatus({ loading: true });
    try {
      const headers = {};
      if (import.meta.env.VITE_BACKUP_SECRET) {
        headers['Authorization'] = `Bearer ${import.meta.env.VITE_BACKUP_SECRET}`;
      }
      const res = await fetch('/api/backup-to-sheets', { headers });
      const json = await res.json();
      setBackupStatus({ loading: false, ...json });
    } catch (e) {
      setBackupStatus({ loading: false, ok: false, error: String(e) });
    }
  };

  const setTickerMessage = (text) => {
    persist({ ...data, tickerMessage: text });
  };
  const postMessage = (text) => {
    const me = data.participants.find(p => p.id === myId);
    const msg = { id: uid(), authorId: myId, authorName: me?.name || 'Unknown', text, at: new Date().toISOString() };
    persist({ ...data, chatMessages: [...(data.chatMessages || []), msg] });
  };
  const deleteMessage = (id) => {
    const next = { ...data, chatMessages: (data.chatMessages || []).filter(m => m.id !== id) };
    persist(next, [], [id]);
  };

  const isPickLocked = (week, team) => {
    if (isAdmin) return false;
    const lockTime = lockTimeForPick(week, team);
    return lockTime !== null && now >= lockTime;
  };
  const isRevealed = (week, pid, team) => {
    if (isAdmin) return true;
    if (myId && pid === myId) return true;
    return isPickLocked(week, team);
  };

  const weekLocked = isPickLocked(viewWeek, undefined);
  const picksThisWeek = data.participants
    .map(p => data.picks[viewWeek]?.[p.id]?.team)
    .filter(Boolean);
  const totalPicksThisWeek = picksThisWeek.length;
  const totalParticipantsForDist = data.participants.length;
  const noPickCount = totalParticipantsForDist - totalPicksThisWeek;
  const pickDistribution = Object.entries(
    picksThisWeek.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {})
  )
    .map(([abbr, count]) => ({ abbr, count, pct: totalParticipantsForDist ? Math.round((count / totalParticipantsForDist) * 100) : 0 }))
    .sort((a, b) => b.count - a.count || a.abbr.localeCompare(b.abbr));
  if (noPickCount > 0) {
    pickDistribution.push({
      abbr: 'No Pick',
      count: noPickCount,
      pct: totalParticipantsForDist ? Math.round((noPickCount / totalParticipantsForDist) * 100) : 0,
      isNoPick: true,
    });
  }

  const syncScores = async (week) => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { results: resultMap, completedGames } = await fetchWeekResults(week, seasonYear);

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
    <div style={{ background: 'radial-gradient(ellipse 90% 60% at 50% -10%, #17211D 0%, #0F1614 55%)', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
        .rounded { border-radius: 10px !important; }
        button { transition: transform 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease; }
        button:active { transform: scale(0.97); }
        input, select { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        input:focus, select:focus { outline: none; border-color: #3D9B5C88 !important; box-shadow: 0 0 0 3px #3D9B5C22; }

        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
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
      <div style={{ background: 'linear-gradient(180deg,#1B2721,#0F1614)', borderBottom: '1px solid #3D9B5C33', boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto mb-3 flex items-center gap-3">
          <img src="/logo.png" alt="" className="w-7 h-7 rounded object-cover shrink-0" />
          <Link to="/" className="font-mono text-xs flex items-center gap-1.5 w-fit" style={{ color: '#8A9A90' }}>
            <ArrowLeft size={12} /> All Pools
          </Link>
          <PoolRules title="Survivor Pool" entryFee={SURVIVOR_ENTRY_FEE} sections={SURVIVOR_RULES} accent="#3D9B5C" />
          {isAdmin ? (
            <button onClick={exitAdmin} className="ml-auto font-mono text-[10px] uppercase px-2 py-1 rounded flex items-center gap-1" style={{ background: '#C1443A22', border: '1px solid #C1443A', color: '#E28A82' }}>
              <Lock size={10} /> Admin mode — exit
            </button>
          ) : (
            <button onClick={openAdminPrompt} className="ml-auto font-mono text-[10px] uppercase underline" style={{ color: '#5C6862' }}>
              Admin
            </button>
          )}
        </div>

        <div className="max-w-5xl mx-auto flex justify-center py-2">
          <img
            src="/survivor-hero.png"
            alt=""
            className="w-full max-w-[260px] sm:max-w-[340px] h-auto object-contain"
          />
        </div>

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
              <div className="min-w-0" ref={titleContainerRef} style={{ overflow: 'hidden' }}>
                {isAdmin ? (
                  <button
                    onClick={() => { setTitleDraft(data.name); setEditingTitle(true); }}
                    className="font-head tracking-wide flex items-center gap-2 min-w-0 text-left w-full"
                    style={{ letterSpacing: '0.02em' }}
                  >
                    <span ref={titleTextRef} className="whitespace-nowrap uppercase" style={{ fontSize: `${titleFontSize}px` }}>{data.name}</span>
                    <Pencil size={14} color="#8A9A90" className="shrink-0" />
                  </button>
                ) : (
                  <div
                    ref={titleTextRef}
                    className="font-head tracking-wide whitespace-nowrap uppercase min-w-0"
                    style={{ letterSpacing: '0.02em', fontSize: `${titleFontSize}px` }}
                  >
                    {data.name}
                  </div>
                )}
                <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#5C6862' }}>Survivor Pool</div>
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#8A9A90' }}>Current Week</div>
            <div className="font-display text-3xl leading-none" style={{ color: '#E8A23D', letterSpacing: '1px', textShadow: '0 0 24px #3D9B5C55' }}>
              {isPreseasonWeek(data.currentWeek) ? (
                <>PRE {data.currentWeek - 100}<span style={{ color: '#5C6862', fontSize: '0.5em' }}> / 3</span></>
              ) : (
                <>{String(data.currentWeek).padStart(2, '0')}<span style={{ color: '#5C6862', fontSize: '0.5em' }}> / 18</span></>
              )}
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
          <div className="px-3 py-1.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
            Entrants {data.participants.length}
          </div>
          <div className="px-3 py-1.5 rounded flex items-center gap-1" style={{ background: '#E8A23D1a', border: '1px solid #E8A23D55', color: '#E8A23D' }}>
            <Coins size={12} /> Entry Fee: {SURVIVOR_ENTRY_FEE} units
          </div>
          {saveError && (
            <div className="px-3 py-1.5 rounded ml-auto" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
              Sync failed — retrying
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 space-y-8">

        <PoolTicker message={data.tickerMessage} isAdmin={isAdmin} onSave={setTickerMessage} accent="#3D9B5C" />

        {/* Entrants */}
        <div>
          <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
            <Users size={14} /> Entrants
          </div>

          {myIdLoaded && (isAdmin || !myIdValid) && (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="font-mono text-[20px] uppercase" style={{ color: '#5C6862' }}>Create new entry?</div>
              </div>
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-3 font-head text-sm uppercase tracking-wide"
                style={{ color: '#0F1614', background: 'linear-gradient(135deg,#F0C168,#E8A23D)', animation: 'entry-fee-pulse 2.4s ease-in-out infinite' }}
              >
                <Coins size={15} /> Entry Fee: {SURVIVOR_ENTRY_FEE} units
              </div>
              <style>{`
                @keyframes entry-fee-pulse {
                  0%, 100% { box-shadow: 0 0 8px #E8A23D66, 0 0 2px #E8A23D; }
                  50% { box-shadow: 0 0 18px #E8A23Dcc, 0 0 6px #E8A23D; }
                }
              `}</style>
              {joinClosed && !isAdmin ? (
                <div className="font-mono text-xs px-3 py-2 rounded mb-4" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
                  Entries closed — Week 1 picks have locked, no new entrants can join this season.
                </div>
              ) : !showCreateForm ? (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1 mb-4"
                  style={{ background: '#3D9B5C', color: '#0F1614' }}
                >
                  <Plus size={16} /> New Entry
                </button>
              ) : (
                <div className="flex flex-col gap-2 mb-1">
                  <input
                    autoFocus
                    value={newRealName}
                    onChange={e => setNewRealName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addParticipant()}
                    placeholder="Your real name (private — only the commissioner sees this)…"
                    className="px-3 py-2 rounded outline-none font-head text-sm"
                    style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                  />
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addParticipant()}
                    placeholder="Display name (what everyone sees)…"
                    className="px-3 py-2 rounded outline-none font-head text-sm"
                    style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                  />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addParticipant()}
                    placeholder="Email…"
                    className="px-3 py-2 rounded outline-none font-mono text-xs"
                    style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addParticipant}
                      disabled={!newName.trim() || !newRealName.trim() || !newEmail.trim()}
                      className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1"
                      style={{ background: (!newName.trim() || !newRealName.trim() || !newEmail.trim()) ? '#1F2B25' : '#3D9B5C', color: (!newName.trim() || !newRealName.trim() || !newEmail.trim()) ? '#5C6862' : '#0F1614' }}
                    >
                      <Plus size={16} /> Create
                    </button>
                    <button
                      onClick={() => { setShowCreateForm(false); setNewName(''); setNewRealName(''); setNewEmail(''); setCreateEntryError(''); }}
                      className="px-3 rounded font-mono text-xs underline"
                      style={{ color: '#5C6862' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {showCreateForm && createEntryError && (
                <div className="font-mono text-xs px-3 py-2 rounded mb-2" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
                  {createEntryError}
                </div>
              )}
              {showCreateForm && (
                <div className="font-mono text-[10px] mb-4" style={{ color: '#5C6862' }}>All three fields are required. Your real name and email are only ever visible to the commissioner, never shown publicly.</div>
              )}
            </>
          )}

          {myIdLoaded && (
            isAdmin ? (
              <>
                {myIdValid && (
                  <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded mb-2" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                    <UserCircle size={14} color="#7FCB98" />
                    You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                    <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
                  <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>All entrants (admin view)</div>
                  <div className="flex items-center gap-3">
                    <button onClick={runBackup} disabled={backupStatus?.loading} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#7FCB98', opacity: backupStatus?.loading ? 0.6 : 1 }}>
                      <RefreshCw size={10} className={backupStatus?.loading ? 'animate-spin' : ''} /> {backupStatus?.loading ? 'Backing up…' : 'Backup Now'}
                    </button>
                    {data.participants.some(p => p.email) && (
                      <button onClick={exportEmails} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#3D9B5C' }}>
                        <Download size={10} /> Export emails (.csv)
                      </button>
                    )}
                  </div>
                </div>
                {backupStatus && !backupStatus.loading && (
                  <div className="font-mono text-[10px] mb-2" style={{ color: backupStatus.ok ? '#7FCB98' : '#E28A82' }}>
                    {backupStatus.ok ? `Backed up all 3 pools to Google Sheets at ${new Date(backupStatus.syncedAt).toLocaleTimeString()}.` : `Backup failed: ${backupStatus.error}`}
                  </div>
                )}
                {data.participants.length === 0 ? (
                  <div className="font-mono text-xs" style={{ color: '#5C6862' }}>No entrants yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map(p => (
                      <div
                        key={p.id}
                        className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs"
                        style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}
                      >
                        <button onClick={() => handleNameTap(p)} className="flex items-center gap-1" style={{ color: '#F0EDE4' }}>
                          {p.pin ? <Lock size={10} color="#7FCB98" /> : <Lock size={10} color="#3A4A42" />}
                          {p.name}
                        </button>
                        {(p.realName || p.email) && (
                          <span style={{ color: '#5C6862', fontSize: '9px' }}>
                            ({p.realName || '?'}{p.email ? ` — ${p.email}` : ''})
                          </span>
                        )}
                        {p.pin && (
                          <button
                            onClick={() => resetPin(p.id)}
                            className="underline"
                            style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}
                          >
                            {resetConfirmId === p.id ? 'Confirm reset?' : 'Reset PIN'}
                          </button>
                        )}
                        {p.lastPinReset && (
                          <span
                            title={new Date(p.lastPinReset.at).toLocaleString()}
                            style={{ color: '#5C6862', fontSize: '9px' }}
                          >
                            (reset by {p.lastPinReset.byName}, {new Date(p.lastPinReset.at).toLocaleDateString()})
                          </span>
                        )}
                        <button onClick={() => removeParticipant(p.id)} title="Remove entrant" style={{ color: '#5C6862' }}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : myIdValid ? (
              <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                <UserCircle size={14} color="#7FCB98" />
                You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
              </div>
            ) : claimPrompt ? (
              <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
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
                    style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
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
              <>
                <div className="font-mono text-[20px] uppercase mb-1.5" style={{ color: '#5C6862' }}>Returning member?</div>
                <div className="font-mono text-[10px] mb-1.5" style={{ color: '#3A4A42' }}>
                  Already have an entry? Search for your name here instead of creating a new one.
                </div>
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Start typing your real or display name…"
                  className="w-full px-3 py-2 rounded outline-none font-head text-sm"
                  style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                />
                {memberSearch.trim() && (
                  <div className="mt-2 space-y-1">
                    {(() => {
                      const q = memberSearch.trim().toLowerCase();
                      const matches = data.participants.filter(p => p.name.toLowerCase().includes(q) || (p.realName || '').toLowerCase().includes(q)).slice(0, 8);
                      if (matches.length === 0) {
                        return <div className="font-mono text-xs px-1" style={{ color: '#5C6862' }}>No matches</div>;
                      }
                      return matches.map(p => (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                          <button onClick={() => handleNameTap(p)} className="flex-1 text-left flex items-center gap-1.5 font-head text-sm" style={{ color: '#F0EDE4' }}>
                            {p.pin && <Lock size={10} color="#7FCB98" />}
                            {p.name}
                          </button>
                          {p.pin && (
                            <button
                              onClick={() => resetPin(p.id)}
                              className="font-mono text-[10px] underline"
                              style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}
                            >
                              {resetConfirmId === p.id ? 'Confirm reset?' : 'Reset PIN'}
                            </button>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </>
            )
          )}
        </div>

        {data.participants.length === 0 ? (
          <div className="text-center py-16 font-head uppercase tracking-wide" style={{ color: '#5C6862' }}>
            Add your first entrant to kick off the pool
          </div>
        ) : (
          <>
            {/* Week tabs */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setViewWeek(w => ALL_WEEKS[Math.max(0, ALL_WEEKS.indexOf(w) - 1)])}
                  className="p-1 rounded"
                  style={{ color: '#8A9A90' }}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {ALL_WEEKS.map(w => (
                    <button
                      key={w}
                      onClick={() => setViewWeek(w)}
                      className="shrink-0 h-9 px-2.5 rounded font-mono text-sm flex flex-col items-center justify-center whitespace-nowrap leading-none"
                      style={{
                        background: w === viewWeek ? '#E8A23D' : '#1F2B25',
                        color: w === viewWeek ? '#0F1614' : '#8A9A90',
                        border: w === data.currentWeek ? '1px solid #E8A23D' : '1px solid #2A3830',
                        fontWeight: w === viewWeek ? 700 : 400,
                      }}
                    >
                      {isPreseasonWeek(w) ? weekLabel(w) : (
                        <>
                          <span style={{ fontSize: '8px', opacity: 0.75 }}>WK</span>
                          <span>{w}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setViewWeek(w => ALL_WEEKS[Math.min(ALL_WEEKS.length - 1, ALL_WEEKS.indexOf(w) + 1)])}
                  className="p-1 rounded"
                  style={{ color: '#8A9A90' }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              {viewWeek !== data.currentWeek && (
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#E8A23D' }}>
                  Set week {viewWeek} as current week
                </button>
              )}
            </div>

            {/* Make your pick — front and center, so nobody has to scroll the full entrant list
                (which could be 100+ names) just to find their own row and pick a team. */}
            {myId && (() => {
              const me = data.participants.find(p => p.id === myId);
              if (!me) return null;
              const myElimWeek = eliminatedAtWeek(myId);
              if (myElimWeek !== null) return null;
              const myPick = data.picks[viewWeek]?.[myId];
              const myLocked = isPickLocked(viewWeek, myPick?.team);
              const myUsed = usedTeams(myId, viewWeek - 1);
              if (myPick?.team) myUsed.delete(myPick.team);
              const scheduleReady = schedule[viewWeek]?.loaded;
              return (
                <div className="rounded px-4 py-3" style={{ background: '#1C2823', border: '1px solid #3D9B5C', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                  <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#7FCB98' }}>
                    <Trophy size={14} /> Make your pick — Week {weekLabel(viewWeek)}
                  </div>
                  {myLocked ? (
                    <div className="font-mono text-xs flex items-center gap-1.5" style={{ color: '#5C6862' }}>
                      <Lock size={12} />
                      {myPick?.team ? `Locked in: ${myPick.team}` : 'Locked — no pick was made this week'}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(schedule[viewWeek]?.games || []).map(g => {
                        const awaySelected = myPick?.team === g.away.abbr;
                        const homeSelected = myPick?.team === g.home.abbr;
                        const awayUsed = myUsed.has(g.away.abbr) && !isAdmin;
                        const homeUsed = myUsed.has(g.home.abbr) && !isAdmin;
                        const awayLocked = isPickLocked(viewWeek, g.away.abbr);
                        const homeLocked = isPickLocked(viewWeek, g.home.abbr);
                        return (
                          <div key={g.id} className="flex flex-col items-center gap-1">
                            {g.odds?.details && (
                              <div className="font-mono text-[9px]" style={{ color: '#5C6862' }}>{g.odds.details}</div>
                            )}
                            <div className="flex items-stretch rounded overflow-hidden" style={{ border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                              <button
                                onClick={() => requestPick(viewWeek, myId, g.away.abbr, me.name, myPick?.team)}
                                disabled={awayUsed || awayLocked}
                                className="px-2.5 py-1.5 text-center"
                                style={{
                                  background: awaySelected ? '#3D9B5C' : '#0F1614',
                                  color: awaySelected ? '#0F1614' : ((awayUsed || awayLocked) ? '#3A4A42' : '#F0EDE4'),
                                  cursor: (awayUsed || awayLocked) ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <div className="font-head text-xs">{g.away.abbr}</div>
                                <div className="font-mono" style={{ fontSize: '9px', opacity: 0.8 }}>{awayLocked ? 'locked' : g.away.record}</div>
                              </button>
                              <div className="flex items-center px-1 font-mono text-[10px]" style={{ color: '#5C6862', background: '#1C2823' }}>@</div>
                              <button
                                onClick={() => requestPick(viewWeek, myId, g.home.abbr, me.name, myPick?.team)}
                                disabled={homeUsed || homeLocked}
                                className="px-2.5 py-1.5 text-center"
                                style={{
                                  background: homeSelected ? '#3D9B5C' : '#0F1614',
                                  color: homeSelected ? '#0F1614' : ((homeUsed || homeLocked) ? '#3A4A42' : '#F0EDE4'),
                                  cursor: (homeUsed || homeLocked) ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <div className="font-head text-xs">{g.home.abbr}</div>
                                <div className="font-mono" style={{ fontSize: '9px', opacity: 0.8 }}>{homeLocked ? 'locked' : g.home.record}</div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {!scheduleReady && (
                        <div className="font-mono text-xs" style={{ color: '#5C6862' }}>Loading matchups…</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Team availability */}
            <div>
              <button
                onClick={() => setShowAvailability(s => !s)}
                className="font-head uppercase text-sm tracking-[0.2em] mb-3 flex items-center gap-2"
                style={{ color: '#8A9A90' }}
              >
                <Users size={14} /> Team Availability {showAvailability ? '▾' : '▸'}
              </button>
              {showAvailability && (
                <>
                  <div className="font-mono text-xs mb-2" style={{ color: '#5C6862' }}>
                    Share of alive entrants ({aliveParticipants.length}) who haven't used each team through week {weekLabel(prevWeekInSeason)}.
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {teamAvailability.map(t => (
                      <div key={t.abbr} className="rounded px-2.5 py-2" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                        <div className="flex items-center justify-between font-mono text-xs mb-1">
                          <span className="font-head" style={{ color: '#F0EDE4' }}>{t.abbr}</span>
                          <span style={{ color: t.pct >= 50 ? '#7FCB98' : t.pct > 0 ? '#E8A23D' : '#E28A82' }}>{t.pct}%</span>
                        </div>
                        <div className="h-1.5 rounded overflow-hidden" style={{ background: '#0F1614' }}>
                          <div style={{ width: `${t.pct}%`, height: '100%', background: t.pct >= 50 ? '#3D9B5C' : t.pct > 0 ? '#E8A23D' : '#C1443A' }} />
                        </div>
                        <div className="font-mono text-[10px] mt-1" style={{ color: '#5C6862' }}>{t.availableCount}/{aliveParticipants.length} alive</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Pick distribution */}
            <div>
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-3" style={{ color: '#8A9A90' }}>
                Week {viewWeek} Pick Distribution
              </div>
              {!weekLocked ? (
                <div className="font-mono text-xs" style={{ color: '#5C6862' }}>
                  Unlocks once this week's picks lock, so nobody can see the crowd before choosing.
                </div>
              ) : (
                <div className="space-y-2">
                  {pickDistribution.map(t => (
                    <div key={t.abbr} className="flex items-center gap-3">
                      <div className="w-16 shrink-0 font-head text-xs" style={{ color: t.isNoPick ? '#5C6862' : '#F0EDE4' }}>{t.abbr}</div>
                      <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                        <div style={{ width: `${t.pct}%`, height: '100%', background: t.isNoPick ? '#5C6862' : '#3D9B5C' }} />
                      </div>
                      <div className="w-20 shrink-0 font-mono text-xs text-right" style={{ color: '#8A9A90' }}>
                        {t.pct}% ({t.count})
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Season picks — one row per entrant, alive first (alphabetical by last name), eliminated
                at the bottom. The current week shows the live picker inline for your own row (or
                admin); every other week — and everyone else's current week — shows as a chip. */}
            <div>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="font-head uppercase text-sm tracking-[0.2em]" style={{ color: '#8A9A90' }}>
                  Season picks
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-mono text-xs flex items-center gap-1" style={{ color: '#5C6862' }}>
                    Season
                    <input
                      type="number"
                      value={seasonYear}
                      onChange={e => setSeasonYear(Number(e.target.value))}
                      className="w-16 px-1.5 py-1 rounded font-mono text-xs"
                      style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
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
                {sortedParticipants.map(p => {
                  const elimWeek = eliminatedAtWeek(p.id);
                  const isOutByNow = elimWeek !== null && elimWeek < viewWeek;
                  const isMe = myId === p.id;
                  const currentPick = data.picks[viewWeek]?.[p.id];
                  const currentLocked = isPickLocked(viewWeek, currentPick?.team);
                  const scheduleReady = schedule[viewWeek]?.loaded;
                  const canEditCurrent = isAdmin && !currentLocked;
                  const used = usedTeams(p.id, viewWeek - 1);
                  if (currentPick?.team) used.delete(currentPick.team);

                  return (
                    <div
                      key={p.id}
                      className="rounded px-3 py-2.5"
                      style={{
                        background: isOutByNow ? '#17211D88' : '#1C2823',
                        border: isMe ? '1px solid #3D9B5C88' : '1px solid #2A3830',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)',
                        opacity: isOutByNow ? 0.55 : 1,
                      }}
                    >
                      <div className="flex items-center gap-3 mb-1.5">
                        <button
                          onClick={() => setExpandedId(id => id === p.id ? null : p.id)}
                          className="flex-1 min-w-0 font-head text-sm truncate flex items-center gap-1.5 text-left"
                        >
                          {elimWeek !== null && <Skull size={12} color="#C1443A" />}
                          {p.name}
                          <span style={{ color: '#5C6862', fontSize: '10px' }}>{expandedId === p.id ? '▾' : '▸'}</span>
                        </button>
                        {(() => {
                          if (!currentPick?.team) {
                            return <div className="font-mono text-xs shrink-0" style={{ color: '#5C6862' }}>No pick this week</div>;
                          }
                          if (!isRevealed(viewWeek, p.id, currentPick.team)) {
                            return (
                              <div className="font-mono text-xs shrink-0 flex items-center gap-1" style={{ color: '#5C6862' }}>
                                <Lock size={10} /> Hidden
                              </div>
                            );
                          }
                          const game = (schedule[viewWeek]?.games || []).find(g => g.away.abbr === currentPick.team || g.home.abbr === currentPick.team);
                          if (!game) {
                            return <div className="font-mono text-xs shrink-0" style={{ color: '#F0EDE4' }}>{currentPick.team}</div>;
                          }
                          const awayPicked = game.away.abbr === currentPick.team;
                          return (
                            <div className="font-mono text-xs shrink-0 flex items-center gap-1">
                              <span style={{ color: awayPicked ? '#F0EDE4' : '#8A9A90', fontWeight: awayPicked ? 700 : 400 }}>
                                {game.away.abbr}{game.away.score != null ? ` ${game.away.score}` : ''}
                              </span>
                              <span style={{ color: '#5C6862' }}>@</span>
                              <span style={{ color: !awayPicked ? '#F0EDE4' : '#8A9A90', fontWeight: !awayPicked ? 700 : 400 }}>
                                {game.home.abbr}{game.home.score != null ? ` ${game.home.score}` : ''}
                              </span>
                            </div>
                          );
                        })()}
                        {isAdmin && (
                          <button onClick={() => removeParticipant(p.id)} className="ml-auto shrink-0 p-1 rounded" style={{ color: '#5C6862' }}>
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {weeksForSeason(viewWeek).filter(w => w !== viewWeek || !canEditCurrent).map(w => {
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
                              title={shown ? `Week ${weekLabel(w)}${pk?.team ? ': ' + TEAM_MAP[pk.team] : ''}` : `Week ${weekLabel(w)}: hidden until kickoff`}
                              className="shrink-0 w-9 h-9 rounded font-mono text-[10px] flex items-center justify-center"
                              style={{ background: bg, border: `1px solid ${border}`, color: txt, opacity: grey ? 0.3 : 1 }}
                            >
                              {!pk?.team ? '·' : shown ? pk.team : <Lock size={10} />}
                            </div>
                          );
                        })}
                      </div>

                      {canEditCurrent && (
                        <div className="mt-2 pt-2 flex flex-col gap-2" style={{ borderTop: '1px solid #2A3830' }}>
                          <div className="flex flex-wrap gap-2">
                            {(schedule[viewWeek]?.games || []).map(g => {
                              const awaySelected = currentPick?.team === g.away.abbr;
                              const homeSelected = currentPick?.team === g.home.abbr;
                              const awayUsed = used.has(g.away.abbr) && !isAdmin;
                              const homeUsed = used.has(g.home.abbr) && !isAdmin;
                              const awayLocked = currentLocked || isPickLocked(viewWeek, g.away.abbr);
                              const homeLocked = currentLocked || isPickLocked(viewWeek, g.home.abbr);
                              return (
                                <div key={g.id} className="flex flex-col items-center gap-1">
                                  {g.odds?.details && (
                                    <div className="font-mono text-[9px]" style={{ color: '#5C6862' }}>{g.odds.details}</div>
                                  )}
                                  <div className="flex items-stretch rounded overflow-hidden" style={{ border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                                    <button
                                      onClick={() => requestPick(viewWeek, p.id, g.away.abbr, p.name, currentPick?.team)}
                                      disabled={awayLocked || awayUsed}
                                      className="px-2.5 py-1.5 text-center"
                                      style={{
                                        background: awaySelected ? '#3D9B5C' : '#0F1614',
                                        color: awaySelected ? '#0F1614' : ((awayLocked || awayUsed) ? '#3A4A42' : '#F0EDE4'),
                                        cursor: (awayLocked || awayUsed) ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      <div className="font-head text-xs">{g.away.abbr}</div>
                                      <div className="font-mono" style={{ fontSize: '9px', opacity: 0.8 }}>{awayLocked ? 'locked' : g.away.record}</div>
                                    </button>
                                    <div className="flex items-center px-1 font-mono text-[10px]" style={{ color: '#5C6862', background: '#1C2823' }}>@</div>
                                    <button
                                      onClick={() => requestPick(viewWeek, p.id, g.home.abbr, p.name, currentPick?.team)}
                                      disabled={homeLocked || homeUsed}
                                      className="px-2.5 py-1.5 text-center"
                                      style={{
                                        background: homeSelected ? '#3D9B5C' : '#0F1614',
                                        color: homeSelected ? '#0F1614' : ((homeLocked || homeUsed) ? '#3A4A42' : '#F0EDE4'),
                                        cursor: (homeLocked || homeUsed) ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      <div className="font-head text-xs">{g.home.abbr}</div>
                                      <div className="font-mono" style={{ fontSize: '9px', opacity: 0.8 }}>{homeLocked ? 'locked' : g.home.record}</div>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            {!scheduleReady && (
                              <div className="font-mono text-xs" style={{ color: '#5C6862' }}>Loading matchups…</div>
                            )}
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="font-mono text-[9px] uppercase" style={{ color: '#3A4A42' }}>Override:</span>
                              {['win', 'loss'].map(r => (
                                <button
                                  key={r}
                                  onClick={() => setResult(viewWeek, p.id, currentPick?.result === r ? 'pending' : r)}
                                  title={r === 'win' ? 'Mark as won' : 'Mark as lost'}
                                  className="w-6 h-6 rounded flex items-center justify-center"
                                  style={{
                                    background: currentPick?.result === r ? (r === 'win' ? '#3D9B5C' : '#C1443A') : '#1F2B25',
                                    border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)',
                                  }}
                                >
                                  {r === 'win' && <Check size={12} color={currentPick?.result === 'win' ? '#0F1614' : '#3A4A42'} />}
                                  {r === 'loss' && <X size={12} color={currentPick?.result === 'loss' ? '#0F1614' : '#3A4A42'} />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {expandedId === p.id && (
                        <div className="mt-2 pt-2 grid gap-1" style={{ borderTop: '1px solid #2A3830' }}>
                          {weeksForSeason(viewWeek).map(w => {
                            const pk = data.picks[w]?.[p.id];
                            const shown = isRevealed(w, p.id, pk?.team);
                            const isElimHere = elimWeek === w;
                            let valueText = '— no pick —';
                            let valueColor = '#5C6862';
                            if (pk?.team) {
                              if (!shown) {
                                valueText = 'Hidden until kickoff';
                              } else {
                                const resultLabel = pk.result === 'win' ? 'Win' : pk.result === 'loss' ? 'Loss' : 'Pending';
                                valueText = `${pk.team} — ${TEAM_MAP[pk.team] || pk.team} (${resultLabel})`;
                                valueColor = isElimHere ? '#E28A82' : pk.result === 'win' ? '#7FCB98' : '#8A9A90';
                              }
                            }
                            return (
                              <div key={w} className="flex items-center justify-between font-mono text-xs">
                                <span style={{ color: '#5C6862' }}>Week {weekLabel(w)}</span>
                                <span style={{ color: valueColor }}>{valueText}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Elimination animation — bomb pulsates, "explodes", then a skull holds for a couple
          seconds before the whole thing fades away. Purely cosmetic, fires once per session. */}
      {bombPhase && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(15,22,20,0.85)' }}>
          {bombPhase === 'pulse' && (
            <Bomb size={120} color="#E8A23D" style={{ animation: 'bomb-pulse 0.8s ease-in-out 3' }} />
          )}
          {bombPhase === 'explode' && (
            <Bomb size={120} color="#E8A23D" style={{ animation: 'bomb-explode 0.4s ease-out forwards' }} />
          )}
          {bombPhase === 'skull' && (
            <div className="flex flex-col items-center gap-3" style={{ animation: 'skull-appear 2s ease-in-out forwards' }}>
              <Skull size={140} color="#C1443A" />
              <div className="font-head text-2xl uppercase tracking-widest" style={{ color: '#C1443A' }}>Eliminated</div>
            </div>
          )}
          <style>{`
            @keyframes bomb-pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.5); }
            }
            @keyframes bomb-explode {
              0% { transform: scale(1); opacity: 1; }
              60% { transform: scale(3); opacity: 1; }
              100% { transform: scale(4); opacity: 0; }
            }
            @keyframes skull-appear {
              0% { transform: scale(0.4); opacity: 0; }
              15% { transform: scale(1.15); opacity: 1; }
              25% { transform: scale(1); opacity: 1; }
              88% { transform: scale(1); opacity: 1; }
              100% { transform: scale(1); opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* Admin PIN modal */}
      {adminPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #2A3830' }}>
            <div className="font-head text-sm uppercase tracking-wide mb-2" style={{ color: '#8A9A90' }}>
              {adminPrompt.mode === 'set' ? 'Set the admin PIN' : 'Enter admin PIN'}
            </div>
            <div className="font-mono text-xs mb-3" style={{ color: '#5C6862' }}>
              {adminPrompt.mode === 'set'
                ? 'This PIN unlocks admin mode across all three pools — lets you edit any pick even after it locks. Set once, use everywhere.'
                : 'One PIN works across Survivor, Confidence, and Lineup pools.'}
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
                style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
              />
              <button onClick={submitAdminPrompt} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#3D9B5C', color: '#0F1614' }}>
                {adminPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
              </button>
              <button onClick={() => setAdminPrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
            </div>
            {adminPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{adminPrompt.error}</div>}
          </div>
        </div>
      )}

      {/* Pick confirmation modal */}
      {pickConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
            <div className="font-head text-sm uppercase tracking-wide mb-2" style={{ color: '#8A9A90' }}>
              Confirm pick
            </div>
            <div className="font-mono text-sm mb-4" style={{ color: '#F0EDE4' }}>
              {pickConfirm.prevTeam ? (
                <>Change <span style={{ color: '#E8A23D' }}>{pickConfirm.participantName}</span>'s week {pickConfirm.week} pick from <b>{pickConfirm.prevTeam}</b> to <b>{pickConfirm.team}</b>?</>
              ) : (
                <>Save <span style={{ color: '#E8A23D' }}>{pickConfirm.participantName}</span>'s week {pickConfirm.week} pick as <b>{pickConfirm.team}</b>?</>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPickConfirm(null)}
                className="px-3 py-1.5 rounded font-head text-xs uppercase"
                style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmPickNow}
                className="px-3 py-1.5 rounded font-head text-xs uppercase"
                style={{ background: '#3D9B5C', color: '#0F1614' }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <PoolChat
        messages={data.chatMessages || []}
        isAdmin={isAdmin}
        myId={myId}
        myName={data.participants.find(p => p.id === myId)?.name || ''}
        onPost={postMessage}
        onDelete={deleteMessage}
        accent="#3D9B5C"
      />

      {/* Saved indicator */}
      {justSaved && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs" style={{ background: '#1C2823', border: '1px solid #3D9B5C', color: '#7FCB98' }}>
          <Check size={12} /> Saved
        </div>
      )}
    </div>
  );
}
