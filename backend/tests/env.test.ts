import { describe, expect, test } from "bun:test";
import { EnvError, parseEnv } from "../src/config/env";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/db",
  REDIS_URL: "redis://:p@localhost:6381",
};

describe("parseEnv", () => {
  test("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
  });

  test("reports every problem at once", () => {
    try {
      parseEnv({ PORT: "abc", NODE_ENV: "staging", REDIS_URL: "http://x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as EnvError).problems.join("|");
      expect(msg).toContain("DATABASE_URL is required");
      expect(msg).toContain("PORT must be an integer");
      expect(msg).toContain("NODE_ENV must be one of");
      expect(msg).toContain("REDIS_URL must start with");
    }
  });

  test("splits comma separated CORS origins", () => {
    const env = parseEnv({ ...base, CORS_ORIGIN: "https://a.com, https://b.com" });
    expect(env.CORS_ORIGINS).toEqual(["https://a.com", "https://b.com"]);
  });

  test("parses booleans strictly", () => {
    expect(parseEnv({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(() => parseEnv({ ...base, TRUST_PROXY: "maybe" })).toThrow(EnvError);
  });
});
