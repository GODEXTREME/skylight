// WebSocket hub: tracks connected clients (display + control panels),
// broadcasts config / aircraft / status, and applies inbound config commands.

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { PROTOCOL_VERSION } from "@shared/index.js";
import type {
  ClientMessage,
  ServerMessage,
  Config,
  Aircraft,
  GroundAircraft,
  SourceStatus,
} from "@shared/index.js";
import { ConfigValidationError, type ConfigStore } from "./config-store.js";

export interface HubDeps {
  store: ConfigStore;
  getSnapshot: () => { now: number; aircraft: Aircraft[] };
  getStatus: () => SourceStatus;
  /** Latest SFO surface snapshot (null until the first successful poll). */
  getSfoGround?: () => { at: number; aircraft: GroundAircraft[] } | null;
  /** Browser Origin check — defends against cross-site WebSocket hijack.
   *  Receives the raw Origin header value (undefined for non-browser clients). */
  isOriginAllowed?: (origin: string | undefined) => boolean;
}

export class Hub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, "display" | "control" | null>();
  private aircraftByHex = new Map<string, string>();
  private aircraftSeq = 0;
  private static readonly MAX_BUFFERED_BYTES = 1_000_000;
  private static readonly MAX_CLIENTS = 32;

  constructor(server: Server, private deps: HubDeps) {
    const allowOrigin = deps.isOriginAllowed ?? (() => true);
    this.wss = new WebSocketServer({
      server,
      path: "/ws",
      verifyClient: (info, cb) => {
        const origin = info.origin || info.req.headers.origin;
        if (allowOrigin(origin as string | undefined)) {
          cb(true);
        } else {
          cb(false, 403, "Forbidden: Origin not in allowlist");
        }
      },
    });
    this.wss.on("connection", (ws) => this.onConnect(ws));

    // Push config changes from any source (REST or another WS client).
    deps.store.subscribe((config) => this.broadcast({ type: "config", config }));
  }

  private onConnect(ws: WebSocket): void {
    if (this.clients.size >= Hub.MAX_CLIENTS) {
      ws.close(1013, "too many clients");
      return;
    }
    this.clients.set(ws, null);

    // Prime the new client with current state.
    this.send(ws, { type: "config", config: this.deps.store.get() });
    const snap = this.deps.getSnapshot();
    this.send(ws, { type: "aircraft", now: snap.now, seq: this.aircraftSeq, aircraft: snap.aircraft });
    this.send(ws, { type: "status", status: this.deps.getStatus() });
    const ground = this.deps.getSfoGround?.();
    if (ground) {
      this.send(ws, { type: "sfoGround", at: ground.at, aircraft: ground.aircraft });
    }

    ws.on("message", (raw) => this.onMessage(ws, raw.toString()));
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  private onMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "invalid JSON message" });
      return;
    }
    try {
      this.applyMessage(ws, msg);
    } catch (error) {
      const message = error instanceof ConfigValidationError ? error.message : "message handling failed";
      this.send(ws, { type: "error", requestId: "requestId" in msg ? msg.requestId : undefined, message });
    }
  }

  private applyMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "patchConfig":
        this.writeConfig(ws, () => this.deps.store.patch(msg.patch));
        this.ack(ws, msg.requestId);
        break;
      case "setConfig":
        this.writeConfig(ws, () => this.deps.store.set(msg.config));
        this.ack(ws, msg.requestId);
        break;
      case "resetConfig":
        this.deps.store.reset();
        this.ack(ws, msg.requestId);
        break;
      case "hello":
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.send(ws, { type: "error", message: `protocol version ${PROTOCOL_VERSION} required` });
          ws.close(1002, "protocol version mismatch");
          return;
        }
        this.clients.set(ws, msg.role);
        break;
      case "requestSnapshot": {
        const snap = this.deps.getSnapshot();
        this.send(ws, { type: "aircraft", now: snap.now, seq: this.aircraftSeq, aircraft: snap.aircraft });
        break;
      }
      case "ping":
        this.send(ws, { type: "pong" });
        break;
    }
  }

  broadcastAircraft(now: number, aircraft: Aircraft[]): void {
    const next = new Map<string, string>();
    const upsert: Aircraft[] = [];
    const alive: string[] = []; // present but unchanged since last broadcast
    for (const ac of aircraft) {
      const { ts: _snapshotTime, ...stableFields } = ac;
      const serialized = JSON.stringify(stableFields);
      next.set(ac.hex, serialized);
      if (this.aircraftByHex.get(ac.hex) !== serialized) {
        upsert.push(ac);
      } else {
        // Aircraft is known and unchanged — just signal it is still alive.
        alive.push(ac.hex);
      }
    }
    const remove = [...this.aircraftByHex.keys()].filter((hex) => !next.has(hex));
    this.aircraftByHex = next;
    this.aircraftSeq++;
    this.broadcast({ type: "aircraftDelta", now, seq: this.aircraftSeq, upsert, remove, alive });
  }
  broadcastStatus(status: SourceStatus): void {
    this.broadcast({ type: "status", status });
  }
  broadcastSfoGround(at: number, aircraft: GroundAircraft[]): void {
    this.broadcast({ type: "sfoGround", at, aircraft });
  }
  broadcastConfig(config: Config): void {
    this.broadcast({ type: "config", config });
  }

  private writeConfig(ws: WebSocket, write: () => void): void {
    try {
      write();
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        this.send(ws, { type: "config", config: this.deps.store.get() });
        return;
      }
      throw err;
    }
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > Hub.MAX_BUFFERED_BYTES) {
        if (msg.type === "aircraftDelta") continue;
        ws.close(1013, "client too slow");
        continue;
      }
      ws.send(data);
    }
  }
  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private ack(ws: WebSocket, requestId?: string): void {
    if (requestId) this.send(ws, { type: "ack", requestId });
  }

  close(): void {
    for (const ws of this.clients.keys()) ws.close(1001, "server shutting down");
    this.wss.close();
  }
}
