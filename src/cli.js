import { BetPawaClient, SPORTS } from "./api.js";
import { printFixtures, printJson, printOdds, printResults, printSports } from "./format.js";

const HELP = `betpawa - read-only BetPawa Uganda CLI

Usage:
  betpawa games [--json]
  betpawa fixtures [--sport football] [--limit 20] [--live] [--json]
  betpawa odds [--sport football] [--limit 10] [--markets 3] [--json]
  betpawa results [--limit 20] [--json]
  betpawa event <event-id> [--json]

Options:
  --sport <name>   football, basketball, tennis, efootball, special
  --limit <n>      number of rows to request
  --offset <n>     number of fixture rows to skip
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

  if (command === "fixtures") {
    const events = await client.listEvents({
      sport: flags.sport || "football",
      eventType: flags.live ? "LIVE" : "UPCOMING",
      limit: numberFlag(flags.limit, 20),
      offset: numberFlag(flags.offset, 0)
    });
    return flags.json ? printJson(events) : printFixtures(events);
  }

  if (command === "odds") {
    const events = await client.getEventsWithOdds({
      sport: flags.sport || "football",
      eventType: flags.live ? "LIVE" : "UPCOMING",
      limit: numberFlag(flags.limit, 10),
      detailLimit: numberFlag(flags.limit, 10),
      offset: numberFlag(flags.offset, 0)
    });
    return flags.json ? printJson(events) : printOdds(events, numberFlag(flags.markets, 3));
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
    if (["json", "live", "help"].includes(key)) {
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
