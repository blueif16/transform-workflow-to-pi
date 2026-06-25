// The ONE reader of content/docs/.
//
// Both the /docs route (app/docs/**) and the llms.txt generator
// (scripts/build-docs-index.mjs) import this module — so the nav, the pages,
// and the AI index are derived by the SAME logic and cannot diverge. This is
// the docs analogue of Pi Flow's "exactly one reader" rule.
//
// Plain JS (runnable by `node` for the generator; consumed by Next via allowJs).

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "docs");

// Top-level folder -> nav label + order. Root files (index.md) fall under "".
export const SECTIONS = {
  "": { title: "Overview", order: 0 },
  start: { title: "Getting started", order: 1 },
  concepts: { title: "Concepts", order: 2 },
  guides: { title: "Guides", order: 3 },
  reference: { title: "Reference", order: 4 },
};

const stripQuotes = (s) => s.trim().replace(/^["']|["']$/g, "");

function splitFrontmatter(raw, file) {
  if (!raw.startsWith("---")) throw new Error(`Missing frontmatter: ${file}`);
  const end = raw.indexOf("\n---", 3);
  if (end === -1) throw new Error(`Unterminated frontmatter: ${file}`);
  return { fmText: raw.slice(3, end).trim(), body: raw.slice(end + 4).replace(/^\s*\n/, "") };
}

function parseFrontmatter(fmText, file) {
  const fm = { read_when: [] };
  let inList = null;
  for (const line of fmText.split("\n")) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (inList && item) {
      fm[inList].push(stripQuotes(item[1]));
      continue;
    }
    inList = null;
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!m) continue;
    const [, key, val] = m;
    if (val === "" && key === "read_when") {
      fm.read_when = [];
      inList = "read_when";
    } else if (key === "order") fm.order = Number(val);
    else if (key === "draft") fm.draft = val === "true";
    else fm[key] = stripQuotes(val);
  }
  if (!fm.title) throw new Error(`Frontmatter missing 'title': ${file}`);
  if (!fm.summary) throw new Error(`Frontmatter missing 'summary': ${file}`);
  return fm;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_") || name.startsWith(".")) continue; // _meta / hidden = not routed
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md") && name !== "README.md") out.push(full);
  }
  return out;
}

function toSlug(file) {
  let slug = relative(CONTENT, file).replace(/\.md$/, "").replace(/\\/g, "/");
  if (basename(slug) === "index") slug = dirname(slug) === "." ? "" : dirname(slug);
  return slug;
}

/** All pages with metadata, sorted by section order then in-folder order. */
export function listPages() {
  return walk(CONTENT)
    .map((file) => {
      const { fmText } = splitFrontmatter(readFileSync(file, "utf8"), file);
      const fm = parseFrontmatter(fmText, file);
      const slug = toSlug(file);
      const top = slug.includes("/") ? slug.split("/")[0] : slug;
      const section = SECTIONS[top] ? top : "";
      return {
        slug,
        segments: slug ? slug.split("/") : [],
        route: "/docs" + (slug ? "/" + slug : ""),
        title: fm.title,
        summary: fm.summary,
        read_when: fm.read_when,
        order: fm.order ?? 99,
        draft: fm.draft ?? false,
        section,
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Sections in nav order, each with its pages. Drives the sidebar. */
export function getNav() {
  const pages = listPages();
  return Object.entries(SECTIONS)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, meta]) => ({ key, title: meta.title, pages: pages.filter((p) => p.section === key) }))
    .filter((s) => s.pages.length);
}

/** One page's frontmatter + raw markdown body, or null if the slug has no file. */
export function getPage(segments = []) {
  const slug = segments.join("/");
  const candidates = [slug && join(CONTENT, slug + ".md"), join(CONTENT, slug, "index.md")].filter(Boolean);
  for (const file of candidates) {
    if (existsSync(file)) {
      const { fmText, body } = splitFrontmatter(readFileSync(file, "utf8"), file);
      return { meta: parseFrontmatter(fmText, file), body };
    }
  }
  return null;
}
