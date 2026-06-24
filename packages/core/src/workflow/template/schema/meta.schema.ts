// JSON Schema (draft 2020-12) for a template `meta.json` — the tiny AUTHORED header
// (template-format.md §5/§11): `{ id, name, description }` + an OPTIONAL phase DISPLAY order.
// `phase` order is decorative (it never drives the DAG — deps + owns do), so it is optional and
// loosely typed (a list of phase labels). `additionalProperties: false` keeps a typo'd key from
// passing.

/** The draft-2020-12 JSON Schema object for a template `meta.json`. Frozen; import to validate. */
export const metaSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://piflow.dev/schema/template/meta.json',
  title: 'piflow template meta.json',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description'],
  properties: {
    id: { type: 'string', minLength: 1, description: 'Workflow id.' },
    name: { type: 'string', minLength: 1, description: 'Human-readable workflow name.' },
    description: { type: 'string', description: 'One-line workflow description.' },
    phases: {
      // OPTIONAL phase DISPLAY order (§5) — decorative; never an ordering source beside deps.
      type: 'array',
      description: 'Optional phase DISPLAY order — decorative only (deps + owns drive the DAG).',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    },
  },
} as const;
