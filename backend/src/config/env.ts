// Typed, validated environment. Every problem is collected and reported together so a
// misconfigured deploy fails once, loudly, at startup instead of at the first request.
// Bun loads backend/.env (and .env.test when NODE_ENV=test) automatically.

type Source = Record<string, string | undefined>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join("\n  - ")}\n(see backend/.env.example)`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Source) {
  const problems: string[] = [];

  const str = (name: string, fallback?: string): string => {
    const value = source[name]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    problems.push(`${name} is required`);
    return "";
  };

  const int = (name: string, fallback: number, min = 0): number => {
    const raw = source[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      problems.push(`${name} must be an integer >= ${min} (got "${raw}")`);
      return fallback;
    }
    return value;
  };

  const bool = (name: string, fallback: boolean): boolean => {
    const raw = source[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (["true", "1", "yes"].includes(raw)) return true;
    if (["false", "0", "no"].includes(raw)) return false;
    problems.push(`${name} must be true or false (got "${raw}")`);
    return fallback;
  };

  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = source[name]?.trim();
    if (!raw) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    problems.push(`${name} must be one of ${allowed.join(", ")} (got "${raw}")`);
    return fallback;
  };

  const url = (name: string, protocols: string[]): string => {
    const value = str(name);
    if (!value) return value;
    try {
      const parsed = new URL(value);
      if (!protocols.includes(parsed.protocol)) {
        problems.push(`${name} must start with ${protocols.join(" or ")}`);
      }
    } catch {
      problems.push(`${name} is not a valid URL`);
    }
    return value;
  };

  const NODE_ENV = oneOf("NODE_ENV", ["development", "test", "production"], "development");

  const env = {
    NODE_ENV,
    PORT: int("PORT", 4000, 1),
    LOG_LEVEL: oneOf("LOG_LEVEL", ["fatal", "error", "warn", "info", "debug", "trace", "silent"], "info"),
    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGINS: str("CORS_ORIGIN", "http://localhost:5173")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    DATABASE_URL: url("DATABASE_URL", ["postgresql:", "postgres:"]),
    REDIS_URL: url("REDIS_URL", ["redis:", "rediss:"]),
    /** Trust X-Forwarded-For for the client IP. Only enable behind a proxy you control. */
    TRUST_PROXY: bool("TRUST_PROXY", false),
    RATE_LIMIT_ENABLED: bool("RATE_LIMIT_ENABLED", true),
    /** Default per-IP request budget per minute for public routes. */
    RATE_LIMIT_DEFAULT_PER_MIN: int("RATE_LIMIT_DEFAULT_PER_MIN", 300, 1),
    /** Maximum request body size in bytes (imports override this per route in Phase 4). */
    MAX_BODY_BYTES: int("MAX_BODY_BYTES", 1_048_576, 1024),
    /** Staff session lifetime in days (absolute, not sliding). */
    SESSION_TTL_DAYS: int("SESSION_TTL_DAYS", 7, 1),
    /** Salt for hashing client IPs before they are stored. Must be set in production. */
    IP_HASH_SALT: str("IP_HASH_SALT", NODE_ENV === "production" ? "" : "dev-only-ip-salt"),
  };

  if (problems.length > 0) throw new EnvError(problems);
  return env;
}

export type Env = ReturnType<typeof parseEnv>;

export const env: Env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
