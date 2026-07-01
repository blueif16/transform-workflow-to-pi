// `piflowctl context` STORE — the pure read/write side of `~/.piflow/contexts.json`, the kubectl/docker-style
// registry of named control-plane endpoints (a `local` and any number of `cloud` `serve` targets) that the CLI
// and GUI point at. This is the persistence + resolution logic ONLY (no arg-parse, no print — that is
// context.ts); it is deterministic and home-dir-overridable via `PIFLOW_HOME` (reusing @piflow/core's ONE
// home resolver, `globalDir`) so it is unit-testable against a tmp dir.
//
// The store lives under the global home `~/.piflow/` (alongside products.json / model-tiers.json) — NEVER in
// the repo/SDK (the architectural law: global mapping/config there, never in packages/ or a product).
//
// An implicit `local` context (the `serve-cli.ts` default endpoint `http://127.0.0.1:5273`) is ALWAYS present,
// even with no file on disk — seeded lazily on every read so `context ls` / resolution never come up empty.
//
// resolveActive precedence (the UNANIMOUS kubectl/docker/gcloud ladder):
//   opts.flagContext  (a `--context <name>` flag)          — highest
//   process.env.PIFLOW_CONTEXT                              — the env override
//   file.current      (the persisted `context use` pointer)
//   'local'           (the implicit default)                — lowest

import fssync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { globalDir } from '@piflow/core';

/** One named control-plane endpoint: where a `serve` lives + an optional bearer token for a cloud one. */
export interface ContextEntry {
  baseUrl: string;
  token?: string;
}

/** The `contexts.json` body: the active-context pointer + the name→endpoint map. */
export interface ContextsFile {
  /** The persisted `context use` pointer (rung 3 of the ladder); null when never set / cleared. */
  current: string | null;
  /** The named endpoints. Always includes the implicit `local` after `readContexts` seeds it. */
  contexts: Record<string, ContextEntry>;
}

/** The reserved implicit context name + its endpoint (the local `serve` default, serve-cli.ts:26-27). */
export const LOCAL_CONTEXT = 'local';
export const LOCAL_BASE_URL = 'http://127.0.0.1:5273';

/** The global home `~/.piflow` — reuses @piflow/core's `globalDir` so `PIFLOW_HOME` is honored identically. */
function homeDir(): string {
  // `globalDir` already resolves `PIFLOW_HOME ?? ~/.piflow`; the `os.homedir()` fallback is defence-in-depth
  // only (should never be reached — kept so this module is self-contained if the helper ever changes shape).
  return globalDir() ?? path.join(os.homedir(), '.piflow');
}

/** `~/.piflow/contexts.json` — the named-context registry (honors `PIFLOW_HOME`). */
export function contextsFile(): string {
  return path.join(homeDir(), 'contexts.json');
}

/** Seed the implicit `local` context if absent — mutates + returns the same object (idempotent). */
function seedLocal(file: ContextsFile): ContextsFile {
  if (!file.contexts[LOCAL_CONTEXT]) file.contexts[LOCAL_CONTEXT] = { baseUrl: LOCAL_BASE_URL };
  return file;
}

/**
 * Read `contexts.json`, tolerating an absent/corrupt file (→ a fresh `{current:null, contexts:{}}`), then
 * ALWAYS seed the implicit `local`. NEVER throws — a broken file degrades to defaults so the CLI keeps working.
 */
export function readContexts(): ContextsFile {
  let file: ContextsFile = { current: null, contexts: {} };
  const p = contextsFile();
  if (fssync.existsSync(p)) {
    try {
      const parsed = JSON.parse(fssync.readFileSync(p, 'utf8')) as Partial<ContextsFile>;
      file = {
        current: typeof parsed.current === 'string' ? parsed.current : null,
        contexts:
          parsed.contexts && typeof parsed.contexts === 'object' ? (parsed.contexts as Record<string, ContextEntry>) : {},
      };
    } catch {
      file = { current: null, contexts: {} };
    }
  }
  return seedLocal(file);
}

/** Persist `contexts.json` (mkdir -p the home first; pretty-printed + trailing newline, matching the registry). */
export async function writeContexts(file: ContextsFile): Promise<void> {
  await fs.mkdir(homeDir(), { recursive: true });
  await fs.writeFile(contextsFile(), JSON.stringify(file, null, 2) + '\n');
}

/**
 * Resolve the ACTIVE context name via the ladder: `--context` flag > `PIFLOW_CONTEXT` env > persisted `current`
 * > `'local'`. Each `??` is a rung — the order here IS the contract (the mutation test flips it). Only a
 * NON-EMPTY string counts at each rung (an empty flag/env falls through, so `--context ""` never wins).
 */
export function resolveActive(opts: { flagContext?: string } = {}): string {
  const flag = opts.flagContext?.trim() || undefined;
  const env = process.env.PIFLOW_CONTEXT?.trim() || undefined;
  const current = readContexts().current || undefined;
  return flag ?? env ?? current ?? LOCAL_CONTEXT;
}

/** Upsert a named endpoint (create or replace baseUrl/token). Returns the mutated file for chaining. */
export function addContext(file: ContextsFile, name: string, entry: ContextEntry): ContextsFile {
  file.contexts[name] = { baseUrl: entry.baseUrl, ...(entry.token ? { token: entry.token } : {}) };
  return file;
}

/**
 * Remove a named endpoint. If it was the `current` pointer, clear `current` (→ resolution falls to `local`).
 * Removing the implicit `local` is a no-op on the pointer but drops any custom override; the next read
 * re-seeds the default, so `local` can never truly be deleted. Returns the mutated file.
 */
export function removeContext(file: ContextsFile, name: string): ContextsFile {
  delete file.contexts[name];
  if (file.current === name) file.current = null;
  return file;
}

/**
 * Set the `current` pointer to `name`. THROWS if `name` is unknown (kubectl `use-context` errors on an
 * unknown name rather than silently pointing at nothing). The implicit `local` is always a valid target.
 */
export function useContext(file: ContextsFile, name: string): ContextsFile {
  if (!file.contexts[name]) {
    throw new Error(`unknown context "${name}" (known: ${Object.keys(file.contexts).sort().join(', ')})`);
  }
  file.current = name;
  return file;
}
