const DEFAULT_BASE_URL = "https://www.betpawa.ug";
const DEFAULT_BRAND = "betpawa-uganda";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_TIME_ZONE = "Africa/Kampala";
const STATSHUB_BASE_URL = "https://statshub.sportradar.com/betpawauof";
const UGANDA_UTC_OFFSET_HOURS = 3;

export const SPORTS = {
  football: { id: "2", name: "Football", defaultMarket: "3743" },
  basketball: { id: "3", name: "Basketball", defaultMarket: "12" },
  tennis: { id: "452", name: "Tennis", defaultMarket: "12" },
  efootball: { id: "101", name: "eFootball", defaultMarket: "3743" },
  special: { id: "457", name: "Special Markets", defaultMarket: "12" }
};

export class BetPawaClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.BETPAWA_BASE_URL || DEFAULT_BASE_URL);
    this.brand = options.brand || process.env.BETPAWA_BRAND || DEFAULT_BRAND;
    this.language = options.language || process.env.BETPAWA_LANGUAGE || DEFAULT_LANGUAGE;
  }

  async listEvents({
    sport = "football",
    eventType = "UPCOMING",
    limit = 20,
    offset = 0,
    includeOdds = true,
    country,
    league,
    date
  } = {}) {
    const sportConfig = resolveSport(sport);
    const filters = await this.buildEventFilters({ sport, country, league, date });
    const query = {
      queries: [
        {
          query: {
            eventType,
            categories: [sportConfig.id],
            ...filters,
            ...(includeOdds ? { hasOdds: true } : {})
          },
          skip: offset,
          take: limit,
          sort: { startTime: "ASC" }
        }
      ]
    };

    const params = new URLSearchParams({ q: JSON.stringify(query) });
    const data = await this.requestJson(`/api/sportsbook/v3/events/lists/by-queries?${params.toString()}`);
    return data.responses?.[0]?.responses || [];
  }

  async listLeagues({ sport = "football", country, date } = {}) {
    const category = await this.getCategory(sport);
    const allRegions = getRegions(category);
    const regions = country ? resolveCountryRegions(allRegions, country).regions : allRegions;
    const range = date ? parseDateRange(date) : null;

    return regions.flatMap((regionEntry) => {
      return (regionEntry.competitions || []).map((competitionEntry) => {
        const dayCount = range ? getCompetitionDayCount(competitionEntry, range.localDate) : null;
        return {
          region: regionEntry.region,
          competition: competitionEntry.competition,
          eventCounts: competitionEntry.eventCounts || {},
          dayCount,
          days: competitionEntry.week?.days || []
        };
      }).filter((entry) => {
        if (!range) {
          return true;
        }
        return Number(entry.dayCount?.upcoming || 0) + Number(entry.dayCount?.hot || 0) > 0;
      });
    });
  }

  async getCategory(sport = "football") {
    const sportConfig = resolveSport(sport);
    return this.requestJson(`/api/sportsbook/v4/categories/list/${encodeURIComponent(sportConfig.id)}?withRegions=true&onlyMeta=false`);
  }

  async buildEventFilters({ sport = "football", country, league, date } = {}) {
    const filters = {};
    let regions = [];

    if (country || league) {
      const category = await this.getCategory(sport);
      const allRegions = getRegions(category);
      regions = country ? resolveCountryRegions(allRegions, country).regions : allRegions;

      const zones = {};
      if (league) {
        zones.competitions = resolveLeagueCompetitions(regions, league).map((entry) => toZoneId(entry.competition.id));
      } else if (country) {
        zones.regions = regions.map((entry) => toZoneId(entry.region.id));
      }
      if (zones.regions?.length || zones.competitions?.length) {
        filters.zones = zones;
      }
    }

    if (date) {
      const range = parseDateRange(date);
      filters.startTime = {
        gte: range.gte,
        lt: range.lt
      };
    }

    return filters;
  }

  async getEvent(eventId) {
    if (!eventId) {
      throw new Error("event id is required");
    }
    return this.requestJson(`/api/sportsbook/v3/events/${encodeURIComponent(eventId)}`);
  }

  async getEventsWithOdds(options = {}) {
    const maxDetails = Number(options.detailLimit || options.limit || 10);
    const events = await this.listEvents(options);
    const selected = events.slice(0, maxDetails);
    return Promise.all(selected.map((event) => this.getEvent(event.id)));
  }

  async getEventDetailsForEvents(events) {
    return Promise.all(events.map((event) => this.getEvent(event.id)));
  }

  async addStatisticsForEvents(events) {
    const details = await this.getEventDetailsForEvents(events);
    const statisticsById = new Map(details.map((event) => {
      return [event.id, buildEventStatistics(event, this.language)];
    }));
    return events.map((event) => ({
      ...event,
      statistics: statisticsById.get(event.id) || buildEventStatistics(event, this.language)
    }));
  }

  addStatistics(events) {
    return events.map((event) => ({
      ...event,
      statistics: buildEventStatistics(event, this.language)
    }));
  }

  async getEventStats(eventId) {
    const event = await this.getEvent(eventId);
    return {
      event: summarizeEvent(event),
      statistics: buildEventStatistics(event, this.language)
    };
  }

  async getResults() {
    return this.requestJson("/api/sportsbook/v2/results/list/all");
  }

  async requestJson(path) {
    const url = `${this.baseUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Pawa-Brand": this.brand,
          "X-Pawa-Language": this.language,
          deviceType: "desktop",
          traceId: `betpawa-cli-${Date.now()}`
        }
      });
    } catch (error) {
      throw new Error(`failed to fetch BetPawa data from ${url}: ${error.message}`);
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`expected JSON from ${path}, got: ${text.slice(0, 120)}`);
    }

    if (!response.ok || body?.error) {
      const reason = body?.error || `${response.status} ${response.statusText}`;
      throw new Error(`${reason} while requesting ${path}`);
    }

    return body;
  }
}

export function resolveSport(sport) {
  const key = String(sport || "").toLowerCase();
  const resolved = SPORTS[key];
  if (!resolved) {
    throw new Error(`unknown sport "${sport}". Use one of: ${Object.keys(SPORTS).join(", ")}`);
  }
  return resolved;
}

export function parseDateRange(value, now = new Date()) {
  const localDate = resolveLocalDate(value, now);
  const [year, month, day] = localDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, -UGANDA_UTC_OFFSET_HOURS, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    localDate,
    gte: start.toISOString(),
    lt: end.toISOString()
  };
}

export function getRegions(categoryResponse) {
  return (categoryResponse.withRegions || []).flatMap((category) => category.regions || []);
}

export function resolveCountryRegions(regions, country) {
  const key = normalizeLookup(country);
  if (!key) {
    return { regions: [], regionIds: [] };
  }

  let matches;
  if (isUnitedKingdomAlias(key)) {
    matches = regions.filter((entry) => {
      const region = entry.region || {};
      return normalizeLookup(region.parentSlug) === "united kingdom"
        || normalizeLookup(region.parentName) === "united kingdom";
    });
  } else {
    matches = regions.filter((entry) => {
      const region = entry.region || {};
      return [
        region.id,
        region.name,
        region.slug,
        region.iso,
        region.parentName,
        region.parentSlug
      ].some((value) => normalizeLookup(value) === key);
    });
  }

  if (!matches.length) {
    throw new Error(`could not find country/region "${country}"`);
  }

  return {
    regions: matches,
    regionIds: matches.map((entry) => entry.region.id)
  };
}

export function resolveLeagueCompetitions(regions, league) {
  const key = normalizeLookup(league);
  const competitions = regions.flatMap((regionEntry) => {
    return (regionEntry.competitions || []).map((competitionEntry) => ({
      region: regionEntry.region,
      competition: competitionEntry.competition,
      eventCounts: competitionEntry.eventCounts || {}
    }));
  });

  const exact = competitions.filter((entry) => {
    const competition = entry.competition || {};
    return [competition.id, competition.name, competition.slug].some((value) => normalizeLookup(value) === key);
  });

  if (exact.length) {
    return exact;
  }

  const partial = competitions.filter((entry) => {
    const competition = entry.competition || {};
    return [competition.name, competition.slug].some((value) => normalizeLookup(value).includes(key));
  });

  if (!partial.length) {
    throw new Error(`could not find league "${league}"`);
  }

  return partial;
}

export function buildEventStatistics(event, language = DEFAULT_LANGUAGE) {
  const widgets = event.widgets || [];
  const sportradar = widgets.find((widget) => widget.type === "SPORTRADAR" && widget.id);
  const live = Boolean(event.additionalInfo?.live);
  const matchId = sportradar?.id || null;

  return {
    available: Boolean(matchId && !live),
    provider: matchId ? "SPORTRADAR" : null,
    matchId,
    url: matchId ? `${STATSHUB_BASE_URL}/${language}/match/${encodeURIComponent(matchId)}` : null,
    live,
    widgets,
    scoreboard: event.scoreboard || null,
    results: event.results || null,
    participants: event.participants || []
  };
}

function summarizeEvent(event) {
  return {
    id: event.id,
    name: event.name,
    startTime: event.startTime,
    category: event.category,
    region: event.region,
    competition: event.competition
  };
}

function getCompetitionDayCount(competitionEntry, localDate) {
  return (competitionEntry.week?.days || []).find((day) => {
    return String(day.day || "").slice(0, 10) === localDate;
  })?.counts || null;
}

function resolveLocalDate(value, now) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "today") {
    return formatLocalDate(now);
  }
  if (raw === "tomorrow") {
    return formatLocalDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  throw new Error(`expected --date to be YYYY-MM-DD, today, or tomorrow; got "${value}"`);
}

function formatLocalDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isUnitedKingdomAlias(key) {
  return ["uk", "gb", "great britain", "britain", "united kingdom"].includes(key);
}

function normalizeLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ");
}

function toZoneId(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}
