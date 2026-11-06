import { Elysia } from "elysia";
import { isProduction } from "../config/env";

// Baseline hardening headers for an API that serves JSON (and the Scalar docs page).
export const securityHeaders = new Elysia({ name: "security-headers" }).onRequest(({ set }) => {
  set.headers["x-content-type-options"] = "nosniff";
  set.headers["referrer-policy"] = "no-referrer";
  set.headers["x-frame-options"] = "DENY";
  set.headers["cross-origin-resource-policy"] = "same-site";
  if (isProduction) set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
});
