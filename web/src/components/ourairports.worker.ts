/**
 * RETIRED — this worker is no longer used.
 *
 * Runtime downloads of upstream GitHub Pages CSVs have been replaced with a
 * static build-time generator (scripts/generate-airports.mjs) and on-demand
 * fetch from /data/airports.json. See airportSearch.ts and ourairports.ts.
 *
 * This file is intentionally empty so that any stale build artefact referencing
 * it fails loudly rather than silently downloading from an upstream host.
 */

// No code — do not add any. This worker is not registered in production.
export {};
