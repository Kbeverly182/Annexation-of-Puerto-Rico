import React, { useState, useEffect } from 'react';

// Finds the next Sunday 1:00 PM America/New_York, computed robustly across the EST/EDT boundary
// via a small self-correcting loop (a fixed UTC-hour guess, checked and nudged until it lands
// exactly on 1pm ET on the right calendar day) rather than a naive fixed UTC-offset assumption,
// which would silently drift an hour wrong for half the year around each DST transition.
function nextKickoffTarget(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false,
    day: 'numeric', month: 'numeric', year: 'numeric',
  });
  const parts = fmt.formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  const weekday = get('weekday');
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const etDay = Number(get('day'));
  const etMonth = Number(get('month')) - 1;
  const etYear = Number(get('year'));
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday];

  // Days to add to the current ET calendar date to land on the right target Sunday — if it's
  // already Sunday and past 1pm, that means THIS Sunday's kickoff has passed, so roll to the one
  // a week out rather than showing an already-elapsed target.
  let daysUntilSunday;
  if (weekdayIndex === 0 && hour < 13) daysUntilSunday = 0;
  else if (weekdayIndex === 0) daysUntilSunday = 7;
  else daysUntilSunday = (7 - weekdayIndex) % 7;

  // Anchored on the ET calendar date of "now", not the UTC calendar date — otherwise a moment
  // that's already past midnight UTC but still "yesterday" in ET (or vice versa) throws the day
  // count off by one.
  const targetDate = new Date(Date.UTC(etYear, etMonth, etDay + daysUntilSunday));
  const targetDayUTC = targetDate.getUTCDate();
  const targetMonthUTC = targetDate.getUTCMonth();
  const targetYearUTC = targetDate.getUTCFullYear();

  let guess = new Date(Date.UTC(targetYearUTC, targetMonthUTC, targetDayUTC, 17, 0, 0));
  for (let i = 0; i < 4; i++) {
    const checkFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, day: 'numeric', month: 'numeric', year: 'numeric' });
    const p = checkFmt.formatToParts(guess);
    const g = (t) => Number(p.find(x => x.type === t).value);
    let gotHour = g('hour');
    if (gotHour === 24) gotHour = 0;
    const gotDay = g('day'), gotMonth = g('month') - 1, gotYear = g('year');
    if (gotHour === 13 && gotDay === targetDayUTC && gotMonth === targetMonthUTC && gotYear === targetYearUTC) break;
    const dayDiff = (Date.UTC(gotYear, gotMonth, gotDay) - Date.UTC(targetYearUTC, targetMonthUTC, targetDayUTC)) / 86400000;
    const hourDiff = 13 - gotHour;
    guess = new Date(guess.getTime() + hourDiff * 3600000 - dayDiff * 86400000);
  }
  return guess;
}

// True for the entire rest of that Sunday (ET) once 1pm has hit — not just the exact instant —
// so "It's Kick-off Time!" stays up through the whole slate of games rather than flashing for a
// moment and immediately switching to a countdown for next week.
function isInKickoffWindow(now) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday').value;
  let hour = Number(parts.find(p => p.type === 'hour').value);
  if (hour === 24) hour = 0;
  return weekday === 'Sun' && hour >= 13;
}

// Reusable across both the light landing page and the dark pool pages — pass colors to match
// whichever theme it's dropped into rather than hard-coding one look.
export default function KickoffCountdown({
  accent = '#E8A23D',
  background = '#1F2B25',
  border = '#2A3830',
  textColor = '#F0EDE4',
  mutedColor = '#8A9A90',
  className = '',
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nowDate = new Date(now);
  const kickoffNow = isInKickoffWindow(nowDate);

  if (kickoffNow) {
    return (
      <div
        className={`rounded px-4 py-2.5 flex items-center justify-center gap-2 font-head text-sm uppercase tracking-wide ${className}`}
        style={{ background: `${accent}22`, border: `1px solid ${accent}`, color: accent }}
      >
        🏈 It's Kick-off Time!
      </div>
    );
  }

  const target = nextKickoffTarget(nowDate);
  const diffMs = Math.max(0, target.getTime() - now);
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');

  return (
    <div
      className={`rounded px-4 py-2.5 flex items-center justify-center gap-2 font-mono text-xs ${className}`}
      style={{ background, border: `1px solid ${border}`, color: textColor }}
    >
      <span className="uppercase tracking-wide" style={{ color: mutedColor }}>Kickoff in</span>
      <span className="font-head text-sm tabular-nums" style={{ color: accent }}>
        {days > 0 && `${days}d `}{pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
    </div>
  );
}
