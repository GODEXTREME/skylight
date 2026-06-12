import { useStream } from "../lib/useStream.js";

/**
 * Embeds the Avionio airport arrivals/departures widget in a sandboxed iframe.
 * The airport code and direction come from config (set via the Control panel).
 * If no airport is configured the panel shows a placeholder — ADS-B tracking
 * and other panels are completely unaffected either way.
 */
export function AirportBoard() {
  const { state } = useStream("control");
  const cfg = state.config;

  if (!cfg) {
    return (
      <div className="airport-board">
        <div className="airport-board-empty">
          <span className="airport-board-empty-title">
            {state.connected ? "Loading…" : "Connecting…"}
          </span>
        </div>
      </div>
    );
  }

  const { airportCode, direction } = cfg.airportBoard;

  if (!airportCode.trim()) {
    return (
      <div className="airport-board">
        <div className="airport-board-empty">
          <span className="airport-board-empty-title">Airport board not configured</span>
          <span className="airport-board-empty-hint">
            Set an airport IATA code in the Control panel → Airport board section.
          </span>
        </div>
      </div>
    );
  }

  const code = airportCode.trim().toUpperCase();
  const src = `https://www.avionio.com/widget/en/${code}/${direction}`;

  return (
    <div className="airport-board">
      <iframe
        className="airport-board-frame"
        src={src}
        title={`${code} ${direction}`}
        /*
         * Sandbox: allow scripts (widget requires JS) and same-origin for the
         * widget's own XHR, but block top-navigation, popups, and forms so
         * the untrusted embed cannot redirect the parent page or exfiltrate
         * data through form submission.
         */
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
    </div>
  );
}
