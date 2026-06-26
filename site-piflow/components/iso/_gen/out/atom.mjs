import { writeFileSync } from "node:fs";
import * as K from "../kit.mjs";

/* ATOM — ONE node = a whole agent.
   5 objects: nucleus (headless pi) · sandbox shell (the seal) ·
   PRE hook (entry gate, DETECT) · POST hook (exit gate, DERIVE+ACT) ·
   granted-tools tether. ONE orange element: the on-failure CONTROL tail.

   SAME shapes/positions/orange-arc as before — only the LABELS are now
   AUTO-PLACED by the kit's Scene (collision-detection + 8-point greedy),
   which fixes the NUCLEUS-on-core and POST-on-bolt overlaps that the old
   hand-coded label coordinates produced. */

const { proj, f2, EDGE } = K;

/* ---- local helper: a thin grey membrane ring (the sandbox seal collar)
   drawn flat on a top plane, enclosing the nucleus. Greyscale only.
   DECO — not an obstacle (labels may pass over it). ---- */
function ring(cx, cy, gz, rx, ry, { stroke = EDGE, sw = 1.5, op = 1, fill = "none" } = {}) {
  const [px, py] = proj(cx, cy, gz);
  return `<ellipse cx="${f2(px)}" cy="${f2(py)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${op}" vector-effect="non-scaling-stroke"/>`;
}

/* ---- local helper: a single orange CONTROL arc (the on-failure tail).
   A quadratic curve with an arrowhead, orange — the ONLY accent.
   DECO — must NOT block labels. ---- */
function controlArc(p0, ctrl, p1, { sw = 2 } = {}) {
  const A = proj(...p0), Q = proj(...ctrl), B = proj(...p1);
  // arrowhead at B, pointing along (Q->B)
  const dx = B[0] - Q[0], dy = B[1] - Q[1], l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, px = -uy, py = ux;
  const base = [B[0] - ux * 8, B[1] - uy * 8];
  const a1 = [base[0] + px * 4.5, base[1] + py * 4.5];
  const a2 = [base[0] - px * 4.5, base[1] - py * 4.5];
  return `<path d="M ${f2(A[0])} ${f2(A[1])} Q ${f2(Q[0])} ${f2(Q[1])} ${f2(B[0])} ${f2(B[1])}" fill="none" stroke="${K.ORANGE}" stroke-width="${sw}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
    `<polygon points="${f2(B[0])},${f2(B[1])} ${f2(a1[0])},${f2(a1[1])} ${f2(a2[0])},${f2(a2[1])}" fill="${K.ORANGE}"/>`;
}

/* viewBox + Scene. padding/margin/labelSize tuned for this scene. */
const VIEWBOX = "-205 -125 410 340";
const S = K.Scene({ viewBox: VIEWBOX, padding: 4, margin: 8, labelSize: 8.5 });

/* ===== contact shadow under the whole node (DECO) ===== */
S.shadow(55, 55, 92, 46, 0.10);

/* ===== (2) SANDBOX SHELL — the seal : a bolted slab platform (TRACKED) =====
   the OS-enforcement membrane the nucleus runs inside. */
S.box(0, 0, 0, 110, 110, 14, { r: 12 });
// sealed corners (bolts) — DECO (tiny dots, do not block labels)
S.bolt(10, 10, 14);
S.bolt(100, 10, 14);
S.bolt(10, 100, 14);
S.bolt(100, 100, 14);

/* ===== membrane ring on the slab top (DECO) ===== */
S.raw(ring(55, 55, 14.4, 42, 21, { sw: 1.6, op: 0.7 }));
S.raw(ring(55, 55, 14.4, 37, 18.5, { sw: 1, op: 0.35 }));

/* ===== (1) NUCLEUS — headless pi : dense white/grey core, centered (TRACKED) ===== */
S.box(41, 41, 14, 28, 28, 21, { r: 7 });
// a small bolt on the core top = the live sealed exec (DECO)
S.bolt(55, 55, 35);

/* ===== (3) PRE HOOK — entry gate (DETECT) : inbound back-left side (TRACKED) ===== */
S.gate(2, 36, { d: 38, h: 30 });

/* ===== (4) POST HOOK — exit gate (DERIVE+ACT) : outbound front-right side (TRACKED) ===== */
S.gate(108, 36, { d: 38, h: 30 });

/* ===== (5) GRANTED-TOOLS TETHER : a FINITE bundle of 3 bonds (TRACKED chips) ===== */
S.toolChip(30, 132, 0, [38, 112, 6]);
S.toolChip(52, 140, 0, [54, 112, 6]);
S.toolChip(74, 134, 0, [70, 112, 6]);

/* ===== ORANGE SPARK — the on-failure CONTROL tail (DECO, the only accent) ===== */
S.raw(controlArc([120, 52, 34], [140, 20, 56], [64, 52, 36]));

/* ===== labels — every spec object, now AUTO-PLACED clear of all shapes =====
   We pass each label's anchor (the iso point it names) + a preferred side;
   the Scene relocates it to the first collision-free 8-point candidate that
   stays inside the viewBox. No hand-tuned screen coordinates. */
S.label([55, 55, 35], "NUCLEUS", { fill: EDGE, side: "top", gap: 10 });        // above the core top
S.label([55, 110, 0], "SANDBOX", { fill: EDGE, side: "bottom", gap: 10 });     // below the slab front
S.label([2, 55, 30], "PRE", { fill: K.MUTE, side: "left", gap: 10 });          // off the entry gate
S.label([113, 55, 30], "POST", { fill: K.MUTE, side: "right", gap: 10 });      // off the exit gate
S.label([52, 138, 6], "TOOLS", { fill: K.MUTE, side: "bottom", gap: 10 });     // under the tool bundle
S.label([140, 20, 56], "CONTROL", { fill: K.ORANGE, side: "right", gap: 10 }); // by the orange arc apex

const svg = S.emit({ w: 1000 });
writeFileSync("atom.svg", svg);
console.log("atom.svg written");
