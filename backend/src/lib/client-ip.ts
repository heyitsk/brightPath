import { env } from "../config/env";

interface IpSource {
  request: Request;
  server?: { requestIP(req: Request): { address: string } | null } | null;
}

/** Best-effort client IP. X-Forwarded-For is trusted only when TRUST_PROXY=true. */
export function clientIp({ request, server }: IpSource): string {
  if (env.TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return server?.requestIP(request)?.address ?? "unknown";
}
