// Static file serving for the built GUI (gui/dist), with SPA fallback to index.html. The /__piflow/ and
// /api/ namespaces are never served as files (they belong to the control API). Path traversal is refused.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, relative, isAbsolute } from "node:path";
import type { ServerResponse } from "node:http";
import type { Middleware } from "./resolve.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

function sendFile(res: ServerResponse, filePath: string, size: number): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(filePath).pipe(res);
}

/** Serve `rootDir` as a single-page app: exact file if it exists, else index.html (client-side routing). */
export function serveStatic(rootDir: string): Middleware {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (pathname.startsWith("/__piflow/") || pathname.startsWith("/api/")) return next();

    const filePath = join(rootDir, pathname);
    // traversal guard: the resolved path must stay under rootDir
    const rel = relative(rootDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) return next();

    // an exact file (or a dir's index.html), else the SPA fallback index.html
    for (const p of [filePath, join(filePath, "index.html"), join(rootDir, "index.html")]) {
      try {
        const st = await stat(p);
        if (st.isFile()) return sendFile(res, p, st.size);
      } catch { /* try next */ }
    }
    return next();
  };
}
