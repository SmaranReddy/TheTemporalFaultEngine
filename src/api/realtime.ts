import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { logger } from "../logger/index.js";

export type RealtimeMessage =
  | {
      type: "event.created" | "event.updated";
      eventId: string;
      status?: string;
      at: string;
    }
  | {
      type: "metrics.snapshot";
      metrics: unknown;
      at: string;
    };

const clients = new Set<Socket>();

export function handleWebSocketUpgrade(
  req: IncomingMessage,
  socket: Socket
): void {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n")
  );

  clients.add(socket);
  logger.info({ clients: clients.size }, "WebSocket client connected");

  socket.on("close", () => {
    clients.delete(socket);
    logger.info({ clients: clients.size }, "WebSocket client disconnected");
  });
  socket.on("error", () => clients.delete(socket));
  socket.on("data", () => {
    // Dashboards are receive-only; incoming frames are intentionally ignored.
  });
}

export function broadcast(message: RealtimeMessage): void {
  const frame = encodeFrame(JSON.stringify(message));

  for (const client of clients) {
    if (client.destroyed) {
      clients.delete(client);
      continue;
    }

    client.write(frame, (err) => {
      if (!err) return;
      clients.delete(client);
      client.destroy();
    });
  }
}

export function eventStatusChanged(eventId: string, status: string): void {
  broadcast({
    type: "event.updated",
    eventId,
    status,
    at: new Date().toISOString(),
  });
}

function encodeFrame(payload: string): Buffer {
  const body = Buffer.from(payload);
  const length = body.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), body]);
  }

  if (length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}
