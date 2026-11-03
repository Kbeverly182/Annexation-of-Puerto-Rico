import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Check, X, Copy, Mail, Trash2, Lock, ChevronDown, ChevronUp, RefreshCw, Pencil, KeyRound } from 'lucide-react';
import { useAdminMode } from '../lib/admin';
import { apiGetPool, apiGetPoolIfChanged, apiSavePool, mergePoolData } from '../lib/api';
import { uid, hashPin } from '../lib/utils';
import { TEAMS, TEAM_MAP } from '../lib/teams';
import { TEAM_IDS } from '../lib/rosters';
import PoolRules from '../components/PoolRules';
import PoolChat from '../components/PoolChat';

const POOL_KEY = 'poultry-bowl-v1';
const IDENTITY_KEY = 'poultry-bowl-identity';
const POLL_MS = 30000;
const FEE = 20;
const JACKPOT_PCT = 10;
const LINEUP_AWARDS = [15, 10, 5];
const ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };
const fixAbbr = (a) => ABBR_FIX[a] || a;

// Autumn palette
const C = {
  bg: '#1A0F08', panel: '#2A1A0E', panel2: '#35210F', line: '#5A3A1F',
  gold: '#E8A23D', orange: '#E26A1D', cream: '#F5E9D3', muted: '#B79B7A', green: '#7FCB98', red: '#E5604F',
};

const LEADERS = [
  { key: 'qb', label: 'QB — most passing yards', pos: 'QB' },
  { key: 'rb', label: 'RB — most rushing yards', pos: 'RB' },
  { key: 'wr', label: 'WR — most receiving yards', pos: 'WR' },
  { key: 'te', label: 'TE — most receptions', pos: 'TE' },
];

const LINEUP_SLOTS = [
  { key: 'QB', label: 'QB', pos: 'QB' },
  { key: 'RB1', label: 'RB', pos: 'RB' },
  { key: 'RB2', label: 'RB', pos: 'RB' },
  { key: 'WR1', label: 'WR', pos: 'WR' },
  { key: 'WR2', label: 'WR', pos: 'WR' },
  { key: 'TE', label: 'TE', pos: 'TE' },
  { key: 'K', label: 'K', pos: 'K' },
  { key: 'DST', label: 'D/ST', pos: 'DST' },
];

const RULES = [
  { heading: 'The Big Four — 20 pts each', body: ['Pick the player who will lead ALL 5 games in each category: QB passing yards, RB rushing yards, WR receiving yards, and TE receptions.', '20 points for each one you get right (80 possible).'] },
  { heading: 'Per game — 5 pts each', body: ['Longest field goal of the game: over or under the posted line (48.5 by default).', 'Total points of the game: over or under the posted line (45.5 by default).', 'Pick against the spread for each game.', 'Lines use a half point so there are no pushes. (If a spread is ever posted on a whole number and lands exactly, everybody gets the 5 points.)'] },
  { heading: 'Winners + confidence', body: ['Pick the winner of each game straight up and rank your confidence 1–5 (use each number once; 5 = most confident).', 'A correct pick earns 5 points × its confidence number. Max 75.'] },
  { heading: 'Exact longest field goal', body: ['Guess the longest made field goal in each game. Exact = 5 points, then minus 1 point for every yard you are off (never below 0).', 'Examples: guess 47, longest 47 = 5 · longest 44 = 2 · longest 50 = 2 · longest 53 = 0. If a game has no field goals the longest counts as 0.'] },
  { heading: 'TD scorer — 12 pts each', body: ['Pick one player in each game to score a touchdown. If he scores at least one TD in that game, you get 12 points.', 'The scorer is the player who runs it in, catches it, or returns it. A passing touchdown does NOT count for the quarterback who threw it — only the player who caught it. (A QB who runs one in himself does count.)'] },
  { heading: 'Fantasy lineup — 15 / 10 / 5', body: ['Build a lineup from players in the 5 games: 1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 D/ST. Every slot must be filled or you are not eligible.', 'Scored with the same full-PPR scoring as Where\'s the Beef (including the D/ST rules).', 'Highest lineup total earns 15 pts, 2nd earns 10, 3rd earns 5. Ties split the points for the spots they cover.'] },
  { heading: 'Tiebreakers', body: ['1) Closest to how many points the Cowboys score.', '2) Closest to the total number of field goals made across all 5 games.'] },
  { heading: 'Big Beefy Bonus — no points, 10% of the pot', body: ['Pick who will score the longest touchdown of the 5 games (defensive TDs and punt/kickoff return TDs do not count). If you are right, you automatically win the Big Beefy Bonus: 10% of the total pot.', 'If more than one person is right, the tiebreakers above decide. If nobody is right, that 10% goes back into the main prize pool.'] },
  { heading: 'Locking', body: 'Everything locks at the kickoff of the first game. After that, every entry\'s picks are revealed to everyone.' },
  { heading: 'Payouts', body: 'Entry is 20 units. Payout structure is posted on this page once entries close.' },
];

// ---------------------------------------------------------------- helpers
const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
const normName = (s) => (s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(SUFFIX, '').replace(/\s+/g, ' ').trim();
const sameName = (a, b) => !!a && !!b && normName(a) === normName(b);

const defaultConfig = () => ({ games: [], fgLine: 48.5, totalLine: 45.5, lockAt: null, tbTeam: 'DAL', payoutNote: '', spreadsLive: false, playersOpen: false });
const emptyData = () => ({
  name: 'The Poultry Bowl', open: false, participants: [], config: defaultConfig(),
  picks: { bowl: {} }, results: { bowl: {} }, chatMessages: [],
});
const withDefaults = (d) => ({
  ...emptyData(), ...d,
  config: { ...defaultConfig(), ...(d?.config || {}) },
  picks: { bowl: {}, ...(d?.picks || {}) },
  results: { bowl: {}, ...(d?.results || {}) },
});

const definedOnly = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// Auto results (from the server sync) with any admin overrides layered on top.
function effectiveResults(res) {
  const auto = res?.auto || {};
  const man = res?.manual || {};
  const ids = new Set([...Object.keys(auto.games || {}), ...Object.keys(man.games || {})]);
  const games = {};
  ids.forEach(id => { games[id] = { ...(auto.games?.[id] || {}), ...definedOnly(man.games?.[id]) }; });
  const leaders = {};
  ['qb', 'rb', 'wr', 'te'].forEach(k => { leaders[k] = man.leaders?.[k]?.name ? man.leaders[k] : auto.leaders?.[k]; });
  return {
    games,
    leaders,
    longestTd: man.longestTd?.name ? man.longestTd : auto.longestTd || null,
    lineupScores: auto.lineupScores || {},
    allFinal: man.allFinal != null ? !!man.allFinal : !!auto.allFinal,
    updatedAt: auto.updatedAt || null,
  };
}

const gameFinal = (rg) => !!rg?.final && rg.homeScore != null && rg.awayScore != null;

function scoreEntrant(pk, cfg, R) {
  const parts = { leaders: 0, win: 0, ats: 0, tot: 0, fgOU: 0, fgExact: 0, td: 0 };
  const detail = { leaders: {}, games: {} };
  let lineupPts = 0;
  let lineupComplete = false;
  if (!pk) return { parts, detail, lineupPts, lineupComplete, base: 0 };

  if (R.allFinal) {
    LEADERS.forEach(({ key }) => {
      const pick = pk.leaders?.[key];
      const lead = R.leaders?.[key];
      const ok = !!(pick && lead && ((pick.id && lead.id && String(pick.id) === String(lead.id)) || sameName(pick.name, lead.name)));
      detail.leaders[key] = ok;
      if (ok) parts.leaders += 20;
    });
  }

  cfg.games.forEach(g => {
    const rg = R.games[g.id];
    if (!gameFinal(rg)) return;
    const gp = pk.games?.[g.id] || {};
    const d = {};
    const winner = rg.homeScore > rg.awayScore ? g.home : rg.awayScore > rg.homeScore ? g.away : null;
    if (winner && gp.win === winner) { d.win = true; parts.win += 5 * (Number(gp.conf) || 0); }

    const margin = rg.homeScore - rg.awayScore + Number(g.spread || 0);
    const cover = margin > 0 ? g.home : margin < 0 ? g.away : 'push';
    if (gp.ats && (cover === 'push' || gp.ats === cover)) { d.ats = true; parts.ats += 5; }

    const total = rg.homeScore + rg.awayScore;
    const totOU = total > cfg.totalLine ? 'over' : total < cfg.totalLine ? 'under' : 'push';
    if (gp.tot && (totOU === 'push' || gp.tot === totOU)) { d.tot = true; parts.tot += 5; }

    const lf = Number(rg.longestFG) || 0;
    const fgOU = lf > cfg.fgLine ? 'over' : lf < cfg.fgLine ? 'under' : 'push';
    if (gp.fg && (fgOU === 'push' || gp.fg === fgOU)) { d.fg = true; parts.fgOU += 5; }

    if (gp.fgExact !== undefined && gp.fgExact !== null && gp.fgExact !== '') {
      const pts = Math.max(0, 5 - Math.abs(Number(gp.fgExact) - lf));
      d.fgPts = pts;
      parts.fgExact += pts;
    }

    if (gp.td && (rg.tds || []).some(t => sameName(t.name, gp.td.name))) { d.td = true; parts.td += 12; }
    detail.games[g.id] = d;
  });

  lineupComplete = LINEUP_SLOTS.every(s => pk.lineup?.[s.key]?.id);
  if (lineupComplete) {
    lineupPts = LINEUP_SLOTS.reduce((sum, s) => sum + (Number(R.lineupScores[pk.lineup[s.key].id]) || 0), 0);
    lineupPts = Math.round(lineupPts * 10) / 10;
  }
  const base = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, detail, lineupPts, lineupComplete, base };
}

