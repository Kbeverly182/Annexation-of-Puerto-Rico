export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Not cryptographic — just avoids storing PINs as plain text in shared storage.
export function hashPin(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function defaultSeasonYear() {
  const now = new Date();
  const m = now.getMonth() + 1;
  return m <= 2 ? now.getFullYear() - 1 : now.getFullYear();
}
