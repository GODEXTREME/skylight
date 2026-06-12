/**
 * Tests for the core data-processing functions in scripts/generate-airports.mjs.
 *
 * We import the ES module functions by path. Vitest handles .mjs files.
 */
import { describe, expect, it } from "vitest";
// Dynamic import so the test works even if generate-airports.mjs is not in the
// TypeScript project's compile path.
const gen = await import("../../scripts/generate-airports.mjs");
const {
  parseCsv,
  parseCoord,
  isEligibleType,
  normalizeAirport,
  normalizeRunway,
  buildAirportIndex,
} = gen;

// ── parseCsv ──────────────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses a simple two-column CSV", () => {
    const { rows } = parseCsv("id,name\n1,Alpha\n2,Beta");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: "1", name: "Alpha" });
    expect(rows[1]).toEqual({ id: "2", name: "Beta" });
  });

  it("handles quoted fields with embedded commas", () => {
    const { rows } = parseCsv(`id,name\n1,"Kennedy, JFK"`);
    expect(rows[0].name).toBe("Kennedy, JFK");
  });

  it("handles escaped double-quotes inside quoted fields", () => {
    const { rows } = parseCsv(`id,name\n1,"He said ""hello"""`);
    expect(rows[0].name).toBe(`He said "hello"`);
  });

  it("handles Windows line endings (CRLF)", () => {
    const { rows } = parseCsv("id,name\r\n1,Alpha\r\n2,Beta");
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe("1");
  });

  it("skips blank lines", () => {
    const { rows } = parseCsv("id,name\n1,Alpha\n\n2,Beta\n");
    expect(rows).toHaveLength(2);
  });

  it("handles Unicode content", () => {
    const { rows } = parseCsv("id,name\n1,Schiphol–Amsterdam");
    expect(rows[0].name).toBe("Schiphol–Amsterdam");
  });

  it("throws on empty input", () => {
    expect(() => parseCsv("")).toThrow();
    expect(() => parseCsv("\n")).toThrow();
  });

  it("returns undefined/null for missing trailing fields", () => {
    const { rows } = parseCsv("a,b,c\n1,2");
    // Field 'c' is missing from data row — acceptable as null or undefined.
    expect(rows[0].c == null).toBe(true);
  });
});

// ── parseCoord ────────────────────────────────────────────────────────────────

describe("parseCoord", () => {
  it("parses valid lat string", () => expect(parseCoord("37.6213")).toBe(37.6213));
  it("parses negative lon string", () => expect(parseCoord("-122.379")).toBe(-122.379));
  it("returns null for empty string", () => expect(parseCoord("")).toBeNull());
  it("returns null for null input", () => expect(parseCoord(null)).toBeNull());
  it("returns null for NaN strings", () => expect(parseCoord("abc")).toBeNull());
  it("returns null for Infinity", () => expect(parseCoord("Infinity")).toBeNull());
  it("returns 0 for literal zero", () => expect(parseCoord("0")).toBe(0));
});

// ── isEligibleType ────────────────────────────────────────────────────────────

describe("isEligibleType", () => {
  it("accepts large_airport", () => expect(isEligibleType("large_airport")).toBe(true));
  it("accepts medium_airport", () => expect(isEligibleType("medium_airport")).toBe(true));
  it("rejects small_airport", () => expect(isEligibleType("small_airport")).toBe(false));
  it("rejects heliport", () => expect(isEligibleType("heliport")).toBe(false));
  it("rejects balloonport", () => expect(isEligibleType("balloonport")).toBe(false));
  it("rejects seaplane_base", () => expect(isEligibleType("seaplane_base")).toBe(false));
});

// ── normalizeAirport ──────────────────────────────────────────────────────────

describe("normalizeAirport", () => {
  const validRow = {
    id: "3469",
    ident: "KSFO",
    type: "large_airport",
    name: "San Francisco International Airport",
    latitude_deg: "37.6213",
    longitude_deg: "-122.379",
    elevation_ft: "13",
    iso_country: "US",
    municipality: "San Francisco",
    scheduled_service: "yes",
    iata_code: "SFO",
  };

  it("normalizes a valid large airport row", () => {
    const a = normalizeAirport(validRow);
    expect(a).not.toBeNull();
    expect(a?.icao).toBe("KSFO");
    expect(a?.iata).toBe("SFO");
    expect(a?.lat).toBe(37.6213);
    expect(a?.lon).toBe(-122.379);
    expect(a?.elevationFt).toBe(13);
    expect(a?.scheduledService).toBe(true);
    expect(a?.type).toBe("large_airport");
  });

  it("returns null for small_airport", () => {
    expect(normalizeAirport({ ...validRow, type: "small_airport" })).toBeNull();
  });

  it("returns null for invalid latitude", () => {
    expect(normalizeAirport({ ...validRow, latitude_deg: "abc" })).toBeNull();
    expect(normalizeAirport({ ...validRow, latitude_deg: "" })).toBeNull();
  });

  it("returns null for invalid longitude", () => {
    expect(normalizeAirport({ ...validRow, longitude_deg: null })).toBeNull();
  });

  it("returns null for missing ident", () => {
    expect(normalizeAirport({ ...validRow, ident: "" })).toBeNull();
  });

  it("sets iata to null when not present", () => {
    const a = normalizeAirport({ ...validRow, iata_code: "" });
    expect(a?.iata).toBeNull();
  });

  it("sets elevationFt to null when missing", () => {
    const a = normalizeAirport({ ...validRow, elevation_ft: "" });
    expect(a?.elevationFt).toBeNull();
  });

  it("handles scheduled_service !== 'yes' as false", () => {
    const a = normalizeAirport({ ...validRow, scheduled_service: "no" });
    expect(a?.scheduledService).toBe(false);
  });
});

