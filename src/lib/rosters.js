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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Fetches with only a few requests in flight at once, retrying failures with backoff.
// Firing all 32 team requests simultaneously reliably triggers ESPN's rate limiting.
async function fetchAllRosters(onProgress) {
  const entries = TEAMS.map(([abbr]) => ({ abbr, teamId: TEAM_IDS[abbr] })).filter(e => e.teamId);
  const results = new Array(entries.length).fill(null);
  const BATCH_SIZE = 4;
  const BATCH_DELAY_MS = 400;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(e => fetchTeamRoster(e.teamId, e.abbr)));
    batchResults.forEach((r, k) => { results[i + k] = r; });
    if (onProgress) onProgress(results.filter(r => r !== null).length, entries.length);
    if (i + BATCH_SIZE < entries.length) await sleep(BATCH_DELAY_MS);
  }

  // Retry failures up to twice, with increasing backoff, in small batches too.
  for (let attempt = 0; attempt < 2; attempt++) {
    const failedIdx = results.map((r, i) => (r === null ? i : -1)).filter(i => i >= 0);
    if (!failedIdx.length) break;
    await sleep(800 * (attempt + 1));
    for (let i = 0; i < failedIdx.length; i += BATCH_SIZE) {
      const batchIdx = failedIdx.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batchIdx.map(idx => fetchTeamRoster(entries[idx].teamId, entries[idx].abbr)));
      batchResults.forEach((r, k) => { results[batchIdx[k]] = r; });
      if (i + BATCH_SIZE < failedIdx.length) await sleep(BATCH_DELAY_MS);
    }
  }

  const missing = entries.filter((e, i) => results[i] === null).map(e => e.abbr);
  const flat = results.filter(Boolean).flat();
  return { flat, missing };
}

export function useNflRosters() {
  const [rosters, setRosters] = useState(cachedRosters);
  const [loading, setLoading] = useState(!cachedRosters);
  const [progress, setProgress] = useState({ loaded: 0, total: 32 });
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
      const { flat, missing } = await fetchAllRosters((loaded, total) => {
        if (!cancelled) setProgress({ loaded, total });
      });
      cachedRosters = flat;
      cachedMissing = missing;
      if (!cancelled) {
        setRosters(flat);
        setMissingTeams(missing);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadTick]);

  const retry = () => setReloadTick(t => t + 1);

  return { rosters: rosters || [], loading, progress, missingTeams, retry };
}

export { TEAM_IDS };
