import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, Ban, Shuffle } from 'lucide-react';
import { uid } from '../lib/utils';

// "Chop Proposal" treasure chest — shared by the Survivor and Revival pools.
//
// A chop is stored on the pool data as `data.chop`:
//   { id, createdAt, round, type: 'even'|'takeAndPlay'|'custom', amount, per, rem, n, pool,
//     note, proposerId, eligibleIds: [ids alive when it was proposed],
//     votes: { [participantId]: { v: 'accept' (a reject clears the proposal), at } } }
// or a tombstone { id, createdAt, withdrawn: true } once someone withdraws it.
//
// Nothing about status is stored — it's derived from the votes, so two people voting at the
// same moment can't clobber each other (mergePoolData unions votes). A proposal is accepted
// when EVERY player who was alive at proposal time has an 'accept' vote. If one of them is
// eliminated before that happens, the proposal is voided (the pot/headcount it was based on
// no longer holds) and somebody can fire a fresh one.

const GOLD = '#E8A23D';

export function chopStatus(chop, aliveIds, canAct) {
  if (chop && chop.withdrawn) return { kind: 'none', rejected: !!chop.rejected };
  if (!chop || !chop.eligibleIds) return { kind: 'none' };
  const votes = chop.votes || {};
  const accepted = chop.eligibleIds.every(id => votes[id]?.v === 'accept');
  if (accepted) return { kind: 'accepted' };
  if (canAct) {
    const alive = new Set(aliveIds);
    if (chop.eligibleIds.some(id => !alive.has(id))) return { kind: 'void' };
  }
  // A deal needs 100% approval, so a single rejection kills it on the spot.
  if (Object.values(votes).some(x => x?.v === 'reject')) return { kind: 'none', rejected: true };
  const acc = chop.eligibleIds.filter(id => votes[id]?.v === 'accept').length;
  return { kind: 'open', acc, waiting: chop.eligibleIds.length - acc, total: chop.eligibleIds.length };
}

function describe(c) {
  if (c.type === 'even') return `Split the pot evenly — each of the ${c.n} remaining players takes ${c.per.toLocaleString()} units.`;
  if (c.type === 'takeAndPlay') return `Each of the ${c.n} remaining players takes ${c.amount.toLocaleString()} units now, and the other ${c.rem.toLocaleString()} units stay in the pot for the last one standing.`;
  return 'Custom deal (see the note below).';
}

function winnerAmount(c) {
  if (c.type === 'even') return c.per;
  if (c.type === 'takeAndPlay') return c.amount;
  return null;
}

