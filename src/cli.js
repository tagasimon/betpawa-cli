import { BetPawaClient, SPORTS } from "./api.js";
import { printEventStats, printFixtures, printJson, printLeagues, printOdds, printResults, printSports } from "./format.js";

const HELP = `betpawa - read-only BetPawa Uganda CLI

Usage:
  betpawa games [--json]
  betpawa leagues [--sport football] [--country uk] [--date today] [--json]
  betpawa fixtures [--sport football] [--country uk] [--league "Premier League"] [--date today] [--limit 20] [--live] [--stats] [--json]
  betpawa odds [--sport football] [--country uk] [--league "Premier League"] [--date today] [--limit 10] [--markets 3] [--stats] [--json]
  betpawa results [--limit 20] [--json]
  betpawa event <event-id> [--json]
  betpawa stats <event-id> [--json]

Options:
  --sport <name>   football, basketball, tennis, efootball, special
  --country <name> country/region filter, e.g. uk, england, scotland
  --league <name>  league/competition filter, e.g. "Premier League"
  --date <date>    YYYY-MM-DD, today, or tomorrow
  --limit <n>      number of rows to request
  --offset <n>     number of fixture rows to skip
  --stats          include Event Statistics metadata and summary
  --live           use live events instead of upcoming events
  --json           print raw JSON
  --base-url <url> override https://www.betpawa.ug

Environment:
  BETPAWA_BASE_URL, BETPAWA_BRAND, BETPAWA_LANGUAGE
`;

export async function run(argv) {
  const { command, positionals, flags } = parseArgs(argv);
  const client = new BetPawaClient({ baseUrl: flags.baseUrl });

  if (!command || flags.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (command === "games") {
    return flags.json ? printJson(SPORTS) : printSports(SPORTS);
  }

  if (command === "leagues") {
    const leagues = await client.listLeagues({
      sport: flags.sport || "football",
      country: flags.country,
      date: flags.date
    });
    return flags.json ? printJson(leagues) : printLeagues(leagues, { showDate: Boolean(flags.date) });
  }

  if (command === "fixtures") {
    let events = await client.listEvents({
      sport: flags.sport || "football",
      eventType: flags.live ? "LIVE" : "UPCOMING",
      limit: numberFlag(flags.limit, 20),
      offset: numberFlag(flags.offset, 0),
      country: flags.country,
      league: flags.league,
      date: flags.date
    });
    if (flags.stats) {
      events = await client.addStatisticsForEvents(events);
    }
    return flags.json ? printJson(events) : printFixtures(events, { showStats: flags.stats });
  }

  if (command === "odds") {
    let events = await client.getEventsWithOdds({
      sport: flags.sport || "football",
      eventType: flags.live ? "LIVE" : "UPCOMING",
      limit: numberFlag(flags.limit, 10),
      detailLimit: numberFlag(flags.limit, 10),
      offset: numberFlag(flags.offset, 0),
      country: flags.country,
      league: flags.league,
      date: flags.date
    });
    if (flags.stats) {
      events = client.addStatistics(events);
    }
    return flags.json ? printJson(events) : printOdds(events, numberFlag(flags.markets, 3), { showStats: flags.stats });
  }

  if (command === "results") {
    const results = await client.getResults();
    const limited = {
      ...results,
      items: (results.items || []).slice(0, numberFlag(flags.limit, 20))
    };
    return flags.json ? printJson(limited) : printResults(limited);
  }

  if (command === "event") {
    const event = await client.getEvent(positionals[0]);
    return flags.json ? printJson(event) : printOdds([event], numberFlag(flags.markets, 10));
  }

  if (command === "stats") {
    const stats = await client.getEventStats(positionals[0]);
    return flags.json ? printJson(stats) : printEventStats(stats);
  }

  throw new Error(`unknown command "${command}". Run "betpawa help".`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = toCamel(rawKey);
    if (["json", "live", "help", "stats"].includes(key)) {
      flags[key] = true;
      continue;
    }

    const next = inlineValue ?? rest[index + 1];
    if (next === undefined || String(next).startsWith("--")) {
      throw new Error(`missing value for --${rawKey}`);
    }
    flags[key] = next;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return { command, positionals, flags };
}

function numberFlag(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`expected a positive number, got "${value}"`);
  }
  return parsed;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
