import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Skull, Flame, ListOrdered, Users, ChevronRight, Coins, Mail, Copy, Check, X, Loader2 } from 'lucide-react';
import { useAdminMode } from '../lib/admin';
import { apiGetPool } from '../lib/api';

const POOL_KEYS = ['survivor-pool-v1', 'revival-survivor-pool-v1', 'confidence-pool-v1', 'lineup-pool-v1'];

const POOLS = [
  {
    to: '/survivor',
    icon: Skull,
    title: 'The Annexation of Puerto Rico',
    type: 'NFL Survivor Pool',
    desc: 'Pick one team to win each week. Lose once and you\'re out.',
    color: '#3D9B5C',
    fee: 20,
  },
  {
    to: '/revival',
    icon: Flame,
    title: 'The Icebox',
    type: 'NFL Survivor Pool — Revival, starts Week 4',
    desc: 'Same rules as our Survivor pool, but a fresh, separate bracket kicking off at Week 4. New sign-ups only.',
    color: '#C1443A',
    fee: 20,
  },
  {
    to: '/confidence',
    icon: ListOrdered,
    title: 'Confidence Pool',
    type: 'NFL Confidence Pool',
    desc: 'Pick every game, rank your confidence 1 to N, cumulative points all season.',
    color: '#E8A23D',
    fee: 25,
  },
  {
    to: '/lineup',
    icon: Users,
    title: 'Where\'s the Beef',
    type: 'Fantasy One-and-Done Pool',
    desc: 'Build a weekly fantasy lineup, no repeat players all season.',
    color: '#5C6862',
    fee: 25,
  },
];

