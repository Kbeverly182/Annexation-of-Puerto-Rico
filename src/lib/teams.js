export const TEAMS = [
  ['BUF', 'Buffalo Bills'], ['MIA', 'Miami Dolphins'], ['NE', 'New England Patriots'], ['NYJ', 'New York Jets'],
  ['BAL', 'Baltimore Ravens'], ['CIN', 'Cincinnati Bengals'], ['CLE', 'Cleveland Browns'], ['PIT', 'Pittsburgh Steelers'],
  ['HOU', 'Houston Texans'], ['IND', 'Indianapolis Colts'], ['JAX', 'Jacksonville Jaguars'], ['TEN', 'Tennessee Titans'],
  ['DEN', 'Denver Broncos'], ['KC', 'Kansas City Chiefs'], ['LV', 'Las Vegas Raiders'], ['LAC', 'Los Angeles Chargers'],
  ['DAL', 'Dallas Cowboys'], ['NYG', 'New York Giants'], ['PHI', 'Philadelphia Eagles'], ['WAS', 'Washington Commanders'],
  ['CHI', 'Chicago Bears'], ['DET', 'Detroit Lions'], ['GB', 'Green Bay Packers'], ['MIN', 'Minnesota Vikings'],
  ['ATL', 'Atlanta Falcons'], ['CAR', 'Carolina Panthers'], ['NO', 'New Orleans Saints'], ['TB', 'Tampa Bay Buccaneers'],
  ['ARI', 'Arizona Cardinals'], ['LAR', 'Los Angeles Rams'], ['SF', 'San Francisco 49ers'], ['SEA', 'Seattle Seahawks'],
];
export const TEAM_MAP = Object.fromEntries(TEAMS);
export const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1); // regular season, weeks 1-18
export const PRESEASON_WEEKS = [101, 102, 103]; // encoded so they never collide with regular season week numbers
// Regular season only — preseason beta-testing is over, so PRE1/PRE2/PRE3 no longer appear
// anywhere in the UI (week tabs, prev/next nav). PRESEASON_WEEKS and the date ranges below are
// kept around since toEspnWeek/weeksForSeason still reference them internally, but nothing
// public surfaces them now.
export const ALL_WEEKS = [...WEEKS];
export const ESPN_ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };

// ESPN's own preseason week numbering doesn't line up with these dates (its "week 1" includes
// the Hall of Fame Game, which is well before the 13th) — so preseason weeks are defined here by
// exact calendar date range instead, matching what was explicitly agreed on for this beta test.
export const PRESEASON_DATE_RANGES = {
  101: { start: '20260813', end: '20260819' }, // Preseason Week 1
  102: { start: '20260820', end: '20260826' }, // Preseason Week 2
  103: { start: '20260827', end: '20260908' }, // Preseason Week 3
};

// Converts our internal (possibly preseason-encoded) week number into what ESPN's API expects.
// Regular season weeks use ESPN's own week/seasontype params; preseason weeks use an explicit
// date range instead, since ESPN's preseason week numbers don't match the dates being used here.
export function toEspnWeek(week) {
  if (week > 100) {
    const range = PRESEASON_DATE_RANGES[week];
    return { seasontype: 1, dateRange: range ? `${range.start}-${range.end}` : null };
  }
  return { seasontype: 2, week };
}

export function isPreseasonWeek(week) {
  return week > 100;
}

export function weekLabel(week) {
  return week > 100 ? `PRE ${week - 100}` : String(week);
}

// The set of weeks that should count toward "the season" for a given week's context — keeps
// preseason beta-testing (elimination chains, used-player tracking, cumulative totals) entirely
// isolated from real regular-season data, so nothing carries over once the real season starts.
export function weeksForSeason(week) {
  return isPreseasonWeek(week) ? PRESEASON_WEEKS : WEEKS;
}
