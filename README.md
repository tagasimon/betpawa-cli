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
```

Odds:

```bash
betpawa odds --sport football --limit 5
betpawa event 34972637
```

Results/live scores:

```bash
betpawa results --limit 20
```

JSON output for Codex or scripts:

```bash
betpawa fixtures --sport football --limit 10 --json
betpawa odds --sport football --limit 3 --json
betpawa results --json
```

## Use In Codex

After installing globally with `npm install -g .`, ask Codex to run commands like:

```text
Run `betpawa fixtures --sport football --limit 10 --json` and summarize the next fixtures.
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
