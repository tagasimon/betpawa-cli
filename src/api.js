const DEFAULT_BASE_URL = "https://www.betpawa.ug";
const DEFAULT_BRAND = "betpawa-uganda";
const DEFAULT_LANGUAGE = "en";

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

  async listEvents({ sport = "football", eventType = "UPCOMING", limit = 20, offset = 0, includeOdds = true } = {}) {
    const sportConfig = resolveSport(sport);
    const query = {
      queries: [
        {
          query: {
            eventType,
            categories: [sportConfig.id],
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

  async getResults() {
    return this.requestJson("/api/sportsbook/v2/results/list/all");
  }

  async requestJson(path) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Pawa-Brand": this.brand,
        "X-Pawa-Language": this.language,
        deviceType: "desktop",
        traceId: `betpawa-cli-${Date.now()}`
      }
    });

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

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}
