#!/usr/bin/env node
/**
 * generate-airports.mjs
 *
 * Generates web/public/data/airports.json from OurAirports CSV data.
 *
 * Usage (download fresh snapshot):
 *   node scripts/generate-airports.mjs
 *
 * Usage (from local files):
 *   node scripts/generate-airports.mjs \
 *     --airports /path/to/airports.csv \
 *     --runways  /path/to/runways.csv
 *
 * Data source: https://ourairports.com/data/
 * License:     CC0 (public domain) — https://ourairports.com/about.html#license
 *
 * Exits 0 on success, non-zero on any input/processing error.
 * Reports included/skipped counts and output file size to stdout.
 */

import { createReadStream, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "web/public/data");
const OUT_FILE = resolve(OUT_DIR, "airports.json");

const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv";

// Sanity guard: fail if we keep fewer than this many airports (catches
// malformed input or upstream format changes).
const MIN_EXPECTED_AIRPORTS = 500;

// Parse command-line arguments.
function parseArgs(argv) {
  const args = { airportsPath: null, runwaysPath: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--airports" && argv[i + 1]) args.airportsPath = argv[++i];
    if (argv[i] === "--runways" && argv[i + 1]) args.runwaysPath = argv[++i];
  }
  return args;
}

// Proper CSV line splitter that handles quoted fields, escaped quotes, and
// Unicode content. Handles \r\n and \n line endings.
function parseCsvLine(line) {
  const fields = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field.
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (i < line.length && line[i] === ",") i++;
    } else {
      // Unquoted field.
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i));
      if (i < line.length && line[i] === ",") i++;
    }
  }

  // A trailing comma means one final empty field.
  if (line.length > 0 && line[line.length - 1] === ",") fields.push("");

  return fields;
}

// Parse a full CSV text into array of header-keyed objects.
// Skips blank lines. Returns { rows, headers }.
export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length || !lines[0].trim()) {
    throw new Error("CSV input is empty or has no header row");
  }
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = fields[j] ?? null;
    }
    rows.push(obj);
  }
  return { rows, headers };
}

