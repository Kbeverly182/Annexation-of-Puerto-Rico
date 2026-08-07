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
export const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);
export const ESPN_ABBR_FIX = { WSH: 'WAS', JAC: 'JAX' };
