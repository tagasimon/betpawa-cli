import { DailyCache } from "./cache.js";
import { fetchOpenHistoricalStats } from "./open-data.js";
import { fetchHistoricalStats } from "./stats.js";

export const MIN_TEAM_MATCHES = 10;
export const DEFAULT_MIN_CONFIDENCE = "high";
export const DEFAULT_MIN_EXPECTED_GOALS = 2;

export async function predictGoals({
  client,
  sport = "football",
  country,
  league,
  date = "today",
  limit = 20,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  minExpectedGoals = DEFAULT_MIN_EXPECTED_GOALS,
  cache = new DailyCache(),
  useBrowser = true,
  statsFetcher = fetchHistoricalStats,
  openStatsFetcher = fetchOpenHistoricalStats
} = {}) {
  if (sport !== "football") {
    throw new Error("predict-goals currently supports football only");
  }

  const events = await client.getEventsWithOdds({
    sport,
    eventType: "UPCOMING",
    limit,
    detailLimit: limit,
    country,
    league,
    date
  });

  const predictions = [];
  const skipped = [];
  const filtered = [];

  for (const event of events) {
    let historical = await statsFetcher(event, {
      baseUrl: client.baseUrl,
      cache,
      useBrowser
    });
    if (!hasPredictionInputs(event, historical)) {
      const openHistorical = await openStatsFetcher(event, {
        cache,
        country,
        league,
        date
      });
      if (hasPredictionInputs(event, openHistorical)) {
        historical = mergeHistoricalSources(historical, openHistorical);
      } else {
        historical = mergeHistoricalWarnings(historical, openHistorical);
      }
    }
    const prediction = buildGoalPrediction(event, historical, { allowOddsOnly: !country && !league });
    if (prediction.skipped) {
      skipped.push(prediction.skipped);
    } else if (!passesPredictionFilters(prediction, { minConfidence, minExpectedGoals })) {
      filtered.push({
        ...prediction,
        filterReason: filterReason(prediction, { minConfidence, minExpectedGoals })
      });
    } else {
      predictions.push(prediction);
    }
  }

  const fallback = predictions.length === 0 && filtered.length > 0;
  const displayedPredictions = fallback ? filtered : predictions;
  displayedPredictions.sort(sortPredictions);
  displayedPredictions.forEach((prediction, index) => {
    prediction.rank = index + 1;
  });

  return {
    date,
    filters: {
      sport,
      country: country || null,
      league: league || null,
      limit,
      minConfidence,
      minExpectedGoals
    },
    predictions: displayedPredictions,
    skipped,
    filtered: fallback ? [] : filtered.map(toFilteredSummary),
    summary: {
      requested: limit,
      fixtures: events.length,
      predicted: displayedPredictions.length,
      skipped: skipped.length,
      filtered: filtered.length,
      fallback,
      averageExpectedGoals: displayedPredictions.length
        ? round(displayedPredictions.reduce((sum, prediction) => sum + prediction.expectedGoals, 0) / displayedPredictions.length, 2)
        : null
    }
  };
}

function sortPredictions(left, right) {
  return confidenceRank(right.confidence) - confidenceRank(left.confidence)
    || right.expectedGoals - left.expectedGoals;
}

function toFilteredSummary(prediction) {
  return {
    id: prediction.id,
    fixture: prediction.fixture,
    startTime: prediction.startTime,
    competition: prediction.competition,
    expectedGoals: prediction.expectedGoals,
    confidence: prediction.confidence,
    reason: prediction.filterReason
  };
}

export function passesPredictionFilters(prediction, { minConfidence = DEFAULT_MIN_CONFIDENCE, minExpectedGoals = DEFAULT_MIN_EXPECTED_GOALS } = {}) {
  return confidenceRank(prediction.confidence) >= confidenceRank(minConfidence)
    && prediction.expectedGoals >= minExpectedGoals;
}

export function hasPredictionInputs(event, historical, minTeamMatches = MIN_TEAM_MATCHES) {
  const teams = historical?.teams || [];
  const [home, away] = event.participants || [];
  const homeStats = findTeamStats(teams, home?.name);
  const awayStats = findTeamStats(teams, away?.name);
  return Boolean(homeStats && awayStats
    && homeStats.matches >= minTeamMatches
    && awayStats.matches >= minTeamMatches
    && Number.isFinite(homeStats.scoredPerMatch)
    && Number.isFinite(homeStats.concededPerMatch)
    && Number.isFinite(awayStats.scoredPerMatch)
    && Number.isFinite(awayStats.concededPerMatch));
}

