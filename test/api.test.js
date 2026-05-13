import assert from "node:assert/strict";
import test from "node:test";

import { parseDateRange, resolveCountryRegions, resolveLeagueCompetitions } from "../src/api.js";

const regions = [
  {
    region: {
      id: "288",
      name: "England",
      slug: "england",
      parentSlug: "united-kingdom"
    },
    competitions: [
      {
        competition: {
          id: "11965",
          name: "Premier League",
          slug: "premier-league"
        },
        eventCounts: { upcoming: "10" }
      }
    ]
  },
  {
    region: {
      id: "290",
      name: "Scotland",
      slug: "scotland",
      parentSlug: "united-kingdom"
    },
    competitions: [
      {
        competition: {
          id: "812",
          name: "Premiership",
          slug: "premiership"
        },
        eventCounts: { upcoming: "3" }
      }
    ]
  },
  {
    region: {
      id: "412",
      name: "Ukraine",
      slug: "ukraine"
    },
    competitions: []
  }
];

test("parseDateRange converts a Kampala local day to UTC bounds", () => {
  assert.deepEqual(parseDateRange("2026-05-17"), {
    localDate: "2026-05-17",
    gte: "2026-05-16T21:00:00.000Z",
    lt: "2026-05-17T21:00:00.000Z"
  });
});

test("parseDateRange resolves today and tomorrow in Africa/Kampala", () => {
  const now = new Date("2026-05-13T20:30:00.000Z");
  assert.equal(parseDateRange("today", now).localDate, "2026-05-13");
  assert.equal(parseDateRange("tomorrow", now).localDate, "2026-05-14");
});

test("resolveCountryRegions maps uk to all United Kingdom regions", () => {
  const resolved = resolveCountryRegions(regions, "uk");
  assert.deepEqual(resolved.regionIds, ["288", "290"]);
});

test("resolveCountryRegions matches exact region names without matching Ukraine for uk", () => {
  const resolved = resolveCountryRegions(regions, "england");
  assert.deepEqual(resolved.regionIds, ["288"]);
});

test("resolveLeagueCompetitions matches league name, slug, and id", () => {
  assert.equal(resolveLeagueCompetitions(regions, "Premier League")[0].competition.id, "11965");
  assert.equal(resolveLeagueCompetitions(regions, "premier-league")[0].competition.id, "11965");
  assert.equal(resolveLeagueCompetitions(regions, "812")[0].competition.name, "Premiership");
});
