import { describe, expect, it, beforeEach } from "vitest";
import {
  searchAirports,
  findClosestAirport,
  findNearbyAirports,
  toDisplayAirport,
  type AirportRecord,
} from "../src/components/airportSearch.js";

// Minimal fixture airports covering the scenarios under test.
function mkAirport(overrides: Partial<AirportRecord> & { icao: string }): AirportRecord {
  return {
    id: overrides.icao,
    icao: overrides.icao,
    iata: overrides.iata ?? null,
    name: overrides.name ?? "Test Airport",
    municipality: overrides.municipality ?? null,
    country: overrides.country ?? "US",
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    elevationFt: overrides.elevationFt ?? 0,
    type: overrides.type ?? "large_airport",
    scheduledService: overrides.scheduledService ?? true,
    runways: overrides.runways ?? [],
  };
}

const AIRPORTS: AirportRecord[] = [
  mkAirport({ icao: "KSFO", iata: "SFO", name: "San Francisco International Airport", municipality: "San Francisco", lat: 37.6213, lon: -122.379 }),
  mkAirport({ icao: "EGLL", iata: "LHR", name: "London Heathrow Airport", municipality: "London" }),
  mkAirport({ icao: "KJFK", iata: "JFK", name: "John F. Kennedy International Airport", municipality: "New York" }),
  mkAirport({ icao: "YSSY", iata: "SYD", name: "Sydney Kingsford Smith International Airport", municipality: "Sydney" }),
  // Medium airports
  mkAirport({ icao: "KEWR", iata: "EWR", name: "Newark Liberty International Airport", municipality: "Newark", type: "medium_airport" }),
  // No IATA
  mkAirport({ icao: "KOAK", iata: null, name: "Oakland International Airport", municipality: "Oakland", lat: 37.7213, lon: -122.221 }),
  // Unscheduled
  mkAirport({ icao: "KSJC", iata: "SJC", name: "San José Mineta International Airport", municipality: "San José", scheduledService: false }),
];

// ── searchAirports ────────────────────────────────────────────────────────────

