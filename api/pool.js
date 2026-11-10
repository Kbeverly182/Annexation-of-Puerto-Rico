import { kv } from '@vercel/kv';

const ALLOWED_KEYS = new Set(['survivor-pool-v1', 'revival-survivor-pool-v1', 'confidence-pool-v1', 'lineup-pool-v1', 'admin-config', 'player-props-v1', 'poultry-bowl-v1', 'poultry-bowl-beta-v1']);

function resolveKey(req) {
  const key = req.query?.key;
  if (typeof key === 'string' && ALLOWED_KEYS.has(key)) return key;
  return 'survivor-pool-v1';
}

export default async function handler(req, res) {
  const key = resolveKey(req);

  if (req.method === 'GET') {
    try {
      // Cheap "has anything changed?" check: pages poll this tiny revision marker and only download
      // the full pool when it moves. (Re-downloading every pool every few seconds from every open
      // tab is what blew through the database's monthly bandwidth allowance.)
      if (req.query?.rev) {
        const revOnly = await kv.get(key + ':rev');
        return res.status(200).json({ rev: revOnly == null ? null : String(revOnly) });
      }
      const rev = await kv.get(key + ':rev'); // read BEFORE the data, so a change in between is simply caught on the next check
      const data = await kv.get(key);
      return res.status(200).json({ data: data || null, rev: rev == null ? null : String(rev) });
    } catch (e) {
      // Log the real reason (visible in Vercel → Logs) and include the short message so an outage
      // can be diagnosed straight from the browser instead of guessing.
      console.error('[api/pool] read failed for key', key, '-', e && (e.message || e));
      return res.status(500).json({ error: 'Failed to read pool data', detail: String((e && e.message) || e).slice(0, 300) });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid pool data' });
      }
      const rev = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await kv.set(key, body);
      await kv.set(key + ':rev', rev);
      return res.status(200).json({ ok: true, rev });
    } catch (e) {
      console.error('[api/pool] save failed for key', key, '-', e && (e.message || e));
      return res.status(500).json({ error: 'Failed to save pool data', detail: String((e && e.message) || e).slice(0, 300) });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
