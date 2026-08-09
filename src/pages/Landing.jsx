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
    <div style={{ background: '#0F1614', color: '#F0EDE4', minHeight: '100vh', fontFamily: "'Inter', sans-serif", position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .font-display { font-family: 'Anton', sans-serif; }
        .font-head { font-family: 'Oswald', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
      `}</style>

      {/* Background watermark logo — faded and off to the side so it never competes with the pool cards */}
      <img
        src="/logo.webp"
        alt=""
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: '50%',
          right: '-8%',
          transform: 'translateY(-50%)',
          width: 'min(75vw, 640px)',
          opacity: 0.1,
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ background: 'linear-gradient(180deg,#17211Dcc,#0F1614cc)', borderBottom: '1px solid #2A3830' }} className="px-5 py-8 sm:px-8">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            <img
              src="/logo.webp"
              alt="Grade A Beef Pools"
              className="shrink-0 w-16 h-16 rounded-lg object-cover"
              style={{ border: '2px solid #3D9B5C' }}
            />
            <div>
              <div className="font-display text-2xl uppercase tracking-wide">Grade A Beef Pools</div>
              <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>Pick your pool below</div>
            </div>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-8 space-y-3">
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
                  background: '#17211D',
                  border: '1px solid #2A3830',
                  opacity: pool.comingSoon ? 0.6 : 1,
                  cursor: pool.comingSoon ? 'default' : 'pointer',
                }}
              >
                <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${pool.color}22`, border: `2px solid ${pool.color}` }}>
                  <Icon size={18} color={pool.color} />
                </div>
                <div className="flex-1">
                  <div className="font-head text-lg uppercase tracking-wide flex items-center gap-2">
                    {pool.title}
                    {pool.comingSoon && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded uppercase" style={{ background: '#1F2B25', color: '#5C6862', border: '1px solid #2A3830' }}>
                        Coming soon
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wide mb-0.5" style={{ color: pool.color }}>{pool.type}</div>
                  <div className="font-mono text-xs" style={{ color: '#8A9A90' }}>{pool.desc}</div>
                </div>
              </Wrapper>
            );
          })}
        </div>
      </div>
    </div>
  );
}