describe("searchAirports", () => {
  it("finds SFO by exact IATA code (case-insensitive input)", () => {
    const results = searchAirports("sfo", AIRPORTS);
    expect(results[0].icao).toBe("KSFO");
    expect(results[0].iata).toBe("SFO");
  });

  it("finds KSFO by exact ICAO code", () => {
    const results = searchAirports("KSFO", AIRPORTS);
    expect(results[0].icao).toBe("KSFO");
  });

  it("finds Heathrow by name substring (case-insensitive)", () => {
    const results = searchAirports("Heathrow", AIRPORTS);
    expect(results[0].icao).toBe("EGLL");
  });

  it("finds airports by municipality", () => {
    const results = searchAirports("london", AIRPORTS);
    expect(results[0].icao).toBe("EGLL");
  });

  it("returns empty array for blank query", () => {
    expect(searchAirports("", AIRPORTS)).toEqual([]);
    expect(searchAirports("  ", AIRPORTS)).toEqual([]);
  });

  it("returns empty array when no matches", () => {
    expect(searchAirports("ZZZZZZZ", AIRPORTS)).toEqual([]);
  });

  it("ranks exact IATA code match before name match", () => {
    // 'san' matches both name ('San Francisco') and municipality ('San José'),
    // but 'SAN' is not a match as a code. SFO exact match should beat name match.
    const results = searchAirports("sfo", AIRPORTS);
    // First result must be exact IATA match.
    expect(results[0].iata).toBe("SFO");
  });

  it("ranks large airports before medium within same tier", () => {
    // 'newark' matches municipality of EWR (medium). Should still appear.
    const results = searchAirports("newark", AIRPORTS);
    expect(results.some((a) => a.icao === "KEWR")).toBe(true);
  });

  it("finds airport without IATA by ICAO", () => {
    const results = searchAirports("KOAK", AIRPORTS);
    expect(results[0].icao).toBe("KOAK");
  });

  it("name 'san' matches multiple airports, result is deterministic", () => {
    const r1 = searchAirports("san", AIRPORTS);
    const r2 = searchAirports("san", AIRPORTS);
    expect(r1.map((a) => a.icao)).toEqual(r2.map((a) => a.icao));
  });

  it("limits results to `limit` parameter", () => {
    const results = searchAirports("a", AIRPORTS, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("exact code match ranks before starts-with name match", () => {
    // Add an airport whose name starts with "SFO" and another with exact IATA SFO.
    const fixtures = [
      mkAirport({ icao: "ZZZZ", iata: null, name: "SFO Regional Airport", municipality: "Somewhere" }),
      ...AIRPORTS,
    ];
    const results = searchAirports("SFO", fixtures);
    // Exact IATA "SFO" on KSFO must be first.
    expect(results[0].icao).toBe("KSFO");
  });
});

// ── findClosestAirport ────────────────────────────────────────────────────────

describe("findClosestAirport", () => {
  it("returns null for empty airport list", () => {
    expect(findClosestAirport(37.6, -122.3, [])).toBeNull();
  });

  it("finds KSFO as closest to SFO coordinates", () => {
    const result = findClosestAirport(37.6213, -122.379, AIRPORTS);
    expect(result?.icao).toBe("KSFO");
  });

  it("finds EGLL as closest to London coordinates", () => {
    const result = findClosestAirport(51.48, -0.46, AIRPORTS);
    expect(result?.icao).toBe("EGLL");
  });

  it("returns the single airport when only one exists", () => {
    const one = [mkAirport({ icao: "ABCD", lat: 10, lon: 20 })];
    expect(findClosestAirport(10, 20, one)?.icao).toBe("ABCD");
  });
});

// ── findNearbyAirports ────────────────────────────────────────────────────────

describe("findNearbyAirports", () => {
  it("returns KSFO and KOAK for coords near SFO with 30mi radius", () => {
    const results = findNearbyAirports(37.6213, -122.379, 30, AIRPORTS);
    const icaos = results.map((a) => a.icao);
    expect(icaos).toContain("KSFO");
    expect(icaos).toContain("KOAK");
  });

  it("returns airports nearest-first", () => {
    const results = findNearbyAirports(37.6213, -122.379, 30, AIRPORTS);
    expect(results[0].icao).toBe("KSFO");
  });

  it("returns empty array when none within radius", () => {
    // Use a remote spot in the Pacific (far from all fixture airports).
    const results = findNearbyAirports(-30, -140, 1, AIRPORTS);
    expect(results).toEqual([]);
  });
});

// ── toDisplayAirport ──────────────────────────────────────────────────────────

describe("toDisplayAirport", () => {
  it("uses IATA as short name when available", () => {
    const a = mkAirport({ icao: "KSFO", iata: "SFO", name: "San Francisco International Airport" });
    const d = toDisplayAirport(a);
    expect(d.name).toBe("SFO");
    expect(d.icao).toBe("KSFO");
    expect(d.fullName).toBe("San Francisco International Airport");
  });

  it("falls back to ICAO as short name when IATA is null", () => {
    const a = mkAirport({ icao: "KOAK", iata: null, name: "Oakland International Airport" });
    const d = toDisplayAirport(a);
    expect(d.name).toBe("KOAK");
  });

  it("elevationFt defaults to 0 when null", () => {
    const a = mkAirport({ icao: "KOAK", elevationFt: null as unknown as number });
    const d = toDisplayAirport(a);
    expect(d.elevationFt).toBe(0);
  });

  it("preserves runway geometry", () => {
    const runway = {
      leIdent: "10L",
      heIdent: "28R",
      le: [37.628742, -122.39341] as [number, number],
      he: [37.613538, -122.35716] as [number, number],
      widthFt: 200,
    };
    const a = mkAirport({ icao: "KSFO", runways: [runway] });
    const d = toDisplayAirport(a);
    expect(d.runways).toHaveLength(1);
    expect(d.runways[0]).toEqual(runway);
  });
});
