#!/usr/bin/env node
// pi-runner driver — runs a Claude Code Workflow by spawning one `pi` per node, on a cheap
// non-Claude coding-plan model, orchestrated entirely from Claude Code (the user runs nothing).
//
// SOURCE OF TRUTH = your `.claude/workflows/<name>.js` (the Claude Code Workflow). This driver
// does NOT re-define the graph. It EXECUTES that file under recording stubs (extract.mjs) to
// capture the EXACT realized prompts + DAG, then runs each node on pi. So: edit the workflow,
// prove it by spawning the real Claude Code Workflow, and pi runs the SAME prompts — no drift,
// nothing to hand-sync.
//
// The DRIVER owns the deterministic graph (stage order, parallel lanes, status, watchdog);
// pi is the per-node executor (read/bash/edit/write) on a non-Claude coding-plan model. Nodes
// coordinate through the FILESYSTEM, exactly like the Workflow's agents do.
//
// THIS FILE IS GENERIC AND BYTE-IDENTICAL ACROSS REPOS. Per-repo specifics live entirely in
// pi-runner/.env (gitignored): the credential/model AND the three path knobs below + an optional
// default `--until`. To adopt in a new repo: copy pi-runner/ and write its .env — never edit this
// file. (That is how the repo copy and the global-skill template stay the same: a fix here is a
// one-file copy, never a manual merge.)
//
// USAGE (the orchestrator runs this — never the user):
//   node pi-runner/run.mjs --run <id> [--arg k=v ...] [--arg-file k=path ...] \
//        [--until <phase>] [--debug] [--dry-run] [--node-timeout N]
//   --run <id> | --id <id> | --lesson <id>   instance id — keys out/<id>/ AND seeds args.lessonId.
//   --arg k=v          a workflow arg (repeatable). Becomes the workflow's `args.k`.
//   --arg-file k=path  read file text into args.k (repeatable).
//   --brief <file>     alias for --arg-file brief=<file> (common pipeline input doc).
//   --style <value>    alias for --arg style=<value>.
//   --until <phase>    truncate after the first stage whose phase TITLE or node LABEL contains
//                      this substring (case-insensitive). Default = $PI_RUNNER_UNTIL or "all".
//   --provider/--model/--extension(-e)/--status as below (model defaults to $PI_CP_MODEL).
//   --debug            real-time heartbeats + stall detection (ALWAYS use while developing).
//   --node-timeout N   hard-kill a node after N seconds (default 600).
//   --dry-run          extract + build prompts + print the exact pi commands; invoke no model.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorkflow } from "./extract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // pi-runner/ lives here