// ── normalizeRunway ───────────────────────────────────────────────────────────

describe("normalizeRunway", () => {
  const validRwy = {
    airport_ref: "3469",
    le_ident: "10L",
    he_ident: "28R",
    le_latitude_deg: "37.628742",
    le_longitude_deg: "-122.39341",
    he_latitude_deg: "37.613538",
    he_longitude_deg: "-122.35716",
    width_ft: "200",
    closed: "0",
  };

  it("normalizes a valid open runway", () => {
    const r = normalizeRunway(validRwy);
    expect(r).not.toBeNull();
    expect(r?.leIdent).toBe("10L");
    expect(r?.heIdent).toBe("28R");
    expect(r?.le).toEqual([37.628742, -122.39341]);
    expect(r?.he).toEqual([37.613538, -122.35716]);
    expect(r?.widthFt).toBe(200);
  });

  it("returns null for closed runways (closed=1)", () => {
    expect(normalizeRunway({ ...validRwy, closed: "1" })).toBeNull();
  });

  it("returns null for closed runways (closed=yes)", () => {
    expect(normalizeRunway({ ...validRwy, closed: "yes" })).toBeNull();
  });

  it("returns null when LE threshold coordinates are invalid", () => {
    expect(normalizeRunway({ ...validRwy, le_latitude_deg: "" })).toBeNull();
    expect(normalizeRunway({ ...validRwy, le_longitude_deg: "not-a-number" })).toBeNull();
  });

  it("returns null when HE threshold coordinates are invalid", () => {
    expect(normalizeRunway({ ...validRwy, he_latitude_deg: null })).toBeNull();
    expect(normalizeRunway({ ...validRwy, he_longitude_deg: "" })).toBeNull();
  });

  it("defaults widthFt to 150 when missing", () => {
    const r = normalizeRunway({ ...validRwy, width_ft: "" });
    expect(r?.widthFt).toBe(150);
  });
});

// ── buildAirportIndex ─────────────────────────────────────────────────────────

describe("buildAirportIndex", () => {
  const airportRow = {
    id: "3469",
    ident: "KSFO",
    type: "large_airport",
    name: "San Francisco International Airport",
    latitude_deg: "37.6213",
    longitude_deg: "-122.379",
    elevation_ft: "13",
    iso_country: "US",
    municipality: "San Francisco",
    scheduled_service: "yes",
    iata_code: "SFO",
  };

  const runwayRow = {
    airport_ref: "3469",
    le_ident: "10L",
    he_ident: "28R",
    le_latitude_deg: "37.628742",
    le_longitude_deg: "-122.39341",
    he_latitude_deg: "37.613538",
    he_longitude_deg: "-122.35716",
    width_ft: "200",
    closed: "0",
  };

  it("includes eligible airports with their runways", () => {
    const { airports, stats } = buildAirportIndex([airportRow], [runwayRow]);
    expect(airports).toHaveLength(1);
    expect(airports[0].icao).toBe("KSFO");
    expect(airports[0].runways).toHaveLength(1);
    expect(stats.included).toBe(1);
  });

  it("skips runways for airports not in the index", () => {
    const orphanRwy = { ...runwayRow, airport_ref: "99999" };
    const { airports } = buildAirportIndex([airportRow], [orphanRwy]);
    expect(airports[0].runways).toHaveLength(0);
  });

  it("skips small airports and counts them", () => {
    const small = { ...airportRow, id: "9999", ident: "KSMALL", type: "small_airport" };
    const { airports, stats } = buildAirportIndex([airportRow, small], []);
    expect(airports).toHaveLength(1);
    expect(stats.skippedType).toBe(1);
  });

  it("deduplicates by ICAO ident (keeps first occurrence)", () => {
    const dup = { ...airportRow, id: "9999" }; // same ident KSFO
    const { airports, stats } = buildAirportIndex([airportRow, dup], []);
    expect(airports).toHaveLength(1);
    expect(stats.skippedCoords).toBeGreaterThan(0);
  });

  it("skips closed runways", () => {
    const closed = { ...runwayRow, closed: "1" };
    const { airports } = buildAirportIndex([airportRow], [closed]);
    expect(airports[0].runways).toHaveLength(0);
  });

  it("skips runways with invalid threshold coords", () => {
    const bad = { ...runwayRow, le_latitude_deg: "" };
    const { airports } = buildAirportIndex([airportRow], [bad]);
    expect(airports[0].runways).toHaveLength(0);
  });

  it("sorts airports alphabetically by ICAO", () => {
    const lhr = {
      ...airportRow,
      id: "2434",
      ident: "EGLL",
      name: "London Heathrow Airport",
      iata_code: "LHR",
    };
    const { airports } = buildAirportIndex([airportRow, lhr], []);
    expect(airports[0].icao).toBe("EGLL");
    expect(airports[1].icao).toBe("KSFO");
  });

  it("output is deterministic on repeated calls with same input", () => {
    const rows = [airportRow];
    const r1 = buildAirportIndex(rows, [runwayRow]);
    const r2 = buildAirportIndex(rows, [runwayRow]);
    expect(r1.airports[0].icao).toEqual(r2.airports[0].icao);
    expect(r1.airports[0].runways).toEqual(r2.airports[0].runways);
  });

  it("handles malformed airport row gracefully (no throw)", () => {
    const bad = { id: "1", ident: "BAD", type: "large_airport", latitude_deg: "NOT_A_NUM" };
    expect(() => buildAirportIndex([bad], [])).not.toThrow();
  });
});
