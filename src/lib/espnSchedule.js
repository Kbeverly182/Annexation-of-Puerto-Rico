import { useState, useEffect, useCallback } from 'react';
import { ESPN_ABBR_FIX, toEspnWeek } from './teams';

export function useEspnSchedule(week, seasonYear) {
  const [schedule, setSchedule] = useState({});

  useEffect(() => { setSchedule({}); }, [seasonYear]);

  const ensureSchedule = useCallback(async (wk) => {
    setSchedule(prev => {
      if (prev[wk]?.loaded || prev[wk]?.loading) return prev;
      return { ...prev, [wk]: { loading: true } };
    });
    try {
      const { seasontype, week: espnWeek } = toEspnWeek(wk);
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${espnWeek}&seasontype=${seasontype}&dates=${seasonYear}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('bad response');
      const json = await res.json();
      const teamKickoff = {};
      const matchups = {};
      const games = [];
      const kickoffTimes = [];
      (json.events || []).forEach(ev => {
        const comp = ev.competitions?.[0];
        const dateStr = comp?.date || ev.date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        const competitors = comp.competitors || [];
        competitors.forEach(c => {
          const rawAbbr = c.team?.abbreviation;
          const abbr = ESPN_ABBR_FIX[rawAbbr] || rawAbbr;
          if (abbr) teamKickoff[abbr] = dateStr;
        });
        if (competitors.length === 2) {
          const recordOf = (c) => (c.records || []).find(r => r.type === 'total')?.summary
            || (c.records || [])[0]?.summary || '0-0';
          const [a, b] = competitors;
          const abbrA = ESPN_ABBR_FIX[a.team?.abbreviation] || a.team?.abbreviation;
          const abbrB = ESPN_ABBR_FIX[b.team?.abbreviation] || b.team?.abbreviation;
          const recA = recordOf(a);
          const recB = recordOf(b);
          if (abbrA) matchups[abbrA] = { opponent: abbrB, home: a.homeAway === 'home', record: recA, oppRecord: recB };
          if (abbrB) matchups[abbrB] = { opponent: abbrA, home: b.homeAway === 'home', record: recB, oppRecord: recA };
          const away = a.homeAway === 'home' ? b : a;
          const home = a.homeAway === 'home' ? a : b;
          const awayAbbr = ESPN_ABBR_FIX[away.team?.abbreviation] || away.team?.abbreviation;
          const homeAbbr = ESPN_ABBR_FIX[home.team?.abbreviation] || home.team?.abbreviation;
          games.push({
            id: ev.id || `${awayAbbr}-${homeAbbr}`,
            kickoff: dateStr,
            completed: !!comp?.status?.type?.completed,
            away: { abbr: awayAbbr, record: recordOf(away), score: away.score, winner: !!away.winner },
            home: { abbr: homeAbbr, record: recordOf(home), score: home.score, winner: !!home.winner },
          });
        }
        const etHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d));
        kickoffTimes.push({ date: d, etHour });
      });
      games.sort((x, y) => new Date(x.kickoff) - new Date(y.kickoff));
      const windowGames = kickoffTimes.filter(k => k.etHour >= 12).sort((a, b) => a.date - b.date);
      const massThreshold = windowGames.length
        ? windowGames[0].date.toISOString()
        : (kickoffTimes.length ? kickoffTimes.sort((a, b) => a.date - b.date)[0].date.toISOString() : null);
      setSchedule(prev => ({ ...prev, [wk]: { loading: false, loaded: true, teamKickoff, matchups, games, massThreshold } }));
    } catch (e) {
      setSchedule(prev => ({ ...prev, [wk]: { loading: false, loaded: true, teamKickoff: {}, matchups: {}, games: [], massThreshold: null, error: true } }));
    }
  }, [seasonYear]);

  useEffect(() => { ensureSchedule(week); }, [week, seasonYear, ensureSchedule]);

  const lockTimeForPick = useCallback((wk, team) => {
    const sch = schedule[wk];
    if (!sch || !sch.loaded) return null;
    const mass = sch.massThreshold ? new Date(sch.massThreshold).getTime() : null;
    const teamTime = team && sch.teamKickoff[team] ? new Date(sch.teamKickoff[team]).getTime() : null;
    if (teamTime && mass) return Math.min(teamTime, mass);
    return teamTime ?? mass;
  }, [schedule]);

  return { schedule, ensureSchedule, lockTimeForPick };
}

// Determine the winning team abbreviation (or 'TIE') for each completed game in a week.
// Used by both Survivor (win/loss per pick) and Confidence (correct/incorrect per game) pools.
// Also detects the week's final (latest-kickoff) game — used as the Monday Night tiebreaker —
// and returns its combined score once that specific game is final.
export async function fetchWeekResults(week, seasonYear) {
  const { seasontype, week: espnWeek } = toEspnWeek(week);
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${espnWeek}&seasontype=${seasontype}&dates=${seasonYear}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('bad response');
  const json = await res.json();
  const results = {}; // teamAbbr -> 'win' | 'loss'
  const gameResults = {}; // gameId -> { winnerAbbr: string|null (null = tie), completed: bool }
  let completedGames = 0;
  let latestGame = null; // { date, completed, total }
  (json.events || []).forEach(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return;
    const dateStr = comp.date || ev.date;
    const d = dateStr ? new Date(dateStr) : null;
    const competitors = comp.competitors || [];
    if (d && (!latestGame || d > latestGame.date) && competitors.length === 2) {
      const total = competitors.reduce((sum, c) => sum + (Number(c.score) || 0), 0);
      latestGame = { date: d, completed: !!comp.status?.type?.completed, total };
    }
    if (!comp.status?.type?.completed) return;
    completedGames++;
    const isTie = competitors.length === 2 && Number(competitors[0].score) === Number(competitors[1].score);
    let winnerAbbr = null;
    competitors.forEach(c => {
      const rawAbbr = c.team?.abbreviation;
      const abbr = ESPN_ABBR_FIX[rawAbbr] || rawAbbr;
      if (!abbr) return;
      results[abbr] = isTie ? 'win' : (c.winner ? 'win' : 'loss');
      if (!isTie && c.winner) winnerAbbr = abbr;
    });
    gameResults[ev.id] = { winnerAbbr: isTie ? null : winnerAbbr, completed: true };
  });
  const mnf = latestGame && latestGame.completed ? latestGame.total : null;
  return { results, gameResults, completedGames, mnfTotal: mnf };
}
