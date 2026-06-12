import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { LeafletMouseEvent } from "leaflet";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import {
  loadAirports,
  searchAirports,
  findClosestAirport,
  toDisplayAirport,
} from "./airportSearch.js";
import type { AirportRecord } from "./airportSearch.js";

interface GeocodeResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface SetupStatus {
  hasSavedConfig: boolean;
  airportBoardCode?: string;
}

interface SelectedAirport {
  record: AirportRecord;
  display: ReturnType<typeof toDisplayAirport>;
}

const PRESETS = [
  { id: "home", label: "Home", description: "Balanced local view", radiusMiles: 3 },
  { id: "airport", label: "Airport", description: "Wider approach coverage", radiusMiles: 8 },
] as const;

function ClickToSet({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e: LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

function Recenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lon]);
  }, [lat, lon, map]);
  return null;
}

export function LocationWizard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [lat, setLat] = useState(37.6213);
  const [lon, setLon] = useState(-122.379);
  const [radiusMiles, setRadiusMiles] = useState(3);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // Airport search state.
  const [airportQuery, setAirportQuery] = useState("");
  const [airportResults, setAirportResults] = useState<AirportRecord[]>([]);
  const [selectedAirport, setSelectedAirport] = useState<SelectedAirport | null>(null);
  const [allAirports, setAllAirports] = useState<AirportRecord[]>([]);
  const [airportsLoaded, setAirportsLoaded] = useState(false);
  const [airportLoadError, setAirportLoadError] = useState(false);
  const airportSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Board-code sync offer.
  const [syncBoardCode, setSyncBoardCode] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/config").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/setup/status").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([cfg, s]) => {
        if (!live) return;
        if (cfg) {
          setLat(Number(cfg.centerLat) || 0);
          setLon(Number(cfg.centerLon) || 0);
          setRadiusMiles(Number(cfg.radiusMiles) || 3);
        }
        if (s) setStatus(s as SetupStatus);
      })
      .catch(() => {
        if (live) setError("Failed to load current settings.");
      });
    return () => { live = false; };
  }, []);

  // Pre-load airports dataset so search is instant.
  useEffect(() => {
    loadAirports().then((airports) => {
      setAllAirports(airports);
      setAirportsLoaded(true);
      if (!airports.length) setAirportLoadError(true);
    });
  }, []);

  // Debounced airport search.
  useEffect(() => {
    if (airportSearchTimer.current) clearTimeout(airportSearchTimer.current);
    const q = airportQuery.trim();
    if (q.length < 2) {
      setAirportResults([]);
      return;
    }
    airportSearchTimer.current = setTimeout(() => {
      setAirportResults(searchAirports(q, allAirports, 8));
    }, 120);
    return () => { if (airportSearchTimer.current) clearTimeout(airportSearchTimer.current); };
  }, [airportQuery, allAirports]);

  const position = useMemo<[number, number]>(() => [lat, lon], [lat, lon]);

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("search failed");
      const data = (await res.json()) as GeocodeResult[];
      setResults(data);
      if (data[0]) {
        setLat(Number(data[0].lat));
        setLon(Number(data[0].lon));
      }
    } catch {
      setError("Search failed. Enter coordinates manually.");
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (r: GeocodeResult) => {
    setLat(Number(r.lat));
    setLon(Number(r.lon));
    setResults([]);
  };

  const selectAirport = (a: AirportRecord) => {
    const display = toDisplayAirport(a);
    setSelectedAirport({ record: a, display });
    setLat(a.lat);
    setLon(a.lon);
    setAirportQuery("");
    setAirportResults([]);

    // Offer board-code sync if the airport has an IATA code.
    if (a.iata) {
      const existing = status?.airportBoardCode ?? "";
      if (!existing || existing.toUpperCase() !== a.iata) {
        setSyncBoardCode(a.iata);
      } else {
        setSyncBoardCode(null);
      }
    } else {
      setSyncBoardCode(null);
    }
  };

  const clearAirport = () => {
    setSelectedAirport(null);
    setSyncBoardCode(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let customAirport: SelectedAirport["display"] | null = null;

      if (selectedAirport) {
        customAirport = selectedAirport.display;
      } else {
        // Manual coordinates: attempt nearest airport lookup, non-fatal on failure.
        setSaveStatus("Looking up nearest airport geometry…");
        if (allAirports.length) {
          const nearest = findClosestAirport(lat, lon, allAirports);
          if (nearest) customAirport = toDisplayAirport(nearest);
        }
      }

      setSaveStatus("Saving config…");
      const body: Record<string, unknown> = {
        centerLat: lat,
        centerLon: lon,
        radiusMiles,
        customAirport: customAirport ?? null,
      };
      if (syncBoardCode) {
        body.airportBoardCode = syncBoardCode;
      }

      const res = await fetch("/api/setup/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? "Save failed");
      }
      location.assign("/control");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
      setSaveStatus("");
    }
  };

  return (
    <div className="setup-root">
      <header className="setup-header">
        <h1>Location setup</h1>
        <p>Pick your center point and preferred radius.</p>
      </header>

      <section className="setup-card">
        {/* Airport search */}
        <div className="setup-airport-search">
          <label className="setup-section-label">Airport</label>
          {selectedAirport ? (
            <div className="setup-airport-selected">
              <span className="setup-airport-name">
                {selectedAirport.record.iata
                  ? `${selectedAirport.record.iata} / ${selectedAirport.record.icao}`
                  : selectedAirport.record.icao}{" "}
                — {selectedAirport.record.name}
              </span>
              <button type="button" className="setup-airport-clear" onClick={clearAirport}>
                ✕ Clear
              </button>
            </div>
          ) : (
            <div className="setup-airport-input-wrap">
              <input
                type="search"
                placeholder={
                  airportLoadError
                    ? "Airport data unavailable — enter coordinates manually"
                    : airportsLoaded
                      ? "IATA / ICAO / name (e.g. SFO, KSFO, Heathrow)"
                      : "Loading airports…"
                }
                disabled={airportLoadError}
                value={airportQuery}
                onChange={(e) => setAirportQuery(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
              {airportLoadError && (
                <p className="setup-airport-warning">
                  Could not load airport data. Manual coordinates and previously saved runway
                  geometry will still work.
                </p>
              )}
            </div>
          )}

          {airportResults.length > 0 && !selectedAirport && (
            <ul className="setup-airport-results">
              {airportResults.map((a) => (
                <li key={a.icao}>
                  <button type="button" onClick={() => selectAirport(a)}>
                    <span className="airport-result-code">
                      {a.iata ? `${a.iata} / ${a.icao}` : a.icao}
                    </span>
                    <span className="airport-result-name">{a.name}</span>
                    {a.municipality && (
                      <span className="airport-result-muni">
                        {a.municipality}
                        {a.country ? `, ${a.country}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {syncBoardCode && (
            <div className="setup-board-sync">
              <span>
                Also set airport board code to <strong>{syncBoardCode}</strong>?
              </span>
              <button type="button" onClick={() => setSyncBoardCode(syncBoardCode)}>
                Yes, sync
              </button>
              <button type="button" onClick={() => setSyncBoardCode(null)}>
                No, keep existing
              </button>
            </div>
          )}
        </div>

        {/* Geocode search */}
        <form className="setup-search" onSubmit={runSearch}>
          <input
            type="search"
            placeholder="Search city or postcode"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {results.length > 0 && (
          <ul className="search-results">
            {results.map((r) => (
              <li key={`${r.lat}:${r.lon}:${r.display_name}`}>
                <button type="button" onClick={() => chooseResult(r)}>
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button key={preset.id} type="button" onClick={() => setRadiusMiles(preset.radiusMiles)}>
              {preset.label}
              <span>{preset.description}</span>
            </button>
          ))}
        </div>

        <div className="map-wrap">
          <MapContainer center={position} zoom={10} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Recenter lat={lat} lon={lon} />
            <ClickToSet onPick={(nextLat, nextLon) => {
              setLat(nextLat);
              setLon(nextLon);
              clearAirport();
            }} />
            <CircleMarker center={position} radius={8} pathOptions={{ color: "#9b7ecf" }} />
          </MapContainer>
        </div>

        <div className="field-grid">
          <label>
            Latitude
            <input
              type="number"
              min={-90}
              max={90}
              step="0.000001"
              value={lat}
              onChange={(e) => {
                setLat(Number(e.target.value));
                clearAirport();
              }}
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              min={-180}
              max={180}
              step="0.000001"
              value={lon}
              onChange={(e) => {
                setLon(Number(e.target.value));
                clearAirport();
              }}
            />
          </label>
          <label>
            Radius (miles)
            <input
              type="range"
              min={1}
              max={25}
              step={0.5}
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(Number(e.target.value))}
            />
            <strong>{radiusMiles.toFixed(1)} mi</strong>
          </label>
        </div>

        {error && <p className="setup-error">{error}</p>}
        {saveStatus && !error && <p className="setup-status">{saveStatus}</p>}

        <div className="setup-actions">
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save and continue"}
          </button>
          {status?.hasSavedConfig && (
            <button type="button" className="secondary" onClick={() => location.assign("/control")}>
              Cancel
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
