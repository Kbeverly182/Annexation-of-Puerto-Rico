import { kv } from '@vercel/kv';

const KEY = 'survivor-pool-v1';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await kv.get(KEY);
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
      await kv.set(KEY, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to save pool data' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).end('Method Not Allowed');
}
