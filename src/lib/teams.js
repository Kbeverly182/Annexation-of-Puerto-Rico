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
export const ALL_WEEKS = [...PRESEASON_WEEKS, ...WEEKS];
export const ESPN_ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };

// Converts our internal (possibly preseason-encoded) week number into what ESPN's API expects.
export function toEspnWeek(week) {
  return week > 100 ? { seasontype: 1, week: week - 100 } : { seasontype: 2, week };
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