// Validate a coordinate string and return a finite number or null.
export function parseCoord(value) {
  if (!value && value !== 0) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Determine if a row is a large or medium airport.
export function isEligibleType(type) {
  return type === "large_airport" || type === "medium_airport";
}

// Normalize an airport row into our compact format.
// Returns null if the row should be skipped.
export function normalizeAirport(row) {
  if (!isEligibleType(row.type)) return null;

  const lat = parseCoord(row.latitude_deg);
  const lon = parseCoord(row.longitude_deg);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const icao = (row.ident ?? "").trim();
  if (!icao) return null;

  const iata = (row.iata_code ?? "").trim();
  const elevStr = (row.elevation_ft ?? "").trim();
  const elevationFt = elevStr ? Number(elevStr) : null;

  return {
    id: String(row.id ?? ""),
    icao,
    iata: iata || null,
    name: (row.name ?? "").trim(),
    municipality: (row.municipality ?? "").trim() || null,
    country: (row.iso_country ?? "").trim() || null,
    lat,
    lon,
    elevationFt: elevationFt !== null && Number.isFinite(elevationFt) ? elevationFt : null,
    type: row.type,
    scheduledService: row.scheduled_service === "yes",
  };
}

// Normalize a runway row. Returns null if it should be skipped.
export function normalizeRunway(row) {
  // Skip closed runways.
  if (row.closed === "1" || row.closed === "yes") return null;

  const leLat = parseCoord(row.le_latitude_deg);
  const leLon = parseCoord(row.le_longitude_deg);
  const heLat = parseCoord(row.he_latitude_deg);
  const heLon = parseCoord(row.he_longitude_deg);

  // Both threshold coordinates must be valid.
  if (leLat === null || leLon === null || heLat === null || heLon === null) return null;

  const widthStr = (row.width_ft ?? "").trim();
  const widthFt = widthStr ? Number(widthStr) : 150;

  return {
    airportRef: String(row.airport_ref ?? ""),
    leIdent: (row.le_ident ?? "").trim(),
    heIdent: (row.he_ident ?? "").trim(),
    le: [leLat, leLon],
    he: [heLat, heLon],
    widthFt: Number.isFinite(widthFt) && widthFt > 0 ? widthFt : 150,
  };
}

// Validate processed airports and runways, deduplicate, and sort.
export function buildAirportIndex(airportRows, runwayRows) {
  const skip = {
    type: 0,
    coords: 0,
    noIdent: 0,
  };

  // First pass: normalize airports.
  const byId = new Map(); // id -> normalized airport
  const byIcao = new Map(); // icao -> first airport id (dedup)

  for (const row of airportRows) {
    if (!isEligibleType(row.type)) { skip.type++; continue; }

    const airport = normalizeAirport(row);
    if (!airport) {
      if (!isEligibleType(row.type)) skip.type++;
      else skip.coords++;
      continue;
    }

    const icaoUpper = airport.icao.toUpperCase();
    if (byIcao.has(icaoUpper)) {
      // Duplicate ICAO — keep the first occurrence.
      skip.coords++;
      continue;
    }
    byId.set(airport.id, airport);
    byIcao.set(icaoUpper, airport.id);
  }

  // Second pass: normalize runways and group by airport id.
  const runwaysByAirport = new Map(); // airport id -> Runway[]
  let runwaysSkipped = 0;

  for (const row of runwayRows) {
    const rwy = normalizeRunway(row);
    if (!rwy) { runwaysSkipped++; continue; }

    const airportId = rwy.airportRef;
    if (!byId.has(airportId)) continue; // runway for airport we don't have

    let list = runwaysByAirport.get(airportId);
    if (!list) { list = []; runwaysByAirport.set(airportId, list); }
    list.push({
      leIdent: rwy.leIdent,
      heIdent: rwy.heIdent,
      le: rwy.le,
      he: rwy.he,
      widthFt: rwy.widthFt,
    });
  }

  // Build final airport objects with runways, sorted by ICAO ident.
  const airports = Array.from(byId.values())
    .map((a) => ({ ...a, runways: runwaysByAirport.get(a.id) ?? [] }))
    .sort((a, b) => a.icao.localeCompare(b.icao));

  return {
    airports,
    stats: {
      included: airports.length,
      skippedType: skip.type,
      skippedCoords: skip.coords + skip.noIdent,
      runwaysSkipped,
    },
  };
}

// Fetch a URL and return text content.
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? httpsGet : httpGet;
    mod(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// Read a local file as text.
function readFile(path) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(path, "utf8") });
    const lines = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => resolve(lines.join("\n")));
    rl.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv);

  console.log("OurAirports airport data generator");
  console.log("===================================");

  let airportsCsv, runwaysCsv;

  if (args.airportsPath) {
    console.log(`Reading airports from: ${args.airportsPath}`);
    if (!existsSync(args.airportsPath)) {
      console.error(`ERROR: File not found: ${args.airportsPath}`);
      process.exit(1);
    }
    airportsCsv = await readFile(args.airportsPath);
  } else {
    console.log(`Downloading airports from: ${AIRPORTS_URL}`);
    try {
      airportsCsv = await fetchUrl(AIRPORTS_URL);
    } catch (err) {
      console.error(`ERROR: Failed to download airports CSV: ${err.message}`);
      process.exit(1);
    }
  }

  if (args.runwaysPath) {
    console.log(`Reading runways from: ${args.runwaysPath}`);
    if (!existsSync(args.runwaysPath)) {
      console.error(`ERROR: File not found: ${args.runwaysPath}`);
      process.exit(1);
    }
    runwaysCsv = await readFile(args.runwaysPath);
  } else {
    console.log(`Downloading runways from: ${RUNWAYS_URL}`);
    try {
      runwaysCsv = await fetchUrl(RUNWAYS_URL);
    } catch (err) {
      console.error(`ERROR: Failed to download runways CSV: ${err.message}`);
      process.exit(1);
    }
  }

  // Parse CSVs.
  let airportRows, runwayRows;
  try {
    ({ rows: airportRows } = parseCsv(airportsCsv));
  } catch (err) {
    console.error(`ERROR: Failed to parse airports CSV: ${err.message}`);
    process.exit(1);
  }
  try {
    ({ rows: runwayRows } = parseCsv(runwaysCsv));
  } catch (err) {
    console.error(`ERROR: Failed to parse runways CSV: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nParsed ${airportRows.length} airport rows, ${runwayRows.length} runway rows`);

  // Build index.
  const { airports, stats } = buildAirportIndex(airportRows, runwayRows);

  console.log(`\nResults:`);
  console.log(`  Included airports:   ${stats.included}`);
  console.log(`  Skipped (type):      ${stats.skippedType}`);
  console.log(`  Skipped (coords/dup):${stats.skippedCoords}`);
  console.log(`  Runways skipped:     ${stats.runwaysSkipped}`);

  // Sanity guard.
  if (airports.length < MIN_EXPECTED_AIRPORTS) {
    console.error(
      `\nERROR: Sanity check failed — only ${airports.length} airports included ` +
      `(expected at least ${MIN_EXPECTED_AIRPORTS}). ` +
      `Check input CSV validity and format.`
    );
    process.exit(1);
  }

  // Build output.
  const now = new Date().toISOString();
  const output = {
    meta: {
      generated: now,
      generatorVersion: "1",
      sourceUrl: "https://ourairports.com/data/",
      license: "CC0 — https://ourairports.com/about.html#license",
      included: airports.length,
      skipped: {
        type: stats.skippedType,
        coordsOrDup: stats.skippedCoords,
        runways: stats.runwaysSkipped,
      },
    },
    airports,
  };

  // Write output.
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(output);
  writeFileSync(OUT_FILE, json, "utf8");

  const kb = (json.length / 1024).toFixed(1);
  console.log(`\nWrote: ${OUT_FILE}`);
  console.log(`Size: ${kb} KB (${airports.length} airports)`);
  console.log("\nDone. Review the included/skipped counts above before committing.");
}

// Only run main() when executed directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  });
}
