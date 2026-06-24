/**
 * MarkdownReader — a compact, dependency-free Markdown renderer themed to the
 * system (Geist type, accent links, mono code, hairline rules). No `marked`,
 * no `dangerouslySetInnerHTML`: every token becomes a real React node, so it is
 * XSS-safe by construction. Covers the common set — headings, bold/italic,
 * inline + fenced code, links, ordered/unordered lists, blockquotes, rules,
 * paragraphs. (Not a full CommonMark engine; nested lists / tables are out.)
 */
import { createElement, type ReactNode } from "react";
import "../styles/reader.css";

const INLINE = [
  { type: "code", re: /`([^`]+)`/ },
  { type: "link", re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: "bold", re: /\*\*([^*]+)\*\*|__([^_]+)__/ },
  { type: "italic", re: /\*([^*]+)\*|_([^_]+)_/ },
] as const;

function parseInline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    let best: { type: string; m: RegExpExecArray } | null = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { type: p.type, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    const { type, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${kp}-${k++}`;
    if (type === "code") out.push(<code key={key} className="ds-md__code">{m[1]}</code>);
    else if (type === "link")
      out.push(
        <a key={key} className="ds-md__link" href={m[2]} target="_blank" rel="noreferrer noopener">
          {parseInline(m[1], key)}
        </a>,
      );
    else if (type === "bold") out.push(<strong key={key} className="ds-md__strong">{parseInline(m[1] ?? m[2], key)}</strong>);
    else out.push(<em key={key} className="ds-md__em">{parseInline(m[1] ?? m[2], key)}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const isBlockStart = (l: string) =>
  /^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+\.)\s)/.test(l) || /^\s*([-*_])\1{2,}\s*$/.test(l);

function parseBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre key={key++} className="ds-md__pre">
          {fence[1] && <span className="ds-md__lang">{fence[1]}</span>}
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(createElement(`h${lvl}`, { key: key++, className: `ds-md__h ds-md__h${lvl}` }, parseInline(h[2], `h${key}`)));
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="ds-md__hr" />);
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={key++} className="ds-md__quote">{parseInline(buf.join(" "), `q${key}`)}</blockquote>);
      continue;
    }

    // list (ordered or unordered)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        items.push(<li key={items.length} className="ds-md__li">{parseInline(item, `li${i}`)}</li>);
        i++;
      }
      out.push(
        ordered ? (
          <ol key={key++} className="ds-md__ol">{items}</ol>
        ) : (
          <ul key={key++} className="ds-md__ul">{items}</ul>
        ),
      );
      continue;
    }

    // paragraph — gather contiguous non-block lines
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(<p key={key++} className="ds-md__p">{parseInline(buf.join(" "), `p${key}`)}</p>);
  }

  return out;
}

export function MarkdownReader({ source }: { source: string }) {
  return <div className="ds-md">{parseBlocks(source)}</div>;
}
