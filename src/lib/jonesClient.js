import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNflRosters } from './rosters';
import { TEAMS } from './teams';

// ---- API ----
export async function jPost(pool, body) {
  const res = await fetch('/api/jones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pool, ...body }) });
  let json = {};
  try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok || json.ok === false) throw new Error(json.error || `Something went wrong (${res.status}).`);
  return json;
}

// Loads the league and quietly re-checks a tiny revision marker every 30 s, downloading again only when it changed.
export function useLeague(pool) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const rev = useRef(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/jones?pool=${pool}`);
      if (!r.ok) throw new Error(`Could not load the league (${r.status}).`);
      const j = await r.json();
      rev.current = j.rev;
      setData(j);
      setError(null);
    } catch (e) { setError(String(e.message || e)); }
  }, [pool]);
  useEffect(() => {
    load();
    const t = setInterval(async () => {
      try {
        if (typeof document !== 'undefined' && document.hidden) return;
        const r = await fetch(`/api/jones?pool=${pool}&rev=1`);
        if (!r.ok) return;
        const j = await r.json();
        if (j.rev !== rev.current) load();
      } catch (e) { /* try again next tick */ }
    }, 30000);
    return () => clearInterval(t);
  }, [pool, load]);
  return { data, error, reload: load };
}

// Every NFL player a manager might want (from ESPN, same source the other pools use) + all 32 D/STs.
export function usePlayerPool() {
  const { rosters, loading, progress, missingTeams, retry } = useNflRosters();
  const players = useMemo(() => {
    const list = (rosters || []).map(p => ({ id: String(p.id), name: p.name, pos: p.position, team: p.team }));
    TEAMS.forEach(([abbr, full]) => list.push({ id: 'DST-' + abbr, name: `${full} D/ST`, pos: 'DST', team: abbr }));
    return list;
  }, [rosters]);
  return { players, loading, progress, missingTeams, retry };
}

// ---- formatting ----
export function fmtKick(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  } catch (e) { return ''; }
}
export function fmtWhen(ts) {
  try { return new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (e) { return ''; }
}

export const THEME = { bg: '#0A1020', panel: '#121A30', panel2: '#1A2442', line: '#25304F', gold: '#F2B138', cream: '#F4EFE2', muted: '#8B96B5', green: '#3FBF6A', red: '#E5483A', blue: '#5B9BFF' };
