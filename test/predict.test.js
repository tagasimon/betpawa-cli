import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DailyCache } from "../src/cache.js";
import { run } from "../src/cli.js";
import {
  buildGoalPrediction,
  estimateGoalsFromOdds,
  noVigProbability,
  passesPredictionFilters,
  poissonCdf,
  predictGoals,
  probabilityOver
} from "../src/predict.js";
import { parseHistoricalStats } from "../src/stats.js";

const event = {
  id: "100",
  name: "Home FC - Away FC",
  startTime: "2026-05-13T15:00:00Z",
  participants: [
    { id: "1", name: "Home FC", position: 1 },
    { id: "2", name: "Away FC", position: 2 }
  ],
  region: { name: "England" },
  competition: { name: "Premier League" },
  markets: [
    {
      marketType: {
        name: "Total Score Over/Under - FT",
        displayName: "Over/Under | Full Time"
      },
      row: [
        {
          prices: [
            { name: "Over", handicap: "2.5", price: 1.9 },
            { name: "Under", handicap: "2.5", price: 1.9 }
          ]
        }
      ]
    }
  ]
};

const historical = {
  source: { method: "fixture", url: "test", cacheHit: false },
  teams: [
    { name: "Home FC", matches: 12, scoredPerMatch: 1.8, concededPerMatch: 1.1 },
    { name: "Away FC", matches: 14, scoredPerMatch: 1.4, concededPerMatch: 1.5 }
  ],
  h2h: { matches: 5, totalGoalsPerMatch: 2.8 },
  league: { totalGoalsPerMatch: 2.6 }
};

const highConfidenceHistorical = {
  ...historical,
  teams: [
    { name: "Home FC", matches: 30, scoredPerMatch: 2.2, concededPerMatch: 1.2 },
    { name: "Away FC", matches: 30, scoredPerMatch: 1.6, concededPerMatch: 1.7 }
  ],
  models: {
    dixonColes: { method: "dc", homeGoals: 2.1, awayGoals: 1.2, totalGoals: 3.3 },
    bayesian: { method: "bayes", homeGoals: 1.9, awayGoals: 1.1, totalGoals: 3 }
  }
};

test("noVigProbability removes bookmaker margin", () => {
  const probability = noVigProbability(1.8, 2.2);
  assert.equal(Number(probability.over.toFixed(3)), 0.55);
  assert.equal(Number(probability.under.toFixed(3)), 0.45);
  assert.ok(probability.margin > 0);
});

test("poisson helpers produce over probabilities", () => {
  assert.equal(Number(poissonCdf(0, 2.5).toFixed(3)), 0.082);
  assert.equal(Number(probabilityOver(2.5, 2.8).toFixed(3)), 0.531);
});

test("estimateGoalsFromOdds reads the full-time total goals market", () => {
  const odds = estimateGoalsFromOdds({
    ...event,
    markets: [
      ...event.markets,
      {
        marketType: {
          id: "5006",
          name: "Total Score Over/Under - FT - Home Team",
          displayName: "Over/Under | Home FC | Full Time"
        },
        row: [
          {
            prices: [
              { name: "Over", handicap: "1.5", price: 1.4 },
              { name: "Under", handicap: "1.5", price: 2.8 }
            ]
          }
        ]
      }
    ]
  });
  assert.ok(odds.expectedGoals > 2.5);
  assert.equal(odds.markets[0].line, 2.5);
  assert.equal(odds.markets.length, 1);
});

test("buildGoalPrediction estimates and ranks a fixture-ready payload", () => {
  const prediction = buildGoalPrediction(event, historical);
  assert.equal(prediction.fixture, "Home FC - Away FC");
  assert.ok(prediction.expectedGoals > 2);
  assert.ok(prediction.probabilities.over2_5 > 0);
  assert.equal(prediction.model.home.matches, 12);
});

test("buildGoalPrediction exposes Dixon-Coles-style and Bayesian estimates when available", () => {
  const prediction = buildGoalPrediction(event, highConfidenceHistorical);
  assert.equal(prediction.model.estimates.dixonColes.totalGoals, 3.3);
  assert.equal(prediction.model.estimates.bayesian.totalGoals, 3);
  assert.equal(prediction.model.estimates.ensemble.totalGoals, 3.15);
  assert.ok(prediction.expectedGoals >= 3);
});

test("passesPredictionFilters requires high confidence and at least 2 expected goals by default", () => {
  assert.equal(passesPredictionFilters({ confidence: "high", expectedGoals: 2 }), true);
  assert.equal(passesPredictionFilters({ confidence: "medium", expectedGoals: 3 }), false);
  assert.equal(passesPredictionFilters({ confidence: "high", expectedGoals: 1.99 }), false);
});

