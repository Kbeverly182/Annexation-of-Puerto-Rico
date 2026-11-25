import React from 'react';
import { Link } from 'react-router-dom';
import { JONES_RULES } from '../lib/jonesRules';

// Landing page for The Jones League — completely separate from the Grade A Beef Pools landing page.
const C = { bg: '#0A1020', panel: '#121A30', line: '#25304F', gold: '#F2B138', cream: '#F4EFE2', muted: '#8B96B5', green: '#3FBF6A' };

export default function JonesLanding() {
  return (
    <div style={{ background: C.bg, color: C.cream, minHeight: '100vh' }}>
      <div style={{ background: 'linear-gradient(180deg,#16213F 0%,#0A1020 100%)', borderBottom: `3px solid ${C.gold}` }}>
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center gap-6">
          <img src="/jones-hero.jpg" alt="The Jones League" style={{ width: 'min(78vw, 300px)', aspectRatio: '4 / 5', objectFit: 'cover', objectPosition: '50% 8%', borderRadius: 16, border: `3px solid ${C.gold}`, boxShadow: '0 0 34px rgba(242,177,56,0.35)', flexShrink: 0 }} />
          <div className="text-center sm:text-left">
            <h1 style={{ fontFamily: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', fontSize: 'clamp(36px, 9vw, 60px)', letterSpacing: 2, color: C.gold, lineHeight: 1.05, textTransform: 'uppercase' }}>
              The Jones League
            </h1>
            <div style={{ color: C.muted, marginTop: 8, fontSize: 15 }}>The NFL playoffs fantasy league · 14 teams · best single game wins</div>
            <div className="flex flex-wrap justify-center sm:justify-start gap-3 mt-6">
              <Link to="/jones/league" style={{ background: C.gold, color: '#1A1205', padding: '12px 22px', borderRadius: 10, fontWeight: 800, textDecoration: 'none' }}>Enter the league →</Link>
              <Link to="/jones/beta" style={{ background: 'transparent', color: C.gold, padding: '12px 22px', borderRadius: 10, fontWeight: 800, textDecoration: 'none', border: `2px solid ${C.gold}` }}>🧪 Beta test league</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[['Starts', 'Jan 16'], ['Teams', '14'], ['Entry', '$40'], ['Waivers', 'Wed 3 AM ET']].map(([k, v]) => (
            <div key={k} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 6px' }}>
              <div style={{ color: C.muted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>{k}</div>
              <div style={{ color: C.gold, fontWeight: 800, fontSize: 20 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#1B2540', border: `1px solid ${C.gold}`, borderRadius: 10, padding: '12px 16px', fontSize: 14 }}>
          🧪 <b>Beta test:</b> until the playoffs start, the beta league runs the same rules on the last weeks of the regular season so we can make sure waivers, trades and scoring work. Nothing in the beta counts for money. To mimic the playoff field, the beta uses players from just 14 NFL teams — six Week 13 games among them plus the Raiders and Jets, who are on a bye that week (like the top seeds in the Wild Card round).
        </div>

        {JONES_RULES.map(sec => (
          <section key={sec.heading} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 18px' }}>
            <h2 style={{ color: C.gold, fontWeight: 800, fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{sec.heading}</h2>
            {sec.body.map((t, i) => <p key={i} style={{ color: C.cream, fontSize: 15, lineHeight: 1.55, marginTop: i ? 8 : 0 }}>{t}</p>)}
          </section>
        ))}

        <div className="text-center" style={{ color: C.muted, fontSize: 12, paddingBottom: 24 }}>The Jones League</div>
      </div>
    </div>
  );
}
