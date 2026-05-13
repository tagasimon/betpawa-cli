const FOOTBALL_DATA_BASE_URL = "https://www.football-data.co.uk/mmz4281";
const TEAM_MATCH_LIMIT = 30;
const SEASONS_TO_FETCH = 3;

const LEAGUES = [
  { country: "england", league: "premier league", code: "E0", aliases: ["english premier league", "premiership"] },
  { country: "england", league: "championship", code: "E1", aliases: ["efl championship"] },
  { country: "england", league: "league one", code: "E2", aliases: ["efl league one"] },
  { country: "england", league: "league two", code: "E3", aliases: ["efl league two"] },
  { country: "scotland", league: "premiership", code: "SC0", aliases: ["scottish premiership"] },
  { country: "germany", league: "bundesliga", code: "D1", aliases: ["1 bundesliga"] },
  { country: "germany", league: "2 bundesliga", code: "D2", aliases: ["bundesliga 2"] },
  { country: "italy", league: "serie a", code: "I1", aliases: [] },
  { country: "italy", league: "serie b", code: "I2", aliases: [] },
  { country: "spain", league: "la liga", code: "SP1", aliases: ["laliga", "primera division"] },
  { country: "spain", league: "segunda division", code: "SP2", aliases: ["la liga 2"] },
  { country: "france", league: "ligue 1", code: "F1", aliases: [] },
  { country: "france", league: "ligue 2", code: "F2", aliases: [] },
  { country: "netherlands", league: "eredivisie", code: "N1", aliases: [] },
  { country: "belgium", league: "jupiler league", code: "B1", aliases: ["pro league", "first division a"] },
  { country: "portugal", league: "primeira liga", code: "P1", aliases: ["liga portugal"] },
  { country: "turkey", league: "super lig", code: "T1", aliases: ["super league"] },
  { country: "greece", league: "super league", code: "G1", aliases: ["super league 1"] }
];

export async function fetchOpenHistoricalStats(event, {
  cache,
  country,
  league,
  date = "today",
  seasons = seasonCodesForDate(date)
} = {}) {
  const resolved = resolveFootballDataLeague({ event, country, league });
  if (!resolved) {
    return {
      source: { method: "open-football-data", provider: "football-data.co.uk", cacheHit: false },
      teams: [],
      h2h: null,
      league: null,
      warnings: ["no Football-Data league mapping for fixture"]
    };
  }

  const seasonPayloads = await Promise.all(seasons.map((season) => fetchFootballDataCsv(resolved.code, season, cache)));
  const rows = seasonPayloads.flatMap((payload) => payload.rows);
  const completed = rows
    .filter((row) => isCompletedMatch(row))
    .filter((row) => isBeforeFixture(row, event.startTime));
  const stats = buildOpenHistoricalStats(event, completed);
  const warnings = [
    ...seasonPayloads.flatMap((payload) => payload.warning ? [payload.warning] : []),
    ...stats.warnings
  ];

  return {
    source: {
      method: "open-football-data",
      provider: "football-data.co.uk",
      code: resolved.code,
      seasons,
      cacheHit: seasonPayloads.every((payload) => payload.cacheHit)
    },
    teams: stats.teams,
    h2h: stats.h2h,
    league: stats.league,
    models: stats.models,
    warnings
  };
}

export function resolveFootballDataLeague({ event, country, league } = {}) {
  const countryKey = normalize(country || event?.region?.name);
  const leagueKey = normalize(league || event?.competition?.name);
  return LEAGUES.find((entry) => {
    if (countryKey && normalize(entry.country) !== countryKey) {
      return false;
    }
    const names = [entry.league, ...(entry.aliases || [])].map(normalize);
    return names.some((name) => leagueKey === name || leagueKey.includes(name) || name.includes(leagueKey));
  }) || null;
}

