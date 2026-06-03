import pino from "pino";
import { env } from "../config/env.js";

function createLogger(): pino.Logger {
  const level = env.NODE_ENV === "test" ? "silent" : "info";

  if (env.NODE_ENV === "development") {
    return pino({
      level,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
      },
    });
  }

  return pino({
    level,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  });
}

export const logger = createLogger();

export type Logger = typeof logger;
