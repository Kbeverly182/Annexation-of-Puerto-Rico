import { kv } from '@vercel/kv';

const ALLOWED_KEYS = new Set(['survivor-pool-v1', 'confidence-pool-v1', 'lineup-pool-v1', 'admin-config']);

function resolveKey(req) {
  const key = req.query?.key;
  if (typeof key === 'string' && ALLOWED_KEYS.has(key)) return key;
  return 'survivor-pool-v1';
}

export default async function handler(req, res) {
  const key = resolveKey(req);

  if (req.method === 'GET') {
    try {
      const data = await kv.get(key);
      return res.status(200).json({ data: data || null });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read pool data' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid pool data' });
      }
      await kv.set(key, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to save pool data' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
