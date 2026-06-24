/**
 * ContentView — renders a node's content with the right themed reader:
 * markdown → MarkdownReader, json → JsonReader, anything else → plain mono.
 * Type is taken from `data.contentType`, else inferred from `typeLabel`
 * (md/markdown, json). Each sits in a consistent `.ds-reader` frame.
 */
import { MarkdownReader } from "./MarkdownReader";
import { JsonReader } from "./JsonReader";
import type { FlowNodeData } from "./WorkflowNode";
import "../styles/reader.css";

export type ContentType = "text" | "markdown" | "json";

function inferType(typeLabel?: string): ContentType {
  const t = (typeLabel ?? "").toLowerCase();
  if (t === "md" || t === "markdown") return "markdown";
  if (t === "json") return "json";
  return "text";
}

export function ContentView({ data }: { data: FlowNodeData }) {
  const type = data.contentType ?? inferType(data.typeLabel);
  const src = data.content ?? data.preview ?? "";

  if (!src) return <div className="ds-reader ds-reader--muted">No content.</div>;
  if (type === "markdown")
    return (
      <div className="ds-reader">
        <MarkdownReader source={src} />
      </div>
    );
  if (type === "json")
    return (
      <div className="ds-reader ds-reader--code">
        <JsonReader source={src} />
      </div>
    );
  return <pre className="ds-reader ds-reader--code ds-glass__legible">{src}</pre>;
}
