import { Elysia, t } from "elysia";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const ServiceStatus = t.Union([t.Literal("up"), t.Literal("down")], {
  description: "Whether the dependency answered its health probe",
});

export const healthRoutes = new Elysia({ prefix: "/health", tags: ["Health"] }).get(
  "",
  async ({ set }) => {
    const [database, cache] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => "up" as const, () => "down" as const),
      redis.ping().then(() => "up" as const, () => "down" as const),
    ]);

    const ok = database === "up" && cache === "up";
    if (!ok) set.status = 503;

    return {
      status: ok ? ("ok" as const) : ("degraded" as const),
      uptimeSeconds: Math.round(process.uptime()),
      services: { database, redis: cache },
    };
  },
  {
    detail: {
      summary: "Health check",
      description:
        "Probes Postgres and Redis. Returns 200 when both are reachable, 503 when any dependency is down. " +
        "Use this for container/orchestrator health checks and for the frontend to detect an unavailable backend.",
    },
    response: {
      200: t.Object(
        {
          status: t.Literal("ok"),
          uptimeSeconds: t.Number({ description: "Seconds since the API process started" }),
          services: t.Object({ database: ServiceStatus, redis: ServiceStatus }),
        },
        { description: "All dependencies are healthy" },
      ),
      503: t.Object(
        {
          status: t.Literal("degraded"),
          uptimeSeconds: t.Number(),
          services: t.Object({ database: ServiceStatus, redis: ServiceStatus }),
        },
        { description: "At least one dependency is down" },
      ),
    },
  },
);