export async function fetchFootballDataCsv(code, season, cache) {
  const key = `${season}-${code}`;
  const cached = cache ? await cache.read("football-data", key) : null;
  if (cached) {
    return { rows: cached.rows || [], cacheHit: true };
  }

  const url = `${FOOTBALL_DATA_BASE_URL}/${season}/${code}.csv`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv,*/*",
        "User-Agent": "betpawa-cli/0.1"
      }
    });
    if (!response.ok) {
      return { rows: [], cacheHit: false, warning: `Football-Data ${code} ${season} returned ${response.status}` };
    }
    const rows = parseCsv(await response.text());
    if (cache) {
      await cache.write("football-data", key, { url, rows });
    }
    return { rows, cacheHit: false };
  } catch (error) {
    return { rows: [], cacheHit: false, warning: `Football-Data fetch failed for ${code} ${season}: ${error.message}` };
  }
}

export function buildOpenHistoricalStats(event, rows) {
  const [home, away] = event.participants || [];
  const homeName = resolveCsvTeamName(home?.name, rows);
  const awayName = resolveCsvTeamName(away?.name, rows);
  const warnings = [];

  if (!homeName || !awayName) {
    return {
      teams: [],
      h2h: null,
      league: leagueStats(rows),
      warnings: ["could not match fixture teams to Football-Data names"]
    };
  }

  const homeStats = teamStats(home?.name, homeName, rows);
  const awayStats = teamStats(away?.name, awayName, rows);
  const h2h = h2hStats(homeName, awayName, rows);
  const models = advancedGoalModels(rows, homeName, awayName, event.startTime);

  return {
    teams: [homeStats, awayStats],
    h2h,
    league: leagueStats(rows),
    models,
    warnings
  };
}

export function advancedGoalModels(rows, homeName, awayName, fixtureStartTime) {
  const completed = rows.filter(isCompletedMatch).filter((row) => isBeforeFixture(row, fixtureStartTime));
  return {
    dixonColes: dixonColesEstimate(completed, homeName, awayName, fixtureStartTime),
    bayesian: bayesianEstimate(completed, homeName, awayName)
  };
}

export function seasonCodesForDate(value = "today", now = new Date()) {
  const date = resolveDate(value, now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return Array.from({ length: SEASONS_TO_FETCH }, (_, index) => {
    const seasonStart = startYear - index;
    return `${String(seasonStart).slice(-2)}${String(seasonStart + 1).slice(-2)}`;
  });
}

export function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index + 1] === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function teamStats(displayName, csvName, rows) {
  const matches = rows
    .filter((row) => row.HomeTeam === csvName || row.AwayTeam === csvName)
    .sort((left, right) => matchDate(right) - matchDate(left))
    .slice(0, TEAM_MATCH_LIMIT);
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const row of matches) {
    const homeGoals = Number(row.FTHG);
    const awayGoals = Number(row.FTAG);
    if (row.HomeTeam === csvName) {
      goalsFor += homeGoals;
      goalsAgainst += awayGoals;
    } else {
      goalsFor += awayGoals;
      goalsAgainst += homeGoals;
    }
  }
  return {
    name: displayName,
    openDataName: csvName,
    matches: matches.length,
    scoredPerMatch: perMatch(goalsFor, matches.length),
    concededPerMatch: perMatch(goalsAgainst, matches.length),
    totalGoalsPerMatch: perMatch(goalsFor + goalsAgainst, matches.length)
  };
}

function h2hStats(homeName, awayName, rows) {
  const matches = rows
    .filter((row) => {
      return (row.HomeTeam === homeName && row.AwayTeam === awayName)
        || (row.HomeTeam === awayName && row.AwayTeam === homeName);
    })
    .sort((left, right) => matchDate(right) - matchDate(left))
    .slice(0, 10);
  if (!matches.length) {
    return null;
  }
  const goals = matches.reduce((sum, row) => sum + Number(row.FTHG) + Number(row.FTAG), 0);
  return {
    matches: matches.length,
    totalGoalsPerMatch: perMatch(goals, matches.length)
  };
}

function leagueStats(rows) {
  const completed = rows.filter(isCompletedMatch);
  if (!completed.length) {
    return null;
  }
  const goals = completed.reduce((sum, row) => sum + Number(row.FTHG) + Number(row.FTAG), 0);
  return {
    matches: completed.length,
    totalGoalsPerMatch: perMatch(goals, completed.length)
  };
}

function dixonColesEstimate(rows, homeName, awayName, fixtureStartTime) {
  const referenceDate = fixtureStartTime ? new Date(fixtureStartTime) : new Date();
  const league = weightedLeagueStats(rows, referenceDate);
  const homeHome = weightedTeamVenueStats(rows, homeName, "home", referenceDate);
  const awayAway = weightedTeamVenueStats(rows, awayName, "away", referenceDate);
  if (!league || !homeHome || !awayAway) {
    return null;
  }

  const homeAttack = shrinkRatio(homeHome.scoredPerMatch / league.homeGoalsPerMatch, homeHome.effectiveMatches, 10);
  const homeDefense = shrinkRatio(homeHome.concededPerMatch / league.awayGoalsPerMatch, homeHome.effectiveMatches, 10);
  const awayAttack = shrinkRatio(awayAway.scoredPerMatch / league.awayGoalsPerMatch, awayAway.effectiveMatches, 10);
  const awayDefense = shrinkRatio(awayAway.concededPerMatch / league.homeGoalsPerMatch, awayAway.effectiveMatches, 10);
  const homeGoals = league.homeGoalsPerMatch * homeAttack * awayDefense;
  const awayGoals = league.awayGoalsPerMatch * awayAttack * homeDefense;

  return {
    method: "time-decayed Dixon-Coles-style attack/defense Poisson",
    homeGoals: round(homeGoals, 2),
    awayGoals: round(awayGoals, 2),
    totalGoals: round(homeGoals + awayGoals, 2),
    inputs: {
      halfLifeDays: 180,
      leagueHomeGoals: round(league.homeGoalsPerMatch, 2),
      leagueAwayGoals: round(league.awayGoalsPerMatch, 2),
      homeEffectiveMatches: round(homeHome.effectiveMatches, 1),
      awayEffectiveMatches: round(awayAway.effectiveMatches, 1)
    }
  };
}

function bayesianEstimate(rows, homeName, awayName) {
  const league = leagueVenueStats(rows);
  const homeHome = teamVenueStats(rows, homeName, "home");
  const awayAway = teamVenueStats(rows, awayName, "away");
  if (!league || !homeHome || !awayAway) {
    return null;
  }

  const priorMatches = 8;
  const homeAttackRate = posteriorRate(homeHome.goalsFor, homeHome.matches, league.homeGoalsPerMatch, priorMatches);
  const homeDefenseRate = posteriorRate(homeHome.goalsAgainst, homeHome.matches, league.awayGoalsPerMatch, priorMatches);
  const awayAttackRate = posteriorRate(awayAway.goalsFor, awayAway.matches, league.awayGoalsPerMatch, priorMatches);
  const awayDefenseRate = posteriorRate(awayAway.goalsAgainst, awayAway.matches, league.homeGoalsPerMatch, priorMatches);
  const homeGoals = league.homeGoalsPerMatch * (homeAttackRate / league.homeGoalsPerMatch) * (awayDefenseRate / league.homeGoalsPerMatch);
  const awayGoals = league.awayGoalsPerMatch * (awayAttackRate / league.awayGoalsPerMatch) * (homeDefenseRate / league.awayGoalsPerMatch);

  return {
    method: "Bayesian shrinkage attack/defense Poisson",
    homeGoals: round(homeGoals, 2),
    awayGoals: round(awayGoals, 2),
    totalGoals: round(homeGoals + awayGoals, 2),
    inputs: {
      priorMatches,
      leagueHomeGoals: round(league.homeGoalsPerMatch, 2),
      leagueAwayGoals: round(league.awayGoalsPerMatch, 2),
      homeMatches: homeHome.matches,
      awayMatches: awayAway.matches
    }
  };
}

function weightedLeagueStats(rows, referenceDate) {
  let weight = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  for (const row of rows) {
    const rowWeight = timeDecayWeight(matchDate(row), referenceDate);
    weight += rowWeight;
    homeGoals += Number(row.FTHG) * rowWeight;
    awayGoals += Number(row.FTAG) * rowWeight;
  }
  if (!weight) {
    return null;
  }
  return {
    homeGoalsPerMatch: homeGoals / weight,
    awayGoalsPerMatch: awayGoals / weight
  };
}

function weightedTeamVenueStats(rows, teamName, venue, referenceDate) {
  let weight = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const row of rows) {
    const isHome = row.HomeTeam === teamName;
    const isAway = row.AwayTeam === teamName;
    if ((venue === "home" && !isHome) || (venue === "away" && !isAway)) {
      continue;
    }
    const rowWeight = timeDecayWeight(matchDate(row), referenceDate);
    weight += rowWeight;
    goalsFor += Number(isHome ? row.FTHG : row.FTAG) * rowWeight;
    goalsAgainst += Number(isHome ? row.FTAG : row.FTHG) * rowWeight;
  }
  if (!weight) {
    return null;
  }
  return {
    effectiveMatches: weight,
    scoredPerMatch: goalsFor / weight,
    concededPerMatch: goalsAgainst / weight
  };
}

function leagueVenueStats(rows) {
  const completed = rows.filter(isCompletedMatch);
  if (!completed.length) {
    return null;
  }
  const homeGoals = completed.reduce((sum, row) => sum + Number(row.FTHG), 0);
  const awayGoals = completed.reduce((sum, row) => sum + Number(row.FTAG), 0);
  return {
    homeGoalsPerMatch: homeGoals / completed.length,
    awayGoalsPerMatch: awayGoals / completed.length
  };
}

function teamVenueStats(rows, teamName, venue) {
  const matches = rows
    .filter((row) => venue === "home" ? row.HomeTeam === teamName : row.AwayTeam === teamName)
    .sort((left, right) => matchDate(right) - matchDate(left))
    .slice(0, TEAM_MATCH_LIMIT);
  if (!matches.length) {
    return null;
  }
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const row of matches) {
    const isHome = row.HomeTeam === teamName;
    goalsFor += Number(isHome ? row.FTHG : row.FTAG);
    goalsAgainst += Number(isHome ? row.FTAG : row.FTHG);
  }
  return {
    matches: matches.length,
    goalsFor,
    goalsAgainst
  };
}

function posteriorRate(goals, matches, priorRate, priorMatches) {
  return (goals + priorRate * priorMatches) / (matches + priorMatches);
}

function shrinkRatio(ratio, sample, priorMatches) {
  if (!Number.isFinite(ratio)) {
    return 1;
  }
  const weight = sample / (sample + priorMatches);
  return 1 + (ratio - 1) * weight;
}

function timeDecayWeight(date, referenceDate) {
  const ageDays = Math.max(0, (referenceDate.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  return 0.5 ** (ageDays / 180);
}

function resolveCsvTeamName(name, rows) {
  const teams = [...new Set(rows.flatMap((row) => [row.HomeTeam, row.AwayTeam]).filter(Boolean))];
  const wanted = normalizeTeam(name);
  let best = null;
  for (const team of teams) {
    const score = teamSimilarity(wanted, normalizeTeam(team));
    if (!best || score > best.score) {
      best = { team, score };
    }
  }
  return best?.score >= 0.72 ? best.team : null;
}

function teamSimilarity(left, right) {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.9;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function normalizeTeam(value) {
  return normalize(value)
    .replace(/\b(fc|afc|cf|sc|women|wfc|u19|u21|u23|club)\b/g, " ")
    .replace(/\bmanchester\b/g, "man")
    .replace(/\bunited\b/g, "utd")
    .replace(/\bnottingham\b/g, "nottm")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCompletedMatch(row) {
  return Number.isFinite(Number(row.FTHG)) && Number.isFinite(Number(row.FTAG));
}

function isBeforeFixture(row, startTime) {
  if (!startTime) {
    return true;
  }
  const date = matchDate(row);
  if (!Number.isFinite(date.getTime())) {
    return true;
  }
  return date.getTime() < new Date(startTime).getTime();
}

function matchDate(row) {
  const [day, month, year] = String(row.Date || "").split("/").map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  return new Date(Date.UTC(fullYear, month - 1, day));
}

function resolveDate(value, now) {
  if (!value || value === "today") {
    return now;
  }
  if (value === "tomorrow") {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T00:00:00Z`);
  }
  return now;
}

function perMatch(total, matches) {
  if (!matches) {
    return null;
  }
  return Math.round((total / matches) * 100) / 100;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
