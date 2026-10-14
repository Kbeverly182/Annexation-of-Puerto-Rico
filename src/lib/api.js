export async function apiGetPool(key) {
  const res = await fetch(`/api/pool?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('failed to load pool');
  const json = await res.json();
  return json.data;
}

export async function apiSavePool(key, data) {
  const res = await fetch(`/api/pool?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('failed to save pool');
  return res.json();
}

// Two people can each be holding a slightly different local snapshot of the pool and save
// around the same time. Without merging, whoever saves last would silently overwrite anything
// the other person just added (e.g. a brand new entrant). This does a best-effort merge right
// before writing: participants are unioned by id (nobody's entry gets dropped), picks/results
// are merged per-week so untouched weeks/entrants from the other snapshot survive, and chat
// messages are unioned by id so two people posting around the same moment don't erase each other.
export function mergePoolData(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const byId = new Map();
  (remote.participants || []).forEach(p => byId.set(p.id, p));
  (local.participants || []).forEach(p => byId.set(p.id, p)); // local wins on same-id conflicts
  const participants = Array.from(byId.values());

  const mergeNested = (localObj = {}, remoteObj = {}) => {
    const keys = new Set([...Object.keys(remoteObj || {}), ...Object.keys(localObj || {})]);
    const out = {};
    keys.forEach(k => {
      out[k] = { ...(remoteObj?.[k] || {}), ...(localObj?.[k] || {}) };
    });
    return out;
  };

  const mergeMessages = (localArr = [], remoteArr = []) => {
    const byMsgId = new Map();
    (remoteArr || []).forEach(m => byMsgId.set(m.id, m));
    (localArr || []).forEach(m => byMsgId.set(m.id, m)); // local wins on same-id conflicts
    return Array.from(byMsgId.values()).sort((a, b) => new Date(a.at) - new Date(b.at));
  };

  // Chop proposal: the newest proposal (by createdAt) wins; if both sides hold the same
  // proposal, union the votes so two people voting at once don't erase each other.
  const mergeChop = (l, r) => {
    if (!l) return r;
    if (!r) return l;
    if (l.id !== r.id) return (l.createdAt || 0) >= (r.createdAt || 0) ? l : r;
    const votes = { ...(r.votes || {}) };
    Object.entries(l.votes || {}).forEach(([pid, v]) => {
      if (!votes[pid] || (v.at || 0) >= (votes[pid].at || 0)) votes[pid] = v;
    });
    return { ...r, ...l, votes };
  };
  const chop = mergeChop(local.chop, remote.chop);

  return {
    ...remote,
    ...local,
    ...(chop ? { chop } : {}),
    participants,
    picks: mergeNested(local.picks, remote.picks),
    results: mergeNested(local.results, remote.results),
    chatMessages: mergeMessages(local.chatMessages, remote.chatMessages),
  };
}
