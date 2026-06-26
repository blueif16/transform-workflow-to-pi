import { writeFileSync } from "node:fs";

/* ===== isometric projection (30°) — matches site-piflow iso-math ===== */
const C = Math.cos(Math.PI / 6), S = 0.5;
const proj = (x, y, z) => [(x - y) * C, (x + y) * S - z];
const f2 = (n) => Number(n.toFixed(2));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/* ===== palette (light system) ===== */
const EDGE = "#1f1f24", SW = 1.5;
const TOP = "#ffffff", LEFT = "#e7e7ee", RIGHT = "#d8d8e0";
const GUIDE = "#1f1f24", ORANGE = "#ff5a1f", MUTE = "#6b6b73";

/* ===== rounded convex polygon path (screen space) ===== */
function roundPath(pts, r) {
  const n = pts.length, tan = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const rr = Math.min(r, len(sub(p0, p1)) / 2, len(sub(p2, p1)) / 2);
    tan.push([add(p1, mul(norm(sub(p0, p1)), rr)), add(p1, mul(norm(sub(p2, p1)), rr))]);
  }
  let d = "";
  for (let i = 0; i < n; i++) {
    const [t1, t2] = tan[i], p1 = pts[i];
    d += (i === 0 ? `M ${f2(t1[0])} ${f2(t1[1])} ` : `L ${f2(t1[0])} ${f2(t1[1])} `);
    d += `Q ${f2(p1[0])} ${f2(p1[1])} ${f2(t2[0])} ${f2(t2[1])} `;
  }
  return { d: d + "Z", tan };
}

