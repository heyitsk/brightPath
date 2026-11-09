// Turns a TypeBox/JSON schema into plain words ("a whole number from 0 to 20"), so a refused
// value can say what IS allowed instead of the validator's "Expected union value".

export interface JsonSchema {
  type?: string;
  anyOf?: JsonSchema[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  format?: string;
  pattern?: string;
  items?: JsonSchema;
  description?: string;
}

/** "A, B or C" */
function orList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * What a schema accepts, as a phrase that follows "Enter ", e.g. "a whole number from 0 to 20".
 * Returns null when the schema cannot be described (objects, patterns): callers fall back to their own wording.
 */
export function describeSchema(schema: JsonSchema): string | null {
  if (schema.anyOf) {
    const real = schema.anyOf.filter((b) => b.type !== "null");
    // A set of fixed values (t.Literal union): "one of GENERAL, EWS or OBC".
    if (real.length > 0 && real.every((b) => b.const !== undefined)) return `one of ${orList(real.map((b) => String(b.const)))}`;
    // Elysia's t.Integer is "a whole number or a numeric string" with the range on the outer schema.
    const whole = real.find((b) => b.type === "integer");
    if (whole) return describeSchema({ ...whole, minimum: whole.minimum ?? schema.minimum, maximum: whole.maximum ?? schema.maximum });
    if (real.some((b) => b.type === "boolean")) return "true or false";
    return real.length === 1 ? describeSchema(real[0]!) : null;
  }
  if (schema.const !== undefined) return String(schema.const);
  switch (schema.type) {
    case "integer":
      return schema.minimum !== undefined && schema.maximum !== undefined ? `a whole number from ${schema.minimum} to ${schema.maximum}` : "a whole number";
    case "boolean":
      return "true or false";
    case "string":
      if (schema.format === "email") return "a valid email address";
      if (schema.format === "uuid") return "a valid id";
      if (schema.pattern) return null; // only a hand-written hint can say this in words
      return schema.maxLength !== undefined ? `text of up to ${schema.maxLength} characters` : "text";
    case "array": {
      const each = schema.items ? describeSchema(schema.items) : null;
      const suffix = each ? `, each ${each}` : "";
      return schema.maxItems !== undefined ? `a list of up to ${schema.maxItems} entries${suffix}` : `a list${suffix}`;
    }
    default:
      return null;
  }
}
