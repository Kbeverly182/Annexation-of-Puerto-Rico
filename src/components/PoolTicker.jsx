import React, { useState } from 'react';
import { Megaphone, Pencil } from 'lucide-react';

// A classic scrolling sports-ticker bar. Admin can edit the message; everyone sees it scroll.
// Renders nothing at all if there's no message and the viewer isn't admin, so an empty pool
// doesn't show an empty bar.
export default function PoolTicker({ message, isAdmin, onSave, accent = '#8A9A90' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message || '');

  const startEdit = () => { setDraft(message || ''); setEditing(true); };
  const save = () => { onSave(draft.trim()); setEditing(false); };

  if (!message && !isAdmin) return null;

  return (
    <div className="mb-4">
      {editing ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#1C2823', border: `1px solid ${accent}` }}>
          <Megaphone size={14} color={accent} className="shrink-0" />
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="e.g. Upset alert in Buffalo!"
            className="flex-1 px-2 py-1 rounded outline-none font-mono text-xs"
            style={{ background: '#0F1614', border: '1px solid #2A3830', color: '#F0EDE4' }}
          />
          <button onClick={save} className="px-3 py-1 rounded font-head text-xs uppercase" style={{ background: accent, color: '#0F1614' }}>Save</button>
          <button onClick={() => setEditing(false)} className="font-mono text-xs underline" style={{ color: '#5C6862' }}>Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded overflow-hidden" style={{ background: '#1C2823', border: `1px solid ${accent}55` }}>
          <div className="shrink-0 px-2.5 py-2 flex items-center gap-1.5" style={{ background: `${accent}22`, borderRight: `1px solid ${accent}55` }}>
            <Megaphone size={12} color={accent} />
          </div>
          <div className="flex-1 overflow-hidden py-2">
            {message ? (
              <div
                className="whitespace-nowrap font-head text-sm inline-block"
                style={{
                  color: '#F0EDE4',
                  paddingLeft: '100%',
                  animation: `pool-ticker-scroll ${Math.max(10, message.length * 0.28)}s linear infinite`,
                }}
              >
                {message}
              </div>
            ) : (
              <div className="font-mono text-xs px-2" style={{ color: '#5C6862' }}>No ticker message set.</div>
            )}
          </div>
          {isAdmin && (
            <button onClick={startEdit} className="shrink-0 px-2.5 py-2" style={{ color: '#5C6862' }} title="Edit ticker">
              <Pencil size={12} />
            </button>
          )}
        </div>
      )}
      <style>{`
        @keyframes pool-ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
