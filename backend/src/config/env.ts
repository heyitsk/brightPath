function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see backend/.env.example)`);
  }
  return value;
}

// Bun loads backend/.env automatically, so no dotenv import is needed at runtime.
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
} as const;

export const isProduction = env.NODE_ENV === "production";
