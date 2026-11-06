import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { AppError } from "../src/lib/errors";
import { redis } from "../src/lib/redis";
import { emptyQueryAsAbsent } from "../src/plugins/empty-query";
import { errorHandler } from "../src/plugins/error-handler";
import { rateLimit } from "../src/plugins/rate-limit";
import { requestId } from "../src/plugins/request-id";
import { call } from "./helpers";

describe("health", () => {
  test("GET /health is ok with a request id and security headers", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", services: { database: "up", redis: "up" } });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("echoes a well-formed inbound request id, ignores a malformed one", async () => {
    const good = await call("/health", { headers: { "x-request-id": "abc-12345678" } });
    expect(good.headers.get("x-request-id")).toBe("abc-12345678");
    const bad = await call("/health", { headers: { "x-request-id": "bad id with spaces" } });
    expect(bad.headers.get("x-request-id")).not.toBe("bad id with spaces");
  });
});

describe("error envelope", () => {
  test("unknown route -> 404 envelope", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND", message: expect.any(String), requestId: expect.any(String) } });
  });

  const probe = new Elysia()
    .use(requestId)
    .use(errorHandler)
    .post("/v", () => "ok", { body: t.Object({ phone: t.String({ minLength: 10 }), city: t.String({ minLength: 1 }) }) })
    .get("/boom", () => {
      throw new Error("secret internal detail");
    })
    .get("/app-error", () => {
      throw AppError.conflict("Already exists");
    })
    .post("/json", () => "ok", { body: t.Object({ a: t.String() }) });

  const hit = async (path: string, init?: RequestInit) => {
    const res = await probe.handle(new Request(`http://localhost${path}`, init));
    return { status: res.status, body: (await res.json()) as any };
  };

  test("validation failure -> 422 with per-field messages", async () => {
    const res = await hit("/v", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "123", city: "" }),
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.message).toBe("Please fix 2 things below.");
    expect(res.body.error.fields.map((f: any) => f.path).sort()).toEqual(["city", "phone"]);
  });

  test("malformed JSON -> 400 INVALID_REQUEST", async () => {
    const res = await hit("/json", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
  });

  test("unexpected error -> 500 without leaking details", async () => {
    const res = await hit("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
  });

  test("AppError keeps its status and code", async () => {
    const res = await hit("/app-error");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("rate limiter", () => {
  test("allows up to the limit, then 429 with Retry-After", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const limited = new Elysia()
      .use(requestId)
      .use(errorHandler)
      .use(rateLimit({ name, limit: 2, windowSec: 30, enabled: true, key: () => "tester" }))
      .get("/x", () => ({ ok: true }));
    const get = () => limited.handle(new Request("http://localhost/x"));

    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    const third = await get();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await third.json()) as any).error.code).toBe("RATE_LIMITED");
    await redis.del(`rl:${name}:tester`);
  });
});

describe("global rate limiter ordering", () => {
  test("a global limiter covers routes mounted by later modules but not earlier ones", async () => {
    const name = `test-${crypto.randomUUID()}`;
    const early = new Elysia().get("/early", () => ({ ok: true }));
    const late = new Elysia().get("/late", () => ({ ok: true }));
    const probe = new Elysia()
      .use(requestId)
      .use(errorHandler)
      .use(early)
      .use(rateLimit({ name, limit: 1, windowSec: 30, enabled: true, scope: "global", key: () => "g" }))
      .use(late);
    const get = (p: string) => probe.handle(new Request(`http://localhost${p}`));

    expect((await get("/early")).status).toBe(200);
    expect((await get("/early")).status).toBe(200); // registered before the limiter: never limited
    expect((await get("/late")).status).toBe(200);
    expect((await get("/late")).status).toBe(429);
    await redis.del(`rl:${name}:g`);
  });
});

describe("empty query values", () => {
  const probe = new Elysia()
    .use(requestId)
    .use(errorHandler)
    .use(emptyQueryAsAbsent)
    .get("/q", ({ query }) => query, {
      query: t.Object({
        id: t.Optional(t.String({ format: "uuid" })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
        q: t.Optional(t.String()),
      }),
    })
    .post("/b", ({ body }) => body, { body: t.Object({ name: t.String({ minLength: 1 }) }) });
  const get = async (qs: string) => {
    const res = await probe.handle(new Request(`http://localhost/q${qs}`));
    return { status: res.status, body: (await res.json()) as any };
  };

  test("blank and whitespace-only params are treated as not provided", async () => {
    const res = await get("?id=&limit=&q=%20%20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test("real values still pass through and are still validated", async () => {
    expect((await get("?limit=5")).body).toEqual({ limit: 5 });
    expect((await get("?limit=abc")).status).toBe(422);
    expect((await get("?id=not-a-uuid")).status).toBe(422);
    expect((await get("?id=&limit=7&q=hello")).body).toEqual({ limit: 7, q: "hello" });
  });

  test("request bodies are NOT relaxed: an empty string still fails", async () => {
    const res = await probe.handle(new Request("http://localhost/b", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "" }) }));
    expect(res.status).toBe(422);
  });
});
