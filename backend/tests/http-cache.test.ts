import { describe, expect, test } from "bun:test";
import { etagFor, sendCacheable } from "../src/lib/http-cache";

const ctx = (ifNoneMatch?: string) => ({
  request: new Request("http://localhost/x", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} }),
  set: { headers: {} as Record<string, string | number | undefined> },
});

describe("sendCacheable", () => {
  test("etag is stable for equal bodies and differs for different ones", () => {
    expect(etagFor({ a: 1 })).toBe(etagFor({ a: 1 }));
    expect(etagFor({ a: 1 })).not.toBe(etagFor({ a: 2 }));
  });

  test("sets ETag and Cache-Control on a fresh request", () => {
    const c = ctx();
    const out = sendCacheable(c, { a: 1 }, { maxAgeSec: 60, staleWhileRevalidateSec: 30 });
    expect(out).toEqual({ a: 1 });
    expect(c.set.headers["etag"]).toBe(etagFor({ a: 1 }));
    expect(c.set.headers["cache-control"]).toBe("public, max-age=60, s-maxage=60, stale-while-revalidate=30");
  });

  test("answers 304 when If-None-Match matches", () => {
    const out = sendCacheable(ctx(etagFor({ a: 1 })), { a: 1 }, { maxAgeSec: 60 });
    expect(out).toBeInstanceOf(Response);
    expect((out as unknown as Response).status).toBe(304);
  });
});
