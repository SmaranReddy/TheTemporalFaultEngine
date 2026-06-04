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

// Periodic heartbeat to clean up stale connections.
// Every 15 seconds, we ping all clients. If a client didn't respond to the previous ping, we destroy it.
const HEARTBEAT_INTERVAL_MS = 15000;
const pingInterval = setInterval(() => {
  for (const client of clients) {
    if (client.destroyed) {
      clients.delete(client);
      continue;
    }

    if ((client as any).isAlive === false) {
      logger.warn("WebSocket client heartbeat timeout, cleaning up connection");
      clients.delete(client);
      client.destroy();
      continue;
    }

    (client as any).isAlive = false;
    // Send WebSocket Ping frame:
    // 0x89: FIN=1, RSV=000, Opcode=1001 (Ping)
    // 0x00: Mask=0, Payload Length=0
    client.write(Buffer.from([0x89, 0x00]), (err) => {
      if (err) {
        logger.warn({ err }, "Failed to write Ping to WebSocket client");
        clients.delete(client);
        client.destroy();
      }
    });
  }
}, HEARTBEAT_INTERVAL_MS);

// unref the interval so it doesn't block process exit
pingInterval.unref();

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

  (socket as any).isAlive = true;
  clients.add(socket);
  logger.info({ clients: clients.size }, "WebSocket client connected");

  const cleanup = () => {
    if (clients.has(socket)) {
      clients.delete(socket);
      logger.info({ clients: clients.size }, "WebSocket client disconnected");
    }
    socket.destroy();
  };

  socket.on("close", cleanup);
  socket.on("end", cleanup);
  socket.on("error", (err) => {
    logger.warn({ err }, "WebSocket client socket error");
    cleanup();
  });

  socket.on("data", (chunk) => {
    // Check WebSocket frame structure to handle control frames
    if (Buffer.isBuffer(chunk) && chunk.length > 0) {
      const firstByte = chunk[0];
      if (firstByte !== undefined) {
        const opcode = firstByte & 0x0f;

        if (opcode === 0x08) {
          // Connection Close frame from browser
          logger.info("WebSocket client sent close frame");
          cleanup();
        } else if (opcode === 0x0a) {
          // Pong frame response to our Ping
          (socket as any).isAlive = true;
        } else {
          // Any other data activity confirms the connection is alive
          (socket as any).isAlive = true;
        }
      }
    }
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
      logger.warn({ err }, "Error broadcasting to WebSocket client, removing");
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