// Load pi-runner/.env (KEY=VALUE) FIRST so PI_RUNNER_* + credentials are visible to the config
// below. A real process.env value always wins (override per-invocation). Never commit .env.
function loadDefaults() {
  let raw;
  try { raw = fs.readFileSync(path.join(HERE, ".env"), "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDefaults();

// ==== PROJECT CONFIG — set these in pi-runner/.env, NOT here ===============================
// PI_RUNNER_ROOT     repo root (the workflow's ROOT). Default = pi-runner/'s parent dir.
// PI_RUNNER_CWD      where pi executes each node + where node-reported relative artifact paths
//                    resolve (the dir your npm scripts run in). Relative paths resolve vs ROOT.
//                    Default = ROOT.
// PI_RUNNER_WORKFLOW path to the workflow .js. Relative paths resolve vs ROOT.
// PI_RUNNER_UNTIL    optional default for --until (e.g. an early phase during bring-up).
const resolveFrom = (root, p, fb) => (!p ? fb : path.isAbsolute(p) ? p : path.join(root, p));
const ROOT = process.env.PI_RUNNER_ROOT ? path.resolve(process.env.PI_RUNNER_ROOT) : path.resolve(HERE, "..");
const RUN_CWD = resolveFrom(ROOT, process.env.PI_RUNNER_CWD, ROOT);
const WORKFLOW = resolveFrom(ROOT, process.env.PI_RUNNER_WORKFLOW, path.join(ROOT, ".claude/workflows/CHANGEME.js"));
// ==========================================================================================

function parseArgs(argv) {
  const a = { until: process.env.PI_RUNNER_UNTIL || "all", provider: "cp", dryRun: false, wfArgs: {} };
  const setRun = (v) => { a.run = v; if (a.wfArgs.lessonId === undefined) a.wfArgs.lessonId = v; if (a.wfArgs.id === undefined) a.wfArgs.id = v; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--run" || k === "--id" || k === "--lesson") setRun(next());
    else if (k === "--arg") { const [key, ...rest] = next().split("="); a.wfArgs[key] = rest.join("="); }
    else if (k === "--arg-file") { const [key, ...rest] = next().split("="); a.wfArgs[key] = fs.readFileSync(path.resolve(rest.join("=")), "utf8"); }
    else if (k === "--brief") a.wfArgs.brief = fs.readFileSync(path.resolve(next()), "utf8");
    else if (k === "--style") a.wfArgs.style = next();
    else if (k === "--until") a.until = next();
    else if (k === "--provider") a.provider = next();
    else if (k === "--model") a.model = next();
    else if (k === "--extension" || k === "-e") a.extension = next();
    else if (k === "--status") a.status = next();
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--debug") a.debug = true;
    else if (k === "--node-timeout") a.nodeTimeout = Number(next());
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.run) a.run = a.wfArgs.lessonId || a.wfArgs.id || a.wfArgs.run || "run";
  return a;
}

const args = parseArgs(process.argv.slice(2));
const model = args.model || process.env.PI_CP_MODEL || "";
const extension = path.resolve(args.extension || path.join(HERE, "providers/coding-plan.ts"));

// DEBUG (always use while developing): frequent status refresh + console heartbeats + stall
// detection so a hang is visible in seconds, never minutes. Production mode is lean.
const DEBUG = args.debug === true;
const HEARTBEAT_MS = DEBUG ? 4000 : 10000;
const STALL_WARN_S = 45;
const NODE_TIMEOUT_S = args.nodeTimeout || 600;

const outRel = `out/${args.run}`;
const promptDir = path.join(RUN_CWD, outRel, "_pi");
const statusPath = path.resolve(args.status || path.join(RUN_CWD, outRel, "run-status.json"));

const abs = (p) => (path.isAbsolute(p) ? p : path.join(RUN_CWD, p));
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
const nowISO = () => new Date().toISOString();
const slug = (label, i) => (label || `node-${i}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function artifactState(p) {
  try { const s = fs.statSync(abs(p)); return { path: p, exists: s.size > 0, bytes: s.size }; }
  catch { return { path: p, exists: false, bytes: 0 }; }
}

// pi has no schema-forced return, so each node ends with a fenced JSON block the driver parses;
// the driver ALSO stat()s the reported artifacts on disk (verified, not trusted).
function returnProtocol(label) {
  return [
    "",
    "RETURN PROTOCOL (pi runner) — after writing all your output files AND the _logs entry,",
    "END your final message with ONE fenced ```json block (and nothing after it) of EXACTLY:",
    "```json",
    JSON.stringify(
      { node: label, status: "ok | gap | blocked", outputArtifacts: ["<repo-relative paths you wrote>"], summary: "<1-2 sentences>", issues: [], pipelineFindings: [] },
      null, 2,
    ),
    "```",
    "The driver stat()s outputArtifacts on disk; status=ok REQUIRES them present.",
  ].join("\n");
}

function selectStages(stages, until) {
  if (!until || until.toLowerCase() === "all") return stages;
  const u = until.toLowerCase();
  let idx = -1;
  stages.forEach((s, i) => {
    if ((s.phase || "").toLowerCase().includes(u) || s.nodes.some((n) => (n.label || "").toLowerCase().includes(u))) idx = i;
  });
  if (idx < 0) { console.error(`--until "${until}" matched no phase/label — running ALL stages`); return stages; }
  return stages.slice(0, idx + 1);
}

const status = {
  run: args.run,
  lessonId: args.wfArgs.lessonId || null,
  until: args.until,
  source: path.relative(ROOT, WORKFLOW),
  provider: args.provider,
  model: model || null,
  dryRun: args.dryRun,
  debug: DEBUG,
  startedAt: nowISO(),
  updatedAt: nowISO(),
  done: false,
  ok: null,
  nodes: {},
};
function writeStatus() {
  status.updatedAt = nowISO();
  ensureDir(path.dirname(statusPath));
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

function lastJsonBlock(text) {
  const re = /```json\s*([\s\S]*?)```/g;
  let m, last = null;
  while ((m = re.exec(text))) last = m[1];
  if (!last) return null;
  try { return JSON.parse(last.trim()); } catch { return null; }
}

function piArgs(promptFileAbs) {
  return [
    // headless executor: print+json, trust project files, ephemeral, --offline (no startup
    // network ops; the model call still works), --no-extensions (explicit -e provider still loads).
    "-p", "--mode", "json", "-a", "--no-session", "--offline", "--no-extensions",
    "--provider", args.provider, "--model", model,
    "-e", extension,
    `@${promptFileAbs}`,
  ];
}

async function runNode(node) {
  const n = status.nodes[node.id];
  n.status = "running";
  n.startedAt = nowISO();
  const t0 = Date.now();
  writeStatus();

  ensureDir(promptDir);
  const promptFile = path.join(promptDir, `${node.id}.prompt.md`);
  fs.writeFileSync(promptFile, node.prompt + returnProtocol(node.label));
  const argv = piArgs(promptFile);
  console.log(`  ▶ ${node.label}  [${node.id}]`);

  if (args.dryRun) {
    console.log(`    DRY: (cd ${RUN_CWD} && pi ${argv.join(" ")})`);
    console.log(`    prompt: ${promptFile} (${fs.statSync(promptFile).size} bytes)`);
    n.status = "dry";
    n.endedAt = nowISO();
    n.durationMs = Date.now() - t0;
    n.command = `pi ${argv.join(" ")}`;
    writeStatus();
    return n;
  }

  const eventsFile = path.join(promptDir, `${node.id}.events.jsonl`);
  const debugLog = path.join(promptDir, `${node.id}.debug.log`);
  return await new Promise((resolve) => {
    let assistantText = "", stderr = "", toolCalls = 0, eventCount = 0;
    let lastEventAt = Date.now(), lastWrite = 0, finished = false;
    const evStream = fs.createWriteStream(eventsFile);
    const dbgStream = DEBUG ? fs.createWriteStream(debugLog) : null;
    const dbg = (m) => { if (dbgStream) dbgStream.write(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}\n`); };
    n.live = { eventCount: 0, toolCalls: 0, lastEvent: "(starting pi)", sinceEventMs: 0, elapsedMs: 0, currentTool: null, textChars: 0, stalled: false };
    dbg(`spawn: pi ${argv.join(" ")}`);

    // stdin MUST be closed — a headless CLI with an open stdin pipe (no TTY) blocks forever
    // waiting for EOF (this caused a silent ~10-min startup hang).
    const child = spawn("pi", argv, { cwd: RUN_CWD, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    const refresh = (force) => {
      Object.assign(n.live, {
        eventCount, toolCalls, textChars: assistantText.length,
        sinceEventMs: Date.now() - lastEventAt, elapsedMs: Date.now() - t0,
        stalled: Date.now() - lastEventAt > STALL_WARN_S * 1000,
      });
      const now = Date.now();
      if (force || now - lastWrite > 800) { lastWrite = now; writeStatus(); }
    };

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      evStream.write(line + "\n");
      eventCount++;
      lastEventAt = Date.now();
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      const t = typeof ev.type === "string" ? ev.type : "";
      if (t) n.live.lastEvent = t;
      const ame = ev.assistantMessageEvent || ev.event || null;
      if (ev.type === "message_update" && ame && ame.type === "text_delta" && typeof ame.delta === "string") assistantText += ame.delta;
      else if (typeof ev.delta === "string" && t.includes("text")) assistantText += ev.delta;
      if (t.startsWith("tool_execution_start")) { toolCalls++; n.live.currentTool = ev.tool || ev.name || (ev.toolCall && ev.toolCall.name) || "tool"; dbg(`tool▶ ${n.live.currentTool}`); }
      else if (t.startsWith("tool_execution_end")) { dbg(`tool✓ ${n.live.currentTool || ""}`); n.live.currentTool = null; }
      else if (dbgStream && t) dbg(`ev ${t}`);
      refresh(false);
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); dbg(`stderr: ${d.toString().trim().slice(0, 200)}`); });
    child.on("error", (err) => { stderr += `\n[spawn error] ${err.message}`; });

    const hb = setInterval(() => {
      if (finished) return;
      refresh(true);
      if (DEBUG) {
        const el = (n.live.elapsedMs / 1000).toFixed(0), dl = (n.live.sinceEventMs / 1000).toFixed(0);
        console.log(`    · ${node.id} t=${el}s ev=${eventCount} tools=${toolCalls} cur=${n.live.currentTool || "-"} last=${n.live.lastEvent} Δ=${dl}s${n.live.stalled ? "  ⚠ STALLED" : ""}`);
      }
      if (n.live.elapsedMs > NODE_TIMEOUT_S * 1000) {
        console.error(`    ✕ ${node.id} exceeded --node-timeout ${NODE_TIMEOUT_S}s — killing pi`);
        n.killedTimeout = true;
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
      }
    }, HEARTBEAT_MS);

    child.on("close", (code) => {
      finished = true;
      clearInterval(hb);
      evStream.end();
      if (dbgStream) dbgStream.end();
      n.eventsFile = path.relative(RUN_CWD, eventsFile);
      if (DEBUG) n.debugLog = path.relative(RUN_CWD, debugLog);
      const parsed = lastJsonBlock(assistantText);
      n.artifacts = ((parsed && parsed.outputArtifacts) || []).map(artifactState);
      const allArtifacts = n.artifacts.length > 0 && n.artifacts.every((a) => a.exists);
      let st;
      if (n.killedTimeout || code !== 0) st = "error";
      else if (parsed && parsed.status && parsed.status !== "ok") st = parsed.status; // gap/blocked self-report honored
      else if (!allArtifacts) st = "blocked"; // ok claimed but a reported file is missing (measure, don't trust)
      else st = "ok";
      n.status = st;
      n.exitCode = code;
      n.toolCalls = toolCalls;
      n.eventCount = eventCount;
      n.summary = n.killedTimeout ? `killed: exceeded ${NODE_TIMEOUT_S}s node timeout` : (parsed && parsed.summary) || assistantText.trim().slice(-240) || "";
      n.issues = (parsed && parsed.issues) || [];
      n.pipelineFindings = (parsed && parsed.pipelineFindings) || [];
      if (!parsed) (n.issues = n.issues || []).push("no return JSON block parsed from pi output");
      if (stderr.trim()) n.stderrTail = stderr.trim().slice(-500);
      n.endedAt = nowISO();
      n.durationMs = Date.now() - t0;
      delete n.live;
      writeStatus();
      const mark = st === "ok" ? "✓" : st === "error" || st === "blocked" ? "✕" : "•";
      console.log(`    ${mark} ${node.label} → ${st} (${(n.durationMs / 1000).toFixed(1)}s, ev=${eventCount}, tools=${toolCalls}) — ${(n.summary || "").split("\n")[0].slice(0, 100)}`);
      resolve(n);
    });
  });
}

(async () => {
  if (!args.dryRun && args.provider === "cp") {
    const missing = [];
    if (!process.env.CODING_PLAN_API_KEY) missing.push("CODING_PLAN_API_KEY");
    if (!process.env.PI_CP_BASE_URL) missing.push("PI_CP_BASE_URL");
    if (!model) missing.push("PI_CP_MODEL (or --model)");
    if (missing.length) { console.error(`\n✕ live run needs: ${missing.join(", ")} (or use --dry-run)\n`); process.exit(2); }
  }

  // THE SYNC: execute the workflow under recording stubs → exact prompts + DAG.
  const { stages: allStages } = await extractWorkflow(WORKFLOW, args.wfArgs);
  const stages = selectStages(allStages, args.until);

  // assign stable ids + register in status
  let idx = 0;
  for (const s of stages) for (const node of s.nodes) { node.id = slug(node.label, idx++); status.nodes[node.id] = { id: node.id, label: node.label, phase: node.phase, status: "pending" }; }

  console.log(`\npi-runner — run "${args.run}" — ${stages.flatMap((s) => s.nodes).length} nodes / ${stages.length} stages from ${path.basename(WORKFLOW)} — ${args.dryRun ? "DRY-RUN" : `provider=${args.provider} model=${model}`}${DEBUG ? ` — DEBUG (heartbeat ${HEARTBEAT_MS / 1000}s · stall>${STALL_WARN_S}s · node-timeout ${NODE_TIMEOUT_S}s)` : ""}`);
  console.log(`source-of-truth: ${WORKFLOW}`);
  console.log(`status → ${statusPath}\n`);
  writeStatus();

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    console.log(`[stage ${i + 1}/${stages.length}] [${s.phase}] ${s.nodes.map((x) => x.id).join(" ∥ ")}`);
    const results = await Promise.all(s.nodes.map((node) => runNode(node)));
    const bad = results.find((r) => r.status === "error" || r.status === "blocked");
    if (bad && !args.dryRun) {
      status.done = true; status.ok = false; writeStatus();
      console.error(`\n✕ halted at ${bad.id} (${bad.status}). See ${statusPath}\n`);
      process.exit(1);
    }
  }

  status.done = true;
  status.ok = args.dryRun ? null : true;
  writeStatus();
  console.log(`\n${args.dryRun ? "DRY-RUN complete" : "✓ complete"} — ${stages.flatMap((s) => s.nodes).length} nodes. status: ${statusPath}\n`);
})();
