import { useState, useEffect } from 'react';
import { TEAMS } from './teams';

const TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13, LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25, SEA: 26, TB: 27, TEN: 10, WAS: 28,
};

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'PK']);
const normalizePosition = (abbr) => (abbr === 'PK' ? 'K' : abbr);

let cachedRosters = null;
let cachedMissing = [];

async function fetchTeamRoster(teamId, abbr) {
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
    if (!res.ok) return null; // signals failure, distinct from a genuinely empty roster
    const json = await res.json();
    const players = [];
    (json.athletes || []).forEach(group => {
      (group.items || []).forEach(a => {
        const rawPos = a.position?.abbreviation;
        if (!RELEVANT_POSITIONS.has(rawPos)) return;
        players.push({
          id: a.id,
          name: a.fullName || a.displayName,
          position: normalizePosition(rawPos),
          team: abbr,
        });
      });
    });
    return players;
  } catch (e) {
    return null;
  }
}

export function useNflRosters() {
  const [rosters, setRosters] = useState(cachedRosters);
  const [loading, setLoading] = useState(!cachedRosters);
  const [missingTeams, setMissingTeams] = useState(cachedMissing);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (cachedRosters && reloadTick === 0) {
      setRosters(cachedRosters);
      setMissingTeams(cachedMissing);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const entries = TEAMS.map(([abbr]) => ({ abbr, teamId: TEAM_IDS[abbr] })).filter(e => e.teamId);
      let results = await Promise.all(entries.map(e => fetchTeamRoster(e.teamId, e.abbr)));

      // A handful of teams commonly fail when all 32 requests fire at once (rate limiting) —
      // retry just the failures once, staggered slightly, before giving up on them.
      const failedIdx = results.map((r, i) => (r === null ? i : -1)).filter(i => i >= 0);
      if (failedIdx.length) {
        const retried = [];
        for (const idx of failedIdx) {
          retried.push(await fetchTeamRoster(entries[idx].teamId, entries[idx].abbr));
          await new Promise(r => setTimeout(r, 150));
        }
        failedIdx.forEach((idx, k) => { results[idx] = retried[k]; });
      }

      const stillMissing = entries.filter((e, i) => results[i] === null).map(e => e.abbr);
      const flat = results.filter(Boolean).flat();
      cachedRosters = flat;
      cachedMissing = stillMissing;
      if (!cancelled) {
        setRosters(flat);
        setMissingTeams(stillMissing);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadTick]);

  const retry = () => setReloadTick(t => t + 1);

  return { rosters: rosters || [], loading, missingTeams, retry };
}

export { TEAM_IDS };
