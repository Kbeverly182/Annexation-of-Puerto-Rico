import React, { useState, useMemo } from 'react';
import { THEME as T } from '../lib/jonesClient';
import { POS_LABEL } from '../lib/jonesCore';

export function Panel({ title, sub, right, children, tone }) {
  return (
    <section style={{ background: T.panel, border: `1px solid ${tone || T.line}`, borderRadius: 12, padding: '14px 16px' }}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-2" style={{ marginBottom: 8 }}>
          <div>
            {title && <h3 style={{ color: T.gold, fontWeight: 800, fontSize: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>}
            {sub && <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn({ children, onClick, kind = 'gold', disabled, small, type = 'button', title }) {
  const bg = kind === 'gold' ? T.gold : kind === 'green' ? T.green : kind === 'red' ? T.red : 'transparent';
  const color = kind === 'ghost' ? T.cream : '#10131F';
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      style={{ background: bg, color, border: kind === 'ghost' ? `1px solid ${T.line}` : 'none', borderRadius: 8, padding: small ? '4px 10px' : '8px 16px', fontWeight: 800, fontSize: small ? 12 : 14, opacity: disabled ? 0.45 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  );
}

export const inputStyle = { background: '#0B1226', border: `1px solid ${T.line}`, color: T.cream, borderRadius: 8, padding: '8px 10px', fontSize: 14, width: '100%' };

export function PosTag({ pos }) {
  return <span style={{ background: T.panel2, border: `1px solid ${T.line}`, color: T.gold, borderRadius: 6, padding: '0 6px', fontSize: 11, fontWeight: 800 }}>{POS_LABEL[pos] || pos}</span>;
}

// Search-as-you-type player chooser. `pool` is the full list; `pos` limits it; `exclude` is a Set of ids to hide.
export function PlayerPicker({ pool, pos, exclude, value, onPick, placeholder = 'Type a name…', disabled }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return pool.filter(p => (!pos || p.pos === pos) && !(exclude && exclude.has(p.id)) && (p.name.toLowerCase().includes(s) || p.team.toLowerCase() === s)).slice(0, 8);
  }, [q, pool, pos, exclude]);
  if (value) {
    return (
      <div className="flex items-center gap-2" style={{ ...inputStyle, justifyContent: 'space-between' }}>
        <span><b>{value.name}</b> <span style={{ color: T.muted, fontSize: 12 }}>{value.team}</span></span>
        {!disabled && <button type="button" onClick={() => onPick(null)} style={{ color: T.muted, fontWeight: 800 }}>✕</button>}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <input value={q} disabled={disabled} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={placeholder} style={inputStyle} />
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', background: '#0B1226', border: `1px solid ${T.gold}`, borderRadius: 8, marginTop: 2, maxHeight: 260, overflowY: 'auto' }}>
          {matches.map(p => (
            <button type="button" key={p.id} onClick={() => { onPick(p); setQ(''); setOpen(false); }}
              className="flex items-center justify-between w-full text-left" style={{ padding: '8px 10px', borderBottom: `1px solid ${T.line}`, color: T.cream, fontSize: 14 }}>
              <span>{p.name}</span>
              <span style={{ color: T.muted, fontSize: 12 }}>{POS_LABEL[p.pos]} · {p.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
