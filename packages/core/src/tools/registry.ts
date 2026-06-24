// The tool registry — addresses tools by `namespace:name`, resolves a node's selection to the bare
// names pi sees (`--tools`), and searches the catalog. `namespace:name` is a pure SDK abstraction;
// pi only ever sees flat `piName`s. Built-ins resolve directly; sdk/mcp tools (ROADMAP M2) also
// require a generated `-e` extension, flagged here via `ResolveResult.extension`.

import type { ToolEntry, ToolRegistry, ToolSelection, ResolveResult, ToolSource } from '../types.js';
import { compileToolExtension, bundleExtension } from './compile.js';
import { SUBMIT_RESULT_TOOL } from './contract-tool.js';

/** pi's native built-in tools, addressed under `fs:` / `sh:`. */
export const BUILTIN_TOOLS: ToolEntry[] = [
  { address: 'fs:read', source: 'builtin', piName: 'read', description: 'Read a file.', origin: { kind: 'native' } },
  { address: 'fs:write', source: 'builtin', piName: 'write', description: 'Write a file.', origin: { kind: 'native' } },
  { address: 'fs:edit', source: 'builtin', piName: 'edit', description: 'Edit a file in place.', origin: { kind: 'native' } },
  { address: 'fs:grep', source: 'builtin', piName: 'grep', description: 'Search file contents.', origin: { kind: 'native' } },
  { address: 'fs:find', source: 'builtin', piName: 'find', description: 'Find files by name.', origin: { kind: 'native' } },
  { address: 'fs:ls', source: 'builtin', piName: 'ls', description: 'List a directory.', origin: { kind: 'native' } },
  { address: 'sh:bash', source: 'builtin', piName: 'bash', description: 'Run a shell command.', origin: { kind: 'native' } },
];

/**
 * The default registry SEED: the pi-natives PLUS the first-party `submit_result` contract tool, so every
 * `DefaultToolRegistry()` carries it and a node declaring `submit_result` binds. It is NOT in
 * `BUILTIN_TOOLS` on purpose — the empty-allow default (resolve/verify) stays native-only, so
 * `submit_result` is OPT-IN (a node must declare it to get the generated `-e` extension that binds it).
 */
export const DEFAULT_TOOLS: ToolEntry[] = [...BUILTIN_TOOLS, SUBMIT_RESULT_TOOL];

/** True for a tool addressable by its BARE piName (the marker vocabulary): pi-natives + first-party contract tools. */
const isBareName = (e: ToolEntry): boolean => e.source === 'builtin' || e.source === 'contract';

export class DefaultToolRegistry implements ToolRegistry {
  private readonly byAddress = new Map<string, ToolEntry>();
  private readonly piNames = new Set<string>();
  // Bare-name index: a builtin's bare `piName` (the name pi sees, e.g. `read`) aliases to its entry, so
  // a marker-authored selection — `parseMarkers` writes BARE names into `tools.allow` — resolves WITHOUT
  // a `namespace:` address. Builtins AND first-party `contract` tools (e.g. `submit_result`) are the bare
  // vocabulary; sdk/mcp bare names are conflict-prefixed, so they keep requiring their `ns:name` address.
  private readonly builtinByPiName = new Map<string, ToolEntry>();

  constructor(seed: ToolEntry[] = DEFAULT_TOOLS) {
    for (const e of seed) this.register(e);
  }

  register(entry: ToolEntry): void {
    let piName = entry.piName;
    // conflict-guard: an sdk/mcp tool must not collide with an existing bare name → prefix it. Builtin AND
    // first-party `contract` tools keep their bare name (it IS the authored vocabulary).
    const existing = this.byAddress.get(entry.address);
    const collides = this.piNames.has(piName) && existing?.piName !== piName;
    if (entry.source !== 'builtin' && entry.source !== 'contract' && collides) {
      piName = `${entry.source}_${piName}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }
    if (existing) {
      this.piNames.delete(existing.piName);
      if (isBareName(existing)) this.builtinByPiName.delete(existing.piName);
    }
    const stored: ToolEntry = { ...entry, piName };
    this.byAddress.set(stored.address, stored);
    this.piNames.add(piName);
    if (isBareName(stored)) this.builtinByPiName.set(stored.piName, stored);
  }

  /** Resolve one selection token to its entry: a `namespace:name` address, or a BARE builtin piName. */
  private entryFor(token: string): ToolEntry | undefined {
    return this.byAddress.get(token) ?? this.builtinByPiName.get(token);
  }

  resolve(sel: ToolSelection): ResolveResult {
    const allow = sel.allow && sel.allow.length ? sel.allow : BUILTIN_TOOLS.map((t) => t.address);
    const denyTokens = sel.deny ?? [];
    // A deny token is itself a bare-or-namespaced address; match it against an allow token's entry by the
    // entry it resolves to, so `deny:['edit']` removes `fs:edit` (and vice versa) — they alias one tool.
    const deny = new Set(denyTokens);
    const denyEntries = new Set(denyTokens.map((t) => this.entryFor(t)?.address).filter(Boolean) as string[]);
    const piTools: string[] = [];
    const nonBuiltin: ToolEntry[] = [];
    const seenNonBuiltin = new Set<string>();
    for (const address of allow) {
      if (deny.has(address)) continue;
      const e = this.entryFor(address);
      if (!e) throw new Error(`unknown tool address: "${address}" (register it before resolving)`);
      if (denyEntries.has(e.address)) continue;
      if (!piTools.includes(e.piName)) piTools.push(e.piName);
      if (e.source !== 'builtin' && !seenNonBuiltin.has(e.address)) {
        seenNonBuiltin.add(e.address);
        nonBuiltin.push(e);
      }
    }
    const result: ResolveResult = { piTools };
    // The deny list is the run's exclude set — surfaced as the bare names pi excludes (`--exclude-tools`,
    // emitted downstream by the command builder). Map each denied token to the bare piName it denies.
    const excludeTools: string[] = [];
    for (const t of denyTokens) {
      const bare = this.entryFor(t)?.piName ?? t;
      if (!excludeTools.includes(bare)) excludeTools.push(bare);
    }
    if (excludeTools.length) result.excludeTools = excludeTools;
    // sdk/mcp tools have no native pi support — compile a generated `-e` extension that binds them, then
    // BUNDLE it host-side (esbuild buildSync — `resolve` stays SYNC) into ONE self-contained ESM file so
    // the bridge/SDK/plugin/shim are INLINED and the staged `_pi/tools.ts` resolves on every provider
    // (outside-repo temp dir / empty cloud VM included), not just where an up-tree node_modules exists.
    if (nonBuiltin.length) result.extension = bundleExtension(compileToolExtension(nonBuiltin).source);
    return result;
  }

  search(query: string, opts: { source?: ToolSource; limit?: number } = {}): ToolEntry[] {
    const q = query.toLowerCase();
    const hits = [...this.byAddress.values()].filter((e) => {
      if (opts.source && e.source !== opts.source) return false;
      return (
        e.address.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
    return opts.limit ? hits.slice(0, opts.limit) : hits;
  }

  /** All registered entries (discovery / debugging). */
  list(): ToolEntry[] {
    return [...this.byAddress.values()];
  }
}
