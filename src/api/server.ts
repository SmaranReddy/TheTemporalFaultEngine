import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { healthCheck as dbHealthCheck } from "../db/index.js";
import { logger } from "../logger/index.js";
import { healthCheck as redisHealthCheck } from "../redis/index.js";
import { dashboardHtml } from "./dashboard.js";
import {
  getMetrics,
  getPrometheusMetrics,
  insertEvent,
  listEvents,
  runBenchmark,
} from "./events.js";
import { handleWebSocketUpgrade } from "./realtime.js";

export interface ApiServerController {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createApiServer(): ApiServerController {
  const server = createServer(route);
  server.on("upgrade", handleWebSocketUpgrade);

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(env.PORT, () => {
          logger.info({ port: env.PORT }, "API server listening");
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          logger.info("API server stopped");
          resolve();
        });
      });
    },
  };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      send(res, 200, dashboardHtml, "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const [database, redis] = await Promise.all([
        dbHealthCheck(),
        redisHealthCheck(),
      ]);
      sendJson(res, database && redis ? 200 : 503, {
        status: database && redis ? "healthy" : "unhealthy",
        dependencies: { database, redis },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/events") {
      const event = await insertEvent(await readJson(req));
      sendJson(res, 201, event);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      sendJson(res, 200, await listEvents(url.searchParams));
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics/json") {
      sendJson(res, 200, await getMetrics());
      return;
    }

    if (req.method === "GET" && url.pathname === "/metrics") {
      send(res, 200, await getPrometheusMetrics(), "text/plain; charset=utf-8");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/benchmarks/run") {
      sendJson(res, 201, await runBenchmark(await readJson(req)));
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    if (err instanceof ZodError) {
      sendJson(res, 400, { error: "Invalid request", issues: err.issues });
      return;
    }

    logger.error({ err }, "API request failed");
    sendJson(res, 500, { error: "Internal server error" });
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};
  return JSON.parse(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
