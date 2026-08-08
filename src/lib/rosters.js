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

let cachedRosters = null; // module-level cache — roster list doesn't change within a session

export function useNflRosters() {
  const [rosters, setRosters] = useState(cachedRosters);
  const [loading, setLoading] = useState(!cachedRosters);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cachedRosters) { setRosters(cachedRosters); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          TEAMS.map(async ([abbr]) => {
            const teamId = TEAM_IDS[abbr];
            if (!teamId) return [];
            try {
              const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
              if (!res.ok) return [];
              const json = await res.json();
              const players = [];
              (json.athletes || []).forEach(group => {
                (group.items || []).forEach(a => {
                  const posAbbr = normalizePosition(a.position?.abbreviation);
                  if (!RELEVANT_POSITIONS.has(a.position?.abbreviation)) return;
                  players.push({
                    id: a.id,
                    name: a.fullName || a.displayName,
                    position: posAbbr,
                    team: abbr,
                    active: a.status?.type === 'active' || a.status?.name === 'Active',
                  });
                });
              });
              return players;
            } catch (e) {
              return [];
            }
          })
        );
        const flat = results.flat();
        cachedRosters = flat;
        if (!cancelled) { setRosters(flat); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { rosters: rosters || [], loading, error };
}

export { TEAM_IDS };
