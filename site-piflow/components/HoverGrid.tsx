"use client";

import { useEffect, useRef } from "react";

/* ============================================================
   HoverGrid — the hero's LEFT field lights up under the cursor.
   A transparent canvas scoped to the left of the hero; the cell
   under the pointer gets a crisp INK targeting outline, random
   neighbours flare a soft white and decay frame-by-frame.
   Monochrome by brand law (never orange — the hero's one spark
   is spent), the inner (right) seam fades toward centre to mirror
   FluidGrid, and it's fully inert under reduced-motion. Cell size
   is computed to MATCH FluidGrid so both halves share one lattice.
   Adapted from a canvas hover-field demo — only the EFFECT is kept.
   ============================================================ */

const NEIGHBOR_CHANCE = 0.5; // odds a given neighbour flares
const FADE_PER_FRAME = 0.02; // gentle opacity decay
const ACTIVE_ALPHA = 0.5; // ink outline on the hovered cell
const NEIGHBOR_ALPHA = 0.5; // starting glow of a flared neighbour
const MAX_TRAIL = 280; // cap live cells (perf guard)

// Match FluidGrid's on-screen cell so the left field shares the right's
// lattice size. FluidGrid slices a 720×1080 viewBox (cell 45) to cover its
// right-56% box, so its pixel cell = 45 × max(0.56·vw / 720, vh / 1080).
const FG_CELL = 45;
const FG_VB_W = 720;
const FG_VB_H = 1080;
const FG_W_FRAC = 0.56;
function fluidCellPx() {
  const scale = Math.max(
    (FG_W_FRAC * window.innerWidth) / FG_VB_W,
    window.innerHeight / FG_VB_H,
  );
  return FG_CELL * scale;
}

// Accent warming: cells within this radius (px) of the title box flare orange,
// fading to monochrome ink beyond it. The brand spends orange sparingly, so the
// glow is gated to the focal title and kept faint — tune the radius / peaks to
// taste, or set ACCENT_RADIUS = 0 to go fully monochrome.
const ACCENT_RADIUS = 240;

type Rgb = [number, number, number];
function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const f = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbStr = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgbaStr = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

type TrailCell = { row: number; col: number; alpha: number };

