import React, { useState } from 'react';
import { BookOpen, X } from 'lucide-react';

// A simple "Rules" button that opens a modal with pool-specific rules content.
// `sections` is an array of { heading, body } where body is a string or array of strings
// (array renders as a bulleted list).
export default function PoolRules({ title, entryFee, sections, accent = '#8A9A90' }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="font-head text-xs uppercase tracking-wide flex items-center gap-1.5 px-3 py-1.5 rounded-full"
        style={{
          color: accent,
          background: `${accent}22`,
          border: `1.5px solid ${accent}`,
          boxShadow: `0 0 10px ${accent}55, 0 0 2px ${accent}`,
          animation: 'pool-rules-pulse 2.4s ease-in-out infinite',
        }}
      >
        <BookOpen size={13} /> Rules
      </button>
      <style>{`
        @keyframes pool-rules-pulse {
          0%, 100% { box-shadow: 0 0 8px ${accent}44, 0 0 2px ${accent}; }
          50% { box-shadow: 0 0 16px ${accent}99, 0 0 5px ${accent}; }
        }
      `}</style>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0" style={{ background: '#0F1614cc' }}>
          <div className="w-full max-w-lg rounded flex flex-col" style={{ background: '#1C2823', border: '1px solid #2A3830', maxHeight: '85vh' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #2A3830' }}>
              <div className="font-head text-base uppercase tracking-wide flex items-center gap-2" style={{ color: accent }}>
                <BookOpen size={16} /> {title} Rules
              </div>
              <button onClick={() => setOpen(false)} style={{ color: '#5C6862' }}><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {entryFee != null && (
                <div className="rounded px-3 py-2" style={{ background: `${accent}18`, border: `1px solid ${accent}55` }}>
                  <div className="font-head text-sm" style={{ color: accent }}>Entry Fee: {entryFee} units</div>
                </div>
              )}
              {sections.map((s, i) => (
                <div key={i}>
                  <div className="font-head text-xs uppercase tracking-wide mb-1.5" style={{ color: '#F0EDE4' }}>{s.heading}</div>
                  {Array.isArray(s.body) ? (
                    <ul className="space-y-1 pl-4" style={{ listStyleType: 'disc' }}>
                      {s.body.map((line, j) => (
                        <li key={j} className="font-mono text-xs" style={{ color: '#8A9A90' }}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>{s.body}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