export function buildGoalPrediction(event, historical, { minTeamMatches = MIN_TEAM_MATCHES, allowOddsOnly = false } = {}) {
  const teams = historical?.teams || [];
  const [home, away] = event.participants || [];
  const homeStats = findTeamStats(teams, home?.name);
  const awayStats = findTeamStats(teams, away?.name);
  const warnings = [...(historical?.warnings || [])];
  const odds = estimateGoalsFromOdds(event);

  if (!homeStats || !awayStats) {
    if (allowOddsOnly && odds.expectedGoals) {
      return buildOddsOnlyPrediction(event, historical, odds, minTeamMatches, warnings);
    }
    return skipped(event, "missing historical team statistics", historical);
  }
  if (homeStats.matches < minTeamMatches || awayStats.matches < minTeamMatches) {
    if (allowOddsOnly && odds.expectedGoals) {
      return buildOddsOnlyPrediction(event, historical, odds, minTeamMatches, warnings);
    }
    return skipped(event, `requires at least ${minTeamMatches} matches per team`, historical, {
      homeMatches: homeStats.matches,
      awayMatches: awayStats.matches
    });
  }
  if (!Number.isFinite(homeStats.scoredPerMatch) || !Number.isFinite(homeStats.concededPerMatch)
    || !Number.isFinite(awayStats.scoredPerMatch) || !Number.isFinite(awayStats.concededPerMatch)) {
    if (allowOddsOnly && odds.expectedGoals) {
      return buildOddsOnlyPrediction(event, historical, odds, minTeamMatches, warnings);
    }
    return skipped(event, "missing scored/conceded rates", historical);
  }

  const historyHomeGoals = mean([homeStats.scoredPerMatch, awayStats.concededPerMatch]);
  const historyAwayGoals = mean([awayStats.scoredPerMatch, homeStats.concededPerMatch]);
  const advancedModels = normalizeAdvancedModels(historical?.models);
  let expectedGoals = advancedModels.ensemble?.totalGoals ?? historyHomeGoals + historyAwayGoals;

  if (!advancedModels.ensemble && Number.isFinite(historical?.h2h?.totalGoalsPerMatch)) {
    expectedGoals = weightedMean([
      [expectedGoals, 0.8],
      [historical.h2h.totalGoalsPerMatch, 0.2]
    ]);
  }
  if (!advancedModels.ensemble && Number.isFinite(historical?.league?.totalGoalsPerMatch)) {
    expectedGoals = weightedMean([
      [expectedGoals, 0.9],
      [historical.league.totalGoalsPerMatch, 0.1]
    ]);
  }

  if (odds.expectedGoals) {
    expectedGoals = weightedMean([
      [expectedGoals, 0.75],
      [odds.expectedGoals, 0.25]
    ]);
  } else {
    warnings.push("no usable over/under odds market");
  }

  const homeShare = safeRatio(historyHomeGoals, historyHomeGoals + historyAwayGoals, 0.5);
  const expectedHomeGoals = expectedGoals * homeShare;
  const expectedAwayGoals = expectedGoals - expectedHomeGoals;
  const overProbabilities = {
    over1_5: round(probabilityOver(1.5, expectedGoals), 4),
    over2_5: round(probabilityOver(2.5, expectedGoals), 4),
    over3_5: round(probabilityOver(3.5, expectedGoals), 4)
  };
  const confidence = confidenceScore(homeStats, awayStats, historical, odds);

  return {
    rank: null,
    id: event.id,
    startTime: event.startTime,
    fixture: event.name,
    competition: [event.region?.name, event.competition?.name].filter(Boolean).join(" / "),
    expectedGoals: round(expectedGoals, 2),
    expectedHomeGoals: round(expectedHomeGoals, 2),
    expectedAwayGoals: round(expectedAwayGoals, 2),
    confidence: confidence.label,
    confidenceScore: confidence.score,
    probabilities: overProbabilities,
    model: {
      minTeamMatches,
      home: homeStats,
      away: awayStats,
      h2h: historical?.h2h || null,
      league: historical?.league || null,
      estimates: advancedModels,
      odds,
      source: historical?.source || null,
      warnings
    }
  };
}

