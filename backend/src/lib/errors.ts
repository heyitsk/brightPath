import { t } from "elysia";

/** Machine-readable error codes the frontend can switch on. Add new ones here, never inline. */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PASSWORD_CHANGE_REQUIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "ACCOUNT_LOCKED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export interface FieldError {
  path: string;
  message: string;
}

/** Throw this from services/routes; the error-handler plugin turns it into the standard envelope. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: FieldError[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }

  static notFound(message = "We could not find that.") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(message: string) {
    return new AppError(409, "CONFLICT", message);
  }
  static unauthenticated(message = "Please log in to continue.") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have permission to do that.") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static passwordChangeRequired() {
    return new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Please choose a new password before continuing.");
  }
  static invalid(message: string, fields?: FieldError[]) {
    return new AppError(422, "VALIDATION_FAILED", message, fields);
  }
}

// ---- OpenAPI schemas -------------------------------------------------------------------

export const FieldErrorSchema = t.Object(
  {
    path: t.String({ description: "Dotted path of the offending field, e.g. `phone` or `items.0.name`" }),
    message: t.String({ description: "Human-readable explanation, safe to show next to the field" }),
  },
  { description: "One problem with one field" },
);

export const ErrorEnvelope = t.Object(
  {
    error: t.Object({
      code: t.String({ description: "Stable machine-readable code, e.g. `VALIDATION_FAILED`, `RATE_LIMITED`, `ACCOUNT_LOCKED`" }),
      message: t.String({ description: "Human-readable summary, e.g. `Please fix 2 things below.`" }),
      fields: t.Optional(
        t.Array(FieldErrorSchema, { description: "Per-field problems. Present for validation errors." }),
      ),
      requestId: t.String({ description: "Echoes the `X-Request-Id` response header. Quote it when reporting a problem." }),
    }),
  },
  { description: "Standard error body returned by every non-2xx response" },
);

const DESCRIPTIONS: Record<number, string> = {
  400: "Malformed request (e.g. unparseable JSON)",
  401: "Not logged in",
  403: "Logged in but not allowed",
  404: "Not found",
  409: "Conflicts with the current state of the data",
  413: "Request body too large",
  422: "Validation failed. See `error.fields` for each problem",
  429: "Too many requests. See the `Retry-After` header",
  500: "Unexpected server error",
};

/** Documents error statuses on a route: `response: { 200: Body, ...errorResponses(401, 422) }`. */
export function errorResponses<const S extends readonly number[]>(...statuses: S) {
  const out: Record<number, typeof ErrorEnvelope> = {};
  for (const s of statuses) {
    out[s] = t.Object(ErrorEnvelope.properties, { description: DESCRIPTIONS[s] ?? "Error" });
  }
  return out as { [K in S[number]]: typeof ErrorEnvelope };
}