/* ===== rounded isometric box ===== */
function roundIsoBox(x, y, z, w, d, h, { r = 8, top = TOP, left = LEFT, right = RIGHT, stroke = EDGE, sw = SW } = {}) {
  const A = proj(x, y, z + h), B = proj(x + w, y, z + h), Cc = proj(x + w, y + d, z + h), D = proj(x, y + d, z + h);
  const { d: topD, tan } = roundPath([A, B, Cc, D], r);
  const down = (p) => [p[0], p[1] + h];
  const B_fromC = tan[1][1], C_fromB = tan[2][0], C_fromD = tan[2][1], D_fromC = tan[3][0];
  const rightWall = [B_fromC, C_fromB, down(C_fromB), down(B_fromC)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ");
  const leftWall = [C_fromD, D_fromC, down(D_fromC), down(C_fromD)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ");
  return `<polygon points="${rightWall}" fill="${right}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <polygon points="${leftWall}" fill="${left}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <path d="${topD}" fill="${top}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

const bolt = (x, y, z) => { const [px, py] = proj(x, y, z); return `<circle cx="${f2(px)}" cy="${f2(py)}" r="2.8" fill="#fff" stroke="${EDGE}" stroke-width="1.1" vector-effect="non-scaling-stroke"/><circle cx="${f2(px)}" cy="${f2(py)}" r="1" fill="${MUTE}"/>`; };

const guide = (x, y, z, w, d) => {
  const pts = [proj(x, y, z), proj(x + w, y, z), proj(x + w, y + d, z), proj(x, y + d, z)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ");
  return `<polygon points="${pts}" fill="none" stroke="${GUIDE}" stroke-width="1" stroke-dasharray="4 4" opacity="0.26" vector-effect="non-scaling-stroke"/>`;
};

/* soft contact shadow on the ground at iso (x,y) */
const shadow = (x, y, rx, ry, op = 0.11) => { const [px, py] = proj(x, y, 0); return `<ellipse cx="${f2(px)}" cy="${f2(py)}" rx="${rx}" ry="${ry}" fill="#1f1f24" opacity="${op}" filter="url(#blur)"/>`; };

function glass(x, y, z, w, d) {
  const A = proj(x, y, z), B = proj(x + w, y, z), Cc = proj(x + w, y + d, z), D = proj(x, y + d, z);
  const { d: gd } = roundPath([A, B, Cc, D], 7);
  const h1 = proj(x + w * 0.22, y + d * 0.12, z), h2 = proj(x + w * 0.55, y + d * 0.8, z);
  return `<path d="${gd}" fill="#cdd2dd" fill-opacity="0.35" stroke="${EDGE}" stroke-width="1.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <path d="${gd}" fill="url(#glassgrad)" fill-opacity="0.6"/>
  <line x1="${f2(h1[0])}" y1="${f2(h1[1])}" x2="${f2(h2[0])}" y2="${f2(h2[1])}" stroke="#fff" stroke-width="3" opacity="0.5" stroke-linecap="round"/>`;
}

/* the AGENT core — clean orange nucleus, subtle glow + nucleus ring on the glass */
function agentCore(cx, cy, gz) {
  const ring = proj(cx, cy, gz); // nucleus ring on the glass plane
  const x = cx - 10, y = cy - 10, z = gz - 1;
  const core = `<polygon points="${[proj(x + 20, y, z + 12), proj(x + 20, y + 20, z + 12), proj(x + 20, y + 20, z), proj(x + 20, y, z)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ")}" fill="#d9500f" stroke="${EDGE}" stroke-width="1.3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <polygon points="${[proj(x, y + 20, z + 12), proj(x + 20, y + 20, z + 12), proj(x + 20, y + 20, z), proj(x, y + 20, z)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ")}" fill="#ef6a2c" stroke="${EDGE}" stroke-width="1.3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <path d="${roundPath([proj(x, y, z + 12), proj(x + 20, y, z + 12), proj(x + 20, y + 20, z + 12), proj(x, y + 20, z + 12)], 4).d}" fill="${ORANGE}" stroke="${EDGE}" stroke-width="1.3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  return `<ellipse cx="${f2(ring[0])}" cy="${f2(ring[1])}" rx="30" ry="15" fill="none" stroke="${ORANGE}" stroke-width="1" opacity="0.35"/>
  <g filter="url(#softglow)">${core}
  <circle cx="${f2(proj(cx, cy, z + 12)[0])}" cy="${f2(proj(cx, cy, z + 12)[1])}" r="2.4" fill="#fff" opacity="0.9"/></g>`;
}

/* dashed flow path along ground points + arrowhead */
function flow(ptsXYZ, { accent = EDGE, op = 0.5 } = {}) {
  const Pp = ptsXYZ.map(([x, y, z]) => proj(x, y, z ?? 0));
  let d = `M ${f2(Pp[0][0])} ${f2(Pp[0][1])} `;
  for (let i = 1; i < Pp.length; i++) d += `L ${f2(Pp[i][0])} ${f2(Pp[i][1])} `;
  const a = Pp[Pp.length - 2], b = Pp[Pp.length - 1], dir = norm(sub(b, a)), per = [-dir[1], dir[0]];
  const base = add(b, mul(dir, -7)), l = add(base, mul(per, 4)), r = add(base, mul(per, -4));
  const head = `<polygon points="${f2(b[0])},${f2(b[1])} ${f2(l[0])},${f2(l[1])} ${f2(r[0])},${f2(r[1])}" fill="${accent}" opacity="${op + 0.25}"/>`;
  return `<path d="${d}" fill="none" stroke="${accent}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round" opacity="${op}" vector-effect="non-scaling-stroke"/>${head}`;
}

/* a HOOK GATE — thin standing panel straddling the flow, with a check glyph */
function gate(x, y, { d = 30, h = 24, mark = MUTE } = {}) {
  const box = roundIsoBox(x, y, 0, 5, d, h, { r: 2, top: "#f3f3f6", left: "#e1e1e8", right: "#d2d2da" });
  const c0 = proj(x, y + d * 0.34, h * 0.44), c1 = proj(x, y + d * 0.5, h * 0.32), c2 = proj(x, y + d * 0.74, h * 0.64);
  const chk = `<path d="M ${f2(c0[0])} ${f2(c0[1])} L ${f2(c1[0])} ${f2(c1[1])} L ${f2(c2[0])} ${f2(c2[1])}" fill="none" stroke="${mark}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return box + chk;
}

/* a tool chip + wire into the sandbox face */
function toolChip(x, y, z, dockXYZ) {
  const b = roundIsoBox(x, y, z, 11, 11, 9, { r: 2.5, top: "#fafafa", left: "#e4e4ea", right: "#d4d4dc" });
  const a = proj(x + 5.5, y + 5.5, z + 9), dk = proj(...dockXYZ);
  return `<path d="M ${f2(a[0])} ${f2(a[1])} L ${f2(dk[0])} ${f2(dk[1])}" fill="none" stroke="${EDGE}" stroke-width="1.1" opacity="0.45" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>${b}`;
}

const label = (x, y, z, text, { anchor = "middle", fill = MUTE, dy = 0 } = {}) => {
  const [px, py] = proj(x, y, z);
  return `<text x="${f2(px)}" y="${f2(py + dy)}" font-family="ui-monospace,monospace" font-size="8.5" letter-spacing="0.7" text-anchor="${anchor}" fill="${fill}">${text}</text>`;
};

/* ===== compose ===== */
const P = [];
// ground guides
P.push(guide(-92, 6, 0, 26, 26), guide(150, 60, 0, 26, 26));
// contact shadows (under everything)
P.push(shadow(55, 55, 94, 46, 0.08));    // slab
P.push(shadow(-77, 19, 26, 13), shadow(163, 73, 26, 13)); // in / out
P.push(shadow(-27, 29, 15, 8), shadow(120, 73, 15, 8));   // gates
P.push(shadow(45, 131, 52, 12, 0.10));    // tools

// inbound flow → PRE gate → sandbox
P.push(flow([[-66, 19, 0], [-32, 24, 0], [-4, 28, 0]]));
P.push(roundIsoBox(-90, 6, 0, 26, 26, 15, { r: 5 }));
P.push(label(-77, 6, 15, "task in", { dy: -16 }));
P.push(gate(-30, 14, { d: 30, h: 24 }));
P.push(label(-22, 8, 24, "PRE-HOOK", { dy: -8, fill: EDGE }));

// central SANDBOX slab
P.push(roundIsoBox(0, 0, 0, 110, 110, 16, { r: 11 }));
P.push(bolt(10, 10, 16), bolt(100, 10, 16), bolt(10, 100, 16), bolt(100, 100, 16));
// vent — 3 thin slots on the back part of the right face (x=110 plane)
for (let i = 0; i < 3; i++) {
  const y0 = 16 + i * 11;
  const v = [proj(110, y0, 4), proj(110, y0 + 7, 4), proj(110, y0 + 7, 11), proj(110, y0, 11)].map(p => `${f2(p[0])},${f2(p[1])}`).join(" ");
  P.push(`<polygon points="${v}" fill="#2b2b32" opacity="0.85"/>`);
}
P.push(label(110, 110, 0, "SANDBOX", { anchor: "middle", dy: 22, fill: EDGE }));

// container + glass + agent
P.push(roundIsoBox(28, 28, 16, 54, 54, 12, { r: 8 }));
P.push(glass(28, 28, 28, 54, 54));
P.push(agentCore(55, 55, 28));
P.push(label(55, 55, 44, "agent", { dy: -30, fill: "#d9500f" }));

// tool rack wired into the sandbox front-left face
P.push(toolChip(20, 126, 0, [8, 110, 10]));
P.push(toolChip(40, 126, 0, [28, 110, 9]));
P.push(toolChip(60, 126, 0, [52, 110, 8]));
P.push(label(40, 150, 0, "TOOLS", { dy: 14, fill: EDGE }));

// outbound flow → POST gate → verified out
P.push(flow([[112, 66, 0], [136, 70, 0], [150, 74, 0]]));
P.push(gate(118, 58, { d: 30, h: 24, mark: ORANGE }));
P.push(label(126, 52, 24, "POST-HOOK", { dy: -8, fill: EDGE }));
P.push(roundIsoBox(150, 60, 0, 26, 26, 15, { r: 5 }));
{ const m = proj(163, 73, 15); P.push(`<rect x="${f2(m[0] - 4)}" y="${f2(m[1] - 4)}" width="8" height="8" rx="2" fill="${ORANGE}"/>`); }
P.push(label(163, 73, 15, "verified", { dy: 22 }));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-175 -82 360 292" width="1080" height="876">
  <defs>
    <linearGradient id="glassgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="1" stop-color="#cfd3de" stop-opacity="0.06"/></linearGradient>
    <filter id="softglow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>
  </defs>
  <rect x="-175" y="-82" width="360" height="292" fill="#f5f5f7"/>
  ${P.join("\n  ")}
</svg>`;
writeFileSync("/tmp/isogen/atom.svg", svg);
console.log("wrote atom.svg");
