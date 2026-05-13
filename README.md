# betpawa-cli

Read-only CLI for BetPawa Uganda sports data: games, fixtures, odds, and live results.

This tool only reads public sportsbook data from `https://www.betpawa.ug/`. It does not log in, place bets, create bet slips, deposit money, or automate account actions.

## Install

```bash
git clone <your-shared-repo-url> betpawa-cli
cd betpawa-cli
npm install -g .
```

For local development without a global install:

```bash
node ./bin/betpawa.js fixtures --sport football --limit 5
node ./bin/betpawa.js fixtures --sport football --country uk --date today --limit 5
```

## Commands

List supported games/sports:

```bash
betpawa games
```

Fixtures:

```bash
betpawa fixtures --sport football --limit 10
betpawa fixtures --sport tennis --live --limit 10
betpawa fixtures --sport football --country uk --date 2026-05-17 --limit 10
betpawa fixtures --sport football --country england --league "Premier League" --date today --stats
```

Odds:

```bash
betpawa odds --sport football --limit 5
betpawa odds --sport football --country uk --date tomorrow --stats --limit 5
betpawa event 34972637
```

Goal predictions:

```bash
betpawa predict-goals --country uk --date today --limit 20
betpawa predict-goals --date today
betpawa predict-goals --country england --league "Premier League" --date today --json
betpawa predict-goals --date today --min-goals 2 --min-confidence high
```

`predict-goals` is read-only. It ranks football fixtures by estimated total goals using BetPawa public fixture data, public event statistics where available, open historical CSV data from Football-Data.co.uk as a fallback, and goal-market odds as a supporting signal. By default it only returns high-confidence predictions with at least 2.0 expected goals. Country or league filters improve historical-data coverage.

When open historical data is available, the table includes two stronger model estimates:

- `DIXON`: time-decayed Dixon-Coles-style attack/defense Poisson estimate.
- `BAYES`: Bayesian-shrinkage attack/defense Poisson estimate.

The command prints statistical estimates only. Outcomes are uncertain and not guaranteed.

Leagues by country or date:

```bash
betpawa leagues --sport football --country uk
betpawa leagues --sport football --country uk --date today
```

Event Statistics:

```bash
betpawa stats 34972637
betpawa stats 34972637 --json
```

Statistics output includes reliable BetPawa-native event data plus Sportradar StatsHub metadata when BetPawa exposes it: availability, provider, match ID, StatsHub URL, scoreboard, native results, participants, and widgets. It does not scrape the full Sportradar HTML app.

Results/live scores:

```bash
betpawa results --limit 20
```

JSON output for Codex or scripts:

```bash
betpawa fixtures --sport football --limit 10 --json
betpawa fixtures --sport football --country uk --date today --stats --json
betpawa odds --sport football --limit 3 --json
betpawa results --json
betpawa predict-goals --country uk --date today --limit 10 --json
```

## Use In Codex

After installing globally with `npm install -g .`, ask Codex to run commands like:

```text
Run `betpawa fixtures --sport football --limit 10 --json` and summarize the next fixtures.
```

```text
Run `betpawa fixtures --sport football --country uk --date today --stats --json` and summarize fixtures with available statistics links.
```

```text
Run `betpawa odds --sport football --limit 5 --json` and show me the main 1X2 odds.
```

```text
Run `betpawa results --limit 20 --json` and summarize the live scores.
```

Codex can also run it directly from the repo:

```bash
node /Users/kazoobasimon/Code/betpawa-cli/bin/betpawa.js fixtures --sport football --limit 10 --json
```

Country/date examples:

```bash
node /Users/kazoobasimon/Code/betpawa-cli/bin/betpawa.js leagues --sport football --country uk
node /Users/kazoobasimon/Code/betpawa-cli/bin/betpawa.js fixtures --sport football --country uk --date today --stats --json
node /Users/kazoobasimon/Code/betpawa-cli/bin/betpawa.js odds --sport football --country england --league "Premier League" --date tomorrow --json
node /Users/kazoobasimon/Code/betpawa-cli/bin/betpawa.js predict-goals --country england --league "Premier League" --date today
```

## Configuration

Defaults are set for BetPawa Uganda. Override only if needed:

```bash
BETPAWA_BASE_URL=https://www.betpawa.ug betpawa fixtures
BETPAWA_BRAND=betpawa-uganda betpawa fixtures
BETPAWA_LANGUAGE=en betpawa fixtures
```

## Notes

- Output and odds depend on BetPawa's current public data.
- Use responsibly and follow BetPawa's terms and local laws.
- Requires Node.js 18 or newer.
