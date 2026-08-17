import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Users, Loader2, RefreshCw, AlertCircle, Lock, UserCircle, ArrowLeft, ListOrdered, Trophy, Check, Download, Coins } from 'lucide-react';
import { WEEKS, ALL_WEEKS, weekLabel, weeksForSeason, isPreseasonWeek } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool, mergePoolData } from '../lib/api';
import { useEspnSchedule, fetchWeekResults } from '../lib/espnSchedule';
import { useAdminMode } from '../lib/admin';
import PoolTicker from '../components/PoolTicker';
import PoolChat from '../components/PoolChat';
import PoolRules from '../components/PoolRules';

const POOL_KEY = 'confidence-pool-v1';
const IDENTITY_KEY = 'my-participant-id-confidence';
const POLL_MS = 15000;

const emptyData = () => ({ name: 'Confidence Pool', participants: [], picks: {}, results: {}, mnfActual: {}, currentWeek: 1 });

const CONFIDENCE_ENTRY_FEE = 25;
const CONFIDENCE_RULES = [
  {
    heading: 'How it works',
    body: [
      'Every week, pick a winner in every single game on the slate.',
      'Rank your confidence in each pick from most confident (highest points) to least confident (lowest points) — if there are 16 games, your most confident pick is worth 16 points, your least confident is worth 1.',
      'Get a pick right, you earn the confidence points you assigned it. Get it wrong, you earn zero for that game.',
      'If a game ends in a tie, nobody gets points for it either way — it\'s a wash regardless of who you picked.',
    ],
  },
  {
    heading: 'Missed picks',
    body: 'If you don\'t rank a game before it locks, it gets automatically placed in the middle of your confidence order — not the harshest penalty, not the most lenient.',
  },
  {
    heading: 'Tiebreaker',
    body: 'Enter your guess for the combined final score of the week\'s last game (Monday Night Football, or whichever game kicks off latest). If two or more people tie in points for the week, whoever\'s guess is closest to the actual combined score wins the tiebreak.',
  },
  {
    heading: 'Standings & locking',
    body: [
      'Early games (Thursday, Saturday, international) lock at their own kickoff time.',
      'All Sunday 1pm-or-later games lock together, all at once.',
      'Your picks stay hidden from everyone else until they lock.',
      'Weekly standings and the season leaderboard both update automatically as results come in.',
    ],
  },
];

// Missed picks (game closed, no winner selected) are pulled out of the natural drag order and
// reinserted near the middle of that week's confidence range — not the top (too harsh for a
// simple forgotten early-week pick) and not the bottom (too lenient a penalty).
function repositionMissed(order, winners, isClosedFn) {
  const n = order.length;
  if (!n) return order;
  const kept = [];
  const missed = [];
  order.forEach(gid => {
    const hasPick = !!(winners && winners[gid]);
    if (!hasPick && isClosedFn(gid)) missed.push(gid);
    else kept.push(gid);
  });
  if (!missed.length) return order;
  const result = [...kept];
  const insertAt = Math.max(0, Math.floor((n - missed.length) / 2));
  result.splice(insertAt, 0, ...missed);
  return result;
}

