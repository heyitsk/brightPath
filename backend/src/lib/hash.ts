import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Opaque, URL-safe random token (256 bits). */
export const randomToken = () => randomBytes(32).toString("base64url");

/** Salted hash of an IP: lets us spot repeats without storing the address (plan §3.3 rule 10). */
export const hashIp = (ip: string | null | undefined) =>
  ip && ip !== "unknown" ? sha256(`${env.IP_HASH_SALT}:${ip}`).slice(0, 32) : null;