export default function Landing() {
  const { isAdmin, prompt: adminPrompt, setPrompt: setAdminPrompt, openPrompt: openAdminPrompt, submitPrompt: submitAdminPrompt, exitAdmin } = useAdminMode();
  const [emailModal, setEmailModal] = useState(null); // { label, emails: [] }
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const [pbOpen, setPbOpen] = useState(false); // flips on when the admin opens the Poultry Bowl
  const [pbTeaser, setPbTeaser] = useState(false); // admin has chosen to show the coming-soon teaser to everyone
  const [pbMsg, setPbMsg] = useState(false); // Poultry Bowl click message while it's still locked

  useEffect(() => {
    (async () => {
      try {
        const pb = await apiGetPool('poultry-bowl-v1');
        setPbOpen(!!pb?.open);
        setPbTeaser(!!pb?.showTeaser || !!pb?.open);
      } catch (e) { /* stay locked if we can't tell */ }
    })();
  }, []);

  // Pulls every pool's participant list and returns one deduplicated set of email addresses
  // across all three — someone entered in more than one pool with the same address only shows
  // up once.
  const buildAllMembersEmailList = async () => {
    setEmailLoading(true);
    setEmailError('');
    try {
      const pools = await Promise.all(POOL_KEYS.map(key => apiGetPool(key)));
      const seen = new Set();
      const emails = [];
      pools.forEach(pool => {
        (pool?.participants || []).forEach(p => {
          const email = (p.email || '').trim();
          if (!email) return;
          const key = email.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          emails.push(email);
        });
      });
      setEmailModal({ label: 'All members — every pool', emails });
    } catch (e) {
      setEmailError('Could not load one or more pools — try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  const copyEmails = () => {
    if (!emailModal) return;
    const text = emailModal.emails.join(', ');
    if (!navigator.clipboard) return; // text box below is still selectable/copyable by hand
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* non-fatal — text box below still works */ });
  };

  return (
    <div style={{ background: '#F9F9F9', color: '#1C2823', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }

        /* ---- Poultry Bowl feature ---- */
        .pb-text {
          font-family: 'Anton', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          line-height: 1.05;
          text-align: center;
          background: linear-gradient(100deg, #FFD54A 0%, #FFF6C2 22%, #FF8A00 42%, #FFE27A 60%, #FFFFFF 72%, #FFB300 85%, #FFD54A 100%);
          background-size: 250% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: pb-shimmer 2.8s linear infinite;
          filter: drop-shadow(0 2px 0 #7A2E00) drop-shadow(0 0 8px rgba(255,170,0,0.75));
        }
        @keyframes pb-shimmer { from { background-position: 250% 0; } to { background-position: -50% 0; } }
        .pb-sparkle {
          position: absolute;
          color: #FFE27A;
          text-shadow: 0 0 6px #FFB300, 0 0 12px #FF8A00;
          animation: pb-twinkle 1.6s ease-in-out infinite;
          pointer-events: none;
          line-height: 1;
        }
        @keyframes pb-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.15) rotate(35deg); }
        }
        .pb-arrow { animation: pb-bob 0.8s ease-in-out infinite; flex-shrink: 0; }
        @keyframes pb-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(7px); } }
        .pb-card {
          position: relative;
          display: block;
          width: 100%;
          padding: 0;
          border: 3px solid #E8A23D;
          border-radius: 10px;
          overflow: hidden;
          background: #1C2823;
          cursor: pointer;
          box-shadow: 0 0 0 2px #7A2E00, 0 6px 18px rgba(232,162,61,0.55);
          animation: pb-glow 2.2s ease-in-out infinite;
          transition: transform 0.15s ease;
        }
        .pb-card:hover { transform: scale(1.02) rotate(-0.6deg); }
        @keyframes pb-glow {
          0%, 100% { box-shadow: 0 0 0 2px #7A2E00, 0 6px 16px rgba(232,162,61,0.45); }
          50% { box-shadow: 0 0 0 2px #7A2E00, 0 6px 28px rgba(255,170,0,0.95); }
        }
        .pool-card {
          transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
          border-left-width: 5px !important;
        }
        .pool-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.12);
          border-color: var(--accent) !important;
        }
      `}</style>

      <div className="flex flex-col md:flex-row md:min-h-screen">
        {/* Pools column */}
        <div className="w-full md:w-96 shrink-0 px-5 sm:px-8 py-8 space-y-3 order-2 md:order-1" style={{ borderTop: '1px solid #E5E3DD' }}>
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <div className="font-display uppercase leading-none" style={{ fontSize: '30px', letterSpacing: '0.02em' }}>
                <span style={{ color: '#1C2823' }}>Grade A </span>
                <span style={{ color: '#1D4ED8', textShadow: '2px 2px 0 rgba(29,78,216,0.2)' }}>Beef Pools</span>
              </div>
              <div className="font-mono text-xs mt-1.5" style={{ color: '#7A8580' }}>Pick your pool below</div>
            </div>
            {isAdmin ? (
              <button onClick={exitAdmin} className="shrink-0 font-mono text-[10px] uppercase px-2 py-1 rounded" style={{ background: '#C1443A22', border: '1px solid #C1443A', color: '#C1443A' }}>
                Exit Admin
              </button>
            ) : (
              <button onClick={openAdminPrompt} className="shrink-0 font-mono text-[10px] uppercase underline" style={{ color: '#B5B0A5' }}>
                Admin
              </button>
            )}
          </div>

          {isAdmin && (
            <div className="rounded px-4 py-3 mb-6" style={{ background: '#1D4ED80d', border: '1px solid #1D4ED855' }}>
              <div className="font-head text-[11px] uppercase tracking-wide mb-2" style={{ color: '#1D4ED8' }}>Admin — Email members</div>
              <button
                onClick={buildAllMembersEmailList}
                disabled={emailLoading}
                className="font-mono text-xs px-3 py-1.5 rounded flex items-center gap-1.5"
                style={{ background: '#1D4ED8', color: '#FFFFFF', opacity: emailLoading ? 0.6 : 1 }}
              >
                {emailLoading ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                {emailLoading ? 'Loading…' : 'Email All Members (all 3 pools)'}
              </button>
              {emailError && <div className="font-mono text-[10px] mt-2" style={{ color: '#C1443A' }}>{emailError}</div>}
              <div className="font-mono text-[10px] mt-2" style={{ color: '#7A8580' }}>
                Want just one pool, or only people who haven't paid or haven't picked yet? Use the Admin section on that pool's own page instead.
              </div>
            </div>
          )}

          <div className="rounded px-5 py-4 mb-6 font-mono text-xs leading-relaxed" style={{ background: '#F7F6F3', border: '1px solid #E5E3DD', color: '#4A544E' }}>
            <p className="mb-3">
              Welcome to your one stop shop for my sports pools. Choose one or more of the pools below to enter. Rules for each pool are at the top of the individual pool pages. Payouts for each will be posted on the individual sites as well after entries close. No cuts taken, all proceeds go to the winners.
            </p>
            <p className="font-head text-[11px] uppercase tracking-wide mb-1" style={{ color: '#1C2823' }}>Send units to the following</p>
            <ul className="mb-3 space-y-0.5">
              <li><span style={{ color: '#1C2823', fontWeight: 600 }}>Venmo:</span> @kenny-beverly (last four 5522)</li>
              <li><span style={{ color: '#1C2823', fontWeight: 600 }}>PayPal:</span> Kenny.beverly@gmail.com</li>
              <li><span style={{ color: '#1C2823', fontWeight: 600 }}>Zelle:</span> Kenny.beverly@gmail.com or email me</li>
              <li><span style={{ color: '#1C2823', fontWeight: 600 }}>Check:</span> email me</li>
            </ul>
            <p className="font-head text-[11px] uppercase tracking-wide mb-1" style={{ color: '#1C2823' }}>My contact info for any questions</p>
            <p>Kenny Beverly<br />732-586-5522</p>
          </div>

          <div className="flex justify-end items-center gap-2 mb-6 pr-2">
            <svg width="44" height="26" viewBox="0 0 44 26" style={{ flexShrink: 0 }}>
              <line x1="2" y1="13" x2="28" y2="13" stroke="#E23D3D" strokeWidth="8" strokeLinecap="round" />
              <polygon points="24,2 42,13 24,24" fill="#E23D3D" />
            </svg>
            <a
              href="https://wug-derby-sports-4dv3.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="font-head"
              style={{ color: '#E23D3D', fontSize: '21px', textDecoration: 'underline', textUnderlineOffset: '3px' }}
            >
              Check out my brother's pool here!
            </a>
          </div>

          {/* THE POULTRY BOWL — Thanksgiving-week pool. Stays locked (clicking shows a note) until the
              admin ticks "Open the pool to everyone" on the Poultry Bowl page, then it links through. */}
          {(pbTeaser || isAdmin) && (
          <div className="mb-2">
            {isAdmin && !pbTeaser && (
              <div className="font-mono text-[10px] uppercase px-2 py-1 rounded mb-1" style={{ background: '#C1443A22', border: '1px solid #C1443A', color: '#C1443A' }}>Admin preview — the public can't see this yet</div>
            )}
            <div className="relative flex items-center justify-center gap-2 px-2 pt-3 pb-1">
              <span className="pb-sparkle" style={{ left: '4%', top: '2px', fontSize: '18px', animationDelay: '0s' }}>✦</span>
              <span className="pb-sparkle" style={{ left: '30%', top: '-4px', fontSize: '12px', animationDelay: '0.5s' }}>✦</span>
              <span className="pb-sparkle" style={{ right: '28%', top: '0px', fontSize: '15px', animationDelay: '1s' }}>✦</span>
              <span className="pb-sparkle" style={{ right: '3%', top: '6px', fontSize: '20px', animationDelay: '0.3s' }}>✦</span>
              <span className="pb-sparkle" style={{ left: '48%', bottom: '-2px', fontSize: '13px', animationDelay: '0.8s' }}>✦</span>
              <svg className="pb-arrow" width="34" height="44" viewBox="0 0 34 44">
                <rect x="11" y="2" width="12" height="22" rx="4" fill="#E23D3D" />
                <polygon points="2,22 32,22 17,42" fill="#E23D3D" />
              </svg>
              <div className="pb-text" style={{ fontSize: '27px' }}>
                Click here for<br />the Poultry Bowl!
              </div>
              <svg className="pb-arrow" width="34" height="44" viewBox="0 0 34 44" style={{ animationDelay: '0.4s' }}>
                <rect x="11" y="2" width="12" height="22" rx="4" fill="#E23D3D" />
                <polygon points="2,22 32,22 17,42" fill="#E23D3D" />
              </svg>
            </div>
            <button
              type="button"
              className="pb-card"
              onClick={() => { if (pbOpen) { navigate('/poultry'); return; } setPbMsg(true); setTimeout(() => setPbMsg(false), 5000); }}
              aria-label="The Poultry Bowl — Thanksgiving week pool (opening soon)"
            >
              <img src="/poultry-bowl.jpg" alt="A turkey in a football helmet carrying a football" style={{ display: 'block', width: '100%', height: 'auto' }} />
              <span className="font-mono uppercase" style={{ position: 'absolute', top: 8, right: 8, background: '#1C2823dd', color: '#FFE27A', border: '1px solid #E8A23D', borderRadius: 4, padding: '2px 8px', fontSize: 10, letterSpacing: '0.06em' }}>
                {pbOpen ? '🏈 Now open — tap to play!' : '🔒 Opening soon'}
              </span>
              <span className="font-mono uppercase" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, #000000cc)', color: '#FFFFFF', padding: '22px 10px 8px', fontSize: 11, letterSpacing: '0.05em', textAlign: 'center' }}>
                Thanksgiving Week · 5 games · Entry 20 units
              </span>
            </button>
            {pbMsg && (
              <div className="font-mono text-xs mt-2 px-3 py-2 rounded" style={{ background: '#FFF6DD', border: '1px solid #E8A23D', color: '#7A4A00' }}>
                🦃 Gobble gobble! The Poultry Bowl isn't open yet — Kenny is still cooking up the rules. Check back soon!
              </div>
            )}
          </div>
          )}

          {POOLS.map(pool => {
            const Icon = pool.icon;
            const Wrapper = pool.comingSoon ? 'div' : Link;
            const wrapperProps = pool.comingSoon ? {} : { to: pool.to };
            return (
              <Wrapper
                key={pool.to}
                {...wrapperProps}
                className="pool-card block rounded px-5 py-4 flex items-center gap-4"
                style={{
                  '--accent': pool.color,
                  background: `${pool.color}0d`,
                  border: '1px solid #E5E3DD',
                  borderLeft: `5px solid ${pool.color}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  opacity: pool.comingSoon ? 0.6 : 1,
                  cursor: pool.comingSoon ? 'default' : 'pointer',
                }}
              >
                <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center" style={{ background: pool.color, boxShadow: `0 3px 8px ${pool.color}66` }}>
                  <Icon size={20} color="#FFFFFF" />
                </div>
                <div className="flex-1">
                  <div className="font-head text-lg uppercase tracking-wide flex items-center gap-2">
                    {pool.title}
                    {pool.comingSoon && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded uppercase" style={{ background: '#EFEDE8', color: '#7A8580', border: '1px solid #E5E3DD' }}>
                        Coming soon
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wide mb-0.5" style={{ color: pool.color }}>{pool.type}</div>
                  <div className="font-mono text-xs" style={{ color: '#7A8580' }}>{pool.desc}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wide mt-1.5 flex items-center gap-1" style={{ color: pool.color }}>
                    <Coins size={11} /> Entry Fee: {pool.fee} units
                  </div>
                </div>
                {!pool.comingSoon && <ChevronRight size={18} className="shrink-0" color={pool.color} />}
              </Wrapper>
            );
          })}
        </div>

        {/* Logo — the focal visual */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10 order-1 md:order-2" style={{ background: '#F9F9F9' }}>
          <img
            src="/logo.png"
            alt="Grade A Beef Pools"
            className="w-full object-contain"
            style={{ maxWidth: '520px', maxHeight: '80vh' }}
          />
        </div>
      </div>

      {adminPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: '#1C2823cc' }}>
          <div className="w-full max-w-sm rounded p-5" style={{ background: '#FFFFFF', border: '1px solid #E5E3DD' }}>
            <div className="font-head text-sm uppercase tracking-wide mb-2" style={{ color: '#1C2823' }}>
              {adminPrompt.mode === 'set' ? 'Set the admin PIN' : 'Enter admin PIN'}
            </div>
            <div className="font-mono text-xs mb-3" style={{ color: '#7A8580' }}>
              {adminPrompt.mode === 'set'
                ? 'This PIN unlocks admin mode across all three pools — lets you edit any pick even after it locks. Set once, use everywhere.'
                : 'Same PIN you use on Survivor, Confidence, and Lineup.'}
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                inputMode="numeric"
                maxLength={8}
                value={adminPrompt.input}
                onChange={e => setAdminPrompt(p => ({ ...p, input: e.target.value.replace(/\D/g, '').slice(0, 8), error: '' }))}
                onKeyDown={e => e.key === 'Enter' && submitAdminPrompt()}
                placeholder="••••"
                className="w-24 px-2 py-1.5 rounded font-mono text-sm tracking-widest text-center"
                style={{ background: '#F7F6F3', border: '1px solid #E5E3DD', color: '#1C2823' }}
              />
              <button onClick={submitAdminPrompt} className="px-3 py-1.5 rounded font-head text-xs uppercase tracking-wide" style={{ background: '#1D4ED8', color: '#FFFFFF' }}>
                {adminPrompt.mode === 'set' ? 'Set PIN' : 'Unlock'}
              </button>
              <button onClick={() => setAdminPrompt(null)} className="font-mono text-xs underline" style={{ color: '#7A8580' }}>Cancel</button>
            </div>
            {adminPrompt.error && <div className="font-mono text-xs mt-1.5" style={{ color: '#C1443A' }}>{adminPrompt.error}</div>}
          </div>
        </div>
      )}

      {emailModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0" style={{ background: '#1C2823cc' }} onClick={() => setEmailModal(null)}>
          <div className="w-full max-w-lg rounded flex flex-col" style={{ background: '#FFFFFF', border: '1px solid #E5E3DD', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E5E3DD' }}>
              <div>
                <div className="font-head text-sm uppercase tracking-wide" style={{ color: '#1C2823' }}>{emailModal.label}</div>
                <div className="font-mono text-[10px]" style={{ color: '#7A8580' }}>{emailModal.emails.length} email address{emailModal.emails.length === 1 ? '' : 'es'}</div>
              </div>
              <button onClick={() => setEmailModal(null)} style={{ color: '#7A8580' }}><X size={20} /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">
              {emailModal.emails.length === 0 ? (
                <div className="font-mono text-xs" style={{ color: '#7A8580' }}>No matching email addresses found.</div>
              ) : (
                <>
                  <textarea
                    readOnly
                    value={emailModal.emails.join(', ')}
                    onFocus={e => e.target.select()}
                    rows={6}
                    className="w-full px-3 py-2 rounded font-mono text-xs resize-none"
                    style={{ background: '#F7F6F3', border: '1px solid #E5E3DD', color: '#1C2823' }}
                  />
                  <button
                    onClick={copyEmails}
                    className="mt-3 px-4 py-2 rounded font-head text-sm uppercase tracking-wide flex items-center gap-1.5"
                    style={{ background: copied ? '#3D9B5C' : '#1D4ED8', color: '#FFFFFF' }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                  <div className="font-mono text-[10px] mt-2" style={{ color: '#7A8580' }}>
                    Paste this directly into Gmail's "To" field — it's already comma-separated.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
