/** On-demand OurAirports static JSON search and nearest-airport lookup. */

export interface AirportRunway {
  leIdent: string;
  heIdent: string;
  le: [number, number];
  he: [number, number];
  widthFt: number;
}

export interface AirportRecord {
  id: string;
  icao: string;
  iata: string | null;
  name: string;
  municipality: string | null;
  country: string | null;
  lat: number;
  lon: number;
  elevationFt: number | null;
  type: "large_airport" | "medium_airport";
  scheduledService: boolean;
  runways: AirportRunway[];
}

interface AirportsFile {
  meta: {
    generated: string;
    generatorVersion: string;
    included: number;
  };
  airports: AirportRecord[];
}

// Singleton load promise — fetched once per page load.
let _load: Promise<AirportRecord[]> | null = null;

/** Load airport data from the locally-served static JSON. Non-fatal on failure. */
export function loadAirports(): Promise<AirportRecord[]> {
  if (_load) return _load;
  _load = fetch("/data/airports.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<AirportsFile>;
    })
    .then((f) => f.airports ?? [])
    .catch((err) => {
      console.warn("[airportSearch] Failed to load /data/airports.json:", err);
      return [];
    });
  return _load;
}

/** Reset the module-level cache (test helper). */
export function _resetLoadCache(): void {
  _load = null;
}

// Search ranking tiers (lower = higher priority).
const TIER_EXACT = 0;
const TIER_STARTS = 1;
const TIER_CONTAINS = 2;

function typeScore(a: AirportRecord): number {
  if (!a.scheduledService) return 2;
  return a.type === "large_airport" ? 0 : 1;
}

function matchTier(a: AirportRecord, qUpper: string, qLower: string): number | null {
  // Tier 0: exact IATA or ICAO match.
  if ((a.iata && a.iata === qUpper) || a.icao === qUpper) return TIER_EXACT;

  // Tier 1+: name / municipality substring matches.
  const nameL = a.name.toLowerCase();
  const muniL = (a.municipality ?? "").toLowerCase();

  if (nameL.startsWith(qLower) || muniL.startsWith(qLower)) return TIER_STARTS;
  if (nameL.includes(qLower) || muniL.includes(qLower)) return TIER_CONTAINS;

  return null;
}

/**
 * Search airports from the static dataset.
 * Exact IATA/ICAO matches rank first; name/municipality substring matches follow.
 * Within each tier, large scheduled airports sort before medium/unscheduled, then
 * alphabetically by name for determinism.
 *
 * Returns up to `limit` results (default 10).
 */
export function searchAirports(
  query: string,
  airports: AirportRecord[],
  limit = 10,
): AirportRecord[] {
  const q = query.trim();
  if (!q) return [];

  const qUpper = q.toUpperCase();
  const qLower = q.toLowerCase();

  type Scored = { airport: AirportRecord; tier: number; ts: number };
  const scored: Scored[] = [];

  for (const a of airports) {
    const tier = matchTier(a, qUpper, qLower);
    if (tier !== null) {
      scored.push({ airport: a, tier, ts: typeScore(a) });
    }
  }

  scored.sort((a, b) =>
    a.tier !== b.tier
      ? a.tier - b.tier
      : a.ts !== b.ts
        ? a.ts - b.ts
        : a.airport.name.localeCompare(b.airport.name),
  );

  return scored.slice(0, limit).map((s) => s.airport);
}

/** Great-circle angular distance squared (radians²) — sufficient for nearest-airport ranking. */
function angDistSq(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const DEG = Math.PI / 180;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const midLat = ((lat1 + lat2) / 2) * DEG;
  const x = dLon * Math.cos(midLat);
  return x * x + dLat * dLat;
}

/**
 * Find the nearest large/medium airport to the given coordinates.
 * Returns null if airports data is empty or unavailable.
 */
export function findClosestAirport(
  lat: number,
  lon: number,
  airports: AirportRecord[],
): AirportRecord | null {
  let best: AirportRecord | null = null;
  let bestDist = Infinity;

  for (const a of airports) {
    const d = angDistSq(lat, lon, a.lat, a.lon);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }

  return best;
}

/** Statute miles radius in radians. */
function mileRad(miles: number): number {
  return miles / 3958.8;
}

/**
 * Find all large/medium airports within `radiusMiles` of the given coordinates.
 * Results are sorted nearest-first.
 */
export function findNearbyAirports(
  lat: number,
  lon: number,
  radiusMiles: number,
  airports: AirportRecord[],
): AirportRecord[] {
  const maxRad = mileRad(radiusMiles);
  const DEG = Math.PI / 180;

  const hits: { airport: AirportRecord; dist: number }[] = [];

  for (const a of airports) {
    const dLat = (a.lat - lat) * DEG;
    const dLon = (a.lon - lon) * DEG;
    const midLat = ((lat + a.lat) / 2) * DEG;
    const x = dLon * Math.cos(midLat);
    const d = Math.sqrt(x * x + dLat * dLat);
    if (d <= maxRad) hits.push({ airport: a, dist: d });
  }

  hits.sort((a, b) => a.dist - b.dist);
  return hits.map((h) => h.airport);
}

/** Convert an AirportRecord into the Airport shape used by the renderer. */
export function toDisplayAirport(a: AirportRecord): {
  icao: string;
  name: string;
  fullName: string;
  lat: number;
  lon: number;
  elevationFt: number;
  runways: AirportRunway[];
} {
  return {
    icao: a.icao,
    name: a.iata ?? a.icao,
    fullName: a.name,
    lat: a.lat,
    lon: a.lon,
    elevationFt: a.elevationFt ?? 0,
    runways: a.runways,
  };
}