function buildStandings(cfg, participants, picksBowl, R) {
  const rows = participants.map(p => {
    const pk = picksBowl[p.id];
    const s = scoreEntrant(pk, cfg, R);
    return { p, pk, ...s, lineupBonus: 0 };
  });

  if (R.allFinal) {
    const eligible = rows.filter(r => r.lineupComplete).sort((a, b) => b.lineupPts - a.lineupPts);
    let idx = 0;
    while (idx < LINEUP_AWARDS.length && idx < eligible.length) {
      let end = idx;
      while (end + 1 < eligible.length && eligible[end + 1].lineupPts === eligible[idx].lineupPts) end++;
      const group = eligible.slice(idx, end + 1);
      const pool = LINEUP_AWARDS.slice(idx, idx + group.length).reduce((a, b) => a + b, 0);
      group.forEach(r => { r.lineupBonus = pool / group.length; });
      idx = end + 1;
    }
  }

  // Tiebreaker actuals
  const tbGame = cfg.games.find(g => g.home === cfg.tbTeam || g.away === cfg.tbTeam);
  const tbRg = tbGame ? R.games[tbGame.id] : null;
  const tb1Actual = tbRg && gameFinal(tbRg) ? (tbGame.home === cfg.tbTeam ? tbRg.homeScore : tbRg.awayScore) : null;
  const tb2Actual = R.allFinal ? cfg.games.reduce((s, g) => s + (Number(R.games[g.id]?.fgMade) || 0), 0) : null;

  rows.forEach(r => {
    r.total = r.base + r.lineupBonus;
    const t1 = r.pk?.tb1; const t2 = r.pk?.tb2;
    r.tb1Diff = tb1Actual != null && t1 !== undefined && t1 !== '' ? Math.abs(Number(t1) - tb1Actual) : Infinity;
    r.tb2Diff = tb2Actual != null && t2 !== undefined && t2 !== '' ? Math.abs(Number(t2) - tb2Actual) : Infinity;
  });
  rows.sort((a, b) => b.total - a.total || a.tb1Diff - b.tb1Diff || a.tb2Diff - b.tb2Diff || (a.p.name || '').localeCompare(b.p.name || ''));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.total === r.total && prev.tb1Diff === r.tb1Diff && prev.tb2Diff === r.tb2Diff ? prev.rank : i + 1;
  });

  let jackpotWinner = null;
  if (R.allFinal && R.longestTd?.name) {
    const hits = rows.filter(r => r.pk?.jackpot && sameName(r.pk.jackpot.name, R.longestTd.name));
    hits.sort((a, b) => a.tb1Diff - b.tb1Diff || a.tb2Diff - b.tb2Diff);
    jackpotWinner = hits[0] || null;
  }
  return { rows, jackpotWinner, tb1Actual, tb2Actual };
}

function pickProgress(pk, cfg) {
  let done = 0; let total = 0;
  const missing = [];
  const chk = (ok, label) => { total++; if (ok) done++; else missing.push(label); };
  LEADERS.forEach(l => chk(!!pk?.leaders?.[l.key]?.name, l.label));
  cfg.games.forEach(g => {
    const gp = pk?.games?.[g.id] || {};
    const tag = `${g.away} @ ${g.home}`;
    chk(!!gp.win, `${tag}: winner`);
    chk(!!gp.conf, `${tag}: confidence`);
    chk(!!gp.ats, `${tag}: spread`);
    chk(!!gp.tot, `${tag}: total`);
    chk(!!gp.fg, `${tag}: FG over/under`);
    chk(gp.fgExact !== undefined && gp.fgExact !== '', `${tag}: exact FG`);
    chk(!!gp.td?.name, `${tag}: TD scorer`);
  });
  LINEUP_SLOTS.forEach(s => chk(!!pk?.lineup?.[s.key]?.id, `Lineup ${s.label}`));
  chk(pk?.tb1 !== undefined && pk?.tb1 !== '', 'Tiebreaker 1 (Cowboys points)');
  chk(pk?.tb2 !== undefined && pk?.tb2 !== '', 'Tiebreaker 2 (total FGs)');
  chk(!!pk?.jackpot?.name, 'Big Beefy Bonus pick');
  return { done, total, missing };
}

const fmtSpread = (g, live = true) => {
  const s = Number(g.spread);
  if (!live || g.spread === undefined || g.spread === null || g.spread === '' || Number.isNaN(s)) return 'TBD';
  if (s === 0) return `${g.home} PK`;
  return s < 0 ? `${g.home} ${s}` : `${g.away} -${s}`;
};
const fmtKick = (iso) => {
  if (!iso) return 'TBD';
  try {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });
  } catch (e) { return iso; }
};

