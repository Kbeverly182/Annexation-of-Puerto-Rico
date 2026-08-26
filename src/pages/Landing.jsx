import React from 'react';
import { Link } from 'react-router-dom';
import { Skull, ListOrdered, Users, ChevronRight } from 'lucide-react';

const POOLS = [
  {
    to: '/survivor',
    icon: Skull,
    title: 'The Annexation of Puerto Rico',
    type: 'NFL Survivor Pool',
    desc: 'Pick one team to win each week. Lose once and you\'re out.',
    color: '#3D9B5C',
  },
  {
    to: '/confidence',
    icon: ListOrdered,
    title: 'Confidence Pool',
    type: 'NFL Confidence Pool',
    desc: 'Pick every game, rank your confidence 1 to N, cumulative points all season.',
    color: '#E8A23D',
  },
  {
    to: '/lineup',
    icon: Users,
    title: 'Where\'s the Beef',
    type: 'Fantasy One-and-Done Pool',
    desc: 'Build a weekly fantasy lineup, no repeat players all season.',
    color: '#5C6862',
  },
];

export default function Landing() {
  return (
    <div style={{ background: '#F9F9F9', color: '#1C2823', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Baloo+2:wght@500;600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Baloo 2', sans-serif; font-weight: 700; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
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
          <div className="mb-6">
            <div className="font-display uppercase leading-none" style={{ fontSize: '30px', letterSpacing: '0.02em' }}>
              <span style={{ color: '#1C2823' }}>Grade A </span>
              <span style={{ color: '#1D4ED8', textShadow: '2px 2px 0 rgba(29,78,216,0.2)' }}>Beef Pools</span>
            </div>
            <div className="font-mono text-xs mt-1.5" style={{ color: '#7A8580' }}>Pick your pool below</div>
          </div>

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
    </div>
  );
}
