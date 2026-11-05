import pino from "pino";
import pretty from "pino-pretty";
import { env, isProduction } from "../config/env";

// Console-only logging. Pretty/coloured in development, JSON lines in production
// (JSON is what log shippers / telemetry will want later).
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: "brightpath-backend" },
    redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
  },
  isProduction
    ? undefined
    : pretty({ colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" }),
);

export type Logger = typeof logger;
