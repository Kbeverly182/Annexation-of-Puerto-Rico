import { kv } from '@vercel/kv';
import { google } from 'googleapis';

const POOL_KEYS = [
  { key: 'survivor-pool-v1', label: 'Survivor' },
  { key: 'confidence-pool-v1', label: 'Confidence' },
  { key: 'lineup-pool-v1', label: 'Lineup' },
];

function getSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY environment variable — see setup guide.');
  }
  // Vercel's env var UI often stores multi-line keys with literal "\n" sequences instead of
  // real newlines — convert them back, or the JWT signing silently fails.
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Creates the two tabs this backup relies on if they don't already exist, so a fresh sheet
// works out of the box without any manual tab setup.
async function ensureTabsExist(sheets, spreadsheetId, tabNames) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set((meta.data.sheets || []).map(s => s.properties.title));
  const toAdd = tabNames.filter(name => !existing.has(name));
  if (toAdd.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toAdd.map(title => ({ addSheet: { properties: { title } } })) },
    });
  }
}

export default async function handler(req, res) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return res.status(500).json({ ok: false, error: 'Missing GOOGLE_SHEET_ID environment variable — see setup guide.' });
  }

  // Optional protection: if you set a CRON_SECRET env var, only requests carrying it are
  // accepted. Vercel automatically includes this as an Authorization header for its own
  // scheduled Cron calls. Leave CRON_SECRET unset if you don't need this (the endpoint just
  // re-runs a safe, non-destructive read-and-copy operation either way).
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    const providedSecret = authHeader.replace(/^Bearer\s+/i, '') || req.query?.secret;
    if (providedSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    const sheets = getSheetsClient();
    const now = new Date().toISOString();

    const pools = {};
    for (const { key, label } of POOL_KEYS) {
      pools[label] = await kv.get(key);
    }

    await ensureTabsExist(sheets, sheetId, ['Raw Backup', 'Entrants']);

    // Raw Backup tab: one row per pool with the complete, untouched JSON for that pool.
    // This is the real safety net — even if every other tab or feature breaks, this alone
    // is enough to reconstruct everything by hand if it ever came to that.
    const rawRows = [['Pool', 'Last Synced', 'Raw JSON']];
    for (const { label } of POOL_KEYS) {
      rawRows.push([label, now, JSON.stringify(pools[label] || {})]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Raw Backup!A1',
      valueInputOption: 'RAW',
      requestBody: { values: rawRows },
    });

    // Entrants tab: a quick human-readable reference across all three pools — who's in each
    // one, their real name and email, and whether they've claimed a PIN yet.
    const entrantRows = [['Pool', 'Display Name', 'Real Name', 'Email', 'PIN Set?']];
    for (const { label } of POOL_KEYS) {
      const data = pools[label];
      (data?.participants || []).forEach(p => {
        entrantRows.push([label, p.name || '', p.realName || '', p.email || '', p.pin ? 'Yes' : 'No']);
      });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Entrants!A1',
      valueInputOption: 'RAW',
      requestBody: { values: entrantRows },
    });

    return res.status(200).json({ ok: true, syncedAt: now, pools: POOL_KEYS.map(p => p.label) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
