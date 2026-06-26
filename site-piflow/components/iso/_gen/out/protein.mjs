/* ============================================================
   protein — the loop refolded.
   A verify FAIL does not loop in place; the chain UNFOLDS forward
   into a bounded ladder of re-attempts, each rung fed the prior
   rung's failure evidence, ending in a stronger-model rescue.
   Composes ONLY the 6 spec objects as a forward-climbing ladder.
   ============================================================ */
import { writeFileSync } from "fs";
import * as K from "../kit.mjs";

const P = [];

/* ---------------- LOCAL helpers (kit not edited) ---------------- */

/* strikeGhost: the REFUSED runtime back-edge. A dashed arrow bowing back
   from the end of the ladder to the start, struck through with an X —
   negative space that says "the cycle is forbidden; we unrolled instead". */
function strikeGhost(fromXYZ, toXYZ, lift) {
  const a = K.proj(...fromXYZ), b = K.proj(...toXYZ);
  const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - lift;
  const curve = `<path d="M ${K.f2(a[0])} ${K.f2(a[1])} Q ${K.f2(mx)} ${K.f2(my)} ${K.f2(b[0])} ${K.f2(b[1])}" fill="none" stroke="${K.MUTE}" stroke-width="1.6" stroke-dasharray="5 5" opacity="0.5" vector-effect="non-scaling-stroke"/>`;
  // back-pointing arrowhead at b (the return lands at the START) — tangent of
  // the quadratic at t=1 points from control(mx,my) toward b.
  const dx = b[0] - mx, dy = b[1] - my, dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl, perx = -uy, pery = ux;
  const tip = [b[0], b[1]];
  const w1 = [b[0] - ux * 9 + perx * 5, b[1] - uy * 9 + pery * 5];
  const w2 = [b[0] - ux * 9 - perx * 5, b[1] - uy * 9 - pery * 5];
  const head = `<polygon points="${K.f2(tip[0])},${K.f2(tip[1])} ${K.f2(w1[0])},${K.f2(w1[1])} ${K.f2(w2[0])},${K.f2(w2[1])}" fill="${K.MUTE}" opacity="0.5"/>`;
  // strike X at the arc apex = "this cycle is forbidden"
  const sx = mx, sy = my + 4, s = 9;
  const cross = `<g opacity="0.78" stroke="${K.MUTE}" stroke-width="2.4" stroke-linecap="round">
    <line x1="${K.f2(sx - s)}" y1="${K.f2(sy - s)}" x2="${K.f2(sx + s)}" y2="${K.f2(sy + s)}"/>
    <line x1="${K.f2(sx - s)}" y1="${K.f2(sy + s)}" x2="${K.f2(sx + s)}" y2="${K.f2(sy - s)}"/></g>`;
  return curve + head + cross;
}

/* gateAt: a VERIFY GATE check-panel that can ride a rung at any z (the kit's
   gate() is pinned to z=0). A thin standing panel with the check mark — the
   same shape recurs per rung so the ladder reads as repeated verify-then-act. */