export default function ConfidencePool() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [viewWeek, setViewWeek] = useState(1);
  const [newName, setNewName] = useState('');
  const [newRealName, setNewRealName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createEntryError, setCreateEntryError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [tiebreakerReminder, setTiebreakerReminder] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [backupStatus, setBackupStatus] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [dragInfo, setDragInfo] = useState(null); // { pid, index }
  const [justSaved, setJustSaved] = useState(false);
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const { schedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);
  // Pinned independently of viewWeek so the join-deadline check works no matter what week
  // someone's currently looking at. PRE 1 (week 101) is the actual start of the season here,
  // not regular week 1, since preseason comes first.
  const { lockTimeForPick: lockTimeForPickWeek1 } = useEspnSchedule(101, seasonYear);
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();

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

  const week1JoinDeadline = lockTimeForPickWeek1(101, undefined);
  const joinClosed = !isAdmin && week1JoinDeadline !== null && now >= week1JoinDeadline;

  const addParticipant = () => {
    if (joinClosed && !isAdmin) return;
    const name = newName.trim();
    const realName = newRealName.trim();
    const email = newEmail.trim();
    if (!name || !realName || !email) return;
    const norm = s => (s || '').trim().toLowerCase();
    const isDuplicate = data.participants.some(p => norm(p.realName) === norm(realName) || norm(p.email) === norm(email));
    if (isDuplicate) {
      setCreateEntryError('This pool only allows one entry per person — that name or email is already registered.');
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

  const games = schedule[viewWeek]?.games || [];
  const maxConfidence = games.length;

  // Same lock rule as Survivor: early games (Thu/int'l/Sat) lock at their own kickoff;
  // every Sunday-1pm-or-later game, including Sunday night and Monday night, locks together
  // once the early Sunday window starts.
  const isGameLocked = (g) => {
    if (isAdmin) return false;
    const lockTime = lockTimeForPick(viewWeek, g.away.abbr); // same value for either side of the game
    return lockTime !== null && now >= lockTime;
  };
  const isMassLocked = () => {
    if (isAdmin) return false;
    const lockTime = lockTimeForPick(viewWeek, undefined);
    return lockTime !== null && now >= lockTime;
  };
  const isGameRevealed = (pid, g) => {
    if (isAdmin) return true;
    if (myId && pid === myId) return true;
    return isGameLocked(g);
  };
  const isTiebreakerRevealed = (pid) => {
    if (isAdmin) return true;
    if (myId && pid === myId) return true;
    return isMassLocked();
  };

  // Returns this participant's confidence order for the week, normalized to include
  // every current game (any new/missing games get appended at the bottom).
  const getOrder = (pid) => {
    const stored = data.picks[viewWeek]?.[pid]?.order || [];
    const validIds = games.map(g => g.id);
    const filtered = stored.filter(id => validIds.includes(id));
    const missing = validIds.filter(id => !filtered.includes(id));
    return [...filtered, ...missing];
  };

  // Display order = raw stored order, with any closed-but-unpicked games pulled to the middle.
  const closedCheckForWeek = (w) => (gid) => !!data.results?.[w]?.[gid]?.completed;
  const getDisplayOrder = (pid) => {
    const raw = getOrder(pid);
    const winners = data.picks[viewWeek]?.[pid]?.winners || {};
    const closedCheck = (gid) => {
      const g = games.find(x => x.id === gid);
      if (g && isGameLocked(g)) return true;
      return closedCheckForWeek(viewWeek)(gid);
    };
    return repositionMissed(raw, winners, closedCheck);
  };

  const setWinner = (week, pid, gameId, abbr) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prevEntry = next.picks[week][pid] || {};
    const winners = { ...(prevEntry.winners || {}), [gameId]: abbr };
    const order = (prevEntry.order && prevEntry.order.length) ? prevEntry.order : getOrder(pid);
    next.picks[week][pid] = { ...prevEntry, winners, order };
    persist(next);

    // Just picked the last remaining game for the week — if the tiebreaker isn't filled in yet,
    // it's easy to forget since there's nothing left prompting for it otherwise.
    const allPicked = games.length > 0 && games.every(g => winners[g.id]);
    const tiebreakerMissing = prevEntry.tiebreaker == null || prevEntry.tiebreaker === '';
    if (allPicked && tiebreakerMissing) {
      setTiebreakerReminder(pid);
    }
  };

  const setTiebreaker = (week, pid, value) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prevEntry = next.picks[week][pid] || {};
    next.picks[week][pid] = { ...prevEntry, tiebreaker: value };
    persist(next);
  };

  const reorder = (week, pid, displayOrder, fromIndex, toIndex) => {
    const arr = [...displayOrder];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prevEntry = next.picks[week][pid] || {};
    next.picks[week][pid] = { ...prevEntry, order: arr };
    persist(next);
  };

  const handleDragStart = (pid, index) => setDragInfo({ pid, index });
  const handleDropOn = (pid, index) => {
    if (!dragInfo || dragInfo.pid !== pid || dragInfo.index === index) { setDragInfo(null); return; }
    const displayOrder = getDisplayOrder(pid);
    reorder(viewWeek, pid, displayOrder, dragInfo.index, index);
    setDragInfo(null);
  };
  // Tap-based reordering — native HTML5 drag-and-drop doesn't work on touchscreens at all, so
  // this is the mobile-friendly way to reorder; works fine as an alternative on desktop too.
  const moveInDisplayOrder = (pid, index, direction) => {
    const displayOrder = getDisplayOrder(pid);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= displayOrder.length) return;
    reorder(viewWeek, pid, displayOrder, index, targetIndex);
  };

  const syncResults = async (week) => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { gameResults, completedGames, mnfTotal } = await fetchWeekResults(week, seasonYear);
      if (completedGames === 0) {
        setSyncMsg(`No finished games yet for week ${week} — try again after kickoff.`);
        return;
      }
      const next = {
        ...data,
        results: { ...data.results, [week]: { ...(data.results?.[week] || {}), ...gameResults } },
        mnfActual: mnfTotal != null ? { ...(data.mnfActual || {}), [week]: mnfTotal } : (data.mnfActual || {}),
      };
      persist(next);
      setSyncMsg(`Synced ${completedGames} finished game${completedGames === 1 ? '' : 's'} for week ${week}${mnfTotal != null ? ` — MNF total: ${mnfTotal}` : ''}.`);
    } catch (e) {
      setSyncMsg('Could not reach the ESPN score feed.');
    } finally {
      setSyncing(false);
    }
  };

  // Points a participant earned in a given week: missed picks are repositioned to the
  // middle before scoring, exactly as in the live display, using synced results as the
  // "is this game decided" signal (works for any past week, not just the one being viewed).
  const weeklyPoints = (pid, w) => {
    const entry = data.picks[w]?.[pid];
    if (!entry?.order?.length) return 0;
    const weekResults = data.results?.[w] || {};
    const effOrder = repositionMissed(entry.order, entry.winners || {}, closedCheckForWeek(w));
    const n = effOrder.length;
    let total = 0;
    effOrder.forEach((gid, idx) => {
      const winner = entry.winners?.[gid];
      const res = weekResults[gid];
      if (res?.completed && winner && res.winnerAbbr === winner) total += (n - idx);
    });
    return total;
  };

  // The most points still mathematically reachable this week: already-correct picks (locked
  // in) plus every pick whose game hasn't been decided yet (optimistic — still possible to go
  // their way). A wrong pick, a tie, or a missed pick can never score, so those are excluded
  // even before their game finishes, same as they're excluded from the real total.
  const weeklyBestPossible = (pid, w) => {
    const entry = data.picks[w]?.[pid];
    if (!entry?.order?.length) return 0;
    const weekResults = data.results?.[w] || {};
    const effOrder = repositionMissed(entry.order, entry.winners || {}, closedCheckForWeek(w));
    const n = effOrder.length;
    let total = 0;
    effOrder.forEach((gid, idx) => {
      const winner = entry.winners?.[gid];
      if (!winner) return;
      const res = weekResults[gid];
      if (res?.completed) {
        if (res.winnerAbbr === winner) total += (n - idx);
      } else {
        total += (n - idx);
      }
    });
    return total;
  };

  // Reflects whichever season is currently being viewed — preseason weeks accumulate their own
  // running total while you're on a PRE tab, regular season weeks accumulate separately once
  // the real season starts. They never mix, so nothing from beta testing carries over later.
  const seasonTotal = (pid) => weeksForSeason(viewWeek).reduce((sum, w) => sum + weeklyPoints(pid, w), 0);

  const numTopSpots = Math.max(1, Math.ceil(data.participants.length / 12));

  const weeklyLeaderboard = (w) => {
    const actualMnf = data.mnfActual?.[w] ?? null;
    const rows = data.participants.map(p => ({
      ...p,
      points: weeklyPoints(p.id, w),
      guess: data.picks[w]?.[p.id]?.tiebreaker ?? null,
    }));
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (actualMnf == null) return 0;
      const da = a.guess == null ? Infinity : Math.abs(a.guess - actualMnf);
      const db = b.guess == null ? Infinity : Math.abs(b.guess - actualMnf);
      return da - db;
    });
    return rows;
  };

  const leaderboard = [...data.participants]
    .map(p => ({ ...p, total: seasonTotal(p.id) }))
    .sort((a, b) => b.total - a.total);

  return (
    <div style={{ background: 'radial-gradient(ellipse 90% 60% at 50% -10%, #17211D 0%, #0F1614 55%)', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
        .rounded { border-radius: 10px !important; }
        button { transition: transform 0.12s ease, box-shadow 0.12s ease, background-color 0.12s ease; }
        button:active { transform: scale(0.97); }
        input, select { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        input:focus, select:focus { outline: none; border-color: #E8A23D88 !important; box-shadow: 0 0 0 3px #E8A23D22; }

        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #3A4A42; border-radius: 4px; }
        select { color-scheme: dark; }
      `}</style>

      <div style={{ background: 'linear-gradient(180deg,#1B2721,#0F1614)', borderBottom: '1px solid #E8A23D33', boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto mb-3 flex items-center gap-3">
          <img src="/logo.webp" alt="" className="w-7 h-7 rounded object-cover shrink-0" />
          <Link to="/" className="font-mono text-xs flex items-center gap-1.5 w-fit" style={{ color: '#8A9A90' }}>
            <ArrowLeft size={12} /> All Pools
          </Link>
          <PoolRules title="Confidence Pool" entryFee={CONFIDENCE_ENTRY_FEE} sections={CONFIDENCE_RULES} accent="#E8A23D" />
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
                className="font-head text-2xl sm:text-3xl tracking-wide flex items-center gap-2 min-w-0 text-left" style={{ letterSpacing: "0.02em" }}
              >
                <span className="truncate uppercase">{data.name}</span>
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#8A9A90' }}>Current Week</div>
            <div className="font-display text-3xl leading-none" style={{ color: '#E8A23D', letterSpacing: '1px', textShadow: '0 0 24px #E8A23D55' }}>
              {isPreseasonWeek(data.currentWeek) ? (
                <>PRE {data.currentWeek - 100}<span style={{ color: '#5C6862', fontSize: '0.5em' }}> / 3</span></>
              ) : (
                <>{String(data.currentWeek).padStart(2, '0')}<span style={{ color: '#5C6862', fontSize: '0.5em' }}> / 18</span></>
              )}
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

        <PoolTicker message={data.tickerMessage} isAdmin={isAdmin} onSave={setTickerMessage} accent="#E8A23D" />

        {/* Entrants */}
        <div>
          <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
            <Users size={14} /> Entrants
          </div>

          <div className="font-mono text-[20px] uppercase mb-1.5" style={{ color: '#5C6862' }}>Create new entry?</div>
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-3 font-head text-sm uppercase tracking-wide"
            style={{ color: '#0F1614', background: 'linear-gradient(135deg,#F0C168,#E8A23D)', animation: 'entry-fee-pulse 2.4s ease-in-out infinite' }}
          >
            <Coins size={15} /> Entry Fee: {CONFIDENCE_ENTRY_FEE} units
          </div>
          <style>{`
            @keyframes entry-fee-pulse {
              0%, 100% { box-shadow: 0 0 8px #E8A23D66, 0 0 2px #E8A23D; }
              50% { box-shadow: 0 0 18px #E8A23Dcc, 0 0 6px #E8A23D; }
            }
          `}</style>
          {joinClosed ? (
            <div className="font-mono text-xs px-3 py-2 rounded mb-4" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
              Entries closed — PRE 1 picks have locked, no new entrants can join this season.
            </div>
          ) : !showCreateForm ? (
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1 mb-4"
              style={{ background: '#E8A23D', color: '#0F1614' }}
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
                  style={{ background: (!newName.trim() || !newRealName.trim() || !newEmail.trim()) ? '#1F2B25' : '#E8A23D', color: (!newName.trim() || !newRealName.trim() || !newEmail.trim()) ? '#5C6862' : '#0F1614' }}
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

          {myIdLoaded && (
            myId && data.participants.some(p => p.id === myId) ? (
              <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                <UserCircle size={14} color="#E8A23D" />
                You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
              </div>
            ) : claimPrompt ? (
              <div className="px-3 py-2.5 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
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
                    style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                  />
                  <button onClick={submitClaim} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
                    {claimPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
                  </button>
                  <button onClick={() => setClaimPrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
                </div>
                {claimPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{claimPrompt.error}</div>}
              </div>
            ) : isAdmin ? (
              <>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
                  <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>All entrants (admin view)</div>
                  <div className="flex items-center gap-3">
                    <button onClick={runBackup} disabled={backupStatus?.loading} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#7FCB98', opacity: backupStatus?.loading ? 0.6 : 1 }}>
                      <RefreshCw size={10} className={backupStatus?.loading ? 'animate-spin' : ''} /> {backupStatus?.loading ? 'Backing up…' : 'Backup Now'}
                    </button>
                    {data.participants.some(p => p.email) && (
                      <button onClick={exportEmails} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#E8A23D' }}>
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
                      <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                        <button onClick={() => handleNameTap(p)} className="flex items-center gap-1" style={{ color: '#F0EDE4' }}>
                          {p.pin ? <Lock size={10} color="#E8A23D" /> : <Lock size={10} color="#3A4A42" />}
                          {p.name}
                        </button>
                        {(p.realName || p.email) && (
                          <span style={{ color: '#5C6862', fontSize: '9px' }}>
                            ({p.realName || '?'}{p.email ? ` — ${p.email}` : ''})
                          </span>
                        )}
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
                        <button onClick={() => removeParticipant(p.id)} title="Remove entrant" style={{ color: '#5C6862' }}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="font-mono text-[20px] uppercase mb-1.5" style={{ color: '#5C6862' }}>Returning member?</div>
                <div className="font-mono text-[10px] mb-1.5" style={{ color: '#3A4A42' }}>
                  Already have an entry? Search for your name here instead of creating a new one.
                </div>
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Start typing your name…"
                  className="w-full px-3 py-2 rounded outline-none font-head text-sm"
                  style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                />
                {memberSearch.trim() && (
                  <div className="mt-2 space-y-1">
                    {(() => {
                      const matches = data.participants.filter(p => p.name.toLowerCase().includes(memberSearch.trim().toLowerCase())).slice(0, 8);
                      if (matches.length === 0) {
                        return <div className="font-mono text-xs px-1" style={{ color: '#5C6862' }}>No matches</div>;
                      }
                      return matches.map(p => (
                        <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                          <button onClick={() => handleNameTap(p)} className="flex-1 text-left flex items-center gap-1.5 font-head text-sm" style={{ color: '#F0EDE4' }}>
                            {p.pin && <Lock size={10} color="#E8A23D" />}
                            {p.name}
                          </button>
                          {p.pin && (
                            <button onClick={() => resetPin(p.id)} className="font-mono text-[10px] underline" style={{ color: resetConfirmId === p.id ? '#E8A23D' : '#5C6862' }}>
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
                ><ChevronLeft size={18} /></button>
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
                ><ChevronRight size={18} /></button>
              </div>
              {viewWeek !== data.currentWeek && (
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#E8A23D' }}>
                  Set week {weekLabel(viewWeek)} as current week
                </button>
              )}
            </div>

            {/* Sync + status */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-head uppercase text-sm tracking-[0.2em]" style={{ color: '#8A9A90' }}>
                Week {weekLabel(viewWeek)} — {games.length} games, {maxConfidence} pts max
              </div>
              <div className="flex items-center gap-2">
                <label className="font-mono text-xs flex items-center gap-1" style={{ color: '#5C6862' }}>
                  Season
                  <input type="number" value={seasonYear} onChange={e => setSeasonYear(Number(e.target.value))} className="w-16 px-1.5 py-1 rounded font-mono text-xs" style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }} />
                </label>
                <button
                  onClick={() => syncResults(viewWeek)}
                  disabled={syncing}
                  className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5"
                  style={{ background: '#1F2B25', border: '1px solid #E8A23D', color: '#E8A23D', opacity: syncing ? 0.6 : 1 }}
                >
                  <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing…' : `Sync week ${weekLabel(viewWeek)} results`}
                </button>
              </div>
            </div>
            {syncMsg && (
              <div className="font-mono text-xs flex items-start gap-1.5 -mt-4" style={{ color: '#E8A23D' }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {syncMsg}
              </div>
            )}

            {/* Picks for viewing/editing — only your own card (or all, for admin); everyone else's
                picks now live in the compact standings grid below instead of a full card each. */}
            <div className="space-y-4">
              {data.participants.map(p => {
                const isMe = myId === p.id;
                if (!isAdmin && !isMe) return null;
                const weekEntry = data.picks[viewWeek]?.[p.id] || {};
                const winners = weekEntry.winners || {};
                const order = getDisplayOrder(p.id);
                const total = seasonTotal(p.id);
                const tiebreakerRevealed = isTiebreakerRevealed(p.id);
                const weekFullyLocked = games.length > 0 && games.every(g => isGameLocked(g));
                const isCardExpanded = expandedId === `mine-${p.id}` || !weekFullyLocked;
                return (
                  <div key={p.id} className="rounded px-4 py-3" style={{ background: '#1C2823', border: isMe ? '1px solid #E8A23D88' : '1px solid #2A3830' }}>
                    <button
                      onClick={() => weekFullyLocked && setExpandedId(id => id === `mine-${p.id}` ? null : `mine-${p.id}`)}
                      className="w-full flex items-center justify-between mb-2"
                      style={{ cursor: weekFullyLocked ? 'pointer' : 'default' }}
                    >
                      <div className="font-head text-sm flex items-center gap-2">
                        {p.name}
                        {weekFullyLocked && <span style={{ color: '#5C6862', fontSize: '10px' }}>{isCardExpanded ? '▾' : '▸'}</span>}
                      </div>
                      <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>Season: {total} pts</div>
                    </button>
                    {weekFullyLocked && !isCardExpanded ? (
                      <div className="font-mono text-xs flex items-center gap-1.5" style={{ color: '#5C6862' }}>
                        <Lock size={12} /> Picks locked for the week — tap to view, or see the standings grid below.
                      </div>
                    ) : games.length === 0 ? (
                      <div className="font-mono text-xs" style={{ color: '#5C6862' }}>Loading matchups…</div>
                    ) : (
                      <div className="space-y-4">
                        {/* Pick a winner and rank your confidence — most confident on top */}
                        <div>
                          <div className="font-mono text-[10px] uppercase mb-1.5" style={{ color: '#5C6862' }}>
                            Pick a winner in each matchup, then rank your confidence — most confident on top
                          </div>
                          <div className="space-y-1">
                            {order.map((gid, idx) => {
                              const g = games.find(gm => gm.id === gid);
                              if (!g) return null;
                              const gLocked = isGameLocked(g);
                              const gRevealed = isGameRevealed(p.id, g);
                              const confidence = order.length - idx;
                              if (!gRevealed) {
                                return (
                                  <div key={gid} className="flex items-center gap-2 rounded px-2.5 py-1.5 font-mono text-xs" style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#5C6862' }}>
                                    <Lock size={12} /> Hidden until kickoff
                                  </div>
                                );
                              }
                              const winner = winners[gid];
                              const awaySelected = winner === g.away.abbr;
                              const homeSelected = winner === g.home.abbr;
                              const result = data.results?.[viewWeek]?.[gid];
                              const missed = gLocked && !winner;
                              const isTie = result?.completed && result.winnerAbbr === null;
                              const correct = result?.completed && !isTie && winner && result.winnerAbbr === winner;
                              const wrong = result?.completed && !isTie && ((winner && result.winnerAbbr !== winner) || (!winner && gLocked));
                              return (
                                <div
                                  key={gid}
                                  draggable={!gLocked}
                                  onDragStart={() => handleDragStart(p.id, idx)}
                                  onDragOver={e => e.preventDefault()}
                                  onDrop={() => handleDropOn(p.id, idx)}
                                  className="flex items-center gap-2 rounded px-2.5 py-1.5 font-mono text-xs flex-wrap"
                                  style={{
                                    background: '#0F1614',
                                    border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)',
                                    cursor: gLocked ? 'default' : 'grab',
                                  }}
                                >
                                  <span className="w-6 text-center font-head shrink-0" style={{ color: '#E8A23D' }}>{confidence}</span>
                                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    {g.odds?.details && (
                                      <div className="font-mono text-[8px]" style={{ color: '#5C6862' }}>{g.odds.details}</div>
                                    )}
                                    <div className="flex items-stretch rounded overflow-hidden" style={{ border: '1px solid #2A3830' }}>
                                      <button
                                        onClick={() => setWinner(viewWeek, p.id, gid, g.away.abbr)}
                                        disabled={gLocked}
                                        className="px-2.5 py-1.5 text-center font-mono text-xs"
                                        style={{
                                          background: awaySelected ? '#3B82F6' : '#1C2823',
                                          color: awaySelected ? '#0F1614' : '#F0EDE4',
                                          cursor: gLocked ? 'not-allowed' : 'pointer',
                                        }}
                                      >
                                        {g.away.abbr}
                                      </button>
                                      <div className="flex items-center px-1 font-mono text-[10px]" style={{ color: '#5C6862', background: '#1C2823' }}>@</div>
                                      <button
                                        onClick={() => setWinner(viewWeek, p.id, gid, g.home.abbr)}
                                        disabled={gLocked}
                                        className="px-2.5 py-1.5 text-center font-mono text-xs"
                                        style={{
                                          background: homeSelected ? '#3B82F6' : '#1C2823',
                                          color: homeSelected ? '#0F1614' : '#F0EDE4',
                                          cursor: gLocked ? 'not-allowed' : 'pointer',
                                        }}
                                      >
                                        {g.home.abbr}
                                      </button>
                                    </div>
                                  </div>
                                  {missed && <span style={{ color: '#5C6862' }}>Missed pick</span>}
                                  {correct && <span style={{ color: '#7FCB98' }}>✓ +{confidence}</span>}
                                  {wrong && <span style={{ color: '#E28A82' }}>✗ 0</span>}
                                  {!gLocked && (
                                    <div className="flex gap-1.5 shrink-0 ml-auto">
                                      <button
                                        type="button"
                                        onClick={() => moveInDisplayOrder(p.id, idx, -1)}
                                        disabled={idx === 0}
                                        title="Move up"
                                        className="flex items-center justify-center rounded"
                                        style={{
                                          width: '38px',
                                          height: '38px',
                                          background: idx === 0 ? '#0F1614' : '#1F2B25',
                                          border: `1px solid ${idx === 0 ? '#2A3830' : '#E8A23D66'}`,
                                          color: idx === 0 ? '#2A3830' : '#E8A23D',
                                          cursor: idx === 0 ? 'default' : 'pointer',
                                        }}
                                      >
                                        <ChevronUp size={20} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => moveInDisplayOrder(p.id, idx, 1)}
                                        disabled={idx === order.length - 1}
                                        title="Move down"
                                        className="flex items-center justify-center rounded"
                                        style={{
                                          width: '38px',
                                          height: '38px',
                                          background: idx === order.length - 1 ? '#0F1614' : '#1F2B25',
                                          border: `1px solid ${idx === order.length - 1 ? '#2A3830' : '#E8A23D66'}`,
                                          color: idx === order.length - 1 ? '#2A3830' : '#E8A23D',
                                          cursor: idx === order.length - 1 ? 'default' : 'pointer',
                                        }}
                                      >
                                        <ChevronDown size={20} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Tiebreaker */}
                        <div className="flex items-center gap-2 font-mono text-base flex-wrap">
                          <span style={{ color: '#8A9A90' }}>MNF tiebreaker (combined final score):</span>
                          {tiebreakerRevealed ? (
                            <input
                              type="number"
                              value={weekEntry.tiebreaker ?? ''}
                              onChange={e => setTiebreaker(viewWeek, p.id, e.target.value === '' ? null : Number(e.target.value))}
                              disabled={isMassLocked()}
                              className="w-24 px-2 py-1.5 rounded text-base"
                              style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                            />
                          ) : (
                            <span className="flex items-center gap-1 font-mono text-xs" style={{ color: '#5C6862' }}><Lock size={10} /> Hidden until kickoff</span>
                          )}
                          {data.mnfActual?.[viewWeek] != null && (
                            <span className="font-mono text-xs" style={{ color: '#8A9A90' }}>(actual: {data.mnfActual[viewWeek]})</span>
                          )}
                        </div>
                      </div>
                    )}
                    <button onClick={() => removeParticipant(p.id)} className="mt-3 font-mono text-[10px] underline" style={{ color: '#5C6862' }}>
                      Remove entrant
                    </button>
                  </div>
                );
              })}
              {!isAdmin && !myId && (
                <div className="font-mono text-xs px-3 py-2" style={{ color: '#5C6862' }}>
                  Claim your name above (under "Returning member?") to make your picks.
                </div>
              )}
            </div>

            {/* Weekly standings grid */}
            <div>
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-1 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                <Trophy size={14} /> Week {weekLabel(viewWeek)} Standings
              </div>
              <div className="font-mono text-[10px] mb-3" style={{ color: '#5C6862' }}>
                Top {numTopSpots} of {data.participants.length} entrants (1 spot per 12) — ties broken by closest MNF guess. Reorders automatically as results come in. Tap a name to see their picks.
              </div>
              <div className="space-y-1.5">
                {weeklyLeaderboard(viewWeek).map((p, i) => {
                  const weekEntry = data.picks[viewWeek]?.[p.id];
                  const winners = weekEntry?.winners || {};
                  const order = getDisplayOrder(p.id);
                  const cells = order.map((gid, idx) => {
                    const g = games.find(gm => gm.id === gid);
                    if (!g) return null;
                    const confidence = order.length - idx;
                    const revealed = isGameRevealed(p.id, g);
                    const winner = winners[gid];
                    const result = data.results?.[viewWeek]?.[gid];
                    const gLocked = isGameLocked(g);
                    const missed = gLocked && !winner;
                    const isTie = result?.completed && result.winnerAbbr === null;
                    const correct = result?.completed && !isTie && winner && result.winnerAbbr === winner;
                    const wrong = result?.completed && !isTie && ((winner && result.winnerAbbr !== winner) || missed);
                    return { gid, team: winner, matchup: `${g.away.abbr} @ ${g.home.abbr}${winner ? ` — picked ${winner}` : ''}`, confidence, revealed, correct, wrong };
                  }).filter(Boolean);
                  return (
                    <div
                      key={p.id}
                      className="rounded px-2.5 py-2"
                      style={{ background: '#1C2823', border: i < numTopSpots ? '1px solid #E8A23D88' : '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}
                    >
                      <button onClick={() => setExpandedId(id => id === p.id ? null : p.id)} className="w-full flex items-center gap-2">
                        <div className="font-mono text-[10px] w-4 shrink-0" style={{ color: i < numTopSpots ? '#E8A23D' : '#5C6862' }}>{i + 1}</div>
                        <div className="font-head text-xs flex-1 text-left truncate">{p.name}</div>
                        {p.guess != null && <div className="font-mono text-[9px] shrink-0 hidden sm:block" style={{ color: '#5C6862' }}>MNF Tie Breaker Score: {p.guess}</div>}
                        <div className="text-right shrink-0 leading-tight">
                          <div className="font-head text-sm" style={{ color: '#E8A23D' }}>{p.points}</div>
                          {(() => {
                            const best = weeklyBestPossible(p.id, viewWeek);
                            return best > p.points ? (
                              <div className="font-mono text-[9px]" style={{ color: '#5C6862' }}>Best Possible Total: {best}</div>
                            ) : null;
                          })()}
                        </div>
                        <span style={{ color: '#5C6862', fontSize: '10px' }}>{expandedId === p.id ? '▾' : '▸'}</span>
                      </button>
                      {expandedId === p.id && (
                        <div className="flex gap-1.5 flex-wrap mt-2.5 pt-2.5" style={{ borderTop: '1px solid #2A3830' }}>
                          {cells.length === 0 && <span className="font-mono text-[10px]" style={{ color: '#3A4A42' }}>No picks yet</span>}
                          {cells.map(c => (
                            <div
                              key={c.gid}
                              title={c.revealed ? c.matchup : 'Hidden until kickoff'}
                              className="px-2 py-1 rounded font-mono text-[10px]"
                              style={{
                                background: !c.revealed ? '#0F1614' : c.correct ? '#3D9B5C22' : c.wrong ? '#C1443A22' : '#0F1614',
                                border: `1px solid ${!c.revealed ? '#2A3830' : c.correct ? '#3D9B5C' : c.wrong ? '#C1443A' : '#2A3830'}`,
                                color: !c.revealed ? '#5C6862' : c.correct ? '#7FCB98' : c.wrong ? '#E28A82' : '#8A9A90',
                              }}
                            >
                              {!c.revealed ? '•••' : c.team ? `${c.team} (${c.confidence})` : `— (${c.confidence})`}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Season leaderboard */}
            <div>
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-1 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                <Trophy size={14} /> Season Leaderboard
              </div>
              <div className="font-mono text-[10px] mb-3" style={{ color: '#5C6862' }}>
                Top {numTopSpots} of {data.participants.length} entrants — season tiebreaker not yet set
              </div>
              <div className="space-y-1.5">
                {leaderboard.map((p, i) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded px-3 py-2"
                    style={{ background: '#1C2823', border: i < numTopSpots ? '1px solid #E8A23D88' : '1px solid #2A3830' }}
                  >
                    <div className="font-mono text-xs w-6" style={{ color: i < numTopSpots ? '#E8A23D' : '#5C6862' }}>{i + 1}</div>
                    <div className="font-head text-sm flex-1">{p.name}</div>
                    <div className="font-mono text-sm" style={{ color: '#E8A23D' }}>{p.total} pts</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* MNF tiebreaker reminder — fires once someone picks their last remaining game, in case
          the tiebreaker field gets missed since there's nothing else prompting for it. */}
      {tiebreakerReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #E8A23D' }}>
            <div className="font-head text-base uppercase tracking-wide mb-2" style={{ color: '#E8A23D' }}>
              One more thing
            </div>
            <div className="font-mono text-sm mb-4" style={{ color: '#F0EDE4' }}>
              MNF tiebreaker is needed to complete picks — don't forget to enter your guess for the combined final score below.
            </div>
            <button
              onClick={() => setTiebreakerReminder(null)}
              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide"
              style={{ background: '#E8A23D', color: '#0F1614' }}
            >
              Got it
            </button>
          </div>
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
              <button onClick={submitAdminPrompt} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
                {adminPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
              </button>
              <button onClick={() => setAdminPrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
            </div>
            {adminPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{adminPrompt.error}</div>}
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
        accent="#E8A23D"
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
