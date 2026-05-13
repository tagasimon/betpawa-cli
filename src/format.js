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

export function printFixtures(events) {
  const rows = events.map((event) => ({
    id: event.id,
    time: formatDate(event.startTime),
    sport: event.category?.name || "",
    competition: joinParts([event.region?.name, event.competition?.name], " / "),
    game: event.name,
    markets: event.totalMarketCount ?? ""
  }));
  printTable(rows, ["id", "time", "sport", "competition", "game", "markets"]);
}

export function printOdds(events, marketLimit = 3) {
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
        odds: selections
      };
    });
  });
  printTable(rows, ["id", "time", "game", "market", "odds"]);
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
    return [column, Math.min(width, column === "odds" || column === "game" ? 72 : 32)];
  }));

  const header = columns.map((column) => pad(column.toUpperCase(), widths[column])).join("  ");
  const divider = columns.map((column) => "-".repeat(widths[column])).join("  ");
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    console.log(columns.map((column) => pad(truncate(row[column] ?? "", widths[column]), widths[column])).join("  "));
  }
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