test("buildGoalPrediction skips fixtures below the historical sample threshold", () => {
  const tooSmall = {
    ...historical,
    teams: [
      { name: "Home FC", matches: 9, scoredPerMatch: 1.8, concededPerMatch: 1.1 },
      { name: "Away FC", matches: 14, scoredPerMatch: 1.4, concededPerMatch: 1.5 }
    ]
  };
  const result = buildGoalPrediction(event, tooSmall);
  assert.equal(result.skipped.reason, "requires at least 10 matches per team");
});

test("parseHistoricalStats extracts team and H2H rates from page text", () => {
  const stats = parseHistoricalStats(`
    Home FC
    Matches played 12
    Goals scored 22
    Goals conceded 13
    Away FC
    Matches played 14
    Average goals scored 1.4
    Average goals conceded 1.5
    Head to Head last 5 matches average total goals 2.8
  `, event.participants);

  assert.equal(stats.teams.length, 2);
  assert.equal(Number(stats.teams[0].scoredPerMatch.toFixed(2)), 1.83);
  assert.equal(stats.h2h.totalGoalsPerMatch, 2.8);
});

test("DailyCache reads and writes JSON by local day", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "betpawa-cache-"));
  try {
    const cache = new DailyCache({ root, date: "2026-05-13" });
    await cache.write("stats", "event:100", { ok: true });
    assert.deepEqual(await cache.read("stats", "event:100"), { ok: true });
    assert.equal(await cache.read("stats", "missing"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("predictGoals allows broad daily scans without country or league filters", async () => {
  const payload = await predictGoals({
    client: { baseUrl: "https://example.com", getEventsWithOdds: async () => [] },
    statsFetcher: async () => historical
  });
  assert.equal(payload.filters.country, null);
  assert.equal(payload.filters.league, null);
});

test("predictGoals returns sorted predictions and skipped reasons", async () => {
  const lowEvent = { ...event, id: "101", name: "Low FC - Lower FC" };
  const payload = await predictGoals({
    client: {
      baseUrl: "https://example.com",
      getEventsWithOdds: async () => [lowEvent, event]
    },
    country: "england",
    statsFetcher: async (fixture) => fixture.id === "101"
      ? { ...historical, teams: [{ name: "Home FC", matches: 3 }, { name: "Away FC", matches: 4 }] }
      : highConfidenceHistorical
  });

  assert.equal(payload.predictions.length, 1);
  assert.equal(payload.predictions[0].rank, 1);
  assert.equal(payload.skipped.length, 1);
});

test("predictGoals falls back to open historical data when BetPawa stats are missing", async () => {
  const payload = await predictGoals({
    client: {
      baseUrl: "https://example.com",
      getEventsWithOdds: async () => [event]
    },
    country: "england",
    statsFetcher: async () => ({
      source: { method: "http", url: "test", cacheHit: false },
      teams: [],
      warnings: ["missing BetPawa stats"]
    }),
    openStatsFetcher: async () => highConfidenceHistorical
  });

  assert.equal(payload.predictions.length, 1);
  assert.equal(payload.predictions[0].model.source.method, "fixture");
  assert.deepEqual(payload.predictions[0].model.warnings, ["missing BetPawa stats"]);
});

test("predictGoals uses odds-only fallback for broad scans when history is unavailable", async () => {
  const payload = await predictGoals({
    client: {
      baseUrl: "https://example.com",
      getEventsWithOdds: async () => [event]
    },
    statsFetcher: async () => ({
      source: { method: "http", url: "test", cacheHit: false },
      teams: [],
      warnings: ["missing BetPawa stats"]
    }),
    openStatsFetcher: async () => ({
      source: { method: "open-football-data", provider: "football-data.co.uk" },
      teams: [],
      warnings: ["no open mapping"]
    })
  });

  assert.equal(payload.predictions.length, 1);
  assert.equal(payload.filtered.length, 0);
  assert.equal(payload.summary.fallback, true);
  assert.equal(payload.predictions[0].confidence, "low");
  assert.match(payload.predictions[0].filterReason, /confidence below high/);
});

test("CLI smoke test for predict-goals uses injected predictor", async () => {
  const writes = [];
  const originalLog = console.log;
  console.log = (value = "") => writes.push(String(value));
  try {
    await run(["predict-goals", "--country", "england"], {
      client: { baseUrl: "https://example.com" },
      predictGoals: async () => ({
        predictions: [{ rank: 1, startTime: event.startTime, fixture: event.name, competition: "England / Premier League", expectedGoals: 2.74, confidence: "medium" }],
        skipped: []
      })
    });
  } finally {
    console.log = originalLog;
  }
  assert.match(writes.join("\n"), /XGOALS/);
  assert.match(writes.join("\n"), /2.7/);
});
