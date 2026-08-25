import React from 'react';
import { Link } from 'react-router-dom';
import { Skull, ListOrdered, Users } from 'lucide-react';

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
      `}</style>

      <div className="flex flex-col md:flex-row md:min-h-screen">
        {/* Pools column */}
        <div className="w-full md:w-96 shrink-0 px-5 sm:px-8 py-8 space-y-3 order-2 md:order-1" style={{ borderTop: '1px solid #E5E3DD' }}>
          <div className="mb-5">
            <div className="font-display text-xl uppercase tracking-wide">Grade A Beef Pools</div>
            <div className="font-mono text-xs" style={{ color: '#7A8580' }}>Pick your pool below</div>
          </div>
          {POOLS.map(pool => {
            const Icon = pool.icon;
            const Wrapper = pool.comingSoon ? 'div' : Link;
            const wrapperProps = pool.comingSoon ? {} : { to: pool.to };
            return (
              <Wrapper
                key={pool.to}
                {...wrapperProps}
                className="block rounded px-5 py-4 flex items-center gap-4"
                style={{
                  background: '#F7F6F3',
                  border: '1px solid #E5E3DD',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  opacity: pool.comingSoon ? 0.6 : 1,
                  cursor: pool.comingSoon ? 'default' : 'pointer',
                }}
              >
                <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${pool.color}1a`, border: `2px solid ${pool.color}` }}>
                  <Icon size={18} color={pool.color} />
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
