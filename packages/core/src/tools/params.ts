// The param-schema → TypeBox-expression renderer, shared by the generated-tool compiler (compile.ts,
// the sdk/mcp branch) and the first-party contract tool (contract-tool.ts). Pure plan→render; every
// embedded value goes through JSON.stringify (injection-safe), exactly like the rest of the compiler.
//
// #21 — Gemini-safe `StringEnum`. A JSON-Schema `{ "enum": [...] }` of ALL-STRING values is rendered by
// every other provider as a plain string enum, but Google's function-calling schema rejects a bare `enum`
// that is not paired with `type: "string"` (and TypeBox's own `Type.Enum`/`Type.Union(Literal…)` produce
// shapes Gemini also mishandles). The fix is the well-known community helper `StringEnum(values)` →
// `Type.Unsafe({ type: "string", enum: values })`, which carries the `type: "string"` Google requires.
//
// We keep this STRICTLY ADDITIVE: a schema with NO all-string enum anywhere renders BYTE-IDENTICALLY to
// the prior `Type.Unsafe(<json>)` form (the StringEnum form is a strict superset of the old OpenAI-only
// correctness). Only when an all-string enum is present do we render the schema as a TypeBox expression
// in which each such sub-schema becomes a `StringEnum([...])` call; the rest stays embedded JSON.

/** The identifier of the generated-preamble helper. */
export const STRING_ENUM_HELPER = 'StringEnum';

/** The preamble line that DEFINES the helper in the generated extension (emitted only when needed). */
export const STRING_ENUM_PREAMBLE =
  `const ${STRING_ENUM_HELPER} = (values) => Type.Unsafe({ type: "string", enum: values });`;

/** Is `v` a JSON-Schema sub-object carrying an all-string `enum`? (the only case we normalize). */
function isAllStringEnum(v: unknown): v is { enum: string[] } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = (v as { enum?: unknown }).enum;
  return Array.isArray(e) && e.length > 0 && e.every((x) => typeof x === 'string');
}

/** Does `schema` contain an all-string `enum` sub-schema ANYWHERE (so it needs the StringEnum helper)? */
export function paramsNeedStringEnum(schema: unknown): boolean {
  if (isAllStringEnum(schema)) return true;
  if (Array.isArray(schema)) return schema.some(paramsNeedStringEnum);
  if (schema && typeof schema === 'object') return Object.values(schema).some(paramsNeedStringEnum);
  return false;
}

/**
 * Render a JSON value as a TypeBox-compatible expression, rewriting every all-string `{ enum }` sub-schema
 * to a `StringEnum([...])` call and embedding everything else as JSON.stringify'd literal. Only reached on
 * the enum-bearing path; produces a valid JS expression (object/array/scalar literals + helper calls).
 */
function renderValueExpr(v: unknown): string {
  if (isAllStringEnum(v)) {
    // an all-string enum sub-schema → the Gemini-safe helper. `StringEnum` supplies `type:"string"` + the
    // `enum`; its sibling annotation keys (description/default/…), EXCEPT the now-helper-owned `type`/`enum`,
    // ride along as a SPREAD so the model still sees them.
    const obj = v as Record<string, unknown>;
    const head = `${STRING_ENUM_HELPER}(${JSON.stringify(obj.enum)})`;
    const restKeys = Object.keys(obj).filter((k) => k !== 'enum' && k !== 'type');
    if (!restKeys.length) return head;
    // merge the helper's String schema with the remaining annotation keys (description/default/…).
    return `{ ...${head}, ${restKeys.map((k) => `${JSON.stringify(k)}: ${renderValueExpr(obj[k])}`).join(', ')} }`;
  }
  if (Array.isArray(v)) return `[${v.map(renderValueExpr).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    return `{ ${entries.map(([k, val]) => `${JSON.stringify(k)}: ${renderValueExpr(val)}`).join(', ')} }`;
  }
  return JSON.stringify(v);
}

/**
 * Render the `parameters:` VALUE expression for a tool's arg schema.
 *
 * - No all-string enum anywhere ⇒ the unchanged `Type.Unsafe(<json>)` form (BYTE-IDENTICAL — additivity).
 * - Otherwise ⇒ `Type.Unsafe(<expr>)` where each all-string enum sub-schema is a `StringEnum([...])` call,
 *   so the embedded schema carries `type:"string"` alongside `enum` (Gemini-safe).
 */
export function renderParamsExpr(schema: unknown): string {
  if (!paramsNeedStringEnum(schema)) return `Type.Unsafe(${JSON.stringify(schema)})`;
  return `Type.Unsafe(${renderValueExpr(schema)})`;
}
