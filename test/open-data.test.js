import assert from "node:assert/strict";
import test from "node:test";

import {
  advancedGoalModels,
  buildOpenHistoricalStats,
  parseCsv,
  resolveFootballDataLeague,
  seasonCodesForDate
} from "../src/open-data.js";

const event = {
  id: "200",
  name: "Man City - Arsenal",
  startTime: "2026-05-13T18:00:00Z",
  participants: [
    { name: "Manchester City FC" },
    { name: "Arsenal FC" }
  ],
  region: { name: "England" },
  competition: { name: "Premier League" }
};

test("resolveFootballDataLeague maps BetPawa country and league names to CSV codes", () => {
  assert.equal(resolveFootballDataLeague({ event })?.code, "E0");
  assert.equal(resolveFootballDataLeague({ country: "Spain", league: "Primera Division" })?.code, "SP1");
  assert.equal(resolveFootballDataLeague({ country: "Uganda", league: "Premier League" }), null);
});

test("seasonCodesForDate returns current and prior European seasons", () => {
  assert.deepEqual(seasonCodesForDate("2026-05-13"), ["2526", "2425", "2324"]);
  assert.deepEqual(seasonCodesForDate("2026-08-01"), ["2627", "2526", "2425"]);
});

test("parseCsv handles quoted team names and BOM headers", () => {
  const rows = parseCsv("\uFEFFDiv,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,01/01/2026,\"Nott'm Forest\",Man City,1,2");
  assert.equal(rows[0].HomeTeam, "Nott'm Forest");
  assert.equal(rows[0].AwayTeam, "Man City");
});

test("buildOpenHistoricalStats computes team, league, and H2H goal rates", () => {
  const rows = [];
  for (let index = 1; index <= 12; index += 1) {
    rows.push({ Date: `${String(index).padStart(2, "0")}/01/2026`, HomeTeam: "Man City", AwayTeam: "Chelsea", FTHG: "2", FTAG: "1" });
    rows.push({ Date: `${String(index).padStart(2, "0")}/02/2026`, HomeTeam: "Liverpool", AwayTeam: "Arsenal", FTHG: "1", FTAG: "2" });
  }
  rows.push({ Date: "01/03/2026", HomeTeam: "Man City", AwayTeam: "Arsenal", FTHG: "3", FTAG: "2" });

  const stats = buildOpenHistoricalStats(event, rows);
  assert.equal(stats.teams.length, 2);
  assert.equal(stats.teams[0].openDataName, "Man City");
  assert.equal(stats.teams[1].openDataName, "Arsenal");
  assert.ok(stats.teams[0].matches >= 10);
  assert.equal(stats.h2h.totalGoalsPerMatch, 5);
  assert.ok(stats.league.totalGoalsPerMatch > 0);
  assert.ok(stats.models.dixonColes.totalGoals > 0);
  assert.ok(stats.models.bayesian.totalGoals > 0);
});

test("advancedGoalModels returns Dixon-Coles-style and Bayesian goal estimates", () => {
  const rows = [];
  for (let index = 1; index <= 20; index += 1) {
    rows.push({ Date: `${String(index).padStart(2, "0")}/01/2026`, HomeTeam: "Man City", AwayTeam: "Chelsea", FTHG: "3", FTAG: "1" });
    rows.push({ Date: `${String(index).padStart(2, "0")}/02/2026`, HomeTeam: "Liverpool", AwayTeam: "Arsenal", FTHG: "1", FTAG: "2" });
  }

  const models = advancedGoalModels(rows, "Man City", "Arsenal", "2026-05-13T18:00:00Z");
  assert.ok(models.dixonColes.totalGoals > 0);
  assert.ok(models.bayesian.totalGoals > 0);
  assert.notEqual(models.dixonColes.method, models.bayesian.method);
});
