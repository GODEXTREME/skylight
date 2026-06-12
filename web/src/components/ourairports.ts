/**
 * Runtime helpers that translate the static airport dataset into the geometry
 * shapes used by the renderer and the setup wizard.
 *
 * Data is fetched lazily from /data/airports.json (generated at build/maintenance
 * time by scripts/generate-airports.mjs). No runtime requests to upstream CSVs.
 */

import {
  loadAirports,
  findClosestAirport,
  findNearbyAirports,
  toDisplayAirport,
} from "./airportSearch.js";

export interface CustomAirport {
  icao: string;
  name: string;
  fullName: string;
  lat: number;
  lon: number;
  elevationFt: number;
  runways: {
    leIdent: string;
    heIdent: string;
    le: [number, number];
    he: [number, number];
    widthFt: number;
  }[];
}

/**
 * Return the closest large/medium airport to the given coordinates, with its
 * runway geometry, from the static dataset.
 *
 * Returns null if the dataset is unavailable or empty (bundled airports and any
 * saved customAirport remain usable).
 */
export async function fetchClosestAirport(
  lat: number,
  lon: number,
): Promise<CustomAirport | null> {
  const airports = await loadAirports();
  if (!airports.length) return null;
  const closest = findClosestAirport(lat, lon, airports);
  return closest ? toDisplayAirport(closest) : null;
}

/**
 * Return all large/medium airports within `radiusMiles` of the given coordinates,
 * nearest-first, with runway geometry.
 */
export async function fetchNearbyAirports(
  lat: number,
  lon: number,
  radiusMiles = 150,
): Promise<CustomAirport[]> {
  const airports = await loadAirports();
  if (!airports.length) return [];
  return findNearbyAirports(lat, lon, radiusMiles, airports).map(toDisplayAirport);
}