function safeGet(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
function safeSet(store, k, v) { try { window[store].setItem(k, v); } catch (e) { /* ignore */ } }

function Chest({ mode }) {
  // mode: 'idle' | 'alert' | 'sealed'
  const open = mode !== 'idle';
  const glowCol = mode === 'sealed' ? '#FFD65A' : '#FF3B30';
  return (
    <svg viewBox="0 0 200 150" width="150" height="112" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="chop-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A9692F" /><stop offset="1" stopColor="#6E4120" /></linearGradient>
        <linearGradient id="chop-wood-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C07C3A" /><stop offset="1" stopColor="#8A5426" /></linearGradient>
        <linearGradient id="chop-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFE07A" /><stop offset="1" stopColor="#C98A1B" /></linearGradient>
        <radialGradient id="chop-light" cx="0.5" cy="1" r="0.9"><stop offset="0" stopColor={glowCol} stopOpacity="0.95" /><stop offset="1" stopColor={glowCol} stopOpacity="0" /></radialGradient>
      </defs>
      {open && <ellipse cx="100" cy="64" rx="90" ry="48" fill="url(#chop-light)" />}
      {/* body */}
      <rect x="20" y="70" width="160" height="66" rx="7" fill="url(#chop-wood)" stroke="#40240F" strokeWidth="2" />
      <path d="M20,92 H180 M20,114 H180" stroke="#40240F" strokeWidth="1.5" opacity=".55" />
      <rect x="44" y="70" width="12" height="66" fill="url(#chop-gold)" stroke="#8A5E10" strokeWidth="1" />
      <rect x="144" y="70" width="12" height="66" fill="url(#chop-gold)" stroke="#8A5E10" strokeWidth="1" />
      {/* coins peeking out when open */}
      {open && (
        <g>
          <ellipse cx="70" cy="70" rx="10" ry="4" fill="url(#chop-gold)" />
          <ellipse cx="100" cy="68" rx="12" ry="5" fill="url(#chop-gold)" />
          <ellipse cx="130" cy="70" rx="10" ry="4" fill="url(#chop-gold)" />
        </g>
      )}
      {/* lid */}
      <g transform={open ? 'rotate(-16 24 70)' : undefined} style={{ transition: 'transform .3s' }}>
        <path d="M20,70 L20,50 Q20,14 100,14 Q180,14 180,50 L180,70 Z" fill="url(#chop-wood-lid)" stroke="#40240F" strokeWidth="2" />
        <path d="M30,44 Q100,20 170,44" stroke="#40240F" strokeWidth="1.5" fill="none" opacity=".4" />
        <rect x="44" y="18" width="12" height="52" fill="url(#chop-gold)" stroke="#8A5E10" strokeWidth="1" />
        <rect x="144" y="18" width="12" height="52" fill="url(#chop-gold)" stroke="#8A5E10" strokeWidth="1" />
      </g>
      {/* lock */}
      <rect x="88" y="62" width="24" height="26" rx="4" fill="url(#chop-gold)" stroke="#8A5E10" strokeWidth="1.5" />
      <circle cx="100" cy="72" r="3.5" fill="#40240F" />
      <rect x="98.5" y="73" width="3" height="8" rx="1" fill="#40240F" />
    </svg>
  );
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 120 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 3.5,
    dur: 3.2 + Math.random() * 3,
    size: 6 + Math.random() * 9,
    rot: Math.random() * 360,
    sway: (Math.random() - 0.5) * 160,
    color: ['#FFD65A', '#FF4D6D', '#3DDC97', '#4CC9F0', '#B388FF', '#FF9F1C', '#FFFFFF'][i % 7],
    round: i % 3 === 0,
  })), []);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <style>{`
        @keyframes chop-confetti { 0% { transform: translate3d(0,-12vh,0) rotate(0deg); opacity: 1; } 100% { transform: translate3d(var(--sway), 112vh, 0) rotate(var(--rot)); opacity: 1; } }
      `}</style>
      {pieces.map(p => (
        <span key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.5,
          background: p.color, borderRadius: p.round ? '50%' : 2,
          '--sway': `${p.sway}px`, '--rot': `${p.rot + 720}deg`,
          animation: `chop-confetti ${p.dur}s linear ${p.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

export default function ChopChest({ data, persist, aliveIds, myId, isAdmin, poolTotal, canAct, poolKey }) {
  const chop = data.chop;
  const status = chopStatus(chop, aliveIds, canAct);
  const n = aliveIds.length;
  const iAmAlive = !!(myId && aliveIds.includes(myId));
  const iAmEligible = !!(myId && chop && chop.eligibleIds && chop.eligibleIds.includes(myId));
  const myName = data.participants.find(p => p.id === myId)?.name || 'matey';

  const [modalOpen, setModalOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [fType, setFType] = useState('even');
  const [fAmount, setFAmount] = useState('');
  const [fNote, setFNote] = useState('');
  const [fError, setFError] = useState('');
  const [alertOpen, setAlertOpen] = useState(false);
  const [winOpen, setWinOpen] = useState(false);
  const alertedRef = useRef(null);

  const isProposer = !!(chop && myId && chop.proposerId === myId);
  const myVote = chop?.votes?.[myId]?.v || null;
  const needsAttention = status.kind === 'open' && canAct && iAmAlive && iAmEligible && !isProposer && !myVote;

  // Fun "ahoy" notification — once per proposal per browser session.
  useEffect(() => {
    if (!needsAttention || !chop) return;
    const key = `chop-alert-${poolKey}-${chop.id}`;
    if (alertedRef.current === chop.id || safeGet('sessionStorage', key)) return;
    alertedRef.current = chop.id;
    safeSet('sessionStorage', key, '1');
    setAlertOpen(true);
  }, [needsAttention, chop?.id, poolKey]);

  // Win celebration — once per device per accepted deal, for the players who were in it.
  useEffect(() => {
    if (status.kind !== 'accepted' || !iAmEligible) return;
    const key = `chop-win-${poolKey}-${chop.id}`;
    if (safeGet('localStorage', key)) return;
    setWinOpen(true);
  }, [status.kind, iAmEligible, chop?.id, poolKey]);

  const closeWin = () => {
    if (chop) safeSet('localStorage', `chop-win-${poolKey}-${chop.id}`, '1');
    setWinOpen(false);
  };

  const save = (next) => persist({ ...data, chop: next });

  const submitProposal = () => {
    setFError('');
    if (!iAmAlive || !canAct) return;
    const per = Math.floor(poolTotal / n);
    const base = { id: uid(), createdAt: Date.now(), round: (chop && !chop.withdrawn ? (chop.round || 1) + 1 : 1), n, pool: poolTotal, proposerId: myId, eligibleIds: [...aliveIds], note: fNote.trim(), votes: { [myId]: { v: 'accept', at: Date.now() } } };
    let c;
    if (fType === 'even') {
      c = { ...base, type: 'even', per, rem: poolTotal - per * n };
    } else if (fType === 'takeAndPlay') {
      const amt = Math.floor(Number(fAmount));
      if (!amt || amt < 1) { setFError('Enter how many units each player takes.'); return; }
      if (amt * n > poolTotal) { setFError(`That's more than the pot — ${n} players × ${amt} = ${(amt * n).toLocaleString()}, but the pot is ${poolTotal.toLocaleString()}.`); return; }
      c = { ...base, type: 'takeAndPlay', amount: amt, rem: poolTotal - amt * n };
    } else {
      if (!fNote.trim()) { setFError('Describe your deal in the note box.'); return; }
      c = { ...base, type: 'custom' };
    }
    save(c);
    setShowForm(false); setFAmount(''); setFNote('');
  };

  const vote = (v) => {
    if (!chop || !iAmEligible || !canAct) return;
    if (v === 'reject') {
      if (!window.confirm('Rejecting clears this proposal for everyone — a chop needs 100% approval. Reject it?')) return;
      save({ id: uid(), createdAt: Date.now(), withdrawn: true, rejected: true });
      return;
    }
    save({ ...chop, votes: { ...(chop.votes || {}), [myId]: { v, at: Date.now() } } });
  };

  const withdraw = () => {
    save({ id: uid(), createdAt: Date.now(), withdrawn: true });
    setModalOpen(false);
  };

  // Chest only appears when a chop is even possible (2+ alive) or a deal exists to show.
  if (n < 2 && status.kind !== 'accepted') return null;

  const mode = status.kind === 'accepted' ? 'sealed' : status.kind === 'open' ? 'alert' : 'idle';
  const glow = mode === 'alert' ? 'chop-glow-red' : mode === 'sealed' ? 'chop-glow-gold' : 'chop-glow-idle';
  const canPropose = canAct && iAmAlive && status.kind !== 'accepted';
  const wAmt = chop && status.kind === 'accepted' ? winnerAmount(chop) : null;

  const panel = { background: '#1F2B25', border: '1px solid #2A3830' };
  const inputStyle = { background: '#16201B', border: '1px solid #2A3830', color: '#F0EDE4' };

  return (
    <div>
      <style>{`
        @keyframes chop-pulse-red { 0%,100% { filter: drop-shadow(0 0 6px #ff2a2a) drop-shadow(0 0 14px #ff2a2a88); } 50% { filter: drop-shadow(0 0 18px #ff2a2a) drop-shadow(0 0 40px #ff2a2acc); } }
        @keyframes chop-pulse-gold { 0%,100% { filter: drop-shadow(0 0 6px #ffd65a) drop-shadow(0 0 14px #ffd65a88); } 50% { filter: drop-shadow(0 0 18px #ffd65a) drop-shadow(0 0 36px #ffd65acc); } }
        .chop-glow-red { animation: chop-pulse-red 1.1s ease-in-out infinite; }
        .chop-glow-gold { animation: chop-pulse-gold 1.8s ease-in-out infinite; }
        .chop-glow-idle { filter: drop-shadow(0 4px 8px rgba(0,0,0,.5)); }
        @keyframes chop-finger { 0%,100% { transform: translateX(0); } 50% { transform: translateX(12px); } }
        @keyframes chop-bounce { 0%,100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-14px) rotate(4deg); } }
        @keyframes chop-pop { 0% { transform: scale(.6); opacity: 0; } 70% { transform: scale(1.06); opacity: 1; } 100% { transform: scale(1); } }
        .chop-pop { animation: chop-pop .45s ease-out; }
      `}</style>

      <div className="flex items-center justify-center gap-2 sm:gap-4">
        {needsAttention && (
          <div className="flex items-center" style={{ animation: 'chop-finger 0.8s ease-in-out infinite' }}>
            <div className="font-head text-sm sm:text-base uppercase text-right leading-tight mr-1" style={{ color: '#FF8A80', textShadow: '0 0 10px #ff2a2a88', maxWidth: 110 }}>
              Check Proposal Here!
            </div>
            <div style={{ fontSize: 40, lineHeight: 1 }}>👉</div>
          </div>
        )}
        <button onClick={() => { setModalOpen(true); setShowForm(false); setFError(''); }} className="flex flex-col items-center" style={{ background: 'transparent' }} aria-label="Chop Proposal">
          <div className={glow}><Chest mode={mode} /></div>
          <div className="font-head uppercase tracking-wider text-sm px-4 py-1 rounded -mt-1" style={{ background: 'linear-gradient(180deg,#8A5426,#5E3716)', border: '2px solid #40240F', color: '#FFE9B8', boxShadow: '0 3px 8px rgba(0,0,0,.5)' }}>
            Chop Proposal
          </div>
          <div className="font-mono text-[10px] uppercase mt-1" style={{ color: mode === 'alert' ? '#FF8A80' : mode === 'sealed' ? '#FFD65A' : '#8A9A90' }}>
            {mode === 'alert' ? `Proposal on the table · ${status.acc}/${status.total} accepted` : mode === 'sealed' ? 'Deal locked in!' : 'Tap to propose a chop'}
          </div>
        </button>
      </div>

      {/* Main modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl p-5 chop-pop" style={{ ...panel, boxShadow: mode === 'alert' ? '0 0 40px #ff2a2a55' : '0 10px 40px rgba(0,0,0,.6)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div className="font-head uppercase text-lg tracking-wide" style={{ color: GOLD }}>🏴‍☠️ Chop Proposal</div>
              <button onClick={() => setModalOpen(false)} style={{ color: '#8A9A90' }}><X size={18} /></button>
            </div>

            {status.kind === 'none' && status.rejected && (
              <div className="font-mono text-xs px-3 py-2 rounded mb-3" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
                The last proposal was rejected, so it's been cleared. A chop needs 100% approval — anyone still alive can make a new one.
              </div>
            )}

            {status.kind === 'void' && (
              <div className="font-mono text-xs px-3 py-2 rounded mb-3" style={{ background: '#C1443A1a', border: '1px solid #C1443A44', color: '#E28A82' }}>
                A player was eliminated, so the last proposal was voided. Fire a new one!
              </div>
            )}

            {status.kind === 'accepted' && (
              <div>
                <div className="rounded-lg p-4 mb-3 text-center" style={{ background: '#FFD65A18', border: '1px solid #FFD65A66' }}>
                  <div className="font-head text-xl uppercase" style={{ color: '#FFD65A' }}>🎉 Chop locked in! 🎉</div>
                  <div className="text-sm mt-2" style={{ color: '#F0EDE4' }}>{describe(chop)}</div>
                  {chop.note && <div className="text-sm mt-2 italic" style={{ color: '#C9D3CC' }}>“{chop.note}”</div>}
                </div>
                <div className="font-mono text-[11px]" style={{ color: '#8A9A90' }}>Every remaining player accepted. The commissioner will handle payouts.</div>
                {isAdmin && (
                  <button onClick={withdraw} className="mt-3 font-mono text-[11px] uppercase underline" style={{ color: '#E28A82' }}>Admin: clear this deal and reopen chopping</button>
                )}
              </div>
            )}

            {status.kind === 'open' && !showForm && (
              <div>
                <div className="font-mono text-[10px] uppercase mb-1" style={{ color: '#8A9A90' }}>Anonymous proposal · Round {chop.round || 1}</div>
                <div className="rounded-lg p-4 mb-3" style={{ background: '#16201B', border: '1px solid #FF3B3055' }}>
                  <div className="text-sm" style={{ color: '#F0EDE4' }}>{describe(chop)}</div>
                  {chop.note && <div className="text-sm mt-2 italic" style={{ color: '#C9D3CC' }}>“{chop.note}”</div>}
                  <div className="font-mono text-[10px] mt-2" style={{ color: '#5C6862' }}>Pot at proposal: {chop.pool.toLocaleString()} units · {chop.n} players remaining</div>
                </div>
                <div className="flex gap-2 font-mono text-[11px] mb-3 flex-wrap">
                  <span className="px-2 py-1 rounded" style={{ background: '#3D9B5C22', color: '#7FCB98' }}>✓ {status.acc} accepted</span>
                  <span className="px-2 py-1 rounded" style={{ background: '#2A3830', color: '#8A9A90' }}>… {status.waiting} waiting</span>
                </div>
                <div className="font-mono text-[11px] mb-3" style={{ color: '#8A9A90' }}>It takes 100% of the remaining players to accept — one rejection clears it.</div>

                {!canAct && (
                  <div className="font-mono text-xs mb-2" style={{ color: '#E8A23D' }}>Switch to the current week to respond.</div>
                )}
                {canAct && !iAmEligible && (
                  <div className="font-mono text-xs mb-2" style={{ color: '#8A9A90' }}>Only players still alive in the pool can respond to a chop.</div>
                )}
                {canAct && iAmEligible && isProposer && (
                  <div className="font-mono text-xs mb-2" style={{ color: '#E8A23D' }}>This is your proposal — waiting on everyone else. You can counter your own offer, or withdraw it.</div>
                )}
                {canAct && iAmEligible && (
                  <div className="flex flex-col gap-2">
                    {!isProposer && (
                      <div className="flex gap-2">
                        <button onClick={() => vote('accept')} className="flex-1 py-2 rounded font-head uppercase text-sm flex items-center justify-center gap-1" style={{ background: myVote === 'accept' ? '#3D9B5C' : '#3D9B5C33', color: myVote === 'accept' ? '#0F1614' : '#7FCB98', border: '1px solid #3D9B5C' }}><Check size={15} /> Accept</button>
                        <button onClick={() => vote('reject')} className="flex-1 py-2 rounded font-head uppercase text-sm flex items-center justify-center gap-1" style={{ background: myVote === 'reject' ? '#C1443A' : '#C1443A33', color: myVote === 'reject' ? '#fff' : '#E28A82', border: '1px solid #C1443A' }}><Ban size={15} /> Reject</button>
                      </div>
                    )}
                    <button onClick={() => { setShowForm(true); setFError(''); }} className="py-2 rounded font-head uppercase text-sm flex items-center justify-center gap-1" style={{ background: '#E8A23D22', color: GOLD, border: `1px solid ${GOLD}` }}><Shuffle size={15} /> Counter with new offer</button>
                    {isProposer && (
                      <button onClick={withdraw} className="font-mono text-[11px] uppercase underline mt-1" style={{ color: '#E28A82' }}>Withdraw my proposal</button>
                    )}
                  </div>
                )}
                {isAdmin && !isProposer && (
                  <button onClick={withdraw} className="mt-3 font-mono text-[11px] uppercase underline" style={{ color: '#E28A82' }}>Admin: clear this proposal</button>
                )}
              </div>
            )}

            {(status.kind === 'none' || status.kind === 'void') && !showForm && (
              <div>
                <div className="text-sm mb-3" style={{ color: '#C9D3CC' }}>
                  Nobody has proposed a chop. Any player still alive can <b>anonymously</b> propose a way to share the pot — every remaining player has to accept for it to happen.
                </div>
                <div className="font-mono text-[11px] mb-3" style={{ color: '#8A9A90' }}>{n} players remaining · pot {poolTotal.toLocaleString()} units</div>
                {canPropose ? (
                  <button onClick={() => { setShowForm(true); setFError(''); }} className="w-full py-2 rounded font-head uppercase text-sm" style={{ background: GOLD, color: '#0F1614' }}>Make a proposal</button>
                ) : (
                  <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>
                    {!canAct ? 'Switch to the current week to propose.' : 'Only players still alive in the pool can propose a chop.'}
                  </div>
                )}
              </div>
            )}

            {showForm && (
              <div>
                <div className="font-mono text-[10px] uppercase mb-2" style={{ color: '#8A9A90' }}>{status.kind === 'open' ? 'Counter offer — replaces the current proposal and restarts the vote' : 'New proposal — your name is never shown'}</div>
                <div className="flex flex-col gap-1.5 mb-3">
                  {[
                    ['even', 'Split evenly', `Everyone takes ${Math.floor(poolTotal / n).toLocaleString()} units and the pool ends`],
                    ['takeAndPlay', 'Take X now, play for the rest', 'Everyone takes a set amount; the rest stays in the pot'],
                    ['custom', 'Custom deal', 'Describe your own terms'],
                  ].map(([k, t, d]) => (
                    <button key={k} onClick={() => setFType(k)} className="text-left px-3 py-2 rounded" style={{ background: fType === k ? '#E8A23D22' : '#16201B', border: `1px solid ${fType === k ? GOLD : '#2A3830'}` }}>
                      <div className="font-head text-sm" style={{ color: fType === k ? GOLD : '#F0EDE4' }}>{t}</div>
                      <div className="font-mono text-[10px]" style={{ color: '#8A9A90' }}>{d}</div>
                    </button>
                  ))}
                </div>
                {fType === 'takeAndPlay' && (
                  <div className="mb-3">
                    <input type="number" min="1" value={fAmount} onChange={e => setFAmount(e.target.value)} placeholder="Units each player takes now…" className="w-full px-3 py-2 rounded outline-none text-sm" style={inputStyle} />
                    {Number(fAmount) > 0 && Number(fAmount) * n <= poolTotal && (
                      <div className="font-mono text-[10px] mt-1" style={{ color: '#8A9A90' }}>{n} × {Math.floor(Number(fAmount))} = {(Math.floor(Number(fAmount)) * n).toLocaleString()} paid out · {(poolTotal - Math.floor(Number(fAmount)) * n).toLocaleString()} stays in the pot</div>
                    )}
                  </div>
                )}
                <textarea value={fNote} onChange={e => setFNote(e.target.value)} rows={3} maxLength={400} placeholder={fType === 'custom' ? 'Describe your deal…' : 'Optional note to the group…'} className="w-full px-3 py-2 rounded outline-none text-sm mb-2" style={inputStyle} />
                {fError && <div className="font-mono text-xs mb-2" style={{ color: '#E28A82' }}>{fError}</div>}
                <div className="flex gap-2">
                  <button onClick={submitProposal} className="flex-1 py-2 rounded font-head uppercase text-sm" style={{ background: GOLD, color: '#0F1614' }}>{status.kind === 'open' ? 'Send counter offer' : 'Throw it in the chest'}</button>
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded font-head uppercase text-sm" style={{ background: '#2A3830', color: '#C9D3CC' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* "Ahoy!" notification */}
      {alertOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(40,0,0,0.82)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 text-center chop-pop" style={{ background: 'linear-gradient(180deg,#2A1511,#1A0F0D)', border: '2px solid #FF3B30', boxShadow: '0 0 60px #ff2a2a88' }}>
            <div style={{ fontSize: 64, lineHeight: 1, display: 'inline-block', animation: 'chop-bounce 1s ease-in-out infinite' }}>💰</div>
            <div className="font-display text-3xl uppercase mt-2" style={{ color: '#FF8A80', fontFamily: "'Anton', sans-serif", letterSpacing: '0.04em' }}>Ahoy, {myName}!</div>
            <div className="font-head text-lg mt-2" style={{ color: '#FFE9B8' }}>A CHOP PROPOSAL just washed ashore! 🏴‍☠️</div>
            <div className="text-sm mt-2" style={{ color: '#C9D3CC' }}>Somebody has put a deal on the table and the crew needs <b>your</b> vote before anyone can sail off with the loot.</div>
            <button onClick={() => { setAlertOpen(false); setModalOpen(true); setShowForm(false); }} className="w-full mt-4 py-3 rounded-lg font-head uppercase text-base" style={{ background: 'linear-gradient(135deg,#FF6B5E,#E0281C)', color: '#fff', boxShadow: '0 0 20px #ff2a2a88' }}>Open the chest!</button>
            <button onClick={() => setAlertOpen(false)} className="mt-3 font-mono text-[11px] uppercase underline" style={{ color: '#8A9A90' }}>Later, I'm busy</button>
          </div>
        </div>
      )}

      {/* Win celebration */}
      {winOpen && chop && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(8,10,20,0.88)' }}>
          <Confetti />
          <div className="relative w-full max-w-sm rounded-2xl p-6 text-center chop-pop" style={{ background: 'linear-gradient(180deg,#2B2410,#16120A)', border: '2px solid #FFD65A', boxShadow: '0 0 70px #ffd65a88' }}>
            <div style={{ fontSize: 64, lineHeight: 1, display: 'inline-block', animation: 'chop-bounce 1s ease-in-out infinite' }}>🏆</div>
            <div className="font-display text-3xl uppercase mt-2" style={{ color: '#FFD65A', fontFamily: "'Anton', sans-serif", letterSpacing: '0.04em' }}>Congratulations!</div>
            {wAmt !== null ? (
              <>
                <div className="font-head text-lg mt-2" style={{ color: '#FFE9B8' }}>You've won</div>
                <div className="font-display text-5xl my-1" style={{ color: '#FFFFFF', fontFamily: "'Anton', sans-serif", textShadow: '0 0 20px #ffd65a' }}>{wAmt.toLocaleString()} units</div>
                <div className="text-sm" style={{ color: '#C9D3CC' }}>{chop.type === 'takeAndPlay' ? `The chop passed — you bank it now, and the last ${chop.rem.toLocaleString()} units are still up for grabs.` : 'Every remaining player accepted the chop!'}</div>
              </>
            ) : (
              <>
                <div className="font-head text-lg mt-2" style={{ color: '#FFE9B8' }}>Your chop deal passed!</div>
                <div className="text-sm mt-1 italic" style={{ color: '#C9D3CC' }}>“{chop.note}”</div>
              </>
            )}
            <div className="font-mono text-[11px] mt-3" style={{ color: '#8A9A90' }}>The commissioner will take care of payouts.</div>
            <button onClick={closeWin} className="w-full mt-4 py-3 rounded-lg font-head uppercase text-base" style={{ background: 'linear-gradient(135deg,#FFE07A,#E8A23D)', color: '#0F1614' }}>Let's go! 🎉</button>
          </div>
        </div>
      )}
    </div>
  );
}