export default function HoverGrid({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    // Interactive, but still motion — respect the reduced-motion contract.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const context = canvasEl.getContext("2d");
    if (!context) return;

    // Non-null-typed bindings so the nested closures below typecheck.
    const canvas = canvasEl;
    const ctx = context;

    // Colours come from the design tokens, never raw hex.
    const root = getComputedStyle(document.documentElement);
    const inkColor = root.getPropertyValue("--fg").trim() || "#171717";
    const mutedColor = root.getPropertyValue("--fg-muted").trim() || "#525252";
    const fillColor = root.getPropertyValue("--surface-1").trim() || "#ffffff";
    const inkRgb = hexToRgb(inkColor);
    const mutedRgb = hexToRgb(mutedColor);
    const accentRgb = hexToRgb(root.getPropertyValue("--accent").trim() || "#ff5a1f");

    // The title box we warm cells around (tagged in Hero with data-hover-anchor).
    const anchorEl = document.querySelector<HTMLElement>("[data-hover-anchor]");

    let width = 0;
    let height = 0;
    let dpr = 1;
    let cell = fluidCellPx(); // px cell, kept in sync with FluidGrid
    let phaseX = 0; // horizontal lattice offset (centred within the field)
    let rectLeft = 0;
    let rectTop = 0;
    // title box in canvas-local coords (for the accent-warming distance test)
    let aL = 0;
    let aT = 0;
    let aR = 0;
    let aB = 0;
    let hasAnchor = false;

    const trail: TrailCell[] = [];
    let curRow = -1; // last cell we spawned neighbours from
    let curCol = -1;
    let hoverRow = -1;
    let hoverCol = -1;
    let inside = false;
    let raf = 0;

    // Size the backing store (DPR-aware) and refresh the cell (it tracks the
    // viewport so it stays equal to FluidGrid's).
    function sizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = fluidCellPx();
      phaseX = (((width / 2 - cell / 2) % cell) + cell) % cell;
    }

    // Cheap position-only read for mouse mapping (no backing-store reset).
    function measurePos() {
      const rect = canvas.getBoundingClientRect();
      rectLeft = rect.left;
      rectTop = rect.top;
      if (anchorEl) {
        const a = anchorEl.getBoundingClientRect();
        aL = a.left - rect.left;
        aT = a.top - rect.top;
        aR = a.right - rect.left;
        aB = a.bottom - rect.top;
        hasAnchor = true;
      }
    }

    const cellLeft = (col: number) => phaseX + col * cell;
    const strokeCell = (row: number, col: number) =>
      ctx.strokeRect(cellLeft(col) + 0.5, row * cell + 0.5, cell, cell);

    // 0 → far from the title (monochrome), 1 → over it (full accent). Smoothstep
    // of the distance from the cell centre to the title box.
    function warmth(cx: number, cy: number) {
      if (!hasAnchor || ACCENT_RADIUS <= 0) return 0;
      const dx = Math.max(aL - cx, 0, cx - aR);
      const dy = Math.max(aT - cy, 0, cy - aB);
      const t = 1 - Math.hypot(dx, dy) / ACCENT_RADIUS;
      return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    }

    // A soft orange radial gradient filling one cell (the "extra colour" that
    // only shows up where the field is warm).
    function cellGlow(cx: number, cy: number, peak: number) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.72);
      g.addColorStop(0, rgbaStr(accentRgb, peak));
      g.addColorStop(1, rgbaStr(accentRgb, 0));
      return g;
    }

    function spawnNeighbors(row: number, col: number) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (Math.random() < NEIGHBOR_CHANCE) {
            trail.push({ row: row + dr, col: col + dc, alpha: NEIGHBOR_ALPHA });
          }
        }
      }
      if (trail.length > MAX_TRAIL) trail.splice(0, trail.length - MAX_TRAIL);
    }

    function tick() {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;

      // Trail: soft white fill + outline, fading out. Near the title the cell
      // also picks up an orange radial glow and an accent-tinted outline.
      for (const c of trail) {
        c.alpha = Math.max(0, c.alpha - FADE_PER_FRAME);
        const left = cellLeft(c.col);
        const top = c.row * cell;
        const cx = left + cell / 2;
        const cy = top + cell / 2;
        const t = warmth(cx, cy);

        ctx.globalAlpha = c.alpha;
        ctx.fillStyle = fillColor;
        ctx.fillRect(left, top, cell, cell);

        if (t > 0.001) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = cellGlow(cx, cy, c.alpha * 0.5 * t);
          ctx.fillRect(left, top, cell, cell);
        }

        ctx.globalAlpha = c.alpha * 0.7;
        ctx.strokeStyle = rgbStr(lerp3(mutedRgb, accentRgb, t));
        strokeCell(c.row, c.col);
      }
      for (let i = trail.length - 1; i >= 0; i--) {
        if (trail[i].alpha <= 0.01) trail.splice(i, 1);
      }

      // Active cell: ink targeting outline, warming to accent over the title.
      if (inside && hoverRow >= 0) {
        const left = cellLeft(hoverCol);
        const top = hoverRow * cell;
        const cx = left + cell / 2;
        const cy = top + cell / 2;
        const t = warmth(cx, cy);

        if (t > 0.001) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = cellGlow(cx, cy, 0.22 * t);
          ctx.fillRect(left, top, cell, cell);
        }

        ctx.globalAlpha = ACTIVE_ALPHA;
        ctx.strokeStyle = rgbStr(lerp3(inkRgb, accentRgb, t));
        strokeCell(hoverRow, hoverCol);
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }

    function onMove(e: MouseEvent) {
      const x = e.clientX - rectLeft;
      const y = e.clientY - rectTop;
      if (x < 0 || y < 0 || x > width || y > height) {
        inside = false;
        return;
      }
      inside = true;
      hoverCol = Math.floor((x - phaseX) / cell);
      hoverRow = Math.floor(y / cell);
      if (hoverRow !== curRow || hoverCol !== curCol) {
        curRow = hoverRow;
        curCol = hoverCol;
        spawnNeighbors(hoverRow, hoverCol);
      }
    }

    function onLeave() {
      inside = false;
      curRow = curCol = -1;
    }

    sizeCanvas();
    measurePos();
    const ro = new ResizeObserver(() => {
      sizeCanvas();
      measurePos();
    });
    ro.observe(canvas);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("scroll", measurePos, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", measurePos);
    };
  }, []);

  return (
    // Wrapper stretches to full height — a replaced <canvas> with top/bottom:0
    // would NOT (it keeps its intrinsic 150px and paints only the top). The
    // canvas fills the wrapper, so the field covers the whole left column and
    // sits ONE LAYER UNDER the title / bottom-left containers (z-0 < their z-10).
    <div className={className} aria-hidden>
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{
          // Fade only the inner (right) seam toward the centre — mirror of
          // FluidGrid's left-edge fade — so the highlight stays right under the
          // cursor across the whole left field.
          WebkitMaskImage:
            "linear-gradient(to right, #000 0%, #000 68%, transparent 100%)",
          maskImage:
            "linear-gradient(to right, #000 0%, #000 68%, transparent 100%)",
        }}
      />
    </div>
  );
}