function normalizeAdvancedModels(models) {
  const dixonColes = normalizeModelEstimate(models?.dixonColes);
  const bayesian = normalizeModelEstimate(models?.bayesian);
  const estimates = {
    dixonColes,
    bayesian,
    ensemble: null
  };
  const available = [dixonColes, bayesian].filter(Boolean);
  if (available.length) {
    const homeGoals = mean(available.map((model) => model.homeGoals));
    const awayGoals = mean(available.map((model) => model.awayGoals));
    estimates.ensemble = {
      method: "mean of Dixon-Coles-style and Bayesian model estimates",
      homeGoals: round(homeGoals, 2),
      awayGoals: round(awayGoals, 2),
      totalGoals: round(homeGoals + awayGoals, 2)
    };
  }
  return estimates;
}

function normalizeModelEstimate(model) {
  if (!Number.isFinite(model?.totalGoals)) {
    return null;
  }
  return model;
}

function buildOddsOnlyPrediction(event, historical, odds, minTeamMatches, warnings) {
  const expectedGoals = odds.expectedGoals;
  const [home, away] = event.participants || [];
  const expectedHomeGoals = expectedGoals / 2;
  const expectedAwayGoals = expectedGoals / 2;
  return {
    rank: null,
    id: event.id,
    startTime: event.startTime,
    fixture: event.name,
    competition: [event.region?.name, event.competition?.name].filter(Boolean).join(" / "),
    expectedGoals: round(expectedGoals, 2),
    expectedHomeGoals: round(expectedHomeGoals, 2),
    expectedAwayGoals: round(expectedAwayGoals, 2),
    confidence: "low",
    confidenceScore: 0.35,
    probabilities: {
      over1_5: round(probabilityOver(1.5, expectedGoals), 4),
      over2_5: round(probabilityOver(2.5, expectedGoals), 4),
      over3_5: round(probabilityOver(3.5, expectedGoals), 4)
    },
    model: {
      minTeamMatches,
      home: home ? { name: home.name, matches: 0 } : null,
      away: away ? { name: away.name, matches: 0 } : null,
      h2h: null,
      league: null,
      odds,
      source: historical?.source || null,
      warnings: [...warnings, "using odds-only estimate because historical data was unavailable for this broad fixture scan"]
    }
  };
}

export function estimateGoalsFromOdds(event) {
  const estimates = [];
  for (const market of event.markets || []) {
    if (!isFullMatchGoalsMarket(market, event)) {
      continue;
    }
    for (const row of market.row || []) {
      const prices = row.prices || [];
      const over = prices.find((price) => normalize(price.name) === "over");
      const under = prices.find((price) => normalize(price.name) === "under");
      const line = parseGoalLine(over?.handicap ?? under?.handicap ?? row.formattedHandicap);
      if (!over?.price || !under?.price || !Number.isFinite(line) || !isHalfGoalLine(line)) {
        continue;
      }
      const probability = noVigProbability(Number(over.price), Number(under.price));
      const expectedGoals = invertPoissonOverProbability(line, probability.over);
      estimates.push({ line, overPrice: Number(over.price), underPrice: Number(under.price), overProbability: probability.over, expectedGoals });
    }
  }
  if (!estimates.length) {
    return { expectedGoals: null, markets: [] };
  }
  const preferred = estimates.find((estimate) => estimate.line === 2.5);
  return {
    expectedGoals: round((preferred || meanEstimate(estimates)).expectedGoals, 2),
    markets: estimates.map((estimate) => ({
      ...estimate,
      overProbability: round(estimate.overProbability, 4),
      expectedGoals: round(estimate.expectedGoals, 2)
    }))
  };
}

