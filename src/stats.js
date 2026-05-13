const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchHistoricalStats(event, {
  baseUrl,
  cache,
  useBrowser = true,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const cached = cache ? await cache.read("event-stats", event.id) : null;
  if (cached) {
    return {
      ...cached,
      source: {
        ...cached.source,
        cacheHit: true
      }
    };
  }

  const url = `${String(baseUrl).replace(/\/+$/, "")}/event/${encodeURIComponent(event.id)}`;
  const plain = await fetchPlainEventStats(url, event);
  if (plain.stats) {
    const payload = withSource(plain.stats, { method: "http", url, cacheHit: false });
    if (cache) {
      await cache.write("event-stats", event.id, payload);
    }
    return payload;
  }

  if (useBrowser) {
    const browser = await fetchBrowserEventStats(url, event, timeoutMs);
    if (browser.stats) {
      const payload = withSource(browser.stats, { method: "browser", url, cacheHit: false });
      if (cache) {
        await cache.write("event-stats", event.id, payload);
      }
      return payload;
    }
    return {
      source: { method: "browser", url, cacheHit: false },
      teams: [],
      h2h: null,
      warnings: [...plain.warnings, ...browser.warnings]
    };
  }

  return {
    source: { method: "http", url, cacheHit: false },
    teams: [],
    h2h: null,
    warnings: plain.warnings
  };
}

export async function fetchPlainEventStats(url, event) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "betpawa-cli/0.1"
      }
    });
    const html = await response.text();
    if (!response.ok) {
      return { stats: null, warnings: [`event page returned ${response.status}`] };
    }
    const stats = parseHistoricalStats(htmlToText(html), event.participants || []);
    return statsHasTeams(stats) ? { stats, warnings: [] } : { stats: null, warnings: ["plain event page did not include historical stats"] };
  } catch (error) {
    return { stats: null, warnings: [`plain event fetch failed: ${error.message}`] };
  }
}

