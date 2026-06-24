/**
 * JsonReader — a themed, collapsible JSON tree (dependency-free). Parses with
 * JSON.parse and renders a recursive tree: keys, type-colored values (string /
 * number / boolean / null), and fold/unfold toggles on objects + arrays.
 * Invalid JSON degrades to a readable error rather than throwing.
 */
import { useState } from "react";
import "../styles/reader.css";

function JsonValue({ value }: { value: unknown }) {
  if (value === null) return <span className="ds-json__null">null</span>;
  switch (typeof value) {
    case "number":
      return <span className="ds-json__num">{String(value)}</span>;
    case "boolean":
      return <span className="ds-json__bool">{String(value)}</span>;
    case "string":
      return <span className="ds-json__str">"{value}"</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

function JsonNode({ name, value, depth, last }: { name?: string; value: unknown; depth: number; last: boolean }) {
  const isContainer = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: depth * 14 } as const;
  const keyEl = name !== undefined && <span className="ds-json__key">"{name}"</span>;
  const colon = name !== undefined && <span className="ds-json__punc">: </span>;

  if (!isContainer) {
    return (
      <div className="ds-json__row" style={pad}>
        {keyEl}
        {colon}
        <JsonValue value={value} />
        {!last && <span className="ds-json__punc">,</span>}
      </div>
    );
  }

  const arr = Array.isArray(value);
  const entries = arr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const openCh = arr ? "[" : "{";
  const closeCh = arr ? "]" : "}";

  return (
    <div>
      <div className="ds-json__row" style={pad}>
        <button className="ds-json__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"}
        </button>
        {keyEl}
        {colon}
        <span className="ds-json__punc">{openCh}</span>
        {!open && (
          <>
            <span className="ds-json__muted">{arr ? `${entries.length} items` : `${entries.length} keys`}</span>
            <span className="ds-json__punc">
              {closeCh}
              {!last ? "," : ""}
            </span>
          </>
        )}
      </div>
      {open && (
        <>
          {entries.map(([k, v], idx) => (
            <JsonNode key={k} name={arr ? undefined : k} value={v} depth={depth + 1} last={idx === entries.length - 1} />
          ))}
          <div className="ds-json__row" style={pad}>
            <span className="ds-json__punc">
              {closeCh}
              {!last ? "," : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function JsonReader({ source }: { source: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    return <div className="ds-json ds-json--error">Invalid JSON — {(e as Error).message}</div>;
  }
  return (
    <div className="ds-json">
      <JsonNode value={parsed} depth={0} last />
    </div>
  );
}
