import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { app } from "../src/app";

// Writes the live OpenAPI spec to <repo>/docs/openapi.json — the file the frontend reads.
const res = await app.handle(new Request("http://localhost/openapi/json"));
if (!res.ok) {
  console.error(`Failed to fetch OpenAPI spec: HTTP ${res.status}`);
  process.exit(1);
}

const spec = await res.json();
const outDir = resolve(import.meta.dir, "../../docs");
await mkdir(outDir, { recursive: true });
await Bun.write(resolve(outDir, "openapi.json"), JSON.stringify(spec, null, 2) + "\n");

console.log(`OpenAPI spec written to ${resolve(outDir, "openapi.json")}`);
process.exit(0); // queue/redis connections would otherwise keep the process alive