export async function fetchBrowserEventStats(url, event, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return { stats: null, warnings: ["playwright is not installed; browser statistics fallback unavailable"] };
  }

  const collected = [];
  let browser;
  try {
    browser = await launchBrowser(playwright);
    const page = await browser.newPage();

    page.on("response", async (response) => {
      const responseUrl = response.url();
      if (!/stat|match|fixture|head/i.test(responseUrl)) {
        return;
      }
      try {
        const contentType = response.headers()["content-type"] || "";
        if (contentType.includes("json") || contentType.includes("text")) {
          collected.push(await response.text());
        }
      } catch {
        // Ignore response bodies that Playwright cannot read.
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await clickStatisticsPreview(page);
    await page.waitForTimeout(2500);

    collected.push(await page.evaluate(() => document.body?.innerText || ""));
    for (const frame of page.frames()) {
      try {
        collected.push(await frame.evaluate(() => document.body?.innerText || ""));
      } catch {
        // Cross-origin frames may not expose text.
      }
    }

    const stats = parseHistoricalStats(collected.join("\n"), event.participants || []);
    return statsHasTeams(stats) ? { stats, warnings: [] } : { stats: null, warnings: ["browser page did not expose parseable historical stats"] };
  } catch (error) {
    return { stats: null, warnings: [`browser statistics fetch failed: ${error.message}`] };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export function parseHistoricalStats(text, participants = []) {
  const clean = normalizeText(text);
  const teams = participants
    .slice(0, 2)
    .map((participant, index, selected) => {
      return parseTeamStats(clean, participant.name, selected
        .map((entry, selectedIndex) => selectedIndex > index ? entry.name : null)
        .filter(Boolean));
    })
    .filter(Boolean);
  const h2h = parseH2hStats(clean);
  const league = parseLeagueStats(clean);

  return {
    teams,
    h2h,
    league,
    rawLength: clean.length
  };
}

export function parseTeamStats(text, teamName, followingTeamNames = []) {
  if (!teamName) {
    return null;
  }
  const index = text.toLowerCase().indexOf(teamName.toLowerCase());
  if (index < 0) {
    return null;
  }
  const nextIndex = followingTeamNames
    .map((name) => text.toLowerCase().indexOf(name.toLowerCase(), index + teamName.length))
    .filter((value) => value > index)
    .sort((left, right) => left - right)[0];
  const windowText = text.slice(index, nextIndex || index + 2400);
  const matches = firstNumber(windowText, [
    /matches\s+played\s+(\d+)/i,
    /played\s+(\d+)\s+matches/i,
    /last\s+(\d+)\s+matches/i
  ]);
  const goalsFor = firstNumber(windowText, [
    /goals\s+scored\s+(\d+(?:\.\d+)?)/i,
    /scored\s+(\d+(?:\.\d+)?)\s+goals/i
  ]);
  const goalsAgainst = firstNumber(windowText, [
    /goals\s+conceded\s+(\d+(?:\.\d+)?)/i,
    /conceded\s+(\d+(?:\.\d+)?)\s+goals/i
  ]);
  const scoredPerMatch = firstNumber(windowText, [
    /average\s+goals\s+scored\s+(\d+(?:\.\d+)?)/i,
    /goals\s+scored\s+per\s+match\s+(\d+(?:\.\d+)?)/i,
    /scored\s+per\s+match\s+(\d+(?:\.\d+)?)/i
  ]);
  const concededPerMatch = firstNumber(windowText, [
    /average\s+goals\s+conceded\s+(\d+(?:\.\d+)?)/i,
    /goals\s+conceded\s+per\s+match\s+(\d+(?:\.\d+)?)/i,
    /conceded\s+per\s+match\s+(\d+(?:\.\d+)?)/i
  ]);
  const totalGoalsPerMatch = firstNumber(windowText, [
    /average\s+total\s+goals\s+(\d+(?:\.\d+)?)/i,
    /total\s+goals\s+per\s+match\s+(\d+(?:\.\d+)?)/i
  ]);

  const sampleSize = matches || inferMatches(goalsFor, scoredPerMatch) || inferMatches(goalsAgainst, concededPerMatch);
  if (!sampleSize) {
    return null;
  }

  return {
    name: teamName,
    matches: sampleSize,
    scoredPerMatch: scoredPerMatch ?? perMatch(goalsFor, sampleSize),
    concededPerMatch: concededPerMatch ?? perMatch(goalsAgainst, sampleSize),
    totalGoalsPerMatch
  };
}

export function parseH2hStats(text) {
  const h2hIndex = text.toLowerCase().search(/head\s*to\s*head|h2h/);
  if (h2hIndex < 0) {
    return null;
  }
  const windowText = text.slice(h2hIndex, h2hIndex + 1800);
  const matches = firstNumber(windowText, [
    /matches\s+played\s+(\d+)/i,
    /last\s+(\d+)\s+matches/i
  ]);
  const totalGoalsPerMatch = firstNumber(windowText, [
    /average\s+total\s+goals\s+(\d+(?:\.\d+)?)/i,
    /total\s+goals\s+per\s+match\s+(\d+(?:\.\d+)?)/i
  ]);
  return matches || totalGoalsPerMatch ? { matches, totalGoalsPerMatch } : null;
}

export function parseLeagueStats(text) {
  const totalGoalsPerMatch = firstNumber(text, [
    /league\s+average\s+total\s+goals\s+(\d+(?:\.\d+)?)/i,
    /competition\s+average\s+total\s+goals\s+(\d+(?:\.\d+)?)/i
  ]);
  return totalGoalsPerMatch ? { totalGoalsPerMatch } : null;
}

function withSource(stats, source) {
  return {
    ...stats,
    source
  };
}

function statsHasTeams(stats) {
  return (stats?.teams || []).length >= 2;
}

async function launchBrowser(playwright) {
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (firstError) {
    try {
      return await playwright.chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      throw firstError;
    }
  }
}

async function clickStatisticsPreview(page) {
  const selectors = [
    "[data-test-id='statistics-button']",
    "text=H2H",
    "text=Statistics"
  ];
  for (const selector of selectors) {
    try {
      const target = page.locator(selector).first();
      if (await target.count()) {
        await target.click({ timeout: 5000 });
        return;
      }
    } catch {
      // Try the next selector.
    }
  }
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeText(text) {
  return String(text || "")
    .replace(/[,_:|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

function perMatch(total, matches) {
  if (!Number.isFinite(total) || !Number.isFinite(matches) || matches <= 0) {
    return null;
  }
  return total / matches;
}

function inferMatches(total, average) {
  if (!Number.isFinite(total) || !Number.isFinite(average) || average <= 0) {
    return null;
  }
  return Math.round(total / average);
}
