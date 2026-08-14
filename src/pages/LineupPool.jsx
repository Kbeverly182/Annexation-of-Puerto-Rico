import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X, ChevronLeft, ChevronRight, Users, Loader2, Lock, UserCircle, ArrowLeft, Trophy, Check, AlertTriangle, Download } from 'lucide-react';
import { TEAMS, TEAM_MAP, WEEKS, ALL_WEEKS, weekLabel, weeksForSeason, isPreseasonWeek } from '../lib/teams';
import { uid, hashPin, defaultSeasonYear } from '../lib/utils';
import { apiGetPool, apiSavePool, mergePoolData } from '../lib/api';
import { useEspnSchedule, buildScoreboardUrl } from '../lib/espnSchedule';
import { useNflRosters } from '../lib/rosters';
import { useAdminMode } from '../lib/admin';
import PoolTicker from '../components/PoolTicker';
import PoolChat from '../components/PoolChat';

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
  const [newEmail, setNewEmail] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear());
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [claimPrompt, setClaimPrompt] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [resetConfirmId, setResetConfirmId] = useState(null);
  const [clearWeekConfirm, setClearWeekConfirm] = useState(false);
  const [clearAllWeeksConfirmState, setClearAllWeeksConfirmState] = useState(false);
  const [slotPickConfirm, setSlotPickConfirm] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [playerSearch, setPlayerSearch] = useState({}); // { `${pid}-${slotKey}`: searchText }
  const [openCombo, setOpenCombo] = useState(null); // which slot's suggestion list is open
  const [statsDebug, setStatsDebug] = useState(null);
  const [statsDebugLoading, setStatsDebugLoading] = useState(false);
  const [statsDebugFilter, setStatsDebugFilter] = useState('');
  const [statsApplySummary, setStatsApplySummary] = useState(null);
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const { schedule, lockTimeForPick } = useEspnSchedule(viewWeek, seasonYear);
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();
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

  useEffect(() => { setClearWeekConfirm(false); setClearAllWeeksConfirmState(false); }, [viewWeek]);

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

  const addParticipant = () => {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email) return;
    const newP = { id: uid(), name, pin: null, email };
    persist({ ...data, participants: [...data.participants, newP] });
    setNewName('');
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

  const exportEmails = () => {
    const rows = data.participants.map(p => `"${(p.name || '').replace(/"/g, '""')}","${p.email || ''}"`);
    const csv = 'Name,Email\n' + rows.join('\n');
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

  // Wipes everyone's picks and scores for one specific week only — leaves every other week,
  // all entrants, and their PINs completely untouched. Admin-only, two taps to confirm.
  const clearWeek = (week) => {
    if (!clearWeekConfirm) { setClearWeekConfirm(true); return; }
    const next = { ...data, picks: { ...data.picks }, playerScores: { ...data.playerScores } };
    delete next.picks[week];
    delete next.playerScores[week];
    persist(next);
    setClearWeekConfirm(false);
  };

  // Wipes picks/scores for every week (preseason and regular) — for clearing out test data that
  // predates the current week system entirely, when it's unclear which exact key it landed under.
  const clearAllWeeks = () => {
    if (!clearAllWeeksConfirmState) { setClearAllWeeksConfirmState(true); return; }
    persist({ ...data, picks: {}, playerScores: {} });
    setClearAllWeeksConfirmState(false);
  };

  // Selecting a player doesn't commit right away — it opens a confirmation prompt first, same
  // pattern as Survivor, so a stray tap doesn't silently overwrite an existing pick.
  const requestSlotPick = (pid, slotKey, position, value, label, participantName) => {
    const oldValue = data.picks[viewWeek]?.[pid]?.[slotKey];
    setSlotPickConfirm({
      pid, slotKey, position, value, label, participantName,
      oldValue, oldLabel: oldValue ? playerLabel(oldValue, position) : null,
    });
  };
  const confirmSlotPick = () => {
    if (!slotPickConfirm) return;
    setSlot(viewWeek, slotPickConfirm.pid, slotPickConfirm.slotKey, slotPickConfirm.value);
    setSlotPickConfirm(null);
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
    if (isAdmin) return false;
    const team = slotTeamAbbr(value, position);
    if (!team) return false;
    const lockTime = lockTimeForPick(viewWeek, team);
    return lockTime !== null && now >= lockTime;
  };
  const isPickRevealed = (pid) => {
    if (isAdmin) return true;
    if (myId && pid === myId) return true;
    const weekPicks = data.picks[viewWeek]?.[pid] || {};
    const filled = SLOTS.filter(s => weekPicks[s.key]);
    if (filled.length === 0) return false;
    return filled.every(s => isSlotLocked(s.position, weekPicks[s.key]));
  };

  const usedByParticipant = (pid, excludeWeek, excludeSlotKey) => {
    const used = new Set();
    if (isAdmin) return used;
    for (const w of weeksForSeason(excludeWeek)) {
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

  // Kept internal-only (not rendered as a visible list) — used by the auto-stats matcher below
  // to know which players were actually drafted this week.
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

  // How many entrants have already used a given player in a PRIOR week — deliberately excludes
  // the currently-viewed week itself, so this reflects "still available going into this week,"
  // not a live readout of who's already picked this week (which would leak other people's picks).
  const seasonUsageCounts = {};
  data.participants.forEach(p => {
    const usedByThis = new Set();
    weeksForSeason(viewWeek).filter(w => w < viewWeek).forEach(w => {
      const weekPicks = data.picks[w]?.[p.id];
      if (!weekPicks) return;
      SLOTS.forEach(s => { if (weekPicks[s.key]) usedByThis.add(weekPicks[s.key]); });
    });
    usedByThis.forEach(val => { seasonUsageCounts[val] = (seasonUsageCounts[val] || 0) + 1; });
  });
  const availabilityPct = (value) => {
    const total = data.participants.length;
    if (total === 0) return 100;
    return Math.round(((total - (seasonUsageCounts[value] || 0)) / total) * 100);
  };

  // How many entrants drafted a given player this specific week — an aggregate count only,
  // never tied to who picked it, so it's safe to show even before picks lock.
  const weekOwnershipCounts = {};
  data.participants.forEach(p => {
    const weekPicks = data.picks[viewWeek]?.[p.id];
    if (!weekPicks) return;
    const pickedThisPerson = new Set(Object.values(weekPicks).filter(Boolean));
    pickedThisPerson.forEach(val => { weekOwnershipCounts[val] = (weekOwnershipCounts[val] || 0) + 1; });
  });
  const ownershipPct = (value) => {
    const total = data.participants.length;
    if (total === 0 || !value) return 0;
    return Math.round(((weekOwnershipCounts[value] || 0) / total) * 100);
  };

  // Standings order: highest season total first; before anyone has scores (all zero), this
  // naturally falls back to alphabetical-by-last-name via the tiebreaker.
  const standingsRows = [...data.participants]
    .map(p => ({ ...p, total: seasonTotal(p.id) }))
    .sort((a, b) => (b.total - a.total) || lastNameOf(a.name).localeCompare(lastNameOf(b.name)));

  const testPlayerStatsSync = async () => {
    setStatsDebugLoading(true);
    setStatsDebug(null);
    try {
      // Check whatever week is currently being viewed first, then fall back to scanning our
      // three defined preseason weeks (by exact date, not ESPN's own mismatched week numbers) —
      // that's what's actually being played right now.
      const candidateWeeks = [viewWeek, 101, 102, 103].filter((w, i, arr) => arr.indexOf(w) === i);
      let completedGames = [];
      let sourceLabel = '';
      for (const w of candidateWeeks) {
        const res = await fetch(buildScoreboardUrl(w, seasonYear));
        const json = await res.json();
        const found = (json.events || []).filter(ev => ev.competitions?.[0]?.status?.type?.completed);
        if (found.length > 0) {
          completedGames = found;
          sourceLabel = `Week ${weekLabel(w)}`;
          break;
        }
      }

      if (completedGames.length === 0) {
        setStatsDebug([{ gameId: '—', matchup: 'No completed games found yet', ok: false, error: 'Checked this week and preseason weeks 1-3 — none have finished. Try again once a game has actually been played.' }]);
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
      applyTestScoresToLineup(results);
    } catch (e) {
      setStatsDebug([{ gameId: '—', matchup: 'Lookup failed', ok: false, error: String(e) }]);
    } finally {
      setStatsDebugLoading(false);
    }
  };

  // Pulls the first numeric value found under any of several candidate label names —
  // a defensive guess since ESPN's exact label strings for this endpoint aren't confirmed yet.
  const pickStat = (stats, keys) => {
    for (const k of keys) {
      if (stats[k] != null) {
        const raw = String(stats[k]);
        // "made/attempted" style stats (kicking, completions) — take the first number, not both digits mashed together.
        if (raw.includes('/')) {
          const made = parseFloat(raw.split('/')[0]);
          if (!isNaN(made)) return made;
        }
        const n = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
        if (!isNaN(n)) return n;
      }
    }
    return 0;
  };

  // PPR scoring per the pool's rules doc. Kicking is a known-approximate area: aggregate
  // box score stats don't include per-kick distance, so field goals use a flat estimate
  // until we can pull play-by-play data — flagged clearly wherever it shows up.
  const computeFantasyPoints = (category, stats) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('pass')) {
      const yds = pickStat(stats, ['YDS', 'PASS YDS', 'PASSING YARDS']);
      const td = pickStat(stats, ['TD', 'PASS TD']);
      const int = pickStat(stats, ['INT', 'INTERCEPTIONS']);
      return { points: yds / 25 + td * 6 + int * -2, approximate: false };
    }
    if (cat.includes('rush')) {
      const yds = pickStat(stats, ['YDS', 'RUSH YDS']);
      const td = pickStat(stats, ['TD', 'RUSH TD']);
      return { points: yds / 10 + td * 6, approximate: false };
    }
    if (cat.includes('receiv')) {
      const rec = pickStat(stats, ['REC', 'RECEPTIONS']);
      const yds = pickStat(stats, ['YDS', 'REC YDS']);
      const td = pickStat(stats, ['TD', 'REC TD']);
      return { points: rec * 1 + yds / 10 + td * 6, approximate: false };
    }
    if (cat.includes('fumbl')) {
      const lost = pickStat(stats, ['LOST', 'FUM LOST']);
      return { points: lost * -2, approximate: false };
    }
    if (cat.includes('kick')) {
      const fgMade = pickStat(stats, ['FG', 'FGM']);
      const longFg = pickStat(stats, ['LONG']);
      const xpMade = pickStat(stats, ['XP', 'PAT']);
      // Distance/10 per made FG, minimum 3.0. The box score only gives the longest FG made,
      // not each individual kick's distance — accurate for a single made FG, an approximation
      // (applying the longest kick's value to every make) when more than one FG was made.
      const perFgPoints = longFg > 0 ? Math.max(longFg / 10, 3.0) : 3.0;
      const fgPoints = fgMade * perFgPoints;
      const xpPoints = xpMade * 1;
      return { points: fgPoints + xpPoints, approximate: fgMade > 1 };
    }
    return { points: 0, approximate: false };
  };

  // Standard ESPN D/ST points-allowed scale.
  const pointsAllowedScore = (pa) => {
    if (pa === 0) return 10;
    if (pa <= 6) return 7;
    if (pa <= 13) return 4;
    if (pa <= 20) return 1;
    if (pa <= 27) return 0;
    if (pa <= 34) return -1;
    return -4;
  };

  // D/ST scoring: points-allowed is reliable (comes straight from the final score), the
  // sacks/turnovers/TD component is best-effort since we don't yet know ESPN's exact team-stat
  // label names — contributes 0 for anything it can't find rather than guessing wrong.
  const computeDstPoints = (teamAbbr, gameResult) => {
    const myScore = gameResult.scores?.find(s => s.abbr === teamAbbr);
    const oppScore = gameResult.scores?.find(s => s.abbr !== teamAbbr);
    let points = 0;
    let approximate = false;
    if (oppScore?.score != null) {
      points += pointsAllowedScore(oppScore.score);
    } else {
      approximate = true;
    }
    const teamStats = gameResult.teams?.find(t => t.abbr === teamAbbr)?.stats || {};
    const sacks = pickStat(teamStats, ['sacksYardsLost', 'sacks', 'Sacks', 'totalSacks']);
    const ints = pickStat(teamStats, ['interceptions', 'Interceptions', 'defensiveInterceptions']);
    const fumRec = pickStat(teamStats, ['fumblesRecovered', 'FumblesRecovered']);
    if (sacks || ints || fumRec) {
      points += sacks * 1 + ints * 2 + fumRec * 2;
    } else {
      approximate = true; // couldn't find these fields — likely under-counting
    }
    return { points, approximate };
  };

  // Applies computed points to whatever the currently-viewed week's rostered players match in
  // the fetched stats. Non-destructive to anyone not found — existing manual entries are untouched
  // unless a real match is found for that exact player.
  const applyTestScoresToLineup = (results) => {
    const allPlayerRows = results.flatMap(r => r.players || []);
    const totalsByPlayerId = {};
    const anyApprox = {};
    allPlayerRows.forEach(row => {
      if (!row.playerId) return;
      const { points, approximate } = computeFantasyPoints(row.category, row.stats);
      totalsByPlayerId[row.playerId] = (totalsByPlayerId[row.playerId] || 0) + points;
      if (approximate) anyApprox[row.playerId] = true;
    });
    // Name index, used only to detect an ID mismatch when a direct ID match fails —
    // if we find the same name under a different ID, that pinpoints the actual bug.
    const rowsByName = {};
    allPlayerRows.forEach(row => {
      if (!row.name) return;
      const k = row.name.toLowerCase();
      (rowsByName[k] = rowsByName[k] || []).push(row);
    });
    // D/ST: any team that actually appears in one of the fetched games' final scores.
    results.forEach(r => {
      (r.scores || []).forEach(s => {
        if (s.abbr) {
          const { points, approximate } = computeDstPoints(s.abbr, r);
          totalsByPlayerId[s.abbr] = points;
          if (approximate) anyApprox[s.abbr] = true;
        }
      });
    });

    let matched = 0;
    const details = [];
    const next = { ...data, playerScores: { ...data.playerScores } };
    next.playerScores[viewWeek] = { ...(next.playerScores[viewWeek] || {}) };
    pickedThisWeek.forEach((info, key) => {
      const directHit = totalsByPlayerId[key];
      if (directHit != null) {
        next.playerScores[viewWeek][key] = Math.round(directHit * 10) / 10;
        matched++;
        details.push({ label: info.label, status: 'matched', points: Math.round(directHit * 10) / 10, key });
        return;
      }
      // No direct ID match — check if the same name exists under a different ID.
      const nameGuess = (info.label || '').split(' (')[0].toLowerCase();
      const nameHit = rowsByName[nameGuess];
      if (nameHit?.length) {
        details.push({ label: info.label, status: 'id-mismatch', key, foundId: nameHit[0].playerId });
      } else {
        details.push({ label: info.label, status: 'no-data', key });
      }
    });
    if (matched > 0) {
      persist(next);
    }
    setStatsApplySummary({ matched, total: pickedThisWeek.size, details, hasApprox: pickedThisWeek.size > 0 && [...pickedThisWeek.keys()].some(k => anyApprox[k]) });
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
        input:focus, select:focus { outline: none; border-color: #8A9A9088 !important; box-shadow: 0 0 0 3px #8A9A9022; }

        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #3A4A42; border-radius: 4px; }
        select { color-scheme: dark; }
      `}</style>

      <div style={{ background: 'linear-gradient(180deg,#1B2721,#0F1614)', borderBottom: '1px solid #8A9A9033', boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }} className="px-5 py-5 sm:px-8">
        <div className="max-w-5xl mx-auto mb-3 flex items-center gap-3">
          <img src="/logo.webp" alt="" className="w-7 h-7 rounded object-cover shrink-0" />
          <Link to="/" className="font-mono text-xs flex items-center gap-1.5 w-fit" style={{ color: '#8A9A90' }}>
            <ArrowLeft size={12} /> All Pools
          </Link>
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
                className="font-head text-xl sm:text-2xl tracking-wide flex items-center gap-2 min-w-0 text-left" style={{ letterSpacing: "0.02em" }}
              >
                <span className="truncate uppercase">{data.name}</span>
              </button>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-xs uppercase tracking-widest" style={{ color: '#8A9A90' }}>Current Week</div>
            <div className="font-display text-3xl leading-none" style={{ color: '#8A9A90', letterSpacing: '1px', textShadow: '0 0 24px #8A9A9055' }}>
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

        <PoolTicker message={data.tickerMessage} isAdmin={isAdmin} onSave={setTickerMessage} accent="#8A9A90" />

        {/* Entrants */}
        <div>
          <div className="font-head uppercase text-sm tracking-[0.2em] mb-2 flex items-center gap-2" style={{ color: '#8A9A90' }}>
            <Users size={14} /> Entrants
          </div>

          <div className="font-mono text-[20px] uppercase mb-1.5" style={{ color: '#5C6862' }}>Create new entry?</div>
          {!showCreateForm ? (
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1 mb-4"
              style={{ background: '#8A9A90', color: '#0F1614' }}
            >
              <Plus size={16} /> New Entry
            </button>
          ) : (
            <div className="flex gap-2 mb-1 flex-wrap">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addParticipant()}
                placeholder="Your name…"
                className="flex-1 px-3 py-2 rounded outline-none font-head text-sm"
                style={{ minWidth: '140px', background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
              />
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addParticipant()}
                placeholder="Email…"
                className="flex-1 px-3 py-2 rounded outline-none font-mono text-xs"
                style={{ minWidth: '180px', background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
              />
              <button
                onClick={addParticipant}
                disabled={!newName.trim() || !newEmail.trim()}
                className="px-4 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1"
                style={{ background: (!newName.trim() || !newEmail.trim()) ? '#1F2B25' : '#8A9A90', color: (!newName.trim() || !newEmail.trim()) ? '#5C6862' : '#0F1614' }}
              >
                <Plus size={16} /> Create
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewName(''); setNewEmail(''); }}
                className="px-3 rounded font-mono text-xs underline"
                style={{ color: '#5C6862' }}
              >
                Cancel
              </button>
            </div>
          )}
          {showCreateForm && (
            <div className="font-mono text-[10px] mb-4" style={{ color: '#5C6862' }}>Both fields are required.</div>
          )}

          {myIdLoaded && (
            myId && data.participants.some(p => p.id === myId) ? (
              <div className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded" style={{ background: '#1F2B25', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                <UserCircle size={14} color="#7FCB98" />
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
                  <button onClick={submitClaim} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#8A9A90', color: '#0F1614' }}>
                    {claimPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
                  </button>
                  <button onClick={() => setClaimPrompt(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
                </div>
                {claimPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#E28A82' }}>{claimPrompt.error}</div>}
              </div>
            ) : isAdmin ? (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-mono text-[10px] uppercase" style={{ color: '#5C6862' }}>All entrants (admin view)</div>
                  {data.participants.some(p => p.email) && (
                    <button onClick={exportEmails} className="font-mono text-[10px] uppercase underline flex items-center gap-1" style={{ color: '#7FCB98' }}>
                      <Download size={10} /> Export emails (.csv)
                    </button>
                  )}
                </div>
                {data.participants.length === 0 ? (
                  <div className="font-mono text-xs" style={{ color: '#5C6862' }}>No entrants yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.participants.map(p => (
                      <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs" style={{ background: '#1C2823', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#8A9A90' }}>
                        <button onClick={() => handleNameTap(p)} className="flex items-center gap-1" style={{ color: '#F0EDE4' }}>
                          {p.pin ? <Lock size={10} color="#7FCB98" /> : <Lock size={10} color="#3A4A42" />}
                          {p.name}
                        </button>
                        {p.email && <span style={{ color: '#5C6862', fontSize: '9px' }}>({p.email})</span>}
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
                            {p.pin && <Lock size={10} color="#7FCB98" />}
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
                        background: w === viewWeek ? '#8A9A90' : '#1F2B25',
                        color: w === viewWeek ? '#0F1614' : '#8A9A90',
                        border: w === data.currentWeek ? '1px solid #8A9A90' : '1px solid #2A3830',
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
                <button onClick={() => setCurrentWeek(viewWeek)} className="font-mono text-xs underline" style={{ color: '#8A9A90' }}>
                  Set week {weekLabel(viewWeek)} as current week
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => clearWeek(viewWeek)}
                  className="font-mono text-xs underline block mt-1"
                  style={{ color: clearWeekConfirm ? '#E28A82' : '#5C6862' }}
                >
                  {clearWeekConfirm ? `Confirm: erase all picks & scores for week ${weekLabel(viewWeek)}?` : `Clear week ${weekLabel(viewWeek)} data`}
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={clearAllWeeks}
                  className="font-mono text-xs underline block mt-1"
                  style={{ color: clearAllWeeksConfirmState ? '#E28A82' : '#5C6862' }}
                >
                  {clearAllWeeksConfirmState ? 'Confirm: erase ALL weeks\' picks & scores (everything)?' : 'Clear ALL weeks\' data (e.g. old test data before PRE 1 existed)'}
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

            {/* Lineups — only your own card (or all, for admin); everyone else's picks now live
                in the Week Standings list below instead of a full hidden-placeholder card each. */}
            <div className="space-y-4">
              {data.participants.map(p => {
                const isMe = myId === p.id;
                if (!isAdmin && !isMe) return null;
                const revealed = isPickRevealed(p.id);
                const weekPicks = data.picks[viewWeek]?.[p.id] || {};
                const total = seasonTotal(p.id);
                return (
                  <div key={p.id} className="rounded px-4 py-3" style={{ background: '#1C2823', border: isMe ? '1px solid #8A9A9088' : '1px solid #2A3830' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-head text-sm">{p.name}</div>
                      <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>Season: {total.toFixed(1)} pts</div>
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
                              .filter(([abbr, name]) => !searchText || name.toLowerCase().includes(searchText.toLowerCase()) || abbr.toLowerCase().includes(searchText.toLowerCase()))
                              .map(([abbr, name]) => ({ value: abbr, label: `${abbr} — ${name}`, avail: availabilityPct(abbr) }))
                              .sort((a, b) => a.label.localeCompare(b.label))
                            : rosters
                              .filter(r => r.position === s.position && teamsPlayingThisWeek.has(r.team) && !used.has(r.id))
                              .filter(r => !searchText || r.name.toLowerCase().includes(searchText.toLowerCase()))
                              .sort((a, b) => lastNameOf(a.name).localeCompare(lastNameOf(b.name)))
                              .map(r => ({ value: r.id, label: `${r.name} (${r.team})`, avail: availabilityPct(r.id) }));
                          return (
                            <div key={s.key} className="flex items-center gap-2 font-mono text-xs">
                              <span className="w-9 shrink-0 font-head" style={{ color: '#8A9A90' }}>{s.label}</span>
                              {locked ? (
                                <span className="flex-1 flex items-center gap-1.5" style={{ color: '#F0EDE4' }}>
                                  <Lock size={10} color="#5C6862" /> {value ? playerLabel(value, s.position) : '— no pick —'}
                                </span>
                              ) : (
                                <div className="relative flex-1">
                                  <input
                                    value={openCombo === searchKey ? searchText : (value ? playerLabel(value, s.position) : '')}
                                    onFocus={() => setOpenCombo(searchKey)}
                                    onChange={e => setPlayerSearch(ps => ({ ...ps, [searchKey]: e.target.value }))}
                                    onBlur={() => setTimeout(() => setOpenCombo(c => (c === searchKey ? null : c)), 150)}
                                    placeholder={`search ${s.label}…`}
                                    className="w-full px-1.5 py-1 rounded"
                                    style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                                  />
                                  {openCombo === searchKey && (
                                    <div
                                      className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded"
                                      style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}
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
                                              requestSlotPick(p.id, s.key, s.position, o.value, o.label, p.name);
                                              setPlayerSearch(ps => ({ ...ps, [searchKey]: '' }));
                                              setOpenCombo(null);
                                            }}
                                            className="w-full text-left px-2 py-1.5 flex items-center justify-between gap-2"
                                            style={{ color: '#F0EDE4' }}
                                          >
                                            <span>{o.label}</span>
                                            <span className="shrink-0" style={{ color: o.avail >= 50 ? '#7FCB98' : o.avail > 0 ? '#E8A23D' : '#E28A82' }}>{o.avail}%</span>
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
              {!isAdmin && !myId && (
                <div className="font-mono text-xs px-3 py-2" style={{ color: '#5C6862' }}>
                  Claim your name above (under "Returning member?") to set your lineup.
                </div>
              )}
            </div>

            {/* Diagnostic: test auto-stats fetch — admin only, this is raw debug output, not
                something a regular participant should ever need to see. */}
            {isAdmin && (
            <div className="rounded px-4 py-3" style={{ background: '#1C2823', border: '1px dashed #5C6862' }}>
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-1 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                Auto-Stats Test (beta)
              </div>
              <div className="font-mono text-[10px] mb-2" style={{ color: '#5C6862' }}>
                Fetches player stats from the most recent completed game, computes PPR points, and applies them to whichever of this week's rostered players it can match — safe to re-run, and manual overrides below still work.
              </div>
              <button
                onClick={testPlayerStatsSync}
                disabled={statsDebugLoading}
                className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide"
                style={{ background: '#1F2B25', border: '1px solid #8A9A90', color: '#8A9A90', opacity: statsDebugLoading ? 0.6 : 1 }}
              >
                {statsDebugLoading ? 'Searching for a completed game…' : 'Test fetch against the most recent completed game'}
              </button>
              {statsApplySummary && (
                <div className="mt-2 font-mono text-xs" style={{ color: statsApplySummary.matched > 0 ? '#7FCB98' : '#E28A82' }}>
                  {statsApplySummary.matched > 0
                    ? `Applied points to ${statsApplySummary.matched} of ${statsApplySummary.total} rostered players this week.`
                    : `No rostered players this week matched anyone in that game's box score.`}
                  {statsApplySummary.hasApprox && ' (Kicker points are a rough estimate — no per-kick distance data available yet.)'}
                  {statsApplySummary.details?.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {statsApplySummary.details.map((d, i) => (
                        <div key={i} style={{ color: d.status === 'matched' ? '#7FCB98' : d.status === 'id-mismatch' ? '#E8A23D' : '#5C6862' }}>
                          {d.status === 'matched' && `✓ ${d.label}: +${d.points} pts (id ${d.key})`}
                          {d.status === 'id-mismatch' && `⚠ ${d.label}: found by name under a different id (roster id ${d.key}, box score id ${d.foundId})`}
                          {d.status === 'no-data' && `– ${d.label}: not found in this game's box score (id ${d.key})`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {statsDebug && (
                <div className="mt-3 space-y-2">
                  {statsDebug.some(r => r.players?.length > 0) && (
                    <input
                      value={statsDebugFilter}
                      onChange={e => setStatsDebugFilter(e.target.value)}
                      placeholder="Search parsed players by name…"
                      className="w-full px-2 py-1.5 rounded font-mono text-xs mb-2"
                      style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)', color: '#F0EDE4' }}
                    />
                  )}
                  {statsDebug.map(r => {
                    const filtered = (r.players || []).filter(
                      p => !statsDebugFilter || (p.name || '').toLowerCase().includes(statsDebugFilter.toLowerCase())
                    );
                    return (
                      <div key={r.gameId} className="rounded px-2.5 py-2 font-mono text-[10px]" style={{ background: '#0F1614', border: '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                        <div className="mb-1" style={{ color: r.ok ? '#7FCB98' : '#E28A82' }}>
                          {r.matchup} — {r.ok ? `parsed ${r.playersParsed} player stat rows` : `error: ${r.error}`}
                        </div>
                        {filtered.length > 0 && (
                          <div className="max-h-64 overflow-y-auto space-y-1">
                            {filtered.map((p, i) => (
                              <div key={i} className="px-2 py-1 rounded" style={{ background: '#1C2823' }}>
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
            )}

            {/* Week standings — nobody sees a plain list of who's been drafted. Sorted by season
                total (alphabetical by last name before anyone has scores). Tap a name to reveal
                their picks — only the slots whose games have actually locked. */}
            <div>
              <div className="font-head uppercase text-sm tracking-[0.2em] mb-3 flex items-center gap-2" style={{ color: '#8A9A90' }}>
                <Trophy size={14} /> Week {weekLabel(viewWeek)} Standings
              </div>
              <div className="space-y-1.5">
                {standingsRows.map(p => {
                  const weekPicks = data.picks[viewWeek]?.[p.id] || {};
                  const weekTotal = SLOTS.reduce((sum, s) => {
                    const val = weekPicks[s.key];
                    return sum + (val && data.playerScores?.[viewWeek]?.[val] != null ? data.playerScores[viewWeek][val] : 0);
                  }, 0);
                  const isMe = myId === p.id;
                  return (
                    <div key={p.id} className="rounded px-3 py-2.5" style={{ background: '#1C2823', border: isMe ? '1px solid #8A9A9088' : '1px solid #2A3830', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.5)' }}>
                      <button onClick={() => setExpandedId(id => id === p.id ? null : p.id)} className="w-full flex items-center gap-3">
                        <span className="font-head text-sm flex-1 text-left truncate">{p.name}</span>
                        <div className="text-right shrink-0 leading-tight">
                          <div className="font-head text-base" style={{ color: '#E8A23D' }}>
                            {weekTotal.toFixed(1)} <span className="font-mono text-[9px] uppercase" style={{ color: '#5C6862' }}>this wk</span>
                          </div>
                          <div className="font-mono text-[9px]" style={{ color: '#5C6862' }}>{p.total.toFixed(1)} season</div>
                        </div>
                        <span style={{ color: '#5C6862', fontSize: '10px' }}>{expandedId === p.id ? '▾' : '▸'}</span>
                      </button>
                      {expandedId === p.id && (
                        <div className="mt-2 pt-2 space-y-1.5" style={{ borderTop: '1px solid #2A3830' }}>
                          {SLOTS.map(s => {
                            const value = weekPicks[s.key];
                            const revealed = isAdmin || isMe || (value ? isSlotLocked(s.position, value) : false);
                            return (
                              <div key={s.key} className="flex items-center gap-2 font-mono text-xs">
                                <span className="w-9 shrink-0 font-head" style={{ color: '#8A9A90' }}>{s.label}</span>
                                {!revealed ? (
                                  <span className="flex-1 flex items-center gap-1.5" style={{ color: '#5C6862' }}>
                                    <Lock size={10} /> Hidden until kickoff
                                  </span>
                                ) : !value ? (
                                  <span className="flex-1" style={{ color: '#5C6862' }}>— no pick —</span>
                                ) : (
                                  <>
                                    <span className="flex-1" style={{ color: '#F0EDE4' }}>{playerLabel(value, s.position)}</span>
                                    <span style={{ color: '#E8A23D' }}>{ownershipPct(value)}% owned</span>
                                    {isAdmin && (
                                      <input
                                        type="number"
                                        value={data.playerScores?.[viewWeek]?.[value] ?? ''}
                                        onChange={e => setPlayerScore(viewWeek, value, e.target.value)}
                                        placeholder="pts"
                                        className="w-14 px-1.5 py-1 rounded text-right"
                                        style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#8A9A90' }}
                                      />
                                    )}
                                  </>
                                )}
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

      {/* Slot pick confirmation modal */}
      {slotPickConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#1C2823', border: '1px solid #2A3830' }}>
            <div className="font-mono text-sm mb-4" style={{ color: '#F0EDE4' }}>
              {slotPickConfirm.oldValue ? (
                <>Change <span style={{ color: '#8A9A90' }}>{slotPickConfirm.participantName}'s</span> pick from <span style={{ color: '#E28A82' }}>{slotPickConfirm.oldLabel}</span> to <span style={{ color: '#7FCB98' }}>{slotPickConfirm.label}</span>?</>
              ) : (
                <>Save <span style={{ color: '#8A9A90' }}>{slotPickConfirm.participantName}'s</span> pick as <span style={{ color: '#7FCB98' }}>{slotPickConfirm.label}</span>?</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={confirmSlotPick} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#8A9A90', color: '#0F1614' }}>
                Confirm
              </button>
              <button onClick={() => setSlotPickConfirm(null)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>
                Cancel
              </button>
            </div>
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
              <button onClick={submitAdminPrompt} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#8A9A90', color: '#0F1614' }}>
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
        accent="#8A9A90"
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
