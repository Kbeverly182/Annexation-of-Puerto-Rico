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
