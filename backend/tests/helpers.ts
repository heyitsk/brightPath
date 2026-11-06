import { app } from "../src/app";

type Json = Record<string, unknown>;

/** Calls the app in-process (no port). Returns status, headers and parsed JSON (or null). */
export async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    }),
  );
  const text = await res.text();
  let body: Json | null = null;
  try {
    body = text ? (JSON.parse(text) as Json) : null;
  } catch {
    /* non-JSON body (e.g. docs HTML) */
  }
  return { status: res.status, headers: res.headers, body, text };
}
