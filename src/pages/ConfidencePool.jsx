import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Users, Loader2, RefreshCw, AlertCircle, Lock, UserCircle, ArrowLeft, ListOrdered, Trophy, Check, Download, Coins, Pencil, GripVertical, Mail, Copy, Hash } from 'lucide-react';
import { WEEKS, ALL_WEEKS, weekLabel, weeksForSeason, isPreseasonWeek } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool, mergePoolData } from '../lib/api';
import { useEspnSchedule, fetchWeekResults, fetchWeekOdds } from '../lib/espnSchedule';
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
      'Every week, pick a winner in every single game on the slate — straight up, not against the spread. Any point spread shown is just for reference; picking the "underdog" only scores if they actually win the game outright.',
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
  {
    heading: 'Joining',
    body: 'This pool is single entry — one entry per person.',
  },
];

// Formats a game's kickoff for display next to the matchup, always in Eastern time to match
// the lock-time rules described elsewhere in the app (everything here is scheduled/compared in
// ET regardless of the viewer's own timezone).
function formatKickoff(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'America/New_York' });
  const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return `${datePart} · ${timePart} ET`;
}

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
  const titleContainerRef = useRef(null);
  const titleTextRef = useRef(null);
  const [titleFontSize, setTitleFontSize] = useState(30);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [syncing, setSyncing] = useState(false);
  const [oddsSyncing, setOddsSyncing] = useState(false);
  const [oddsSyncMsg, setOddsSyncMsg] = useState('');
  const [syncMsg, setSyncMsg] = useState('');
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createEntryError, setCreateEntryError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showSeasonLeaderboard, setShowSeasonLeaderboard] = useState(false);
  const [showTopPayouts, setShowTopPayouts] = useState(false);
  const [tiebreakerReminder, setTiebreakerReminder] = useState(null);
  const [submitCheck, setSubmitCheck] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [newSeasonConfirm, setNewSeasonConfirm] = useState(false);
  const [emailModal, setEmailModal] = useState(null); // { label, emails: [] }
  const [renamePrompt, setRenamePrompt] = useState(null); // { participantId, value, error }
  const [copied, setCopied] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  // Admin-only "Restore entrant" tool (paste a saved entrant record back in). Hooks stay above the early return.
  // Your own picks card stays open by default once the week locks (so you see your colored picks right away);
  // this only tracks if you've manually collapsed it.
  const [myCardCollapsed, setMyCardCollapsed] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [restoreStatus, setRestoreStatus] = useState(null); // { ok, msg }
  const [memberSearch, setMemberSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [celebrationQueue, setCelebrationQueue] = useState([]);
  const [activeCelebration, setActiveCelebration] = useState(null);
  // Pointer-based drag state for reordering confidence picks. Deliberately not the HTML5 drag-
  // and-drop API — that API has no real touch support (iOS/Android won't fire its drag events at
  // all), so it can only ever work with a mouse. Pointer Events (down/move/up) are the one API
  // that's identical for touch and mouse, which is why this is built on those instead.
  const [pointerDrag, setPointerDrag] = useState(null); // { pid, order: [gid,...], draggedGid, pointerId }
  const dragRowRefs = useRef({}); // gid -> row DOM node, used to hit-test drag position against
  const viewWeekRef = useRef(1);
  const dragSessionRef = useRef(null); // live drag bookkeeping (measured row positions etc.) — a ref so pointer moves never trigger React re-renders
  const commitOrderRef = useRef(null); // always points at the latest commitOrder, for the delayed commit when a drag ends

  // Smooths the drag reorder itself — without this, every row bumped out of the way by the
  // dragged item just snaps straight to its new spot the instant the order array changes, which
  // reads as jumpy rather than a smooth reorder. This uses the standard "FLIP" technique: measure
  // where every row WAS right before the reorder, let the reorder happen, measure where each row
  // ended up, then paint it starting back at its old spot (no transition) and immediately animate
  // it over to zero offset (with a transition) — the browser fills in the motion between the two,
  // so it visually slides into place instead of teleporting. The dragged row itself is skipped —
  // its position is directly tied to where your finger is, so snapping there reads as responsive
  // rather than jarring; it's only the OTHER rows shifting out of the way that need to feel smooth.
  // MUST stay above the `if (loading || !data)` early return below, same as the other hooks up
  // here — a hook that's only reached once data has loaded changes how many hooks React sees
  // between renders, which crashes the whole render (this exact bug already happened once before
  // in this file, with the win-celebration confetti).
  useLayoutEffect(() => {
    // Once a drag is over (and React has put the rows in their final DOM order), wipe the
    // temporary transforms used to animate the drag — the rows are now exactly where those
    // transforms had them, so nothing visibly moves.
    if (pointerDrag) return;
    Object.values(dragRowRefs.current).forEach(node => {
      if (node && node.style) { node.style.transform = ''; node.style.transition = ''; node.style.willChange = ''; }
    });
  }, [pointerDrag === null]);

  // Three interchangeable ways to set confidence order — drag-and-drop doesn't work well for
  // everyone (some touchscreens/trackpads are fussy with it), so arrows and direct number entry
  // are offered as full equivalents, not a fallback. Remembered per-device since it's a personal
  // preference, not something that needs to sync across devices.
  const [rankMode, setRankMode] = useState(() => {
    try { return localStorage.getItem('confidence-rank-mode') || 'drag'; } catch (e) { return 'drag'; }
  });
  useEffect(() => {
    try { localStorage.setItem('confidence-rank-mode', rankMode); } catch (e) { /* non-fatal */ }
  }, [rankMode]);
  const [numberDrafts, setNumberDrafts] = useState({}); // `${pid}-${gid}` -> in-progress typed text
  const [justSaved, setJustSaved] = useState(false);
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const { schedule, ensureSchedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);
  // Pinned independently of viewWeek so the join-deadline check works no matter what week
  // someone's currently looking at. Regular season Week 1 is the actual start of the season
  // now that preseason beta-testing is over.
  const { lockTimeForPick: lockTimeForPickWeek1 } = useEspnSchedule(1, seasonYear);
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();

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
      if (dragSessionRef.current) return; // never re-render the page out from under an in-progress drag
      try {
        const remote = await apiGetPool(POOL_KEY);
        if (dragSessionRef.current) return;
        if (remote) setData(remote);
      } catch (e) { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const celebratedKey = (w, pid) => `confidence-celebrated-w${w}-${pid}`;

  // Make sure every regular-season week's schedule has actually been fetched, not just the one
  // currently being viewed — isWeekComplete needs each week's real game count to know whether
  // it's actually over, and the shared schedule hook only loads whichever week is on screen.
  // IMPORTANT: this and the three effects below must stay ABOVE the `if (loading || !data)`
  // return below — hooks have to run in the same order on every render, so a hook placed after
  // an early return would be skipped entirely while loading and only start firing once data
  // arrives, which crashes the whole page (React detects the mismatched hook count). Each one
  // guards its own body against missing data instead, so it's always called, but safely no-ops
  // until there's real data to work with.
  useEffect(() => {
    if (!data) return;
    weeksForSeason(viewWeek).forEach(w => ensureSchedule(w));
  }, [viewWeek, data]);

  // Scan every completed week for a win nobody's been shown a celebration for yet. Runs whenever
  // scores or the schedule change, since either can be what finally makes a week "complete."
  // Calls isWeekComplete/weekWinnerIds (defined later in this file, after the loading guard) —
  // safe because this effect's callback only actually runs once React commits, by which point
  // this render will have finished executing top to bottom (and so defined them) whenever data
  // was actually present; the `!data` check below keeps it from ever reaching that reference on
  // a render where it wasn't.
  useEffect(() => {
    if (!data || !myIdLoaded || !myId) return;
    const newlyWon = [];
    weeksForSeason(viewWeek).forEach(w => {
      if (!isWeekComplete(w)) return;
      if (!weekWinnerIds(w).includes(myId)) return;
      try {
        if (localStorage.getItem(celebratedKey(w, myId))) return;
      } catch (e) { return; }
      newlyWon.push(w);
    });
    if (newlyWon.length > 0) {
      setCelebrationQueue(q => Array.from(new Set([...q, ...newlyWon])).sort((a, b) => a - b));
    }
  }, [data, myIdLoaded, myId, schedule]);

  // Shows queued celebrations one at a time rather than all at once.
  useEffect(() => {
    if (activeCelebration == null && celebrationQueue.length > 0) {
      setActiveCelebration(celebrationQueue[0]);
      setCelebrationQueue(q => q.slice(1));
    }
  }, [celebrationQueue, activeCelebration]);

  const dismissCelebration = () => {
    if (activeCelebration != null && myId) {
      try { localStorage.setItem(celebratedKey(activeCelebration, myId), '1'); } catch (e) { /* non-fatal */ }
    }
    setActiveCelebration(null);
  };

  useEffect(() => {
    if (activeCelebration == null) return;
    const t = setTimeout(dismissCelebration, 6000);
    return () => clearTimeout(t);
  }, [activeCelebration]);

  const confettiPieces = useMemo(() => {
    if (activeCelebration == null) return [];
    const colors = ['#E8A23D', '#7FCB98', '#3D9B5C', '#F0EDE4', '#5EA8E8', '#E28A82'];
    return Array.from({ length: 90 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.7,
      duration: 2.4 + Math.random() * 1.8,
      rotate: Math.random() * 360,
      color: colors[i % colors.length],
      width: 6 + Math.random() * 5,
      height: 4 + Math.random() * 8,
    }));
  }, [activeCelebration]);

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
    if (!isAdmin) return; // only the admin can remove an entrant
    const next = { ...data, participants: data.participants.filter(p => p.id !== id) };
    for (const w of ALL_WEEKS) { if (next.picks[w]) delete next.picks[w][id]; }
    persist(next, [id]);
  };
  // Admin-only: put back an entrant who was removed, using their saved record (participant + picks per week)
  // pulled from a Google Sheets backup. Adds only this one entrant; nobody else's data is touched.
  const restoreEntrant = () => {
    if (!isAdmin) return;
    let parsed;
    try {
      parsed = JSON.parse(restoreText);
    } catch (e) {
      setRestoreStatus({ ok: false, msg: "That doesn't look like a saved entrant record — make sure you pasted the whole thing." });
      return;
    }
    const p = parsed && parsed.participant;
    const savedPicks = (parsed && parsed.picks) || {};
    if (!p || !p.id || !p.name) {
      setRestoreStatus({ ok: false, msg: 'Record is missing the entrant details.' });
      return;
    }
    if (data.participants.some(x => x.id === p.id)) {
      setRestoreStatus({ ok: false, msg: `${p.name} is already in the pool — nothing to restore.` });
      return;
    }
    if (data.participants.some(x => (x.name || '').toLowerCase() === p.name.toLowerCase())) {
      setRestoreStatus({ ok: false, msg: `Someone named "${p.name}" is already in the pool.` });
      return;
    }
    const nextPicks = { ...data.picks };
    Object.keys(savedPicks).forEach(w => {
      nextPicks[w] = { ...(nextPicks[w] || {}), [p.id]: savedPicks[w] };
    });
    persist({ ...data, participants: [...data.participants, p], picks: nextPicks });
    setRestoreStatus({ ok: true, msg: `Restored ${p.name} with picks for ${Object.keys(savedPicks).length} week(s).` });
    setRestoreText('');
  };
  const setCurrentWeek = (w) => persist({ ...data, currentWeek: w });
  const saveTitle = () => {
    if (!isAdmin) { setEditingTitle(false); return; }
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

  // Admin-only entry-fee tracking — purely a record-keeping flag, doesn't affect picks, locks,
  // or anything else about how the pool runs.
  const togglePaid = (id) => {
    persist({
      ...data,
      participants: data.participants.map(p => p.id === id ? { ...p, paid: !p.paid } : p),
    });
  };

  // Display-name editing — for someone fixing a typo in their own name, or admin fixing it on
  // an entrant's behalf. Real name, email, and PIN are untouched either way; this only ever
  // changes the public display name. No uniqueness check here since display names were never
  // required to be unique at signup either — only real name is.
  const openRenamePrompt = (participantId) => {
    const current = data.participants.find(p => p.id === participantId)?.name || '';
    setRenamePrompt({ participantId, value: current, error: '' });
  };
  const saveRename = () => {
    if (!renamePrompt) return;
    const trimmed = renamePrompt.value.trim();
    if (!trimmed) {
      setRenamePrompt(p => ({ ...p, error: 'Name cannot be empty.' }));
      return;
    }
    persist({
      ...data,
      participants: data.participants.map(p => p.id === renamePrompt.participantId ? { ...p, name: trimmed } : p),
    });
    setRenamePrompt(null);
  };

  // Builds a deduplicated, comma-separated email list for this pool only, filtered by who
  // still needs a nudge — everyone, whoever hasn't picked a single winner yet this week (not
  // "hasn't finished," just "hasn't started"), or whoever isn't marked paid.
  const buildEmailList = (filter) => {
    let matching = data.participants;
    if (filter === 'nopick') {
      matching = data.participants.filter(p => {
        const entry = data.picks[viewWeek]?.[p.id];
        return !entry || Object.keys(entry.winners || {}).length === 0;
      });
    } else if (filter === 'unpaid') {
      matching = data.participants.filter(p => !p.paid);
    }
    const seen = new Set();
    const emails = [];
    matching.forEach(p => {
      const email = (p.email || '').trim();
      if (!email || seen.has(email.toLowerCase())) return;
      seen.add(email.toLowerCase());
      emails.push(email);
    });
    const labels = { all: 'All members', nopick: `Haven't picked yet — Week ${weekLabel(viewWeek)}`, unpaid: 'Not marked paid' };
    setEmailModal({ label: labels[filter], emails });
  };

  const copyEmails = () => {
    if (!emailModal) return;
    const text = emailModal.emails.join(', ');
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* non-fatal — text box below still works */ });
  };

  // Keeps everyone's name, display name, email, and PIN exactly as-is — no re-registering
  // returning players — while wiping every piece of data that's specific to the season that
  // just ended: picks, results, the MNF tiebreaker actuals, chat, the ticker, and the
  // current-week pointer. Deliberately does NOT touch admin-config (a separate KV key
  // entirely), so the shared admin PIN survives this too.
  const startNewSeason = () => {
    if (!newSeasonConfirm) { setNewSeasonConfirm(true); return; }
    persist({
      ...data,
      picks: {},
      results: {},
      mnfActual: {},
      chatMessages: [],
      tickerMessage: '',
      currentWeek: 1,
    });
    setNewSeasonConfirm(false);
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
  // The tiebreaker guess stays editable through Thursday/early games and locks at the same
  // Sunday-1pm/MNF mass-lock as everything else — it's also kept hidden from everyone but the
  // entrant themself (and admin) until that same moment, so there's no advantage either way.
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

  // Records "I've checked my picks as of this exact state" server-side, so the Submit button's
  // grey/orange status is consistent no matter which device someone checks from — same shared
  // data every other pick already lives in, not device-local storage.
  const confirmSubmission = (week, pid, signature) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prevEntry = next.picks[week][pid] || {};
    next.picks[week][pid] = { ...prevEntry, confirmedSignature: signature };
    persist(next);
  };

  // Persists a fully-formed new order for one entrant/week directly (used once a pointer drag
  // finishes, since by then we already have the exact final array rather than a from/to index pair).
  const commitOrder = (week, pid, newOrder) => {
    const next = { ...data, picks: { ...data.picks } };
    next.picks[week] = { ...(next.picks[week] || {}) };
    const prevEntry = next.picks[week][pid] || {};
    next.picks[week][pid] = { ...prevEntry, order: newOrder };
    persist(next);
  };

  commitOrderRef.current = commitOrder;
  viewWeekRef.current = viewWeek;

  const isGidLocked = (gid) => {
    const g = games.find(x => x.id === gid);
    return g ? isGameLocked(g) : false;
  };

  // Locked games must never shift position just because OTHER, still-open games get reordered —
  // once a pick is locked its confidence value is final, whether it's already won, lost, or
  // still in progress. This pins every locked gid to its exact current index untouched, and only
  // lets the still-open games move around each other to fill in whatever spots remain. Every
  // reorder path (drag, arrows, typed numbers) below goes through this same function so none of
  // them can accidentally bump a locked pick — a bug that used to be possible in all three.
  const reorderKeepingLockedInPlace = (fullOrder, moveGid, newIndexAmongUnlocked) => {
    const lockedEntries = [];
    const unlockedGids = [];
    fullOrder.forEach((gid, idx) => {
      if (isGidLocked(gid)) lockedEntries.push({ idx, gid });
      else unlockedGids.push(gid);
    });
    const withoutMoved = unlockedGids.filter(g => g !== moveGid);
    const clampedIdx = Math.max(0, Math.min(withoutMoved.length, newIndexAmongUnlocked));
    withoutMoved.splice(clampedIdx, 0, moveGid);
    const result = new Array(fullOrder.length);
    lockedEntries.forEach(({ idx, gid }) => { result[idx] = gid; });
    let ui = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === undefined) { result[i] = withoutMoved[ui]; ui++; }
    }
    return result;
  };

  // Drag-and-drop design (why it's built this way): the rows stay in their ORIGINAL DOM order for
  // the whole drag, and are only ever moved with CSS transforms. Every row's position is measured
  // ONCE when the drag starts, so nothing about the layout changes while you drag — that's what
  // stops the jumping/flapping the earlier version had (it re-ordered the real DOM mid-drag and
  // hit-tested against rows that were themselves still animating). The grabbed row follows the
  // pointer exactly; the other rows slide to where they'd land if you dropped now. Nothing is saved
  // until you let go.
  const dragKey = (pid, gid) => `${pid}|${gid}`;

  const beginPointerDrag = (e, pid, order, gid) => {
    e.preventDefault();
    if (dragSessionRef.current) return;
    const firstNode = dragRowRefs.current[dragKey(pid, order[0])];
    if (!firstNode) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const rel = {};
    const heights = {};
    order.forEach(g => {
      const n = dragRowRefs.current[dragKey(pid, g)];
      if (n) { rel[g] = n.offsetTop - firstNode.offsetTop; heights[g] = n.offsetHeight; }
    });
    const gap = order.length > 1 && rel[order[1]] !== undefined ? Math.max(0, rel[order[1]] - (rel[order[0]] + heights[order[0]])) : 0;
    const lastG = order[order.length - 1];
    dragSessionRef.current = {
      pid, draggedGid: gid, pointerId: e.pointerId, baseOrder: [...order], order: [...order],
      startY: e.clientY, scrollY0: window.scrollY, rel, heights, gap,
      total: (rel[lastG] || 0) + (heights[lastG] || 0),
      locked: new Set(order.filter(g => isGidLocked(g))),
      dy: 0, ending: false,
    };
    order.forEach(g => {
      const n = dragRowRefs.current[dragKey(pid, g)];
      if (!n) return;
      n.style.willChange = 'transform';
      n.style.transition = g === gid ? 'none' : 'transform 160ms ease';
    });
    setPointerDrag({ pid, baseOrder: [...order], order: [...order], draggedGid: gid, pointerId: e.pointerId });
  };

  const onPointerMoveDrag = (e) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.ending || e.pointerId !== sess.pointerId) return;
    const { rel, heights, gap, baseOrder, draggedGid, pid } = sess;
    // Edge auto-scroll so long lists can be dragged past the visible area.
    if (e.clientY < 70) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    const h = heights[draggedGid] || 0;
    let dy = e.clientY - sess.startY + (window.scrollY - sess.scrollY0);
    dy = Math.max(-(rel[draggedGid] || 0), Math.min(sess.total - h - (rel[draggedGid] || 0), dy));
    sess.dy = dy;
    const dragNode = dragRowRefs.current[dragKey(pid, draggedGid)];
    if (dragNode) dragNode.style.transform = `translateY(${dy}px)`;

    // Where would it land? Count how many other open rows have their (original, fixed) midpoint
    // above the dragged row's current center.
    const centerY = (rel[draggedGid] || 0) + dy + h / 2;
    let targetIndex = 0;
    baseOrder.forEach(g => {
      if (g === draggedGid || sess.locked.has(g)) return;
      if ((rel[g] || 0) + (heights[g] || 0) / 2 < centerY) targetIndex++;
    });
    const newOrder = reorderKeepingLockedInPlace(baseOrder, draggedGid, targetIndex);
    if (newOrder.join('|') !== sess.order.join('|')) {
      sess.order = newOrder;
      applyDragLayout(sess);
      setPointerDrag(pd => (pd ? { ...pd, order: newOrder } : pd));
    }
  };

  // Slides every row except the grabbed one to the spot it'd occupy in sess.order.
  const applyDragLayout = (sess) => {
    const finalTop = {};
    let y = 0;
    sess.order.forEach(g => { finalTop[g] = y; y += (sess.heights[g] || 0) + sess.gap; });
    sess.finalTop = finalTop;
    sess.baseOrder.forEach(g => {
      if (g === sess.draggedGid) return;
      const n = dragRowRefs.current[dragKey(sess.pid, g)];
      if (n) n.style.transform = `translateY(${(finalTop[g] || 0) - (sess.rel[g] || 0)}px)`;
    });
  };

  const endPointerDrag = (e) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.ending || e.pointerId !== sess.pointerId) return;
    sess.ending = true;
    applyDragLayout(sess);
    // Glide the grabbed row into its final slot, then save and hand over to React's real order.
    const dragNode = dragRowRefs.current[dragKey(sess.pid, sess.draggedGid)];
    if (dragNode) {
      dragNode.style.transition = 'transform 120ms ease';
      dragNode.style.transform = `translateY(${(sess.finalTop[sess.draggedGid] || 0) - (sess.rel[sess.draggedGid] || 0)}px)`;
    }
    setTimeout(() => {
      const changed = sess.order.join('|') !== sess.baseOrder.join('|');
      if (changed && commitOrderRef.current) commitOrderRef.current(viewWeekRef.current, sess.pid, sess.order);
      dragSessionRef.current = null;
      setPointerDrag(null);
    }, 130);
  };

  // Arrow-button reordering — moves one still-open game up or down a single spot among the
  // OTHER still-open games, never displacing a locked one.
  const moveInOrder = (pid, order, gid, direction) => {
    if (isGidLocked(gid)) return; // shouldn't be reachable — arrows aren't rendered for a locked row — but safe regardless
    const unlockedGids = order.filter(g => !isGidLocked(g));
    const curIdx = unlockedGids.indexOf(gid);
    if (curIdx === -1) return;
    const targetIdx = curIdx + direction;
    if (targetIdx < 0 || targetIdx >= unlockedGids.length) return;
    const newOrder = reorderKeepingLockedInPlace(order, gid, targetIdx);
    commitOrder(viewWeek, pid, newOrder);
  };

  // Typed-number reordering — same underlying move as drag/arrows, just driven by a number
  // instead of a gesture. The person types an absolute confidence value (1 to N), which has to
  // be translated into "how many open slots down" that corresponds to, since locked slots are
  // pinned and don't count toward that — typing straight into an absolute array index (as this
  // used to) was exactly what let a locked pick get bumped.
  const setConfidenceNumber = (pid, order, gid, rawValue) => {
    if (isGidLocked(gid)) return; // shouldn't be reachable — the input isn't rendered for a locked row — but safe regardless
    const n = order.length;
    const parsed = parseInt(rawValue, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.max(1, Math.min(n, parsed));
    const targetAbsIdx = n - clamped;
    const lockedAtOrAbove = order.slice(0, targetAbsIdx + 1).filter(isGidLocked).length;
    const relativeIdx = targetAbsIdx - lockedAtOrAbove;
    const newOrder = reorderKeepingLockedInPlace(order, gid, relativeIdx);
    commitOrder(viewWeek, pid, newOrder);
  };

  // Spreads can move throughout the week (unlike results, which are final once posted), so this
  // is a manual, anyone-can-click refresh rather than something that happens automatically — and
  // it writes into the shared pool data (same as everything else here) so one person syncing
  // updates what everyone sees, not just their own browser.
  const syncOdds = async () => {
    setOddsSyncing(true);
    setOddsSyncMsg('');
    try {
      const oddsByGame = await fetchWeekOdds(viewWeek, seasonYear);
      if (Object.keys(oddsByGame).length === 0) {
        setOddsSyncMsg(`No spreads posted for week ${viewWeek} yet — try again closer to kickoff.`);
        return;
      }
      persist({
        ...data,
        oddsOverride: { ...(data.oddsOverride || {}), [viewWeek]: oddsByGame },
      });
      setOddsSyncMsg(`Synced spreads for ${Object.keys(oddsByGame).length} game${Object.keys(oddsByGame).length === 1 ? '' : 's'}.`);
    } catch (e) {
      setOddsSyncMsg('Could not reach the ESPN odds feed — try again in a bit.');
    } finally {
      setOddsSyncing(false);
    }
  };
  // Prefers a manually-synced spread over whatever was cached at page load, since that's more
  // likely to be current — falls back to the schedule's own odds if nobody's synced yet.
  const effectiveOdds = (g) => data.oddsOverride?.[viewWeek]?.[g.id] || g.odds;

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

  // A week only counts as "decided" once every one of its games has a completed result — while
  // games are still in progress, points are still moving and nobody should be told they've won.
  const isWeekComplete = (w) => {
    const games = schedule[w]?.games;
    if (!games || games.length === 0) return false;
    const weekResults = data.results?.[w] || {};
    return games.every(g => weekResults[g.id]?.completed);
  };

  // Everyone tied for the top score that week (ties both get the win — same as a real split
  // payout would). A max of 0 isn't treated as a real win; nobody should be congratulated for
  // scoring nothing.
  const weekWinnerIds = (w) => {
    if (!data.participants.length) return [];
    const scored = data.participants.map(p => ({ id: p.id, pts: weeklyPoints(p.id, w) }));
    const max = Math.max(...scored.map(s => s.pts));
    if (max <= 0) return [];
    return scored.filter(s => s.pts === max).map(s => s.id);
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

  const SEASON_TOP_SPOTS = 3; // season-long payout goes to a fixed top 3, not scaled by entrant count
  // myId being set doesn't guarantee it still points to a real entrant — a full pool reset (or
  // manual removal) can leave a stale id sitting in someone's localStorage. Treat that the same
  // as not being signed in at all, everywhere it matters, rather than just where it happened to
  // already get double-checked.
  const myIdValid = !!(myId && data.participants.some(p => p.id === myId));

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

  // Season rank for each entrant, straight from leaderboard's own order — reused wherever a
  // season position needs to show up next to someone's season total, like in Weekly Standings.
  const seasonRankById = {};
  leaderboard.forEach((p, i) => { seasonRankById[p.id] = i + 1; });
  const ordinal = (n) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  return (
    <div style={{ position: 'relative', zIndex: 0, isolation: 'isolate', background: 'radial-gradient(ellipse 90% 60% at 50% -10%, #17211D 0%, #0F1614 55%)', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      {/* Night-sky backdrop (Milky Way) — fixed behind everything, with a dark wash on top so text stays
          readable. Purely decorative: no pointer events, hidden from screen readers. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          backgroundImage: `linear-gradient(180deg, rgba(8,12,20,0.60), rgba(8,12,20,0.74)), url(${GALAXY_BG})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: '#05070D',
        }}
      />
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

      <div style={{ background: 'linear-gradient(180deg,rgba(27,39,33,0.9),rgba(15,22,20,0.84))', borderBottom: '1px solid #E8A23D33', boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto mb-3 flex items-center gap-3">
          <img src="/logo.png" alt="" className="w-7 h-7 rounded object-cover shrink-0" />
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

        <div className="max-w-5xl mx-auto flex justify-center py-2">
          <img
            src="/confidence-hero.png"
            alt=""
            className="w-full max-w-[260px] sm:max-w-[340px] h-auto object-contain"
          />
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
                <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#5C6862' }}>Confidence Pool</div>
              </div>
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
        <div className="max-w-5xl mx-auto mt-4 flex gap-2 font-mono text-xs uppercase">
          <div className="px-3 py-1.5 rounded flex items-center gap-1" style={{ background: '#E8A23D1a', border: '1px solid #E8A23D55', color: '#E8A23D' }}>
            <Coins size={12} /> Entry Fee: {CONFIDENCE_ENTRY_FEE} units
          </div>
        </div>
        {saveError && (
          <div className="max-w-5xl mx-auto mt-3 font-mono text-xs px-3 py-1.5 rounded" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82', width: 'fit-content' }}>
            Sync failed — retrying
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 space-y-8">

        <div>
          <button
            onClick={() => setShowTopPayouts(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-head text-sm uppercase tracking-wide"
            style={{ color: '#0F1614', background: 'linear-gradient(135deg,#F0C168,#E8A23D)', animation: 'top-payout-pulse 2.4s ease-in-out infinite' }}
          >
            <Trophy size={15} /> Payouts {showTopPayouts ? '▾' : '▸'}
          </button>
          <style>{`
            @keyframes top-payout-pulse {
              0%, 100% { box-shadow: 0 0 8px #E8A23D66, 0 0 2px #E8A23D; }
              50% { box-shadow: 0 0 18px #E8A23Dcc, 0 0 6px #E8A23D; }
            }
          `}</style>
          {showTopPayouts && (
            <div className="rounded-lg px-4 py-3 mt-2" style={{ background: '#1F2B25', border: '1px solid #E8A23D66' }}>
              <div className="flex items-center justify-between font-mono text-xs py-1.5" style={{ borderBottom: '1px solid #2A3830', color: '#8A9A90' }}>
                <span className="uppercase tracking-wide">Weekly winner</span>
                <span className="font-head" style={{ color: '#E8A23D' }}>30 units</span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs py-1.5" style={{ color: '#8A9A90' }}>
                <span className="uppercase tracking-wide">Season — 1st place</span>
                <span className="font-head" style={{ color: '#E8A23D' }}>275 units</span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs py-1.5" style={{ color: '#8A9A90' }}>
                <span className="uppercase tracking-wide">Season — 2nd place</span>
                <span className="font-head" style={{ color: '#E8A23D' }}>140 units</span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs py-1.5" style={{ color: '#8A9A90' }}>
                <span className="uppercase tracking-wide">Season — 3rd place</span>
                <span className="font-head" style={{ color: '#E8A23D' }}>70 units</span>
              </div>
            </div>
          )}
        </div>

        <PoolTicker message={data.tickerMessage} isAdmin={isAdmin} onSave={setTickerMessage} accent="#E8A23D" />

        {/* Entrants */}
        <div>
          <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
            <Users size={14} /> Entrants
          </div>

          {myIdLoaded && (isAdmin || !myIdValid) && (
            <>
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
                  Entries closed — Week 1 picks have locked, no new entrants can join this season.
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
            </>
          )}

          {myIdLoaded && (
            isAdmin ? (
              <>
                {myIdValid && (
                  <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded mb-2" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                    <UserCircle size={14} color="#E8A23D" />
                    You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                    <button onClick={() => openRenamePrompt(myId)} title="Edit your display name" style={{ color: '#5C6862' }}><Pencil size={11} /></button>
                    <button onClick={forgetMe} className="ml-auto underline" style={{ color: '#5C6862' }}>Not you? Switch</button>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1.5">
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>All entrants (admin view)</div>
                    <div className="font-mono text-[10px] uppercase" style={{ color: '#7FCB98' }}>
                      Paid {data.participants.filter(p => p.paid).length}/{data.participants.length}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={runBackup} disabled={backupStatus?.loading} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#7FCB98', opacity: backupStatus?.loading ? 0.6 : 1 }}>
                      <RefreshCw size={10} className={backupStatus?.loading ? 'animate-spin' : ''} /> {backupStatus?.loading ? 'Backing up…' : 'Backup Now'}
                    </button>
                    {data.participants.some(p => p.email) && (
                      <button onClick={exportEmails} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#E8A23D' }}>
                        <Download size={10} /> Export emails (.csv)
                      </button>
                    )}
                    <button
                      onClick={startNewSeason}
                      onBlur={() => setNewSeasonConfirm(false)}
                      title="Keeps every entrant's name, display name, email, and PIN. Wipes all picks, results, the tiebreaker, chat, and the ticker, and resets the current week back to 1."
                      className="font-mono text-[10px] uppercase underline flex items-center gap-1"
                      style={{ color: newSeasonConfirm ? '#E28A82' : '#5C6862' }}
                    >
                      <RefreshCw size={10} /> {newSeasonConfirm ? 'Confirm: wipe all picks & start fresh?' : 'Start New Season'}
                    </button>
                  </div>
                </div>
                {backupStatus && !backupStatus.loading && (
                  <div className="font-mono text-[10px] mb-2" style={{ color: backupStatus.ok ? '#7FCB98' : '#E28A82' }}>
                    {backupStatus.ok ? `Backed up all 3 pools to Google Sheets at ${new Date(backupStatus.syncedAt).toLocaleTimeString()}.` : `Backup failed: ${backupStatus.error}`}
                  </div>
                )}
                <div className="mb-3">
                  <button onClick={() => setRestoreOpen(o => !o)} className="font-mono text-[10px] uppercase underline" style={{ color: '#5C6862' }}>
                    {restoreOpen ? 'Hide restore entrant' : 'Restore entrant'}
                  </button>
                  {restoreOpen && (
                    <div className="mt-2 rounded px-3 py-3" style={{ background: '#1F2B25', border: '1px solid #2A3830' }}>
                      <div className="font-mono text-[10px] mb-2" style={{ color: '#8A9A90' }}>
                        Paste a saved entrant record to bring someone back with their original picks.
                      </div>
                      <textarea
                        value={restoreText}
                        onChange={e => { setRestoreText(e.target.value); setRestoreStatus(null); }}
                        rows={4}
                        placeholder="Paste the saved record here"
                        className="w-full px-2 py-1.5 rounded outline-none font-mono text-[10px]"
                        style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                      />
                      <button
                        onClick={restoreEntrant}
                        disabled={!restoreText.trim()}
                        className="mt-2 px-3 py-1.5 rounded font-head text-xs uppercase"
                        style={{ background: restoreText.trim() ? '#7FCB98' : '#2A3830', color: '#0F1614' }}
                      >
                        Restore
                      </button>
                      {restoreStatus && (
                        <div className="font-mono text-[10px] mt-2" style={{ color: restoreStatus.ok ? '#7FCB98' : '#E28A82' }}>{restoreStatus.msg}</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>Email this pool's members:</div>
                  <button onClick={() => buildEmailList('all')} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#7FCB98' }}>
                    <Mail size={10} /> All
                  </button>
                  <button onClick={() => buildEmailList('nopick')} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#E8A23D' }}>
                    <Mail size={10} /> Haven't picked (Week {weekLabel(viewWeek)})
                  </button>
                  <button onClick={() => buildEmailList('unpaid')} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#E28A82' }}>
                    <Mail size={10} /> Not paid
                  </button>
                </div>
                {data.participants.length === 0 ? (
                  <div className="font-mono text-xs" style={{ color: '#5C6862' }}>No entrants yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs" style={{ background: p.paid ? '#E8A23D1a' : '#1C2823', border: `1px solid ${p.paid ? '#E8A23D66' : '#2A3830'}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                        <button
                          onClick={() => togglePaid(p.id)}
                          title={p.paid ? 'Mark as unpaid' : 'Mark as paid'}
                          className="flex items-center justify-center rounded-sm shrink-0"
                          style={{ width: '15px', height: '15px', background: p.paid ? '#E8A23D' : 'transparent', border: `1px solid ${p.paid ? '#E8A23D' : '#5C6862'}` }}
                        >
                          {p.paid && <Check size={11} color="#0F1614" />}
                        </button>
                        <button onClick={() => handleNameTap(p)} className="flex items-center gap-1" style={{ color: '#F0EDE4' }}>
                          {p.pin ? <Lock size={10} color="#E8A23D" /> : <Lock size={10} color="#3A4A42" />}
                          {p.name}
                        </button>
                        <button onClick={() => openRenamePrompt(p.id)} title="Edit display name" style={{ color: '#5C6862' }}><Pencil size={10} /></button>
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
            ) : myIdValid ? (
              <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                <UserCircle size={14} color="#E8A23D" />
                You're picking as <span style={{ color: '#F0EDE4' }}>{data.participants.find(p => p.id === myId)?.name}</span>
                <button onClick={() => openRenamePrompt(myId)} title="Edit your display name" style={{ color: '#5C6862' }}><Pencil size={11} /></button>
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
                const dragHere = !!(pointerDrag && pointerDrag.pid === p.id);
                const liveOrder = dragHere ? pointerDrag.order : order;
                const domOrder = dragHere ? pointerDrag.baseOrder : order; // rows keep their original DOM order during a drag; only transforms move them
                const total = seasonTotal(p.id);
                const tiebreakerRevealed = isTiebreakerRevealed(p.id);
                const weekFullyLocked = games.length > 0 && games.every(g => isGameLocked(g));
                // Your own card shows your picks (with win/loss/in-progress colors) even after the week
                // locks; admin's view of everyone else's cards stays collapsed until tapped.
                const isCardExpanded = !weekFullyLocked || (isMe ? !myCardCollapsed : expandedId === `mine-${p.id}`);
                return (
                  <div key={p.id} className="rounded px-4 py-3" style={{ background: '#1C2823', border: isMe ? '1px solid #E8A23D88' : '1px solid #2A3830' }}>
                    <button
                      onClick={() => {
                        if (!weekFullyLocked) return;
                        if (isMe) setMyCardCollapsed(c => !c);
                        else setExpandedId(id => id === `mine-${p.id}` ? null : `mine-${p.id}`);
                      }}
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
                          <div className="flex items-center justify-between flex-wrap gap-2 mb-2.5">
                            <div className="rounded px-3 py-2 font-head text-xs uppercase tracking-wide flex items-center gap-2" style={{ background: '#E8A23D1a', border: '1px solid #E8A23D66', color: '#E8A23D' }}>
                              <AlertCircle size={14} className="shrink-0" /> Picks are straight up — NOT against the spread
                            </div>
                            <button
                              onClick={syncOdds}
                              disabled={oddsSyncing}
                              className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide flex items-center gap-1.5 shrink-0"
                              style={{ background: '#1F2B25', border: '1px solid #5EA8E8', color: '#5EA8E8', opacity: oddsSyncing ? 0.6 : 1 }}
                              title="Spreads move throughout the week — sync to pull the latest, for everyone."
                            >
                              <RefreshCw size={12} className={oddsSyncing ? 'animate-spin' : ''} />
                              {oddsSyncing ? 'Syncing…' : 'Sync latest spreads'}
                            </button>
                          </div>
                          {oddsSyncMsg && (
                            <div className="font-mono text-[10px] mb-2.5" style={{ color: '#5EA8E8' }}>{oddsSyncMsg}</div>
                          )}
                          <div className="font-mono text-[10px] uppercase mb-1.5" style={{ color: '#5C6862' }}>
                            Pick a winner in each matchup, then rank your confidence — most confident on top
                          </div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="font-mono text-[9px] uppercase mr-1" style={{ color: '#5C6862' }}>Reorder by:</span>
                            {[
                              { key: 'drag', label: 'Drag & Drop', icon: GripVertical },
                              { key: 'type', label: 'Type Numbers', icon: Hash },
                              { key: 'arrows', label: 'Arrows', icon: ChevronUp },
                            ].map(m => (
                              <button
                                key={m.key}
                                type="button"
                                onClick={() => setRankMode(m.key)}
                                className="flex items-center gap-1 px-2 py-1 rounded-full font-mono text-[9px] uppercase"
                                style={{
                                  background: rankMode === m.key ? '#E8A23D' : '#1F2B25',
                                  color: rankMode === m.key ? '#0F1614' : '#8A9A90',
                                  border: `1px solid ${rankMode === m.key ? '#E8A23D' : '#2A3830'}`,
                                }}
                              >
                                <m.icon size={10} /> {m.label}
                              </button>
                            ))}
                          </div>
                          <div className="space-y-1" style={{ overflowAnchor: 'none' }}>
                            {domOrder.map((gid) => {
                              const idx = liveOrder.indexOf(gid);
                              const g = games.find(gm => gm.id === gid);
                              if (!g) return null;
                              const gLocked = isGameLocked(g);
                              const gRevealed = isGameRevealed(p.id, g);
                              const confidence = liveOrder.length - idx;
                              if (!gRevealed) {
                                return (
                                  <div key={gid} ref={el => { dragRowRefs.current[`${p.id}|${gid}`] = el; }} className="flex items-center gap-2 rounded px-2.5 py-1.5 font-mono text-xs" style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#5C6862' }}>
                                    <Lock size={12} /> Hidden until kickoff
                                  </div>
                                );
                              }
                              const winner = winners[gid];
                              const awaySelected = winner === g.away.abbr;
                              const homeSelected = winner === g.home.abbr;
                              const result = data.results?.[viewWeek]?.[gid];
                              // Pick button color reflects real status, not just "is this selected":
                              // blue while still open to change, yellow once locked but the game
                              // hasn't finished, green/red once it has and this team won or lost.
                              const pickButtonColor = (teamAbbr) => {
                                if (!gLocked) return { bg: '#3B82F6', text: '#0F1614' };
                                if (!result?.completed) return { bg: '#E8A23D', text: '#0F1614' };
                                if (result.winnerAbbr === null) return { bg: '#5C6862', text: '#0F1614' }; // tie
                                return result.winnerAbbr === teamAbbr
                                  ? { bg: '#3D9B5C', text: '#0F1614' }
                                  : { bg: '#C1443A', text: '#F0EDE4' };
                              };
                              const missed = gLocked && !winner;
                              const isTie = result?.completed && result.winnerAbbr === null;
                              const correct = result?.completed && !isTie && winner && result.winnerAbbr === winner;
                              const wrong = result?.completed && !isTie && ((winner && result.winnerAbbr !== winner) || (!winner && gLocked));
                              const isBeingDragged = pointerDrag && pointerDrag.pid === p.id && pointerDrag.draggedGid === gid;
                              return (
                                <div
                                  key={gid}
                                  ref={el => { dragRowRefs.current[`${p.id}|${gid}`] = el; }}
                                  className="flex items-center gap-2 rounded px-2.5 py-1.5 font-mono text-xs flex-wrap"
                                  style={{
                                    background: isBeingDragged ? '#243328' : '#0F1614',
                                    border: `1px solid ${isBeingDragged ? '#E8A23D' : '#2A3830'}`,
                                    boxShadow: isBeingDragged
                                      ? '0 8px 20px rgba(0,0,0,0.6)'
                                      : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)',
                                    position: 'relative',
                                    zIndex: isBeingDragged ? 10 : 1,
                                  }}
                                >
                                  {rankMode === 'type' && !gLocked ? (
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={1}
                                      max={liveOrder.length}
                                      value={numberDrafts[`${p.id}-${gid}`] ?? confidence}
                                      onChange={e => setNumberDrafts(d => ({ ...d, [`${p.id}-${gid}`]: e.target.value }))}
                                      onFocus={e => e.target.select()}
                                      onBlur={e => {
                                        setConfidenceNumber(p.id, liveOrder, gid, e.target.value);
                                        setNumberDrafts(d => { const next = { ...d }; delete next[`${p.id}-${gid}`]; return next; });
                                      }}
                                      onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                                      className="w-9 text-center font-head shrink-0 rounded"
                                      style={{ background: '#1F2B25', border: '1px solid #E8A23D66', color: '#E8A23D', fontSize: '16px' }}
                                    />
                                  ) : (
                                    <span className="w-6 text-center font-head shrink-0" style={{ color: '#E8A23D' }}>{confidence}</span>
                                  )}
                                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    {effectiveOdds(g)?.details && (
                                      <div className="font-mono text-[8px]" style={{ color: '#5C6862' }}>{effectiveOdds(g).details}</div>
                                    )}
                                    <div className="flex items-stretch rounded overflow-hidden" style={{ border: '1px solid #2A3830' }}>
                                      <button
                                        onClick={() => setWinner(viewWeek, p.id, gid, g.away.abbr)}
                                        disabled={gLocked}
                                        className="px-2.5 py-1.5 text-center font-mono text-xs"
                                        style={{
                                          background: awaySelected ? pickButtonColor(g.away.abbr).bg : '#1C2823',
                                          color: awaySelected ? pickButtonColor(g.away.abbr).text : '#F0EDE4',
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
                                          background: homeSelected ? pickButtonColor(g.home.abbr).bg : '#1C2823',
                                          color: homeSelected ? pickButtonColor(g.home.abbr).text : '#F0EDE4',
                                          cursor: gLocked ? 'not-allowed' : 'pointer',
                                        }}
                                      >
                                        {g.home.abbr}
                                      </button>
                                    </div>
                                    {/* Kickoff sits under the matchup (not beside it) so every row is the same height
                                        — beside it, wider matchups pushed the drag handle onto its own line. */}
                                    <div className="font-mono text-[9px] whitespace-nowrap" style={{ color: '#5C6862' }}>{formatKickoff(g.kickoff)}</div>
                                  </div>
                                  {missed && <span style={{ color: '#5C6862' }}>Missed pick</span>}
                                  {correct && <span style={{ color: '#7FCB98' }}>✓ +{confidence}</span>}
                                  {wrong && <span style={{ color: '#E28A82' }}>✗ 0</span>}
                                  {!gLocked && rankMode === 'drag' && (
                                    <button
                                      type="button"
                                      title="Drag to reorder"
                                      onPointerDown={e => beginPointerDrag(e, p.id, liveOrder, gid)}
                                      onPointerMove={onPointerMoveDrag}
                                      onPointerUp={endPointerDrag}
                                      onPointerCancel={endPointerDrag}
                                      className="flex items-center justify-center rounded shrink-0 ml-auto"
                                      style={{
                                        width: '38px',
                                        height: '38px',
                                        background: isBeingDragged ? '#E8A23D' : '#1F2B25',
                                        border: `1px solid ${isBeingDragged ? '#E8A23D' : '#E8A23D66'}`,
                                        color: isBeingDragged ? '#0F1614' : '#E8A23D',
                                        cursor: isBeingDragged ? 'grabbing' : 'grab',
                                        touchAction: 'none', // stops the page from scrolling while dragging on touch
                                        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                                      }}
                                    >
                                      <GripVertical size={18} />
                                    </button>
                                  )}
                                  {!gLocked && rankMode === 'arrows' && (
                                    <div className="flex gap-1 shrink-0 ml-auto">
                                      <button
                                        type="button"
                                        title="Move up"
                                        onClick={() => moveInOrder(p.id, liveOrder, gid, -1)}
                                        disabled={idx === 0}
                                        className="flex items-center justify-center rounded"
                                        style={{ width: '30px', height: '38px', background: idx === 0 ? '#0F1614' : '#1F2B25', border: `1px solid ${idx === 0 ? '#2A3830' : '#E8A23D66'}`, color: idx === 0 ? '#2A3830' : '#E8A23D' }}
                                      >
                                        <ChevronUp size={16} />
                                      </button>
                                      <button
                                        type="button"
                                        title="Move down"
                                        onClick={() => moveInOrder(p.id, liveOrder, gid, 1)}
                                        disabled={idx === liveOrder.length - 1}
                                        className="flex items-center justify-center rounded"
                                        style={{ width: '30px', height: '38px', background: idx === liveOrder.length - 1 ? '#0F1614' : '#1F2B25', border: `1px solid ${idx === liveOrder.length - 1 ? '#2A3830' : '#E8A23D66'}`, color: idx === liveOrder.length - 1 ? '#2A3830' : '#E8A23D' }}
                                      >
                                        <ChevronDown size={16} />
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

                        {isMe && !isMassLocked() && (() => {
                          const signature = JSON.stringify({ winners: weekEntry.winners || {}, tiebreaker: weekEntry.tiebreaker ?? null });
                          const hasUnsubmittedChanges = weekEntry.confirmedSignature !== signature;
                          return (
                            <button
                              onClick={() => {
                                const missingGames = games.filter(g => !winners[g.id]);
                                const missingTiebreaker = weekEntry.tiebreaker == null || weekEntry.tiebreaker === '';
                                setSubmitCheck({ missingGames, missingTiebreaker, participantName: p.name });
                                confirmSubmission(viewWeek, p.id, signature);
                              }}
                              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1.5 self-start"
                              style={{ background: hasUnsubmittedChanges ? '#E8A23D' : '#2A3830', color: hasUnsubmittedChanges ? '#0F1614' : '#8A9A90', border: hasUnsubmittedChanges ? 'none' : '1px solid #3A4A42' }}
                            >
                              <Check size={16} /> {hasUnsubmittedChanges ? 'Submit My Picks' : 'Picks Saved'}
                            </button>
                          );
                        })()}
                      </div>
                    )}
                    {isAdmin && (
                      <button onClick={() => removeParticipant(p.id)} className="mt-3 font-mono text-[10px] underline" style={{ color: '#5C6862' }}>
                        Remove entrant
                      </button>
                    )}
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
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                <Trophy size={14} /> Week {weekLabel(viewWeek)} Standings
              </div>
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-2 font-head text-sm uppercase tracking-wide"
                style={{ color: '#0F1614', background: 'linear-gradient(135deg,#F0C168,#E8A23D)', animation: 'weekly-payout-pulse 2.4s ease-in-out infinite' }}
              >
                <Coins size={15} /> Weekly winner takes 30 units
              </div>
              <style>{`
                @keyframes weekly-payout-pulse {
                  0%, 100% { box-shadow: 0 0 8px #E8A23D66, 0 0 2px #E8A23D; }
                  50% { box-shadow: 0 0 18px #E8A23Dcc, 0 0 6px #E8A23D; }
                }
              `}</style>
              <div className="font-mono text-[10px] mb-3" style={{ color: '#5C6862' }}>
                Ties broken by closest MNF guess. Reorders automatically as results come in. Tap a name to see their picks.
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
                      style={{ background: '#1C2823', border: i === 0 ? '1px solid #E8A23D88' : '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}
                    >
                      <button onClick={() => setExpandedId(id => id === p.id ? null : p.id)} className="w-full flex items-center gap-2">
                        <div className="font-mono text-[10px] w-4 shrink-0" style={{ color: i === 0 ? '#E8A23D' : '#5C6862' }}>{i + 1}</div>
                        <div className="font-head text-xs flex-1 text-left truncate">{p.name}</div>
                        {p.guess != null && isTiebreakerRevealed(p.id) && <div className="font-mono text-[9px] shrink-0 hidden sm:block" style={{ color: '#5C6862' }}>MNF Tie Breaker Score: {p.guess}</div>}
                        <div className="text-right shrink-0 leading-tight">
                          <div className="font-head text-sm" style={{ color: '#E8A23D' }}>{p.points}</div>
                          {(() => {
                            const best = weeklyBestPossible(p.id, viewWeek);
                            return best > p.points ? (
                              <div className="font-mono text-[11px]" style={{ color: '#F0EDE4' }}>Best Possible: {best}</div>
                            ) : null;
                          })()}
                          <div className="font-mono text-[11px]" style={{ color: '#F0EDE4' }}>{seasonTotal(p.id)} season ({ordinal(seasonRankById[p.id])})</div>
                        </div>
                        <span style={{ color: '#5C6862', fontSize: '10px' }}>{expandedId === p.id ? '▾' : '▸'}</span>
                      </button>
                      {expandedId === p.id && (
                        <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid #2A3830' }}>
                          <div className="font-mono text-[10px] mb-2" style={{ color: '#5C6862' }}>
                            MNF Tiebreaker (combined final score): {isTiebreakerRevealed(p.id) ? (
                              <span style={{ color: p.guess != null ? '#E8A23D' : '#5C6862' }}>{p.guess != null ? p.guess : 'Not entered'}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1" style={{ color: '#5C6862' }}><Lock size={10} /> Hidden until kickoff</span>
                            )}
                          </div>
                          {(() => {
                            const best = weeklyBestPossible(p.id, viewWeek);
                            return best > p.points ? (
                              <div className="font-mono text-[11px] mb-2" style={{ color: '#F0EDE4' }}>Best Possible Total: {best}</div>
                            ) : null;
                          })()}
                          <div className="flex gap-1.5 flex-wrap">
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Season leaderboard */}
            <div>
              <div className="rounded-lg px-4 py-3 mb-3" style={{ background: '#1F2B25', border: '1px solid #E8A23D66' }}>
                <div className="font-head uppercase text-[11px] tracking-[0.2em] mb-2" style={{ color: '#E8A23D' }}>Season Payouts</div>
                <div className="flex items-center justify-between font-mono text-xs py-1" style={{ color: '#8A9A90' }}>
                  <span className="uppercase tracking-wide">1st place</span>
                  <span className="font-head" style={{ color: '#E8A23D' }}>275 units</span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs py-1" style={{ color: '#8A9A90' }}>
                  <span className="uppercase tracking-wide">2nd place</span>
                  <span className="font-head" style={{ color: '#E8A23D' }}>140 units</span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs py-1" style={{ color: '#8A9A90' }}>
                  <span className="uppercase tracking-wide">3rd place</span>
                  <span className="font-head" style={{ color: '#E8A23D' }}>70 units</span>
                </div>
              </div>
              <button onClick={() => setShowSeasonLeaderboard(v => !v)} className="w-full flex items-center gap-2 mb-1">
                <div className="font-head uppercase text-sm tracking-[0.2em] flex items-center gap-2" style={{ color: '#8A9A90' }}>
                  <Trophy size={14} /> Season Leaderboard
                </div>
                {showSeasonLeaderboard ? <ChevronDown size={20} color="#8A9A90" /> : <ChevronRight size={20} color="#8A9A90" />}
                <span className="font-mono text-[10px] ml-auto" style={{ color: '#5C6862' }}>
                  {showSeasonLeaderboard ? 'tap to collapse' : `${leaderboard.length} entrants — tap to expand`}
                </span>
              </button>
              {showSeasonLeaderboard && (
                <>
                  <div className="font-mono text-[10px] mb-3" style={{ color: '#5C6862' }}>
                    Top {SEASON_TOP_SPOTS} of {data.participants.length} entrants win season-long payouts — season tiebreaker not yet set
                  </div>
                  <div className="space-y-1.5">
                    {leaderboard.map((p, i) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 rounded px-3 py-2"
                        style={{ background: '#1C2823', border: i < SEASON_TOP_SPOTS ? '1px solid #E8A23D88' : '1px solid #2A3830' }}
                      >
                        <div className="font-mono text-xs w-6" style={{ color: i < SEASON_TOP_SPOTS ? '#E8A23D' : '#5C6862' }}>{i + 1}</div>
                        <div className="font-head text-sm flex-1">{p.name}</div>
                        <div className="font-mono text-sm" style={{ color: '#E8A23D' }}>{p.total} pts</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
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

      {/* Submit My Picks confirmation — lets someone explicitly check "did I actually finish"
          rather than assuming ordering the games and entering a tiebreaker means they're done. */}
      {submitCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: `1px solid ${(submitCheck.missingGames.length > 0 || submitCheck.missingTiebreaker) ? '#C1443A' : '#3D9B5C'}` }}>
            {submitCheck.missingGames.length === 0 && !submitCheck.missingTiebreaker ? (
              <>
                <div className="font-head text-base uppercase tracking-wide mb-2" style={{ color: '#7FCB98' }}>
                  All set!
                </div>
                <div className="font-mono text-sm mb-4" style={{ color: '#F0EDE4' }}>
                  You've picked a winner for every game and entered your MNF tiebreaker. Nothing left to do — you can still change any pick until it locks.
                </div>
              </>
            ) : (
              <>
                <div className="font-head text-base uppercase tracking-wide mb-2" style={{ color: '#E28A82' }}>
                  Not finished yet
                </div>
                <div className="font-mono text-sm mb-3" style={{ color: '#F0EDE4' }}>
                  {submitCheck.participantName} is missing:
                </div>
                <ul className="mb-4 pl-4 space-y-1" style={{ listStyleType: 'disc' }}>
                  {submitCheck.missingGames.length > 0 && (
                    <li className="font-mono text-sm" style={{ color: '#E28A82' }}>
                      A winner pick for {submitCheck.missingGames.length} game{submitCheck.missingGames.length === 1 ? '' : 's'}: {submitCheck.missingGames.map(g => `${g.away.abbr} @ ${g.home.abbr}`).join(', ')}
                    </li>
                  )}
                  {submitCheck.missingTiebreaker && (
                    <li className="font-mono text-sm" style={{ color: '#E28A82' }}>The MNF tiebreaker score</li>
                  )}
                </ul>
              </>
            )}
            <button
              onClick={() => setSubmitCheck(null)}
              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide"
              style={{ background: (submitCheck.missingGames.length > 0 || submitCheck.missingTiebreaker) ? '#C1443A' : '#3D9B5C', color: '#0F1614' }}
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

      {/* Weekly-win celebration — shown once, only to the winner(s), the first time they open
          the pool after their win is fully decided. */}
      {activeCelebration != null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" style={{ pointerEvents: 'none' }}>
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
              100% { transform: translateY(110vh) rotate(720deg); opacity: 0.4; }
            }
            @keyframes celebration-pop {
              0% { transform: scale(0.85); opacity: 0; }
              60% { transform: scale(1.03); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>
          <div className="absolute inset-0 overflow-hidden">
            {confettiPieces.map(p => (
              <div
                key={p.id}
                style={{
                  position: 'absolute',
                  left: `${p.left}%`,
                  top: '-5%',
                  width: `${p.width}px`,
                  height: `${p.height}px`,
                  background: p.color,
                  borderRadius: '1px',
                  animation: `confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
                  transform: `rotate(${p.rotate}deg)`,
                }}
              />
            ))}
          </div>
          <div
            className="relative rounded-lg px-7 py-6 text-center mx-6"
            style={{
              background: '#1C2823',
              border: '2px solid #E8A23D',
              boxShadow: '0 16px 48px rgba(0,0,0,0.65), 0 0 40px #E8A23D33',
              pointerEvents: 'auto',
              animation: 'celebration-pop 0.4s ease-out',
            }}
          >
            <div className="font-display text-2xl uppercase leading-tight mb-2" style={{ color: '#E8A23D' }}>
              🎉 Congrats on the big win! 🎉
            </div>
            <div className="font-mono text-sm mb-4" style={{ color: '#F0EDE4' }}>
              You took the top spot in Week {weekLabel(activeCelebration)}.
            </div>
            <button
              onClick={dismissCelebration}
              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide"
              style={{ background: '#E8A23D', color: '#0F1614' }}
            >
              Nice!
            </button>
          </div>
        </div>
      )}

      {renamePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #2A3830' }}>
            <div className="font-head text-sm uppercase tracking-wide mb-2" style={{ color: '#F0EDE4' }}>Edit display name</div>
            <input
              autoFocus
              value={renamePrompt.value}
              onChange={e => setRenamePrompt(p => ({ ...p, value: e.target.value, error: '' }))}
              onKeyDown={e => e.key === 'Enter' && saveRename()}
              className="w-full px-3 py-2 rounded outline-none font-head text-sm mb-2"
              style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
            />
            {renamePrompt.error && <div className="font-mono text-xs mb-2" style={{ color: '#E28A82' }}>{renamePrompt.error}</div>}
            <div className="flex items-center gap-2">
              <button onClick={saveRename} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#E8A23D', color: '#0F1614' }}>
                Save
              </button>
              <button onClick={() => setRenamePrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0" style={{ background: '#0F1614cc' }} onClick={() => setEmailModal(null)}>
          <div className="w-full max-w-lg rounded flex flex-col" style={{ background: '#1C2823', border: '1px solid #2A3830', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #2A3830' }}>
              <div>
                <div className="font-head text-sm uppercase tracking-wide" style={{ color: '#F0EDE4' }}>{emailModal.label}</div>
                <div className="font-mono text-[10px]" style={{ color: '#5C6862' }}>{emailModal.emails.length} email address{emailModal.emails.length === 1 ? '' : 'es'}</div>
              </div>
              <button onClick={() => setEmailModal(null)} style={{ color: '#5C6862' }}><X size={20} /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">
              {emailModal.emails.length === 0 ? (
                <div className="font-mono text-xs" style={{ color: '#5C6862' }}>No matching email addresses found.</div>
              ) : (
                <>
                  <textarea
                    readOnly
                    value={emailModal.emails.join(', ')}
                    onFocus={e => e.target.select()}
                    rows={6}
                    className="w-full px-3 py-2 rounded font-mono text-xs resize-none"
                    style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
                  />
                  <button
                    onClick={copyEmails}
                    className="mt-3 px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1.5"
                    style={{ background: copied ? '#3D9B5C' : '#1F2B25', color: copied ? '#0F1614' : '#F0EDE4', border: copied ? 'none' : '1px solid #3A4A42' }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                  <div className="font-mono text-[10px] mt-2" style={{ color: '#5C6862' }}>
                    Paste this directly into Gmail's "To" field — it's already comma-separated.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Milky Way backdrop, embedded so there's no separate image file to deploy.
const GALAXY_BG = 'data:image/jpeg;base64,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oKaoJIIIooZDxc4IMIIIIIKIIKpoJJLL77677777776777r777Ypo7b6ab7y45oI4IIZIIIIIJIw6IIIIIIJdLIIqYYobaa777677777777774LL5Lvt6pLrKbr775a44YIIIIIIIEApIaEJKIYIIY6I76b7b67677b77777776776a5plp5r7pibL7a7L66I6MIIoIqIJLIIK4IpaIdIK7r5557777B777a6bb77777464QI745Fphp66w11T765YIIIIIIJYoLIIIoIa4Y76r776777574J77br5zlLr5b77orb4ooZpJa776/b6oIYIpKIJIIIIIIJLKavbr77LrbL777766077777q7roqp77bL7774I4p7r64o745IaIIMKqIIJZKIIoKY6757YJZLpqbqKKWpDLTbxYZ475zbZr7747aYq6Z766b77oaqIoKJcILKIYIYIpqar6K5ZrI44wgaQxTQSwBADaARDZDKCJihT56pZb7IJ7p77r7a6566ILb44577Z776547bNJCBTDBhDJtLCiAwjSMgABwBAhACzTDJDCQDja77JLL7776777Lr77Z7r6oZq4Sn7CYJvSCo4dH8YJLTDyzgwxhDixCbSQRxjyiRgIzCQwBBDDb6QxxDYCRTQTgQOplPNuH+c9Pnk8lU8ddhJIrKsINIuIIpChJYIINLDIYKBTCDjwzQJCDDRzDTA7N9sEneHDHUnKKIYLIwke8dPkktnGHGlE0utvHHFE8tvHE6+JoKAAIqwYoJNII+E32G/EAIYLYIqI0UoALY2218qVVvrdaLaKU001k10lEGU0lXP/wDqOTg778xhRhDN9lB7GX888M++s++2MCaCmuCK+aOCKWSGCuKCiYVX1fLCggE4Aw+wBDSjrTlJN9vw++++++++++++++++++wCC9Ve678sNM++O/v8+OmaAiCCCCCCDBABBCCCCCjQCiCWO++++++++++++++++2+++++e++++++++++++6mSCCCCCCCDCBBJDADDCCCCCCSaK2y+++++++++++++++++++6++++++++++++mq2iGCCCDCCCABxFJBBBHCCCCCyWKe++2+++++++++++++++6+++++++++++++++jFFBFNiDJBDBBBAAAEAAgwCCyJlV1pF5xJRDSSCiTD9hB9XDR5z3xy317159t9bgAA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';
