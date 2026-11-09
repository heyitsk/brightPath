import { Elysia } from "elysia";
import { AppError, type ErrorCode, type FieldError } from "../lib/errors";
import { describeSchema, type JsonSchema } from "../lib/schema-words";
import { logger } from "../lib/logger";
import { getRequestId } from "./request-id";

interface Issue {
  path?: string;
  message?: string;
  schema?: JsonSchema;
}
interface ValidationLike {
  all?: Issue[];
}
interface RouteLike {
  method: string;
  path: string;
  hooks?: Record<string, { properties?: Record<string, JsonSchema> } | undefined>;
}

// Elysia reports a bad query/path number (e.g. `score=721`, out of range) with an EMPTY path, because it
// checks the converted value on its own. The field is recovered from the route's own schema instead.
let listRoutes: () => readonly RouteLike[] = () => [];

/** app.ts hands over the route table once the app is built, so errors can name the field. */
export function provideRouteTable(list: () => readonly RouteLike[]) {
  listRoutes = list;
}

function sameShape(a: JsonSchema, b: JsonSchema) {
  return a.description === b.description && a.minimum === b.minimum && a.maximum === b.maximum;
}

/** The name of the single request field whose schema matches the issue's, or undefined when unsure. */
function fieldNamed(route: string, method: string, schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  const hooks = listRoutes().find((r) => r.path === route && r.method === method)?.hooks;
  const matches: string[] = [];
  for (const part of ["query", "params", "body", "headers"]) {
    for (const [name, field] of Object.entries(hooks?.[part]?.properties ?? {})) {
      if (sameShape(field, schema)) matches.push(name);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** "Enter a whole number from -180 to 720." instead of "Expected union value". */
function plainMessage(issue: Issue): string {
  if (issue.message === "Expected required property") return "This is required.";
  const words = issue.schema ? describeSchema(issue.schema) : null;
  return words ? `Enter ${words}.` : (issue.message ?? "Invalid value");
}

function toFields(error: ValidationLike, route: string, method: string): FieldError[] {
  const seen = new Set<string>();
  const fields: FieldError[] = [];
  for (const issue of error.all ?? []) {
    // TypeBox paths look like "/phone" or "/items/0/name"; the API contract uses dotted paths.
    const path = (issue.path ?? "").replace(/^\//, "").replaceAll("/", ".") || fieldNamed(route, method, issue.schema) || "(request)";
    if (seen.has(path)) continue; // first message per field is enough for a form
    seen.add(path);
    fields.push({ path, message: plainMessage(issue) });
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
    const fields = toFields(error as unknown as ValidationLike, ctx.route, request.method);
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
