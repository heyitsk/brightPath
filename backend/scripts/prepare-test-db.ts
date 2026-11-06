// Creates the *_test database if missing and applies all migrations to it.
// Runs before `bun test` (see package.json "test"). Refuses to touch anything not named *_test.
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.test.example to .env.test.");

const target = new URL(url);
const dbName = target.pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to prepare "${dbName}": test database name must end with _test`);
}

const admin = new URL(url);
admin.pathname = "/postgres";
admin.search = "";
const client = new Client({ connectionString: admin.toString() });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (exists.rowCount === 0) {
  await client.query(`CREATE DATABASE "${dbName.replaceAll('"', "")}"`);
  console.log(`created database ${dbName}`);
}
await client.end();

const proc = Bun.spawn(["bunx", "prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: url },
  stdout: "ignore",
  stderr: "inherit",
});
const code = await proc.exited;
if (code !== 0) process.exit(code);
console.log(`test database ${dbName} is up to date`);