function gateAt(x, y, z, d, h) {
  const box = K.roundIsoBox(x, y, z, 5, d, h, { r: 2, top: "#f3f3f6", left: "#e1e1e8", right: "#d2d2da" });
  const c0 = K.proj(x, y + d * 0.34, z + h * 0.44), c1 = K.proj(x, y + d * 0.5, z + h * 0.32), c2 = K.proj(x, y + d * 0.74, z + h * 0.64);
  const chk = `<path d="M ${K.f2(c0[0])} ${K.f2(c0[1])} L ${K.f2(c1[0])} ${K.f2(c1[1])} L ${K.f2(c2[0])} ${K.f2(c2[1])}" fill="none" stroke="${K.MUTE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return box + chk;
}

/* screenLabel: a label placed at ABSOLUTE screen coords (not iso-projected),
   with an optional thin leader line to the object it names. Needed because the
   climbing ladder makes iso-projected label baselines collide; screen bands
   keep them apart. */
function screenLabel(sx, sy, text, { anchor = "start", fill = K.MUTE, size = 8.5, leadTo = null, leadColor = null } = {}) {
  let lead = "";
  if (leadTo) {
    const [lx, ly] = leadTo;
    lead = `<line x1="${K.f2(sx + (anchor === "end" ? -2 : anchor === "middle" ? 0 : 2))}" y1="${K.f2(sy + 2)}" x2="${K.f2(lx)}" y2="${K.f2(ly)}" stroke="${leadColor || fill}" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" vector-effect="non-scaling-stroke"/>`;
  }
  return `${lead}<text x="${K.f2(sx)}" y="${K.f2(sy)}" font-family="ui-monospace,monospace" font-size="${size}" letter-spacing="0.7" text-anchor="${anchor}" fill="${fill}">${text}</text>`;
}

/* tickRow: the BOUND-k budget meter — n pips on a top face; the last
   `spent` pips dimmed = budget consumed, which is why the ladder ends in
   the escalate rung. Runs along iso-y so it sits flat on the box top. */
function tickRow(x, y, z, n, spent) {
  let g = "";
  for (let i = 0; i < n; i++) {
    const [px, py] = K.proj(x, y + i * 5, z);
    const dim = i >= n - spent;
    g += `<rect x="${K.f2(px - 1.8)}" y="${K.f2(py - 3.6)}" width="3.6" height="3.8" rx="0.8" fill="${dim ? "#ffffff" : K.MUTE}" stroke="${K.EDGE}" stroke-width="1" opacity="${dim ? 0.5 : 0.92}" vector-effect="non-scaling-stroke"/>`;
  }
  return g;
}

/* ---------------- ladder layout ----------------
   Four rungs march along iso-x and rise in z. Each rung is ONE unit:
   a re-attempt CLONE box with a VERIFY GATE seated on its far (down-right)
   edge. Stride is generous so nothing crowds; each rung sits one step
   higher so the eye reads UNROLL + CLIMB, never a back-edge. */
const DEPTH = 30;           // constant iso-y depth of every box
const STRIDE = 46;          // iso-x distance between rungs (generous)
const RISE = 11;            // z gained per rung (the climb)
const BW = 30, BH = 16;     // clone box footprint / height

const rungs = [0, 1, 2, 3].map((i) => ({
  i,
  x: i * STRIDE,
  z: i * RISE,
  esc: i === 3,
}));

/* contact shadows on the ground under every box (so nothing floats) */
for (const r of rungs) {
  P.push(K.shadow(r.x + BW / 2, DEPTH / 2, r.esc ? 36 : 30, r.esc ? 17 : 14, 0.10));
}

/* the refused back-edge ghost — from the LAST rung back to the FIRST.
   Drawn before the boxes so the struck-out cycle reads as a ground ghost
   the architecture rejected. Anchored near box tops at each end. */
P.push(strikeGhost(
  [rungs[3].x + BW / 2, DEPTH + 6, rungs[3].z + BH],
  [rungs[0].x + BW / 2, DEPTH + 6, rungs[0].z + BH],
  64
));

/* build each rung: clone box (+ gate), escalate rung heavier */
for (const r of rungs) {
  // the forward re-attempt clone (T__r{i})
  P.push(K.roundIsoBox(r.x, 0, r.z, BW, DEPTH, BH, { r: 6 }));

  if (r.esc) {
    // stronger-model rescue: a heavier second tier + sealed bolts = "more
    // capability". Visibly taller than the repeating rungs.
    P.push(K.roundIsoBox(r.x + 4, 5, r.z + BH, BW - 8, DEPTH - 10, 16, { r: 5 }));
    P.push(K.bolt(r.x + 7, 8, r.z + BH + 16));
    P.push(K.bolt(r.x + BW - 7, DEPTH - 8, r.z + BH + 16));
  }

  // the VERIFY GATE for this rung, standing on the box top at the rung's z
  const gz = r.esc ? r.z + BH + 16 : r.z + BH;
  P.push(gateAt(r.x + BW - 5, 5, gz, DEPTH - 10, r.esc ? 18 : 15));
}