// ---------------------------------------------------------------- rosters (just the teams in the games)
const POS_OK = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'PK']);
function useGamePlayers(abbrs) {
  const key = abbrs.join(',');
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!abbrs.length) { setPlayers([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const out = [];
      await Promise.all(abbrs.map(async (abbr) => {
        const id = TEAM_IDS[abbr];
        if (!id) return;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`);
            if (!r.ok) throw new Error('bad');
            const json = await r.json();
            (json.athletes || []).forEach(group => (group.items || []).forEach(a => {
              const raw = a.position?.abbreviation;
              if (!POS_OK.has(raw)) return;
              out.push({ id: String(a.id), name: a.fullName || a.displayName, position: raw === 'PK' ? 'K' : raw, team: abbr });
            }));
            return;
          } catch (e) { await new Promise(res => setTimeout(res, 600 * (attempt + 1))); }
        }
      }));
      if (!cancelled) { setPlayers(out); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [key]);
  return { players, loading };
}

const inputStyle = { background: C.bg, border: `1px solid ${C.line}`, color: C.cream, borderRadius: 4, padding: '6px 8px', fontSize: 13, width: '100%' };
const smallBtn = (bg, fg = C.bg) => ({ background: bg, color: fg, borderRadius: 4, padding: '6px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' });

function PlayerSelect({ value, onChange, options, placeholder, disabled, exclude = [] }) {
  const byTeam = {};
  options.forEach(o => { (byTeam[o.team] = byTeam[o.team] || []).push(o); });
  return (
    <select
      value={value?.id || ''}
      disabled={disabled}
      onChange={e => {
        const o = options.find(x => x.id === e.target.value);
        onChange(o ? { id: o.id, name: o.name, team: o.team, position: o.position } : null);
      }}
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
    >
      <option value="">{placeholder || 'Choose…'}</option>
      {value?.id && !options.some(o => o.id === value.id) && <option value={value.id}>{value.name}</option>}
      {Object.keys(byTeam).sort().map(team => (
        <optgroup key={team} label={TEAM_MAP[team] || team}>
          {byTeam[team].sort((a, b) => a.name.localeCompare(b.name)).map(o => (
            <option key={o.id} value={o.id} disabled={exclude.includes(o.id) && o.id !== value?.id}>{o.name} ({o.position})</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="flex gap-1">
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="font-mono flex-1"
            style={{ padding: '6px 4px', fontSize: 12, borderRadius: 4, background: on ? C.gold : C.bg, color: on ? C.bg : C.cream, border: `1px solid ${on ? C.gold : C.line}`, opacity: disabled ? 0.6 : 1 }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}


// A turkey leg (drumstick) used as the section selector.
function Drumstick({ active, done }) {
  return (
    <svg width="54" height="54" viewBox="0 0 64 64" style={{ filter: active ? 'drop-shadow(0 0 6px #FFB300)' : 'none', transition: 'transform 0.15s', transform: active ? 'scale(1.12)' : 'none' }}>
      <g transform="rotate(-38 32 32)">
        <rect x="29" y="40" width="6" height="17" rx="2" fill="#F5E9D3" stroke="#8A6A45" strokeWidth="1.5" />
        <circle cx="27.5" cy="58" r="4.2" fill="#F5E9D3" stroke="#8A6A45" strokeWidth="1.5" />
        <circle cx="36.5" cy="58" r="4.2" fill="#F5E9D3" stroke="#8A6A45" strokeWidth="1.5" />
        <path d="M32 4 C48 4 56 17 52 30 C49 40 41 43 37 49 L27 49 C23 43 15 40 12 30 C8 17 16 4 32 4 Z" fill={done ? '#3D9B5C' : '#C26B1D'} stroke="#6B3410" strokeWidth="2" />
        <path d="M22 12 C26 8 34 8 38 11" stroke="#FFD9A0" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.8" />
        <ellipse cx="25" cy="24" rx="4" ry="6" fill="#FFB866" opacity="0.35" />
      </g>
    </svg>
  );
}


// The Big Beefy Bonus icon: a thick slab of beef with a fork stuck in it.
function JackpotIcon({ active }) {
  return (
    <svg width="58" height="54" viewBox="0 0 68 64" style={{ filter: active ? 'drop-shadow(0 0 7px #FF8A5C)' : 'drop-shadow(0 0 3px rgba(255,120,80,0.45))', transition: 'transform 0.15s', transform: active ? 'scale(1.12)' : 'none' }}>
      {/* slab: side/thickness first, then the top face */}
      <path d="M6 40 C6 52 14 58 34 58 C54 58 62 52 62 40 L62 34 L6 34 Z" fill="#7A1F1A" stroke="#4A0F0C" strokeWidth="2" />
      <path d="M8 30 C6 20 16 12 34 12 C52 12 62 20 60 30 C62 38 52 44 34 44 C16 44 6 38 8 30 Z" fill="#C4362B" stroke="#4A0F0C" strokeWidth="2" />
      {/* fat cap along the top edge */}
      <path d="M12 21 C18 15 28 14 34 14 C42 14 52 16 56 22" stroke="#F7E6D0" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* marbling */}
      <g stroke="#F4B9A8" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9">
        <path d="M16 30 C20 27 24 31 28 28" />
        <path d="M34 35 C39 32 43 36 49 32" />
        <path d="M20 38 C24 36 27 39 32 37" />
        <path d="M40 25 C44 23 47 26 52 24" />
      </g>
      {/* the fork, handle up, tines buried in the steak */}
      <g stroke="#3B3B3B" strokeWidth="1.1" strokeLinejoin="round" fill="#EDEDF3">
        <rect x="32" y="1" width="4.4" height="21" rx="2.2" />
        <path d="M27 21 L41.5 21 C41.5 25 39.5 27 36.5 27.5 L32 27.5 C29 27 27 25 27 21 Z" />
        <rect x="27.6" y="27" width="2.6" height="13" rx="1.3" />
        <rect x="32.9" y="27" width="2.6" height="14" rx="1.3" />
        <rect x="38.2" y="27" width="2.6" height="13" rx="1.3" />
      </g>
    </svg>
  );
}

// A numeric pick that only commits when you press Enter or tap away (so the "change your
// pick?" confirmation doesn't fire on every keystroke).
function NumberPick({ value, onCommit, disabled, placeholder, tick }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value, tick]);
  const commit = () => {
    const v = draft === '' ? '' : Number(draft);
    if (String(v) === String(value ?? '')) return;
    onCommit(v);
  };
  return (
    <input
      type="number" inputMode="numeric" disabled={disabled} placeholder={placeholder}
      value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
    />
  );
}

const has = (v) => v !== undefined && v !== null && v !== '';
function legCounts(pk, games) {
  const n = games.length;
  const g = (fn) => games.filter(x => fn(pk?.games?.[x.id] || {})).length;
  return [
    { key: 'big4', label: 'The Big Four', done: LEADERS.filter(l => pk?.leaders?.[l.key]?.name).length, total: 4 },
    { key: 'win', label: 'Winners', done: g(p => p.win && p.conf), total: n },
    { key: 'ats', label: 'Spread', done: g(p => p.ats), total: n },
    { key: 'tot', label: 'Total Pts', done: g(p => p.tot), total: n },
    { key: 'fg', label: 'FG Over/Under', done: g(p => p.fg), total: n },
    { key: 'exact', label: 'Exact FG', done: g(p => has(p.fgExact)), total: n },
    { key: 'td', label: 'TD Scorer', done: g(p => p.td?.name), total: n },
    { key: 'lineup', label: 'Fantasy Lineup', done: LINEUP_SLOTS.filter(s => pk?.lineup?.[s.key]?.id).length, total: LINEUP_SLOTS.length },
    { key: 'tb', label: 'Tiebreakers', done: (has(pk?.tb1) ? 1 : 0) + (has(pk?.tb2) ? 1 : 0), total: 2 },
    { key: 'jackpot', label: 'Big Beefy Bonus', done: pk?.jackpot?.name ? 1 : 0, total: 1 },
  ];
}

// ---------------------------------------------------------------- page
export default function PoultryBowl() {
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [myId, setMyId] = useState(null);
  const [myIdLoaded, setMyIdLoaded] = useState(false);
  const [actAsId, setActAsId] = useState(null); // admin editing someone else's picks
  const [claim, setClaim] = useState(null);
  const [showJoin, setShowJoin] = useState(false);
  const [joinForm, setJoinForm] = useState({ name: '', realName: '', email: '' });
  const [joinError, setJoinError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [expandedId, setExpandedId] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [emailModal, setEmailModal] = useState(null);
  const [copied, setCopied] = useState(false);
  const [espnRange, setEspnRange] = useState({ start: '20261125', end: '20261127' });
  const [espnMsg, setEspnMsg] = useState('');
  const [manualDraft, setManualDraft] = useState(null);
  const [activeLeg, setActiveLeg] = useState('big4');
  const [pendingChange, setPendingChange] = useState(null); // { apply, oldLabel, newLabel, who }
  const [cancelTick, setCancelTick] = useState(0);
  const saveTimer = useRef(null);
  const skipNextPoll = useRef(false);
  const savedTimer = useRef(null);

  // ---- load + poll (hooks stay above the early returns)
  useEffect(() => {
    (async () => {
      try {
        const remote = await apiGetPool(POOL_KEY);
        setData(withDefaults(remote || {}));
      } catch (e) {
        setLoadError(true); // never fall back to an empty pool on a failed read
      } finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!loadError || data) return;
    const t = setTimeout(async () => {
      try {
        const remote = await apiGetPool(POOL_KEY);
        setData(withDefaults(remote || {}));
        setLoadError(false);
      } catch (e) { setLoadError(x => x); setNow(Date.now()); }
    }, 8000);
    return () => clearTimeout(t);
  }, [loadError, !!data, now]);

  useEffect(() => {
    try { const s = localStorage.getItem(IDENTITY_KEY); if (s) setMyId(s); } catch (e) { /* ignore */ }
    finally { setMyIdLoaded(true); }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (skipNextPoll.current) { skipNextPoll.current = false; return; }
      if (saveTimer.current) return; // a local save is in flight
      try {
        const remote = await apiGetPoolIfChanged(POOL_KEY);
        if (remote !== undefined && !saveTimer.current) setData(withDefaults(remote || {}));
      } catch (e) { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const cfg = data?.config || defaultConfig();
  const games = useMemo(() => [...(cfg.games || [])].sort((a, b) => Date.parse(a.kickoff || 0) - Date.parse(b.kickoff || 0)), [data?.config?.games]);
  const gameTeams = useMemo(() => [...new Set(games.flatMap(g => [g.home, g.away]))].filter(Boolean), [games]);
  const { players: roster, loading: rosterLoading } = useGamePlayers(gameTeams);

  if (loading || !data) {
    return (
      <div style={{ background: C.bg }} className="min-h-screen flex items-center justify-center">
        {loadError ? (
          <div className="text-center px-6 max-w-sm">
            <div className="font-head text-lg uppercase" style={{ color: C.gold }}>Can't reach the pool right now</div>
            <div className="font-mono text-xs mt-2" style={{ color: C.muted }}>The database isn't responding. Nothing has been lost or changed — please don't re-enter anything. This page keeps retrying automatically.</div>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 rounded font-head text-sm uppercase" style={{ background: C.gold, color: C.bg }}>Retry now</button>
          </div>
        ) : <Loader2 className="animate-spin" size={28} color={C.gold} />}
      </div>
    );
  }

  // ---- persistence
  const stripAuto = (d) => {
    if (!d.results?.bowl || d.results.bowl.auto === undefined) return d;
    const { auto, ...rest } = d.results.bowl;
    return { ...d, results: { ...d.results, bowl: rest } };
  };
  const persist = (next, removedIds = [], removedMessageIds = []) => {
    setData(next);
    skipNextPoll.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const remote = await apiGetPool(POOL_KEY).catch(() => null);
        let merged = withDefaults(mergePoolData(stripAuto(next), remote));
        if (removedIds.length) {
          merged = { ...merged, participants: merged.participants.filter(p => !removedIds.includes(p.id)) };
          const bowl = { ...(merged.picks.bowl || {}) };
          removedIds.forEach(id => delete bowl[id]);
          merged.picks = { ...merged.picks, bowl };
        }
        if (removedMessageIds.length) merged = { ...merged, chatMessages: (merged.chatMessages || []).filter(m => !removedMessageIds.includes(m.id)) };
        await apiSavePool(POOL_KEY, merged);
        setData(merged);
        setSaveError(false);
        setJustSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), 1500);
      } catch (e) { setSaveError(true); }
      finally { saveTimer.current = null; }
    }, 250);
  };

  // ---- derived state
  const R = effectiveResults(data.results?.bowl);
  const kickoffs = games.map(g => Date.parse(g.kickoff)).filter(n => !Number.isNaN(n));
  const lockAt = cfg.lockAt ? Date.parse(cfg.lockAt) : (kickoffs.length ? Math.min(...kickoffs) : null);
  const locked = lockAt != null && now >= lockAt;
  const picksBowl = data.picks?.bowl || {};
  const myIdValid = !!(myId && data.participants.some(p => p.id === myId));
  const actingId = isAdmin && actAsId && data.participants.some(p => p.id === actAsId) ? actAsId : (myIdValid ? myId : null);
  const actingPerson = data.participants.find(p => p.id === actingId);
  const canEdit = !!actingId && (!locked || isAdmin);
  const myPicks = (actingId && picksBowl[actingId]) || {};
  const progress = pickProgress(myPicks, { ...cfg, games });
  const standings = buildStandings({ ...cfg, games }, data.participants, picksBowl, R);
  const paidCount = data.participants.filter(p => p.paid).length;
  const pot = paidCount * FEE;
  const jackpotAmt = pot * JACKPOT_PCT / 100;
  const joinClosed = locked && !isAdmin;

  // ---- actions
  const setMyPicks = (fn) => {
    if (!canEdit) return;
    const cur = picksBowl[actingId] || {};
    const nextP = { ...fn(cur), updatedAt: Date.now() };
    persist({ ...data, picks: { ...data.picks, bowl: { ...picksBowl, [actingId]: nextP } } });
  };
  const setTop = (patch) => setMyPicks(cur => ({ ...cur, ...patch }));
  const setLeader = (key, val) => setMyPicks(cur => ({ ...cur, leaders: { ...(cur.leaders || {}), [key]: val } }));
  const setGame = (gid, patch) => setMyPicks(cur => ({ ...cur, games: { ...(cur.games || {}), [gid]: { ...(cur.games?.[gid] || {}), ...patch } } }));
  const setConf = (gid, v) => setMyPicks(cur => {
    const gm = { ...(cur.games || {}) };
    const old = gm[gid]?.conf;
    if (v) {
      const other = Object.keys(gm).find(k => k !== gid && Number(gm[k]?.conf) === v);
      if (other) gm[other] = { ...gm[other], conf: old || undefined }; // swap
    }
    gm[gid] = { ...(gm[gid] || {}), conf: v || undefined };
    return { ...cur, games: gm };
  });
  const setSlot = (key, val) => setMyPicks(cur => ({ ...cur, lineup: { ...(cur.lineup || {}), [key]: val } }));

  // Same rule as the other pools: a first-time pick saves straight away, but replacing a pick
  // that's already been made asks "Change X to Y?" first.
  const lbl = (v) => (v && typeof v === 'object' ? v.name : v);
  const guard = (oldVal, newVal, apply) => {
    if (!canEdit) return;
    const o = lbl(oldVal); const nw = lbl(newVal);
    if (!has(o)) { apply(); return; }
    if (String(o) === String(nw ?? '')) return;
    setPendingChange({ apply, oldLabel: String(o), newLabel: has(nw) ? String(nw) : '(nothing)', who: actingPerson?.name });
  };
  const confirmPending = () => { if (pendingChange) { pendingChange.apply(); setPendingChange(null); } };
  const cancelPending = () => { setPendingChange(null); setCancelTick(t => t + 1); };

  const chooseMe = (id) => { setMyId(id); try { localStorage.setItem(IDENTITY_KEY, id); } catch (e) { /* ignore */ } };
  const forgetMe = () => { setMyId(null); setActAsId(null); try { localStorage.removeItem(IDENTITY_KEY); } catch (e) { /* ignore */ } };
  const addParticipant = () => {
    if (joinClosed) return;
    const name = joinForm.name.trim(); const realName = joinForm.realName.trim(); const email = joinForm.email.trim();
    if (!name || !realName || !email) { setJoinError('Fill in all three boxes.'); return; }
    const norm = s => (s || '').trim().toLowerCase();
    if (data.participants.some(p => norm(p.realName) === norm(realName))) { setJoinError('One entry per person — that name is already registered.'); return; }
    if (data.participants.some(p => norm(p.name) === norm(name))) { setJoinError('That display name is taken — pick another.'); return; }
    const newP = { id: uid(), name, realName, email, pin: null, paid: false };
    persist({ ...data, participants: [...data.participants, newP] });
    setJoinForm({ name: '', realName: '', email: '' }); setJoinError(''); setShowJoin(false);
    setClaim({ participantId: newP.id, mode: 'set', input: '', error: '' });
  };
  const submitClaim = () => {
    if (!claim) return;
    if (!/^\d{4}$/.test(claim.input)) { setClaim(c => ({ ...c, error: 'PIN must be 4 digits', input: '' })); return; }
    const person = data.participants.find(p => p.id === claim.participantId);
    if (!person) { setClaim(null); return; }
    const hashed = hashPin(claim.input);
    if (claim.mode === 'set') {
      persist({ ...data, participants: data.participants.map(p => p.id === person.id ? { ...p, pin: hashed } : p) });
      chooseMe(person.id); setClaim(null);
    } else if (hashed === person.pin) { chooseMe(person.id); setClaim(null); }
    else setClaim(c => ({ ...c, error: 'Wrong PIN', input: '' }));
  };
  const togglePaid = (id) => persist({ ...data, participants: data.participants.map(p => p.id === id ? { ...p, paid: !p.paid } : p) });
  const resetPin = (id) => persist({ ...data, participants: data.participants.map(p => p.id === id ? { ...p, pin: null } : p) });
  const removeParticipant = (id) => { if (window.confirm('Remove this entrant and their picks?')) persist({ ...data, participants: data.participants.filter(p => p.id !== id) }, [id]); };
  const postMessage = (text) => persist({ ...data, chatMessages: [...(data.chatMessages || []), { id: uid(), authorId: myId, authorName: data.participants.find(p => p.id === myId)?.name || 'Admin', text, at: new Date().toISOString() }] });
  const deleteMessage = (id) => persist({ ...data, chatMessages: (data.chatMessages || []).filter(m => m.id !== id) }, [], [id]);

  const setConfig = (patch) => persist({ ...data, config: { ...cfg, ...patch } });
  const updateGame = (gid, patch) => setConfig({ games: cfg.games.map(g => g.id === gid ? { ...g, ...patch } : g) });
  const removeGame = (gid) => setConfig({ games: cfg.games.filter(g => g.id !== gid) });
  const addBlankGame = () => setConfig({ games: [...cfg.games, { id: 'g' + uid(), away: 'DAL', home: 'DET', kickoff: '', spread: '', espnId: '' }] });

  const loadFromEspn = async (refreshSpreads = false) => {
    setEspnMsg('Loading from ESPN…');
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=${espnRange.start}-${espnRange.end}`);
      if (!r.ok) throw new Error('ESPN returned ' + r.status);
      const json = await r.json();
      const found = (json.events || []).map(ev => {
        const comp = ev.competitions?.[0];
        const home = fixAbbr(comp?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation);
        const away = fixAbbr(comp?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation);
        let spread;
        const details = comp?.odds?.[0]?.details || '';
        const m = details.match(/^([A-Z]{2,4})\s*([+-]?\d+(?:\.\d+)?)/);
        if (m) { const amt = Math.abs(Number(m[2])); spread = fixAbbr(m[1]) === home ? -amt : amt; }
        else if (/^EVEN|PK/i.test(details)) spread = 0;
        return { id: 'g' + ev.id, espnId: String(ev.id), kickoff: ev.date, home, away, spread };
      }).filter(g => g.home && g.away);
      if (!found.length) { setEspnMsg('ESPN has no games in that date range yet.'); return; }
      const byEspn = Object.fromEntries(cfg.games.filter(g => g.espnId).map(g => [g.espnId, g]));
      const merged = [...cfg.games];
      let added = 0;
      found.forEach(f => {
        const ex = byEspn[f.espnId];
        if (ex) {
          const i = merged.findIndex(g => g.id === ex.id);
          merged[i] = { ...ex, kickoff: f.kickoff || ex.kickoff, spread: f.spread !== undefined && (refreshSpreads || ex.spread === undefined || ex.spread === '' || ex.spread === null) ? f.spread : ex.spread };
        } else { merged.push({ ...f, spread: f.spread ?? '' }); added++; }
      });
      setConfig({ games: merged });
      setEspnMsg(refreshSpreads ? `Refreshed spreads from ESPN for ${found.filter(g => g.spread !== undefined).length} of ${found.length} game(s). Games ESPN has no line for were left alone — check each one below.` : `Found ${found.length} game${found.length === 1 ? '' : 's'} (${added} new). Check the spreads below — ESPN sometimes has none yet.`);
    } catch (e) { setEspnMsg('Could not load from ESPN: ' + (e.message || e)); }
  };

  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const buildEmails = (filter) => {
    let list = data.participants;
    let label = 'All entrants';
    if (filter === 'unpaid') { list = list.filter(p => !p.paid); label = 'Not marked paid'; }
    if (filter === 'unfinished') { list = list.filter(p => pickProgress(picksBowl[p.id], { ...cfg, games }).done < pickProgress(picksBowl[p.id], { ...cfg, games }).total); label = 'Picks not finished'; }
    const seen = new Set(); const emails = [];
    list.forEach(p => { const e = (p.email || '').trim(); if (e && !seen.has(e.toLowerCase())) { seen.add(e.toLowerCase()); emails.push(e); } });
    setEmailModal({ label, emails });
  };

  const startManual = () => {
    const man = data.results?.bowl?.manual || {};
    setManualDraft({
      games: Object.fromEntries(games.map(g => {
        const m = man.games?.[g.id] || {};
        return [g.id, { homeScore: m.homeScore ?? '', awayScore: m.awayScore ?? '', longestFG: m.longestFG ?? '', fgMade: m.fgMade ?? '', final: m.final ?? '', tdText: (m.tds || []).map(t => `${t.name} ${t.yards || ''}`.trim()).join(', ') }];
      })),
      leaders: { qb: man.leaders?.qb?.name || '', rb: man.leaders?.rb?.name || '', wr: man.leaders?.wr?.name || '', te: man.leaders?.te?.name || '' },
      ltName: man.longestTd?.name || '', ltYards: man.longestTd?.yards ?? '',
      allFinal: man.allFinal ?? '',
    });
  };
  const saveManual = () => {
    const d = manualDraft;
    const num = (v) => (v === '' || v === undefined ? undefined : Number(v));
    const manGames = {};
    games.forEach(g => {
      const x = d.games[g.id];
      const tds = x.tdText.trim() ? x.tdText.split(',').map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^(.*?)\s*(\d+)?$/); return { name: (m?.[1] || s).trim(), yards: m?.[2] ? Number(m[2]) : 0, def: false }; }) : undefined;
      manGames[g.id] = definedOnly({ homeScore: num(x.homeScore), awayScore: num(x.awayScore), longestFG: num(x.longestFG), fgMade: num(x.fgMade), final: x.final === '' ? undefined : !!x.final, tds });
    });
    const leaders = {};
    Object.keys(d.leaders).forEach(k => { if (d.leaders[k].trim()) leaders[k] = { name: d.leaders[k].trim() }; });
    const manual = { games: manGames, leaders, ...(d.ltName.trim() ? { longestTd: { name: d.ltName.trim(), yards: Number(d.ltYards) || 0 } } : {}), ...(d.allFinal === '' ? {} : { allFinal: !!d.allFinal }) };
    persist({ ...data, results: { ...data.results, bowl: { ...(data.results.bowl || {}), manual } } });
    setManualDraft(null);
  };
  const clearManual = () => { if (window.confirm('Clear all manual overrides and use only ESPN data?')) { const { manual, ...rest } = data.results.bowl || {}; persist({ ...data, results: { ...data.results, bowl: { ...rest, manual: {} } } }); setManualDraft(null); } };

  // ---- gate: not open yet
  if (!data.open && !isAdmin) {
    return (
      <div style={{ background: C.bg, color: C.cream, minHeight: '100vh', fontFamily: "'Inter', sans-serif" }} className="flex flex-col items-center justify-center px-6 text-center">
        <img src="/poultry-bowl.jpg" alt="" style={{ maxWidth: 420, width: '100%', borderRadius: 10, border: `3px solid ${C.gold}` }} />
        <div className="mt-5" style={{ fontFamily: "'Anton', sans-serif", fontSize: 32, color: C.gold, letterSpacing: '0.04em' }}>THE POULTRY BOWL</div>
        <div className="font-mono text-sm mt-2" style={{ color: C.muted }}>🔒 Not open yet — Kenny is still cooking up the rules. Check back soon!</div>
        <Link to="/" className="font-mono text-xs underline mt-6" style={{ color: C.muted }}>← Back to all pools</Link>
        <div className="mt-6"><button onClick={openAdminPrompt} className="font-mono text-[10px] uppercase underline" style={{ color: C.line }}>Admin</button></div>
        {adminPrompt && <AdminPrompt adminPrompt={adminPrompt} setAdminPrompt={setAdminPrompt} submitAdminPrompt={submitAdminPrompt} />}
      </div>
    );
  }

  const showPicksOf = (pid) => locked || pid === actingId;
  const lockText = lockAt == null ? 'Games not set up yet' : locked ? 'Picks are LOCKED' : `Locks ${fmtKick(new Date(lockAt).toISOString())}`;
  const msLeft = lockAt != null ? lockAt - now : 0;
  const countdown = lockAt != null && !locked ? (() => {
    const m = Math.floor(msLeft / 60000); const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60);
    return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m % 60}m left` : `${m}m left`;
  })() : '';

  const gameHasStarted = (g) => { const k = Date.parse(g.kickoff); return !Number.isNaN(k) && now >= k; };

  return (
    <div style={{ background: C.bg, color: C.cream, minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        .pb-shimmer { background: linear-gradient(100deg,#FFD54A,#FFF6C2 25%,#FF8A00 45%,#FFE27A 65%,#FFB300); background-size:250% 100%; -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; animation: pbs 3s linear infinite; }
        @keyframes pbs { from { background-position: 250% 0 } to { background-position: -50% 0 } }
        select option, select optgroup { background: #1A0F08; color: #F5E9D3; }
      `}</style>

      {/* Hero */}
      <div className="relative" style={{ borderBottom: `3px solid ${C.gold}` }}>
        <img src="/poultry-bowl.jpg" alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', objectPosition: 'center 35%', display: 'block' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(26,15,8,0.35), rgba(26,15,8,0.92))' }} />
        <div className="absolute inset-x-0 bottom-0 px-5 pb-3">
          <Link to="/" className="font-mono text-[11px] underline" style={{ color: C.cream }}>← All pools</Link>
          <div className="font-display pb-shimmer uppercase" style={{ fontSize: 40, lineHeight: 1.05, letterSpacing: '0.04em' }}>{data.name || 'The Poultry Bowl'}</div>
          <div className="font-mono text-xs" style={{ color: C.cream }}>Thanksgiving week · {games.length || 5} games · Entry {FEE} units</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <PoolRules title="Poultry Bowl" entryFee={FEE} sections={RULES} accent={C.gold} />
            <span className="font-mono text-xs px-2 py-1 rounded flex items-center gap-1" style={{ background: locked ? '#5A1F18' : C.panel2, border: `1px solid ${locked ? C.red : C.line}`, color: locked ? '#FFB4A8' : C.cream }}>
              <Lock size={11} /> {lockText}{countdown ? ` · ${countdown}` : ''}
            </span>
            {!data.open && isAdmin && <span className="font-mono text-[10px] uppercase px-2 py-1 rounded" style={{ background: '#5A1F18', color: '#FFB4A8', border: `1px solid ${C.red}` }}>Hidden from public</span>}
          </div>
          {isAdmin ? (
            <button onClick={exitAdmin} className="font-mono text-[10px] uppercase px-2 py-1 rounded" style={{ background: '#C1443A22', border: '1px solid #C1443A', color: '#FFB4A8' }}>Exit Admin</button>
          ) : <button onClick={openAdminPrompt} className="font-mono text-[10px] uppercase underline" style={{ color: C.line }}>Admin</button>}
        </div>

        {isAdmin && (!cfg.spreadsLive || !cfg.playersOpen) && (
          <div className="rounded px-3 py-2 font-mono text-xs" style={{ background: '#3A2A0A', border: `1px solid ${C.gold}`, color: C.cream }}>
            ⏰ <b>Reminder before opening:</b> {!cfg.spreadsLive && 'spreads are TBD'}{!cfg.spreadsLive && !cfg.playersOpen && ' and '}{!cfg.playersOpen && 'player pools are closed (only you can see them)'}. Ask Claude to pull the latest spreads and players before Nov 25, then flip the switches in Admin tools.
          </div>
        )}

        {/* Pot */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Entries', `${data.participants.length}`], ['Pot (paid)', `${pot} units`], [`Beefy Bonus ${JACKPOT_PCT}%`, `${jackpotAmt} units`]].map(([k, v]) => (
            <div key={k} className="rounded py-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="font-mono text-[10px] uppercase" style={{ color: C.muted }}>{k}</div>
              <div className="font-head text-lg" style={{ color: C.gold }}>{v}</div>
            </div>
          ))}
        </div>
        {cfg.payoutNote && <div className="font-mono text-xs rounded px-3 py-2" style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.cream, whiteSpace: 'pre-wrap' }}>💰 {cfg.payoutNote}</div>}

        {/* Jackpot / results banner */}
        {R.allFinal && (
          <div className="rounded px-4 py-3" style={{ background: '#3A2A0A', border: `2px solid ${C.gold}` }}>
            <div className="font-head uppercase" style={{ color: C.gold }}>🏆 Final</div>
            <div className="font-mono text-xs mt-1" style={{ color: C.cream }}>
              Leader: <b>{standings.rows[0]?.p.name}</b> with {standings.rows[0]?.total} pts.
              {R.longestTd?.name && <> Longest TD: <b>{R.longestTd.name}</b>{R.longestTd.yards ? ` (${R.longestTd.yards} yds)` : ''} — {standings.jackpotWinner ? <>Big Beefy Bonus winner <b>{standings.jackpotWinner.p.name}</b> ({jackpotAmt} units)!</> : 'nobody picked him; the Bonus rolls into the main pot.'}</>}
            </div>
          </div>
        )}

        {/* Jackpot watch — who currently owns the longest TD, and who picked him */}
        {games.length > 0 && (() => {
          const lt = R.longestTd;
          const tally = {};
          if (locked) {
            data.participants.forEach(p => {
              const j = picksBowl[p.id]?.jackpot;
              if (!j?.name) return;
              const key = normName(j.name);
              (tally[key] = tally[key] || { name: j.name, who: [] }).who.push(p.name);
            });
          }
          const leaderKey = lt?.name ? normName(lt.name) : null;
          const leaderPickers = leaderKey ? (tally[leaderKey]?.who || []) : [];
          const ltGame = lt?.gameId ? games.find(g => g.id === lt.gameId) : null;
          const others = Object.entries(tally).filter(([k]) => k !== leaderKey).sort((a, b) => b[1].who.length - a[1].who.length);
          return (
            <div className="rounded px-4 py-3" style={{ background: '#3A2A0A', border: `2px solid ${C.gold}` }}>
              <div className="font-head uppercase" style={{ color: C.gold }}>🥩 Big Beefy Bonus watch — longest TD ({jackpotAmt} units)</div>
              {lt?.name ? (
                <div className="mt-1">
                  <div className="font-head text-lg">{lt.name}{lt.team ? ` (${lt.team})` : ''} <span style={{ color: C.gold }}>{lt.yards ? `· ${lt.yards} yds` : ''}</span></div>
                  <div className="font-mono text-[11px]" style={{ color: C.muted }}>
                    {ltGame ? `${ltGame.away} @ ${ltGame.home} · ` : ''}{R.allFinal ? 'Final — this is the winning TD.' : 'Current longest TD (no defensive or punt/kickoff return TDs) — can still be beaten.'}
                  </div>
                  <div className="font-mono text-xs mt-2" style={{ color: C.cream }}>
                    {!locked ? '🔒 Who picked him is revealed at kickoff.' : leaderPickers.length
                      ? <>Picked by: <b style={{ color: C.gold }}>{leaderPickers.join(', ')}</b></>
                      : 'Nobody picked him — if he holds, the Bonus rolls back into the main pot.'}
                  </div>
                </div>
              ) : (
                <div className="font-mono text-xs mt-1" style={{ color: C.muted }}>No touchdowns scored yet — the leader shows up here once the first TD hits.</div>
              )}
              {locked && others.length > 0 && (
                <details className="mt-2 font-mono text-[11px]" style={{ color: C.muted }}>
                  <summary style={{ cursor: 'pointer', color: C.gold }}>Everyone's Big Beefy Bonus picks</summary>
                  <ul className="mt-1 space-y-0.5">
                    {others.map(([k, v]) => <li key={k}><b style={{ color: C.cream }}>{v.name}</b> — {v.who.join(', ')}</li>)}
                  </ul>
                </details>
              )}
            </div>
          );
        })()}

        {/* Identity */}
        <div className="rounded px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
          {actingId ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-xs">
                {isAdmin && actAsId ? 'Admin editing picks for ' : "You're picking as "}<b style={{ color: C.gold }}>{actingPerson?.name}</b>
                {myIdValid && !actAsId && <button onClick={forgetMe} className="underline ml-2" style={{ color: C.muted }}>not you?</button>}
                {actAsId && <button onClick={() => setActAsId(null)} className="underline ml-2" style={{ color: C.muted }}>stop</button>}
              </div>
              <div className="font-mono text-xs" style={{ color: progress.done === progress.total ? C.green : C.gold }}>
                {progress.done}/{progress.total} picks made
              </div>
            </div>
          ) : (
            <div>
              <div className="font-head uppercase text-sm mb-2" style={{ color: C.gold }}>Who are you?</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {data.participants.map(p => (
                  <button key={p.id} onClick={() => setClaim({ participantId: p.id, mode: p.pin ? 'enter' : 'set', input: '', error: '' })} className="font-mono text-xs px-2 py-1 rounded" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.cream }}>{p.name}</button>
                ))}
                {data.participants.length === 0 && <span className="font-mono text-xs" style={{ color: C.muted }}>No entries yet — be the first!</span>}
              </div>
              {joinClosed ? (
                <div className="font-mono text-xs" style={{ color: C.muted }}>Entries are closed — the first game has kicked off.</div>
              ) : showJoin ? (
                <div className="space-y-2">
                  <input placeholder="Display name (shown on leaderboard)" value={joinForm.name} onChange={e => setJoinForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                  <input placeholder="Your real name" value={joinForm.realName} onChange={e => setJoinForm(f => ({ ...f, realName: e.target.value }))} style={inputStyle} />
                  <input placeholder="Email" value={joinForm.email} onChange={e => setJoinForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} />
                  {joinError && <div className="font-mono text-xs" style={{ color: C.red }}>{joinError}</div>}
                  <div className="flex gap-2">
                    <button onClick={addParticipant} className="font-head" style={smallBtn(C.gold)}>Join the pool</button>
                    <button onClick={() => setShowJoin(false)} className="font-mono text-xs underline" style={{ color: C.muted }}>Cancel</button>
                  </div>
                </div>
              ) : <button onClick={() => setShowJoin(true)} className="font-head" style={smallBtn(C.orange, '#fff')}>+ Join the Poultry Bowl</button>}
            </div>
          )}
          {isAdmin && (
            <div className="mt-2 flex items-center gap-2 font-mono text-[11px]" style={{ color: C.muted }}>
              Admin: edit picks as
              <select value={actAsId || ''} onChange={e => setActAsId(e.target.value || null)} style={{ ...inputStyle, width: 'auto' }}>
                <option value="">—</option>
                {data.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {games.length === 0 && (
          <div className="rounded p-4 text-center" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="font-mono text-sm" style={{ color: C.muted }}>The games haven't been set up yet{isAdmin ? '.' : ' — check back soon.'}</div>
            {isAdmin && (
              <div className="mt-3">
                <button onClick={() => loadFromEspn(false)} className="font-head flex items-center gap-1 mx-auto" style={smallBtn(C.gold)}><RefreshCw size={12} /> Load the Thanksgiving games from ESPN</button>
                <div className="font-mono text-[11px] mt-2" style={{ color: C.muted }}>Pulls every game between {espnRange.start} and {espnRange.end} (change the dates in Admin tools if needed).</div>
                {espnMsg && <div className="font-mono text-xs mt-2" style={{ color: C.cream }}>{espnMsg}</div>}
              </div>
            )}
          </div>
        )}

        {/* Picks editor — turkey legs pick the section, each shows how many picks are in */}
        {games.length > 0 && (() => {
          const legs = legCounts(myPicks, games);
          const leg = legs.find(l => l.key === activeLeg) || legs[0];
          const needGames = (children) => <div className="space-y-3">{children}</div>;
          const gameHead = (g, extra) => (
            <div className="flex flex-wrap justify-between items-baseline gap-1 mb-2">
              <div className="font-head text-base">{g.away} @ {g.home}</div>
              <div className="font-mono text-[11px]" style={{ color: C.muted }}>{fmtKick(g.kickoff)}{extra ? ` · ${extra}` : ''}</div>
            </div>
          );
          const card = (g, extra, body) => (
            <div key={g.id} className="rounded p-3" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>{gameHead(g, extra)}{body}</div>
          );
          const playersGate = !cfg.playersOpen && !isAdmin;
          const tbdPlayers = (title) => (
            <Section title={title} sub="">
              <div className="font-mono text-xs" style={{ color: C.muted }}>🦃 Player pool TBD — the players for these picks get posted closer to Thanksgiving (rosters and injuries settle first). Check back soon!</div>
            </Section>
          );
          const usedConf = (gid) => games.map(x => x.id !== gid ? Number(myPicks.games?.[x.id]?.conf) : 0).filter(Boolean);
          const panels = {
            big4: () => playersGate ? tbdPlayers('The Big Four — 20 pts each') : (
              <Section title="The Big Four — 20 pts each" sub="Who leads ALL the games in each category?">
                <div className="space-y-2">
                  {LEADERS.map(l => (
                    <div key={l.key}>
                      <Label>{l.label}</Label>
                      <PlayerSelect value={myPicks.leaders?.[l.key]} onChange={v => guard(myPicks.leaders?.[l.key], v, () => setLeader(l.key, v))} options={roster.filter(p => p.position === l.pos)} disabled={!canEdit} />
                    </div>
                  ))}
                </div>
              </Section>
            ),
            win: () => (
              <Section title="Winners + confidence" sub="Pick the winner and rank your confidence — 5 pts × the number if you're right. Use each number once.">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  const used = usedConf(g.id);
                  return card(g, `Spread ${fmtSpread(g, cfg.spreadsLive)}`, (
                    <div className="flex gap-2 items-center">
                      <div style={{ flex: 1 }}><Segmented disabled={!canEdit} value={gp.win} onChange={v => guard(gp.win, v, () => setGame(g.id, { win: v }))} options={[{ value: g.away, label: g.away }, { value: g.home, label: g.home }]} /></div>
                      <select disabled={!canEdit} value={gp.conf || ''} onChange={e => { const v = Number(e.target.value) || 0; guard(gp.conf, v || '', () => setConf(g.id, v)); }} style={{ ...inputStyle, width: 100 }}>
                        <option value="">Conf…</option>
                        {Array.from({ length: games.length }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}{used.includes(n) ? ' (swap)' : ''}</option>)}
                      </select>
                    </div>
                  ));
                }))}
              </Section>
            ),
            ats: () => (
              <Section title="Against the spread — 5 pts each" sub="Pick who covers.">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  const sp = Number(g.spread);
                  const spreadReady = !!cfg.spreadsLive && has(g.spread);
                  if (!spreadReady) return card(g, 'Spread TBD', <div className="font-mono text-xs" style={{ color: C.muted }}>📅 The spread for this game is still TBD — it opens up closer to kickoff week. Check back soon!</div>);
                  return card(g, `Spread ${fmtSpread(g, true)}`, (
                    <Segmented disabled={!canEdit} value={gp.ats} onChange={v => guard(gp.ats, v, () => setGame(g.id, { ats: v }))} options={[
                      { value: g.away, label: `${g.away} ${sp > 0 ? '-' + g.spread : sp < 0 ? '+' + Math.abs(g.spread) : 'PK'}` },
                      { value: g.home, label: `${g.home} ${sp < 0 ? g.spread : sp > 0 ? '+' + g.spread : 'PK'}` },
                    ]} />
                  ));
                }))}
              </Section>
            ),
            tot: () => (
              <Section title={`Total points over/under ${cfg.totalLine} — 5 pts each`} sub="Combined score of both teams.">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  return card(g, `Line ${cfg.totalLine}`, <Segmented disabled={!canEdit} value={gp.tot} onChange={v => guard(gp.tot, v, () => setGame(g.id, { tot: v }))} options={[{ value: 'over', label: 'Over' }, { value: 'under', label: 'Under' }]} />);
                }))}
              </Section>
            ),
            fg: () => (
              <Section title={`Longest field goal over/under ${cfg.fgLine} — 5 pts each`} sub="The longest made field goal in each game.">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  return card(g, `Line ${cfg.fgLine}`, <Segmented disabled={!canEdit} value={gp.fg} onChange={v => guard(gp.fg, v, () => setGame(g.id, { fg: v }))} options={[{ value: 'over', label: 'Over' }, { value: 'under', label: 'Under' }]} />);
                }))}
              </Section>
            ),
            exact: () => (
              <Section title="Exact longest field goal" sub="5 pts for exact, minus 1 for every yard off (never below 0). Press Enter or tap away to save.">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  return card(g, '', <NumberPick tick={cancelTick} disabled={!canEdit} placeholder="yards, e.g. 47" value={gp.fgExact} onCommit={v => guard(gp.fgExact, v, () => setGame(g.id, { fgExact: v }))} />);
                }))}
              </Section>
            ),
            td: () => playersGate ? tbdPlayers('TD scorer — 12 pts each') : (
              <Section title="TD scorer — 12 pts each" sub="Pick one player in each game to score a touchdown (rushing, receiving or return — a passing TD counts for the catcher, not the QB).">
                {needGames(games.map(g => {
                  const gp = myPicks.games?.[g.id] || {};
                  return card(g, '', <PlayerSelect value={gp.td} onChange={v => guard(gp.td, v, () => setGame(g.id, { td: v }))} options={roster.filter(p => (p.team === g.home || p.team === g.away) && p.position !== 'K')} disabled={!canEdit} />);
                }))}
              </Section>
            ),
            lineup: () => playersGate ? tbdPlayers('Fantasy lineup — 15 / 10 / 5') : (
              <Section title="Fantasy lineup — 15 / 10 / 5" sub="Same scoring as Where's the Beef. Fill all 8 slots.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {LINEUP_SLOTS.map(s => {
                    const chosen = LINEUP_SLOTS.map(x => myPicks.lineup?.[x.key]?.id).filter(Boolean);
                    const opts = s.pos === 'DST'
                      ? gameTeams.map(t => ({ id: t, name: `${TEAM_MAP[t] || t} D/ST`, team: t, position: 'D/ST' }))
                      : roster.filter(p => p.position === s.pos);
                    return (
                      <div key={s.key}>
                        <Label>{s.label}</Label>
                        <PlayerSelect value={myPicks.lineup?.[s.key]} onChange={v => guard(myPicks.lineup?.[s.key], v, () => setSlot(s.key, v))} options={opts} disabled={!canEdit} exclude={chosen} />
                      </div>
                    );
                  })}
                </div>
              </Section>
            ),
            tb: () => (
              <Section title="Tiebreakers" sub="Closest wins. Press Enter or tap away to save.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label>1) How many points will the Cowboys score?</Label><NumberPick tick={cancelTick} disabled={!canEdit} value={myPicks.tb1} onCommit={v => guard(myPicks.tb1, v, () => setTop({ tb1: v }))} /></div>
                  <div><Label>2) Total field goals made across all games</Label><NumberPick tick={cancelTick} disabled={!canEdit} value={myPicks.tb2} onCommit={v => guard(myPicks.tb2, v, () => setTop({ tb2: v }))} /></div>
                </div>
              </Section>
            ),
            jackpot: () => playersGate ? tbdPlayers('The Big Beefy Bonus — 10% of the pot') : (
              <div className="rounded p-4" style={{ background: '#3A2A0A', border: `2px solid ${C.gold}` }}>
                <div className="font-head uppercase text-base" style={{ color: C.gold }}>🥩 The Big Beefy Bonus — {JACKPOT_PCT}% of the pot</div>
                <div className="font-mono text-[11px] mb-3" style={{ color: C.muted }}>Who scores the longest TD of the 5 games? (Defensive TDs and punt/kickoff return TDs don't count.) No points — just the Big Beefy Bonus.</div>
                <PlayerSelect value={myPicks.jackpot} onChange={v => guard(myPicks.jackpot, v, () => setTop({ jackpot: v }))} options={roster.filter(p => p.position !== 'K')} disabled={!canEdit} />
              </div>
            ),
          };
          const allDone = legs.every(l => l.done === l.total);
          return (
            <div className="space-y-4">
              {!actingId && <div className="font-mono text-xs rounded px-3 py-2" style={{ background: C.panel, color: C.cream, border: `1px solid ${C.gold}` }}>👀 Preview — join the pool or pick your name above to start making picks{isAdmin ? ' (or use "edit picks as" in the admin row)' : ''}.</div>}
              {locked && !isAdmin && <div className="font-mono text-xs rounded px-3 py-2" style={{ background: '#5A1F18', color: '#FFB4A8', border: `1px solid ${C.red}` }}>Picks are locked — here's what you entered.</div>}
              {rosterLoading && roster.length === 0 && <div className="font-mono text-xs flex items-center gap-2" style={{ color: C.muted }}><Loader2 size={12} className="animate-spin" /> Loading players…</div>}

              <div className="rounded p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <div className="font-head uppercase text-sm text-center mb-2" style={{ color: C.gold }}>
                  {allDone ? '🦃 All picks are in — you\'re set!' : 'Tap a turkey leg (or the beef) to make your picks'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 6 }}>
                  {legs.map(l => {
                    const done = l.total > 0 && l.done === l.total;
                    const active = l.key === leg.key;
                    return (
                      <button key={l.key} onClick={() => setActiveLeg(l.key)} style={{ background: active ? '#4A2E12' : 'transparent', border: `2px solid ${active ? C.gold : 'transparent'}`, borderRadius: 10, padding: '6px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        {l.key === 'jackpot' ? <JackpotIcon active={active} /> : <Drumstick active={active} done={done} />}
                        <div className="font-head" style={{ fontSize: 12, lineHeight: 1.1, color: C.cream, marginTop: 2 }}>{l.label}</div>
                        <div className="font-mono" style={{ fontSize: 13, marginTop: 2, color: done ? C.green : C.gold, fontWeight: 600 }}>
                          {done ? '✓' : `${l.done}/${l.total}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {panels[leg.key]()}
            </div>
          );
        })()}

        {/* Games + results board */}
        {games.length > 0 && (
          <Section title="Games & results" sub="">
            <div className="space-y-2">
              {games.map(g => {
                const rg = R.games[g.id];
                return (
                  <div key={g.id} className="flex flex-wrap justify-between items-center rounded px-3 py-2 font-mono text-xs" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                    <div><b>{g.away} @ {g.home}</b> <span style={{ color: C.muted }}>· {fmtKick(g.kickoff)} · {fmtSpread(g, cfg.spreadsLive)}</span></div>
                    <div style={{ color: gameFinal(rg) ? C.green : C.muted }}>
                      {rg && rg.homeScore != null ? `${g.away} ${rg.awayScore} – ${g.home} ${rg.homeScore}${gameFinal(rg) ? ' · Final' : gameHasStarted(g) ? ' · Live' : ''}` : gameHasStarted(g) ? 'In progress' : 'Upcoming'}
                      {rg && rg.homeScore != null && <span style={{ color: C.muted }}> · longest FG {rg.longestFG ?? 0} · {rg.fgMade ?? 0} FG</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {R.updatedAt && <div className="font-mono text-[10px] mt-2" style={{ color: C.muted }}>Results last synced {new Date(R.updatedAt).toLocaleString()}</div>}
          </Section>
        )}

        {/* Leaderboard */}
        <Section title="Leaderboard" sub={locked ? 'Tap a name to see their picks and points' : 'Everyone\'s picks are revealed at kickoff'}>
          <div className="space-y-1.5">
            {standings.rows.length === 0 && <div className="font-mono text-xs" style={{ color: C.muted }}>No entries yet.</div>}
            {standings.rows.map(r => {
              const open = expandedId === r.p.id;
              const prog = pickProgress(r.pk, { ...cfg, games });
              return (
                <div key={r.p.id} className="rounded" style={{ background: C.panel2, border: `1px solid ${r.p.id === actingId ? C.gold : C.line}` }}>
                  <button className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => setExpandedId(open ? null : r.p.id)}>
                    <div className="flex items-center gap-3">
                      <span className="font-head text-lg" style={{ color: C.gold, width: 26 }}>{r.rank}</span>
                      <span className="font-head text-base">{r.p.name}{r.p.paid ? '' : <span className="font-mono text-[10px] ml-2" style={{ color: C.red }}>unpaid</span>}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {!locked && <span className="font-mono text-[11px]" style={{ color: prog.done === prog.total ? C.green : C.muted }}>{prog.done}/{prog.total}</span>}
                      <span className="font-head text-lg">{r.total}</span>
                      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 font-mono text-[11px] space-y-1" style={{ color: C.muted }}>
                      <div>Big Four {r.parts.leaders} · Winners {r.parts.win} · Spread {r.parts.ats} · Totals {r.parts.tot} · FG O/U {r.parts.fgOU} · Exact FG {r.parts.fgExact} · TD scorers {r.parts.td} · Lineup bonus {r.lineupBonus}</div>
                      {r.lineupComplete && <div>Lineup total: {r.lineupPts} pts</div>}
                      {showPicksOf(r.p.id) ? <PicksSummary r={r} games={games} cfg={cfg} R={R} /> : <div>🔒 Picks are hidden until the first kickoff.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {R.allFinal && <div className="font-mono text-[10px] mt-2" style={{ color: C.muted }}>Tiebreak actuals — Cowboys points: {standings.tb1Actual ?? '—'} · total FGs made: {standings.tb2Actual ?? '—'}</div>}
        </Section>

        {/* Admin */}
        {isAdmin && (
          <div className="rounded" style={{ background: '#2A1A0E', border: `2px solid ${C.orange}` }}>
            <button className="w-full flex justify-between items-center px-4 py-3" onClick={() => setAdminOpen(o => !o)}>
              <span className="font-head uppercase" style={{ color: C.orange }}>Admin tools</span>
              {adminOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {adminOpen && (
              <div className="px-4 pb-4 space-y-5 font-mono text-xs">
                <div className="space-y-2">
                  <label className="flex items-center gap-2" style={{ color: C.cream }}>
                    <input type="checkbox" checked={!!cfg.spreadsLive} onChange={e => setConfig({ spreadsLive: e.target.checked })} />
                    <b>Spreads are final — show them &amp; allow spread picks</b> <span style={{ color: C.muted }}>(off = everyone sees TBD)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ color: C.cream }}>
                    <input type="checkbox" checked={!!cfg.playersOpen} onChange={e => setConfig({ playersOpen: e.target.checked })} />
                    <b>Player pools are open</b> <span style={{ color: C.muted }}>(Big Four, TD scorer, fantasy lineup, Big Beefy Bonus — off = everyone but you sees TBD)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ color: C.cream }}>
                    <input type="checkbox" checked={!!data.showTeaser || !!data.open} disabled={!!data.open} onChange={e => persist({ ...data, showTeaser: e.target.checked })} />
                    <b>Show the "coming soon" turkey on the landing page</b> <span style={{ color: C.muted }}>(it's still locked — people can't get in)</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ color: C.cream }}>
                    <input type="checkbox" checked={!!data.open} onChange={e => persist({ ...data, open: e.target.checked })} />
                    <b>Open the pool to everyone</b> <span style={{ color: C.muted }}>(also turns the landing-page turkey into a live link)</span>
                  </label>
                </div>

                <div>
                  <div className="font-head uppercase mb-2" style={{ color: C.gold }}>Games & lines</div>
                  <div className="flex flex-wrap items-end gap-2 mb-2">
                    <div><Label>ESPN dates from</Label><input value={espnRange.start} onChange={e => setEspnRange(r => ({ ...r, start: e.target.value }))} style={{ ...inputStyle, width: 110 }} /></div>
                    <div><Label>to</Label><input value={espnRange.end} onChange={e => setEspnRange(r => ({ ...r, end: e.target.value }))} style={{ ...inputStyle, width: 110 }} /></div>
                    <button onClick={() => loadFromEspn(false)} className="font-head flex items-center gap-1" style={smallBtn(C.gold)}><RefreshCw size={12} /> Load games from ESPN</button>
                    <button onClick={() => loadFromEspn(true)} className="font-head flex items-center gap-1" style={smallBtn(C.orange, '#fff')}><RefreshCw size={12} /> Refresh spreads from ESPN</button>
                    <button onClick={addBlankGame} className="font-head" style={smallBtn(C.panel2, C.cream)}>+ Add game by hand</button>
                  </div>
                  {espnMsg && <div className="mb-2" style={{ color: C.muted }}>{espnMsg}</div>}
                  <div className="space-y-2">
                    {games.map(g => (
                      <div key={g.id} className="rounded p-2 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                        <div><Label>Away</Label><select value={g.away} onChange={e => updateGame(g.id, { away: e.target.value })} style={inputStyle}>{TEAMS.map(([a]) => <option key={a} value={a}>{a}</option>)}</select></div>
                        <div><Label>Home</Label><select value={g.home} onChange={e => updateGame(g.id, { home: e.target.value })} style={inputStyle}>{TEAMS.map(([a]) => <option key={a} value={a}>{a}</option>)}</select></div>
                        <div className="col-span-2"><Label>Kickoff (your time)</Label><input type="datetime-local" value={toLocalInput(g.kickoff)} onChange={e => updateGame(g.id, { kickoff: e.target.value ? new Date(e.target.value).toISOString() : '' })} style={inputStyle} /></div>
                        <div><Label>Home spread</Label><input type="number" step="0.5" value={g.spread ?? ''} onChange={e => updateGame(g.id, { spread: e.target.value === '' ? '' : Number(e.target.value) })} style={inputStyle} /></div>
                        <div><Label>ESPN game id</Label><input value={g.espnId || ''} onChange={e => updateGame(g.id, { espnId: e.target.value.trim() })} style={inputStyle} /></div>
                        <div className="col-span-2 sm:col-span-6 flex justify-between items-center" style={{ color: C.muted }}>
                          <span>Shows as: {g.away} @ {g.home} · {fmtSpread(g)} <i>(home spread: −3.5 = home favored by 3.5; use .5 to avoid pushes)</i></span>
                          <button onClick={() => window.confirm('Remove this game?') && removeGame(g.id)} style={{ color: C.red }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <div><Label>Longest FG line</Label><input type="number" step="0.5" value={cfg.fgLine} onChange={e => setConfig({ fgLine: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><Label>Total points line</Label><input type="number" step="0.5" value={cfg.totalLine} onChange={e => setConfig({ totalLine: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><Label>Tiebreaker team</Label><select value={cfg.tbTeam} onChange={e => setConfig({ tbTeam: e.target.value })} style={inputStyle}>{TEAMS.map(([a]) => <option key={a} value={a}>{a}</option>)}</select></div>
                    <div><Label>Lock time override</Label><input type="datetime-local" value={toLocalInput(cfg.lockAt)} onChange={e => setConfig({ lockAt: e.target.value ? new Date(e.target.value).toISOString() : null })} style={inputStyle} /></div>
                  </div>
                  <div className="mt-2" style={{ color: C.muted }}>Default lock is the first kickoff. Lines changed after people have picked still score against the new numbers — set them before opening.</div>
                  <div className="mt-2"><Label>Payout note shown to everyone (optional)</Label><textarea rows={3} value={cfg.payoutNote || ''} onChange={e => setConfig({ payoutNote: e.target.value })} style={inputStyle} placeholder="e.g. 1st 50% · 2nd 25% · 3rd 15% · Big Beefy Bonus 10%" /></div>
                </div>

                <div>
                  <div className="font-head uppercase mb-2" style={{ color: C.gold }}>Results</div>
                  <div style={{ color: C.muted }} className="mb-2">Results come from ESPN automatically when <b>/api/sync-poultry</b> runs (add it to cron-job.org every 15 min). Use overrides only if ESPN is wrong or late.</div>
                  {!manualDraft ? (
                    <div className="flex gap-2"><button onClick={startManual} className="font-head" style={smallBtn(C.gold)}>Edit manual overrides</button><button onClick={clearManual} className="font-head" style={smallBtn(C.panel2, C.cream)}>Clear overrides</button></div>
                  ) : (
                    <div className="space-y-3">
                      {games.map(g => {
                        const x = manualDraft.games[g.id];
                        const set = (patch) => setManualDraft(d => ({ ...d, games: { ...d.games, [g.id]: { ...d.games[g.id], ...patch } } }));
                        return (
                          <div key={g.id} className="rounded p-2" style={{ background: C.panel2, border: `1px solid ${C.line}` }}>
                            <div className="font-head mb-1">{g.away} @ {g.home}</div>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                              <div><Label>{g.away} score</Label><input type="number" value={x.awayScore} onChange={e => set({ awayScore: e.target.value })} style={inputStyle} /></div>
                              <div><Label>{g.home} score</Label><input type="number" value={x.homeScore} onChange={e => set({ homeScore: e.target.value })} style={inputStyle} /></div>
                              <div><Label>Longest FG</Label><input type="number" value={x.longestFG} onChange={e => set({ longestFG: e.target.value })} style={inputStyle} /></div>
                              <div><Label>FGs made</Label><input type="number" value={x.fgMade} onChange={e => set({ fgMade: e.target.value })} style={inputStyle} /></div>
                              <div><Label>Final?</Label><select value={x.final === '' ? '' : x.final ? '1' : '0'} onChange={e => set({ final: e.target.value === '' ? '' : e.target.value === '1' })} style={inputStyle}><option value="">auto</option><option value="1">Yes</option><option value="0">No</option></select></div>
                            </div>
                            <Label>TD scorers (comma-separated, add yards after the name — e.g. "Brian Thomas Jr. 12, Travis Etienne 4")</Label>
                            <input value={x.tdText} onChange={e => set({ tdText: e.target.value })} style={inputStyle} />
                          </div>
                        );
                      })}
                      <div className="grid grid-cols-2 gap-2">
                        {LEADERS.map(l => <div key={l.key}><Label>{l.label}</Label><input value={manualDraft.leaders[l.key]} onChange={e => setManualDraft(d => ({ ...d, leaders: { ...d.leaders, [l.key]: e.target.value } }))} style={inputStyle} placeholder="player name" /></div>)}
                        <div><Label>Longest TD — player</Label><input value={manualDraft.ltName} onChange={e => setManualDraft(d => ({ ...d, ltName: e.target.value }))} style={inputStyle} /></div>
                        <div><Label>Longest TD — yards</Label><input type="number" value={manualDraft.ltYards} onChange={e => setManualDraft(d => ({ ...d, ltYards: e.target.value }))} style={inputStyle} /></div>
                        <div><Label>All 5 games final?</Label><select value={manualDraft.allFinal === '' ? '' : manualDraft.allFinal ? '1' : '0'} onChange={e => setManualDraft(d => ({ ...d, allFinal: e.target.value === '' ? '' : e.target.value === '1' }))} style={inputStyle}><option value="">auto</option><option value="1">Yes</option><option value="0">No</option></select></div>
                      </div>
                      <div className="flex gap-2"><button onClick={saveManual} className="font-head" style={smallBtn(C.gold)}>Save overrides</button><button onClick={() => setManualDraft(null)} className="underline" style={{ color: C.muted }}>Cancel</button></div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="font-head uppercase mb-2" style={{ color: C.gold }}>Entrants ({data.participants.length})</div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <button onClick={() => buildEmails('all')} className="underline flex items-center gap-1" style={{ color: C.cream }}><Mail size={11} /> All</button>
                    <button onClick={() => buildEmails('unpaid')} className="underline" style={{ color: C.cream }}>Not paid</button>
                    <button onClick={() => buildEmails('unfinished')} className="underline" style={{ color: C.cream }}>Picks unfinished</button>
                  </div>
                  <div className="space-y-1">
                    {data.participants.map(p => (
                      <div key={p.id} className="flex items-center justify-between rounded px-2 py-1" style={{ background: C.panel2 }}>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={!!p.paid} onChange={() => togglePaid(p.id)} /> {p.name} <span style={{ color: C.muted }}>({p.realName})</span></label>
                        <span className="flex items-center gap-3">
                          <button title="Reset PIN" onClick={() => window.confirm(`Reset ${p.name}'s PIN?`) && resetPin(p.id)} style={{ color: C.muted }}><KeyRound size={13} /></button>
                          <button title="Remove" onClick={() => removeParticipant(p.id)} style={{ color: C.red }}><Trash2 size={13} /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <PoolChat messages={data.chatMessages || []} isAdmin={isAdmin} myId={myId} myName={data.participants.find(p => p.id === myId)?.name || ''} onPost={postMessage} onDelete={deleteMessage} accent={C.gold} />

      {claim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#000000bb' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="font-head uppercase text-sm mb-1" style={{ color: C.gold }}>{claim.mode === 'set' ? 'Choose a 4-digit PIN' : 'Enter your PIN'}</div>
            <div className="font-mono text-xs mb-3" style={{ color: C.muted }}>{claim.mode === 'set' ? 'You\'ll use it to get back into your picks from any device.' : `PIN for ${data.participants.find(p => p.id === claim.participantId)?.name}`}</div>
            <div className="flex items-center gap-2">
              <input autoFocus inputMode="numeric" maxLength={4} value={claim.input} onChange={e => setClaim(c => ({ ...c, input: e.target.value.replace(/\D/g, '').slice(0, 4), error: '' }))} onKeyDown={e => e.key === 'Enter' && submitClaim()} placeholder="••••" className="font-mono text-center tracking-widest" style={{ ...inputStyle, width: 90 }} />
              <button onClick={submitClaim} className="font-head" style={smallBtn(C.gold)}>{claim.mode === 'set' ? 'Set PIN' : 'Enter'}</button>
              <button onClick={() => setClaim(null)} className="font-mono text-xs underline" style={{ color: C.muted }}>Cancel</button>
            </div>
            {claim.error && <div className="font-mono text-xs mt-2" style={{ color: C.red }}>{claim.error}</div>}
          </div>
        </div>
      )}

      {adminPrompt && <AdminPrompt adminPrompt={adminPrompt} setAdminPrompt={setAdminPrompt} submitAdminPrompt={submitAdminPrompt} />}

      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#000000bb' }} onClick={() => setEmailModal(null)}>
          <div className="w-full max-w-lg rounded p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-2"><div className="font-head uppercase text-sm" style={{ color: C.gold }}>{emailModal.label} — {emailModal.emails.length}</div><button onClick={() => setEmailModal(null)}><X size={18} /></button></div>
            <textarea readOnly rows={5} value={emailModal.emails.join(', ')} onFocus={e => e.target.select()} style={inputStyle} />
            <button onClick={() => { navigator.clipboard?.writeText(emailModal.emails.join(', ')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }} className="mt-2 font-head flex items-center gap-1" style={smallBtn(copied ? C.green : C.gold)}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#000000bb' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="font-mono text-[10px] uppercase mb-2" style={{ color: C.gold }}>Replacing an existing pick</div>
            <div className="font-mono text-sm mb-4" style={{ color: C.cream }}>
              Change {pendingChange.who ? <span style={{ color: C.muted }}>{pendingChange.who}'s</span> : 'your'} pick from <span style={{ color: '#E28A82' }}>{pendingChange.oldLabel}</span> to <span style={{ color: C.green }}>{pendingChange.newLabel}</span>?
            </div>
            <div className="flex items-center gap-3">
              <button onClick={confirmPending} className="font-head" style={smallBtn(C.gold)}>Confirm</button>
              <button onClick={cancelPending} className="font-mono text-xs underline" style={{ color: C.muted }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {saveError && <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-96 z-50 font-mono text-xs px-3 py-2 rounded" style={{ background: '#5A1F18', border: `1px solid ${C.red}`, color: '#FFB4A8' }}>Couldn't save — your last change may not have stuck. Check your connection and try again.</div>}
      {justSaved && <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs" style={{ background: C.panel, border: `1px solid ${C.green}`, color: C.green }}><Check size={12} /> Saved</div>}
    </div>
  );
}

// ---------------------------------------------------------------- small pieces
function Section({ title, sub, children }) {
  return (
    <div className="rounded p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div className="mb-3">
        <div className="font-head uppercase text-base" style={{ color: C.gold }}>{title}</div>
        {sub ? <div className="font-mono text-[11px]" style={{ color: C.muted }}>{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}
function Label({ children }) {
  return <div className="font-mono text-[11px] mb-1 mt-2" style={{ color: C.muted }}>{children}</div>;
}
function AdminPrompt({ adminPrompt, setAdminPrompt, submitAdminPrompt }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#000000bb' }}>
      <div className="w-full max-w-sm rounded p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="font-head text-sm uppercase mb-2" style={{ color: C.gold }}>{adminPrompt.mode === 'set' ? 'Set the admin PIN' : 'Enter admin PIN'}</div>
        <div className="flex items-center gap-2">
          <input autoFocus inputMode="numeric" maxLength={8} value={adminPrompt.input} onChange={e => setAdminPrompt(p => ({ ...p, input: e.target.value.replace(/\D/g, '').slice(0, 8), error: '' }))} onKeyDown={e => e.key === 'Enter' && submitAdminPrompt()} placeholder="••••" className="font-mono text-center tracking-widest" style={{ ...inputStyle, width: 100 }} />
          <button onClick={submitAdminPrompt} className="font-head" style={smallBtn(C.gold)}>{adminPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}</button>
          <button onClick={() => setAdminPrompt(null)} className="font-mono text-xs underline" style={{ color: C.muted }}>Cancel</button>
        </div>
        {adminPrompt.error && <div className="font-mono text-xs mt-2" style={{ color: C.red }}>{adminPrompt.error}</div>}
      </div>
    </div>
  );
}

function PicksSummary({ r, games, cfg, R }) {
  const pk = r.pk || {};
  const mark = (ok, final) => (!final ? '' : ok ? ' ✓' : ' ✗');
  return (
    <div className="space-y-2">
      <div>
        <b style={{ color: C.cream }}>Big Four:</b>{' '}
        {LEADERS.map(l => `${l.key.toUpperCase()}: ${pk.leaders?.[l.key]?.name || '—'}${mark(r.detail.leaders[l.key], R.allFinal)}`).join(' · ')}
      </div>
      {games.map(g => {
        const gp = pk.games?.[g.id] || {};
        const d = r.detail.games[g.id];
        const fin = !!d;
        return (
          <div key={g.id}>
            <b style={{ color: C.cream }}>{g.away} @ {g.home}:</b>{' '}
            Win {gp.win || '—'} ({gp.conf || '—'}){mark(d?.win, fin)} · ATS {gp.ats || '—'}{mark(d?.ats, fin)} · Total {gp.tot || '—'}{mark(d?.tot, fin)} · FG {gp.fg || '—'}{mark(d?.fg, fin)} · Exact FG {gp.fgExact ?? '—'}{fin ? ` (+${d.fgPts ?? 0})` : ''} · TD {gp.td?.name || '—'}{mark(d?.td, fin)}
          </div>
        );
      })}
      <div><b style={{ color: C.cream }}>Lineup:</b> {LINEUP_SLOTS.map(s => `${s.label} ${pk.lineup?.[s.key]?.name || '—'}`).join(' · ')}</div>
      <div><b style={{ color: C.cream }}>Tiebreakers:</b> Cowboys {pk.tb1 ?? '—'} · Total FGs {pk.tb2 ?? '—'} · <b style={{ color: C.cream }}>Big Beefy Bonus:</b> {pk.jackpot?.name || '—'}</div>
    </div>
  );
}