function isFullMatchGoalsMarket(market, event) {
  const marketType = market.marketType || {};
  if (String(marketType.id || "") === "5000") {
    return true;
  }
  const name = `${marketType.name || ""} ${marketType.displayName || ""}`.toLowerCase();
  if (!name.includes("total score over/under")) {
    return false;
  }
  if (name.includes("home team") || name.includes("away team")) {
    return false;
  }
  for (const participant of event.participants || []) {
    const participantName = normalize(participant.name);
    if (participantName && name.includes(participantName)) {
      return false;
    }
  }
  return name.includes("full time") || name.includes("ft");
}

export function noVigProbability(overPrice, underPrice) {
  const overRaw = 1 / overPrice;
  const underRaw = 1 / underPrice;
  const total = overRaw + underRaw;
  return {
    over: overRaw / total,
    under: underRaw / total,
    margin: total - 1
  };
}

export function probabilityOver(line, lambda) {
  return 1 - poissonCdf(Math.floor(line), lambda);
}

export function poissonCdf(k, lambda) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let index = 1; index <= k; index += 1) {
    term *= lambda / index;
    sum += term;
  }
  return sum;
}

export function invertPoissonOverProbability(line, targetProbability) {
  let low = 0.05;
  let high = 8;
  for (let index = 0; index < 40; index += 1) {
    const mid = (low + high) / 2;
    if (probabilityOver(line, mid) < targetProbability) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function skipped(event, reason, historical, extra = {}) {
  return {
    skipped: {
      id: event.id,
      fixture: event.name,
      startTime: event.startTime,
      competition: [event.region?.name, event.competition?.name].filter(Boolean).join(" / "),
      reason,
      source: historical?.source || null,
      warnings: historical?.warnings || [],
      ...extra
    }
  };
}

function findTeamStats(teams, name) {
  const key = normalize(name);
  return teams.find((team) => normalize(team.name) === key) || null;
}

function mergeHistoricalSources(primary, fallback) {
  return {
    ...fallback,
    warnings: [
      ...(primary?.warnings || []),
      ...(fallback?.warnings || [])
    ]
  };
}

function mergeHistoricalWarnings(primary, fallback) {
  return {
    ...(primary || fallback),
    warnings: [
      ...(primary?.warnings || []),
      ...(fallback?.warnings || [])
    ],
    fallbackSource: fallback?.source || null
  };
}

function confidenceScore(homeStats, awayStats, historical, odds) {
  const sample = Math.min(homeStats.matches, awayStats.matches);
  let score = Math.min(0.8, 0.35 + sample / 80);
  if (Number.isFinite(historical?.h2h?.totalGoalsPerMatch)) {
    score += 0.05;
  }
  if (historical?.models?.dixonColes || historical?.models?.bayesian) {
    score += 0.05;
  }
  if (odds.expectedGoals) {
    score += 0.1;
  }
  score = Math.min(0.95, score);
  return {
    score: round(score, 2),
    label: score >= 0.75 ? "high" : score >= 0.55 ? "medium" : "low"
  };
}

function filterReason(prediction, { minConfidence, minExpectedGoals }) {
  const reasons = [];
  if (confidenceRank(prediction.confidence) < confidenceRank(minConfidence)) {
    reasons.push(`confidence below ${minConfidence}`);
  }
  if (prediction.expectedGoals < minExpectedGoals) {
    reasons.push(`expected goals below ${minExpectedGoals}`);
  }
  return reasons.join("; ");
}

function confidenceRank(value) {
  const ranks = { low: 1, medium: 2, high: 3 };
  const key = normalize(value);
  if (!ranks[key]) {
    throw new Error(`unknown confidence "${value}". Use one of: low, medium, high`);
  }
  return ranks[key];
}

function mean(values) {
  const filtered = values.filter(Number.isFinite);
  if (!filtered.length) {
    return null;
  }
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function weightedMean(pairs) {
  const filtered = pairs.filter(([value, weight]) => Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
  const totalWeight = filtered.reduce((sum, [, weight]) => sum + weight, 0);
  return filtered.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function meanEstimate(estimates) {
  const total = estimates.reduce((sum, estimate) => sum + estimate.expectedGoals, 0);
  return { expectedGoals: total / estimates.length };
}

function safeRatio(value, total, fallback) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return fallback;
  }
  return value / total;
}

function parseGoalLine(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(String(value).replace(/[^\d.]+/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isHalfGoalLine(value) {
  return Math.abs(value % 1 - 0.5) < 0.001;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