/* the BOUND-k meter on the first rung's top face (k=4 pips, last spent) */
P.push(tickRow(rungs[0].x + 6, 7, rungs[0].z + BH, 4, 1));

/* ---------------- the ONE orange element ----------------
   EVIDENCE packet (consultPreamble): a single orange dashed connector that
   threads from each rung's verify gate INTO the next rung's clone, gap by
   gap — the failure facts carried forward. The ONLY hue in the scene.
   One orange chip rides the first hand-off as the packet itself. */
const ev = [];
rungs.forEach((r, i) => {
  const gtop = (r.esc ? r.z + BH + 16 : r.z + BH) + (r.esc ? 18 : 15);
  ev.push([r.x + BW + 2, DEPTH / 2, gtop - 4]);      // leave from this gate's top
  if (i < rungs.length - 1) {
    const n = rungs[i + 1];
    ev.push([n.x + 4, DEPTH / 2, n.z + BH + 5]);      // arrive at next clone top
  }
});
P.push(K.flow(ev, { accent: K.ORANGE, op: 0.9, sw: 1.8 }));

/* the evidence packet chip riding the first hand-off gap */
{
  const r0 = rungs[0];
  const px = r0.x + BW + 9, pz = r0.z + BH + 9;
  P.push(K.roundIsoBox(px, DEPTH / 2 - 4, pz, 9, 9, 7, { r: 2, accent: true }));
}

/* ---------------- labels (every spec object, in clean SCREEN bands) ----------
   placed at absolute screen coords with thin leaders so the climbing ladder
   can't make their baselines collide. Bands: top arc · left · right · bottom. */

// REFUSED BACK-EDGE — top band, above the struck-out arc apex (screen ~42,-55)
P.push(screenLabel(42, -78, "REFUSED BACK-EDGE · checkCycles", { anchor: "middle", fill: K.MUTE, leadTo: [42, -60] }));

// VERIFY GATE — left band, leader from text END to the first rung's gate top
P.push(screenLabel(-128, -40, "VERIFY GATE · V", { anchor: "start", fill: K.EDGE }));
P.push(`<line x1="-58" y1="-43" x2="9" y2="-11" stroke="${K.MUTE}" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" vector-effect="non-scaling-stroke"/>`);

// BOUND k — left band, below VERIFY; leader from text END to rung 0's tick meter
P.push(screenLabel(-128, -24, "BOUND · k = reroute.max", { anchor: "start", fill: K.MUTE }));
P.push(`<line x1="2" y1="-27" x2="-5" y2="-6" stroke="${K.MUTE}" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" vector-effect="non-scaling-stroke"/>`);

// ESCALATE — right band, leader to the tall final rung top
P.push(screenLabel(140, -30, "ESCALATE · STRONGER MODEL", { anchor: "start", fill: K.EDGE, leadTo: [121, -2] }));

// EVIDENCE (orange — the one accent's name) — bottom-mid, orange leader UP to
// the orange thread running through the mid-ladder
P.push(screenLabel(62, 112, "EVIDENCE · consultPreamble", { anchor: "middle", fill: K.ORANGE, leadColor: K.ORANGE, leadTo: [62, 14] }));

// FORWARD RE-ATTEMPT — bottom band, centered under the ladder
P.push(screenLabel(62, 132, "FORWARD RE-ATTEMPT · T__r{i}", { anchor: "middle", fill: K.EDGE }));

writeFileSync("protein.svg", K.emit("-180 -150 540 360", P));
console.log("wrote protein.svg with", P.length, "parts");
