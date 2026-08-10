import { useState, useEffect } from 'react';
import { apiGetPool, apiSavePool } from './api';
import { hashPin } from './utils';

const ADMIN_KEY = 'admin-config';
const LOCAL_KEY = 'site-admin-unlocked';

// One admin PIN shared across all three pools (stored server-side as a hash, same low-key
// deterrent level as entrant PINs — not real security, just enough friction to stop casual
// misuse). Once unlocked on a device it stays unlocked there until explicitly logged out.
export function useAdminMode() {
  const [adminHash, setAdminHash] = useState(undefined); // undefined = still loading, null = no PIN set yet
  const [isAdmin, setIsAdmin] = useState(false);
  const [prompt, setPrompt] = useState(null); // { mode: 'set' | 'enter', input, error }

  useEffect(() => {
    (async () => {
      try {
        const remote = await apiGetPool(ADMIN_KEY);
        setAdminHash(remote?.pinHash || null);
      } catch (e) {
        setAdminHash(null);
      }
    })();
    try {
      if (localStorage.getItem(LOCAL_KEY) === 'true') setIsAdmin(true);
    } catch (e) {
      // ignore — private browsing etc.
    }
  }, []);

  const openPrompt = () => {
    if (isAdmin) return;
    setPrompt({ mode: adminHash ? 'enter' : 'set', input: '', error: '' });
  };

  const submitPrompt = async () => {
    if (!prompt) return;
    if (!/^\d{4,8}$/.test(prompt.input)) {
      setPrompt(p => ({ ...p, error: 'PIN must be 4-8 digits', input: '' }));
      return;
    }
    const hashed = hashPin(prompt.input);
    if (prompt.mode === 'set') {
      try {
        await apiSavePool(ADMIN_KEY, { pinHash: hashed });
        setAdminHash(hashed);
        setIsAdmin(true);
        try { localStorage.setItem(LOCAL_KEY, 'true'); } catch (e) { /* non-fatal */ }
        setPrompt(null);
      } catch (e) {
        setPrompt(p => ({ ...p, error: 'Could not save — try again', input: '' }));
      }
    } else if (hashed === adminHash) {
      setIsAdmin(true);
      try { localStorage.setItem(LOCAL_KEY, 'true'); } catch (e) { /* non-fatal */ }
      setPrompt(null);
    } else {
      setPrompt(p => ({ ...p, error: 'Wrong PIN', input: '' }));
    }
  };

  const exitAdmin = () => {
    setIsAdmin(false);
    try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* non-fatal */ }
  };

  return { isAdmin, adminHash, prompt, setPrompt, openPrompt, submitPrompt, exitAdmin };
}
