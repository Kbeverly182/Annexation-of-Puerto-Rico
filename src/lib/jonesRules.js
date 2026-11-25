// The Jones League rules, as text, shown on the landing page and the Rules tab. (Edit here to change both.)
export const JONES_RULES = [
  {
    heading: 'Your roster',
    body: ['8 spots: QB, RB, RB, WR, WR, TE, K, D/ST. There is no bench.'],
  },
  {
    heading: 'Scoring (full points — no decimals)',
    body: [
      '1 point for every 10 yards rushing or receiving. 1 point for every 25 yards passing. Each type is rounded down on its own, so 29 rushing yards + 55 receiving yards = 2 + 5 = 7 points, not 8.',
      '6 points for every touchdown. 2 points for a 2-point conversion (passing, rushing or receiving).',
      '−1 for each interception thrown. −1 for each lost fumble.',
      'Kickers: 3 points for a field goal under 40 yards, 4 for 40–49 yards, 5 for 50+ yards, and 1 for each extra point.',
      'D/ST: 10 points for a shutout (zero points allowed — once a team scores on the defense this drops to zero), 6 for a defensive or special-teams touchdown, 2 for a safety, 2 for each interception and each fumble recovery, and 1 for each sack.',
    ],
  },
  {
    heading: 'Points do NOT add up across the playoffs',
    body: [
      'Each position scores its best single game while the player was on your roster. If Josh Allen scores 26 in round one and 24 in round two, your QB total is 26 — not 50.',
      'For RB and WR (two spots each) it is your two best different players. If Davante Adams scores 18 and Parker Washington scores 5 in round one and they repeat it in round two, you cannot use Adams’ 18 in both spots — it is still 18 and 5.',
      'Your team total is the sum of all eight positions. The highest team total after the Super Bowl wins.',
    ],
  },
  {
    heading: 'Waivers — every Wednesday',
    body: [
      'Waivers are processed Wednesday at 3:00 AM ET. Any player who was not drafted, or who was dropped, can be claimed. Every claim is an add + a drop of the same position (rosters have exact spots).',
      'You can queue as many claims as you like and rank them. The lowest score picks first, then the next lowest, and so on. Each pass through the order, every team gets one successful claim (its highest-ranked claim that is still available), and passes repeat until everyone’s claims are used up.',
      'Because some teams are on a bye in the first round, “lowest score” is measured as points per player who has played, so the order is fair. Ties go to the team with fewer players played, then to the league’s tiebreak order.',
    ],
  },
  {
    heading: 'Trades',
    body: [
      'Trades open right after the last game of the week and stay open until the next round kicks off. One team offers, the other accepts or declines. Both teams must send the same number of players at each position.',
      'No trade may have a contingency — the trade is at face value. No money can be offered and no post-trade agreements can be made.',
    ],
  },
  {
    heading: 'Money',
    body: ['$40 per team. Payouts are approximately 65% / 20% / 10% (the actual payouts are set before the draft based on the number of teams).'],
  },
];
