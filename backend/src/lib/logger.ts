import pino from "pino";
import pretty from "pino-pretty";
import { env, isProduction } from "../config/env";

// Console-only logging. Pretty/coloured in development, JSON lines in production
// (JSON is what log shippers / telemetry will want later).
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: "brightpath-backend" },
    // PII and secrets never reach the logs (plan §3.3 rule 10). Paths cover top-level and one level deep.
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        ...["password", "passwordHash", "token", "name", "email", "phone", "phoneE164", "city"].flatMap((k) => [k, `*.${k}`]),
      ],
      censor: "[redacted]",
    },
  },
  isProduction
    ? undefined
    : pretty({ colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" }),
);

export type Logger = typeof logger;
