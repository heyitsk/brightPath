import { Elysia } from "elysia";
import { AppError, type ErrorCode, type FieldError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRequestId } from "./request-id";

interface ValidationLike {
  all?: Array<{ path?: string; message?: string }>;
}

function toFields(error: ValidationLike): FieldError[] {
  const seen = new Set<string>();
  const fields: FieldError[] = [];
  for (const issue of error.all ?? []) {
    // TypeBox paths look like "/phone" or "/items/0/name"; the API contract uses dotted paths.
    const path = (issue.path ?? "").replace(/^\//, "").replaceAll("/", ".") || "(body)";
    if (seen.has(path)) continue; // first message per field is enough for a form
    seen.add(path);
    fields.push({ path, message: issue.message ?? "Invalid value" });
  }
  return fields;
}

function envelope(
  request: Request,
  code: ErrorCode,
  message: string,
  fields?: FieldError[],
) {
  return { error: { code, message, ...(fields ? { fields } : {}), requestId: getRequestId(request) } };
}

// Turns every failure into the single documented envelope (see lib/errors.ts).
export const errorHandler = new Elysia({ name: "error-handler" }).onError({ as: "global" }, (ctx) => {
  const { code, error, request, set } = ctx;

  if (error instanceof AppError) {
    set.status = error.status;
    if (error.headers) Object.assign(set.headers, error.headers);
    if (error.status >= 500) logger.error({ requestId: getRequestId(request), err: error }, "request failed");
    return envelope(request, error.code, error.message, error.fields);
  }

  if (code === "VALIDATION") {
    const fields = toFields(error as unknown as ValidationLike);
    set.status = 422;
    const n = fields.length;
    return envelope(
      request,
      "VALIDATION_FAILED",
      n === 1 ? "Please fix 1 thing below." : `Please fix ${n} things below.`,
      fields,
    );
  }

  if (code === "NOT_FOUND") {
    set.status = 404;
    return envelope(request, "NOT_FOUND", "We could not find that.");
  }

  if (code === "PARSE") {
    set.status = 400;
    return envelope(request, "INVALID_REQUEST", "The request body could not be read.");
  }

  // Anything else is a bug or an outage: log the real error, tell the client nothing sensitive.
  logger.error({ requestId: getRequestId(request), method: request.method, path: ctx.path, code, err: error }, "request failed");
  set.status = 500;
  return envelope(request, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
});
