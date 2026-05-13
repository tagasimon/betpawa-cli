export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function printSports(sports) {
  const rows = Object.entries(sports).map(([key, sport]) => ({
    key,
    id: sport.id,
    name: sport.name
  }));
  printTable(rows, ["key", "id", "name"]);
}

export function printLeagues(leagues, { showDate = false } = {}) {
  const rows = leagues.map((entry) => ({
    region: entry.region?.name || "",
    id: entry.competition?.id || "",
    league: entry.competition?.name || "",
    upcoming: showDate ? entry.dayCount?.upcoming || "0" : entry.eventCounts?.upcoming || "0",
    hot: showDate ? entry.dayCount?.hot || "0" : entry.eventCounts?.hot || "0"
  }));
  printTable(rows, ["region", "id", "league", "upcoming", "hot"]);
}

export function printFixtures(events, { showStats = false } = {}) {
  const rows = events.map((event) => ({
    id: event.id,
    time: formatDate(event.startTime),
    sport: event.category?.name || "",
    competition: joinParts([event.region?.name, event.competition?.name], " / "),
    game: event.name,
    markets: event.totalMarketCount ?? "",
    stats: formatStats(event.statistics)
  }));
  printTable(rows, ["id", "time", "sport", "competition", "game", "markets", ...(showStats ? ["stats"] : [])]);
}

export function printOdds(events, marketLimit = 3, { showStats = false } = {}) {
  const rows = events.flatMap((event) => {
    const markets = (event.markets || []).slice(0, marketLimit);
    return markets.flatMap((market) => {
      const selections = flattenSelections(market)
        .slice(0, 12)
        .map((selection) => `${formatSelectionName(selection)} ${selection.price}`)
        .join(" | ");

      return {
        id: event.id,
        time: formatDate(event.startTime),
        game: event.name,
        market: market.marketType?.displayName || market.marketType?.name || "",
        odds: selections,
        stats: formatStats(event.statistics)
      };
    });
  });
  printTable(rows, ["id", "time", "game", "market", "odds", ...(showStats ? ["stats"] : [])]);
}

export function printResults(results, eventsById = new Map()) {
  const rows = (results.items || []).map((item) => {
    const event = eventsById.get(item.id);
    const scores = scoreBySide(item.results);
    const period = item.results?.display?.currentPeriod?.name || "";
    const minute = item.results?.display?.minute;

    return {
      id: item.id,
      game: event?.name || "",
      status: minute ? `${period} ${minute}'` : period,
      score: formatScore(scores)
    };
  });
  printTable(rows, ["id", "game", "status", "score"]);
}

export function printGoalPredictions(payload) {
  const rows = (payload.predictions || []).map((prediction) => ({
    rank: prediction.rank,
    time: formatDate(prediction.startTime),
    fixture: prediction.fixture,
    competition: prediction.competition,
    xGoals: prediction.expectedGoals.toFixed(1),
    dixon: formatModelGoals(prediction.model?.estimates?.dixonColes),
    bayes: formatModelGoals(prediction.model?.estimates?.bayesian),
    confidence: prediction.confidence
  }));
  printTable(rows, ["rank", "time", "fixture", "competition", "xGoals", "dixon", "bayes", "confidence"]);
  console.log("Note: goal estimates are statistical and uncertain; outcomes are not guaranteed.");
  if (payload.summary?.fallback) {
    console.log(`No fixtures met the strict filters, so showing the best lower-confidence predictions instead.`);
  }
  if (payload.filtered?.length) {
    console.log(`Filtered ${payload.filtered.length} lower-confidence or under-threshold fixture(s).`);
  }
  if (payload.skipped?.length) {
    console.log(`Skipped ${payload.skipped.length} fixture(s) without enough historical data.`);
  }
}

export function printEventStats(statsPayload) {
  const { event, statistics } = statsPayload;
  const rows = [{
    id: event?.id || "",
    game: event?.name || "",
    competition: joinParts([event?.region?.name, event?.competition?.name], " / "),
    available: statistics?.available ? "yes" : "no",
    provider: statistics?.provider || "",
    match: statistics?.matchId || "",
    url: statistics?.url || ""
  }];
  printTable(rows, ["id", "game", "competition", "available", "provider", "match", "url"]);

  const score = formatScore(scoreBySide(statistics?.results));
  if (score) {
    console.log(`Score: ${score}`);
  }
}

export function flattenSelections(market) {
  return (market.row || []).flatMap((row) => {
    return (row.prices || []).map((price) => ({
      ...price,
      rowHandicap: row.formattedHandicap || row.handicap || price.handicap || ""
    }));
  });
}

export function scoreBySide(results) {
  const sides = { HOME: "", AWAY: "" };
  const participantResults = results?.participantPeriodResults || [];
  for (const participantResult of participantResults) {
    const side = participantResult.participant?.type;
    const fullTime = (participantResult.periodResults || []).find((entry) => {
      return entry.period?.slug === "FULL_TIME_EXCLUDING_OVERTIME";
    });
    if (side && fullTime) {
      sides[side] = fullTime.result;
    }
  }
  return sides;
}

export function printTable(rows, columns) {
  if (!rows.length) {
    console.log("No data found.");
    return;
  }

  const widths = Object.fromEntries(columns.map((column) => {
    const width = Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length));
    return [column, Math.min(width, maxColumnWidth(column))];
  }));

  const header = columns.map((column) => pad(column.toUpperCase(), widths[column])).join("  ");
  const divider = columns.map((column) => "-".repeat(widths[column])).join("  ");
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    console.log(columns.map((column) => pad(truncate(row[column] ?? "", widths[column]), widths[column])).join("  "));
  }
}

function maxColumnWidth(column) {
  if (column === "url") {
    return 96;
  }
  if (column === "odds" || column === "game") {
    return 72;
  }
  if (column === "fixture") {
    return 64;
  }
  if (column === "competition" || column === "league" || column === "stats") {
    return 48;
  }
  return 32;
}

function formatSelectionName(selection) {
  const handicap = selection.rowHandicap && !String(selection.name).includes(String(selection.rowHandicap))
    ? ` ${selection.rowHandicap}`
    : "";
  return `${selection.displayName || selection.name}${handicap}`.trim();
}

function formatScore(scores) {
  if (!scores.HOME && !scores.AWAY) {
    return "";
  }
  return `${scores.HOME || "0"}-${scores.AWAY || "0"}`;
}

function formatStats(statistics) {
  if (!statistics) {
    return "";
  }
  if (statistics.available) {
    return `${statistics.provider} ${statistics.matchId}`;
  }
  if (statistics.matchId) {
    return `${statistics.provider} ${statistics.matchId} (live)`;
  }
  return "none";
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-UG", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: process.env.TZ || "Africa/Kampala"
  }).format(new Date(value));
}

function formatModelGoals(model) {
  return Number.isFinite(model?.totalGoals) ? model.totalGoals.toFixed(1) : "";
}

function joinParts(parts, separator) {
  return parts.filter(Boolean).join(separator);
}

function pad(value, width) {
  return truncate(String(value), width).padEnd(width, " ");
}

function truncate(value, width) {
  const text = String(value);
  if (text.length <= width) {
    return text;
  }
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
