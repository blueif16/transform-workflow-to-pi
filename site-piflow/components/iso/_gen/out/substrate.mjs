import { writeFileSync } from "node:fs";
import * as K from "../kit.mjs";

/* ============================================================
   substrate — the DAG as a composed workflow.
   Story: a goal in (COMPOSER) → it lays down a graph of SEALED
   NODES → wired by INFERRED EDGES (a write meeting a read) →
   run rank by rank (one PARALLEL STAGE shown) → one TASK flows
   through, lighting the node it currently occupies (the orange).
   Objects (exactly the spec, all labeled):
     COMPOSER · SEALED NODE · INFERRED EDGE · PARALLEL STAGE · TASK
   Orange spark: the single lit node the task is on right now.
   ============================================================ */

const proj = K.proj, f2 = K.f2;

/* ---- local helpers (NOT in kit; reported in addedHelpers) ---- */

// a SEALED NODE: a uniform sealed cell (one pi per node) with a bolt.
// `lit` paints it orange — the one node the task occupies.
function node(x, y, z, { s = 22, h = 14, lit = false } = {}) {
  let g = K.shadow(x + s / 2, y + s / 2, 16, 8, 0.09);
  g += "\n  " + K.roundIsoBox(x, y, z, s, s, h, { r: 5, accent: lit });
  g += "\n  " + K.bolt(x + s / 2, y + s / 2, z + h); // sealed-screw on the top
  return g;
}

// an INFERRED EDGE: a connector that visibly springs from an upstream
// WRITE nib to a downstream READ nib — the wire nobody authored.
// leaves the +x face of `from` and arrives at the -x face of `to`.
function inferredEdge(fx, fy, fz, tx, ty, tz, { s = 22, h = 14 } = {}) {
  const w = proj(fx + s, fy + s / 2, fz + h * 0.5);   // write nib (upstream)
  const r = proj(tx, ty + s / 2, tz + h * 0.5);       // read nib (downstream)
  const nib = (p) =>
    `<circle cx="${f2(p[0])}" cy="${f2(p[1])}" r="2.3" fill="#fff" stroke="${K.EDGE}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`;
  const line = `<path d="M ${f2(w[0])} ${f2(w[1])} L ${f2(r[0])} ${f2(r[1])}" fill="none" stroke="${K.EDGE}" stroke-width="1.4" opacity="0.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  return line + nib(w) + nib(r);
}

const P = [];

/* ---- geometry: graph advances along +x, stages are ranks ---- */
const S = 22, H = 14;            // node footprint / height
const SX = 60;                   // x-gap between stage ranks
const x0 = 0, x1 = x0 + SX, x2 = x1 + SX + 10;   // three stage x-origins
const yMid = 36;                 // single-node lane (centered)
const yA = 4, yB = 68;           // the two parallel siblings' lanes

/* ---- 1. PARALLEL STAGE: a low platform the co-firing rank sits ON ----
   A thin raised band under the two siblings reads as "these fire as one
   rank" far better than a faint dashed rhombus. */
const padX = 7, padY = 7;
P.push(K.shadow(x1 + S / 2, (yA + yB + S) / 2, 26, 36, 0.08));
P.push(K.roundIsoBox(x1 - padX, yA - padY, 0, S + 2 * padX, (yB - yA) + S + 2 * padY, 3,
  { r: 6, top: "#eef0f4", left: "#dfe1e8", right: "#d2d4dc" }));
P.push(K.label(x1 + S / 2, yB + S + 4, 0, "PARALLEL STAGE", { dy: 30, fill: K.EDGE }));

/* ---- 2. COMPOSER: the goal-driven act that lays down the graph ---- */
// a raised emitter slab back-left, from which the graph is laid down.
const cx = -64, cy = yMid;
P.push(K.shadow(cx + 13, cy + 13, 24, 12, 0.10));
P.push(K.roundIsoBox(cx, cy - 1, 0, 28, 28, 22, { r: 6 }));
P.push(K.bolt(cx + 14, cy + 13, 22));
P.push(K.label(cx + 14, cy + 28, 0, "COMPOSER", { dy: 26, fill: K.EDGE }));
P.push(K.label(cx + 14, cy - 1, 22, "goal in", { dy: -16, fill: K.MUTE }));

const zP = 3;  // platform height the parallel rank sits on

/* ---- 3. INFERRED EDGES (over the band, under the flow) ---- */
// composer → stage-0 node (composer is a 28-wide emitter, leaves its +x face)
{
  const w = proj(cx + 28, cy + 13, 11), r = proj(x0, yMid + S / 2, H * 0.5);
  const nib = (p) => `<circle cx="${f2(p[0])}" cy="${f2(p[1])}" r="2.3" fill="#fff" stroke="${K.EDGE}" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`;
  P.push(`<path d="M ${f2(w[0])} ${f2(w[1])} L ${f2(r[0])} ${f2(r[1])}" fill="none" stroke="${K.EDGE}" stroke-width="1.4" opacity="0.8" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` + nib(w) + nib(r));
}
// stage-0 → both stage-1 siblings (the fan that proves it's a topology)
P.push(inferredEdge(x0, yMid, 0, x1, yA, zP, { s: S, h: H }));
P.push(inferredEdge(x0, yMid, 0, x1, yB, zP, { s: S, h: H }));
// both stage-1 siblings → stage-2 node (the lit one)
P.push(inferredEdge(x1, yA, zP, x2, yMid, 0, { s: S, h: H }));
P.push(inferredEdge(x1, yB, zP, x2, yMid, 0, { s: S, h: H }));
P.push(K.label((x0 + x1) / 2 + S / 2, yMid - 24, 8, "INFERRED EDGE", { dy: -8, fill: K.MUTE }));

/* ---- 4. SEALED NODES (the graph itself) ---- */
P.push(node(x0, yMid, 0));                   // stage 0
P.push(node(x1, yA, zP));                     // stage 1 sibling A (on platform)
P.push(node(x1, yB, zP));                     // stage 1 sibling B (on platform)
P.push(node(x2, yMid, 0, { lit: true }));     // stage 2 — the LIT node (orange)
P.push(K.label(x0 + S / 2, yMid + S, 0, "SEALED NODE", { dy: 18, fill: K.EDGE }));

/* ---- 5. FLOWING TASK: the single live thing, advancing to the lit node ----
   lifted clear of the composer top and the edges; a single dashed wavefront
   that threads the ranks and lands ON the lit node's top (the orange spark). */
P.push(K.flow([
  [cx + 14, cy + 8, H + 22],
  [x0 + S / 2, yMid + S / 2, H + 11],
  [x1 + S / 2, (yA + yB) / 2 + S / 2, H + zP + 13],
  [x2 + S / 2, yMid + S / 2, H + 1],
], { accent: K.EDGE, op: 0.6 }));
P.push(K.label(x2 + S + 6, yMid + S / 2, H + 6, "TASK", { dy: -4, fill: K.ORANGE, anchor: "start" }));

const svg = K.emit("-150 -70 360 240", P);
writeFileSync("substrate.svg", svg);
console.log("wrote substrate.svg");
