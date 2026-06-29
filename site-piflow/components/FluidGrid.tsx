"use client";

/* ============================================================
   FluidGrid — the hero's right-half animation. A faint engineering
   grid (retires the old .gridpaper for the hero) with ink "modules"
   that morph between grid-aligned poses and merge via an SVG goo
   filter — the agentic-workflow substrate, restyled to the light
   system (ink blocks, hairline grid; no orange — the spark stays in
   the eyebrow). Ported from the GSAP reference: controls removed,
   reduced-motion safe, GSAP context auto-cleaned on unmount.
   ============================================================ */

import { useEffect, useRef } from "react";
import gsap from "gsap";

// Board geometry (viewBox units). The grid spans the WHOLE viewBox so it
// fills the right half; the morphing board is centered inside it.
const VB_W = 720;
const VB_H = 1080;
const CELLS = 12;
const SIZE = 540;
const C = SIZE / CELLS; // 45
const ORIGIN_X = (VB_W - SIZE) / 2; // 90
const ORIGIN_Y = (VB_H - SIZE) / 2; // 270
const BLOCKS = 7;

type Pose = [col: number, row: number, w: number, h: number, rot: number];
type Frame = Pose[];

// Each block: [col, row, widthCells, heightCells, rotation]. Landings are
// grid-based; travel adds small rotations + a soft goo blur in between.
const POSES: Frame[] = [
  [[0, 3, 2, 2, 0], [3, 1, 2, 2, 0], [5, 3, 2, 4, 0], [2, 10, 6, 2, 0], [8, 7, 2, 2, 0], [10, 10, 2, 2, 0], [7, 0, 2, 2, 0]],
  [[1, 2, 2, 2, -4], [3, 3, 2, 4, 3], [5, 4, 3, 2, 0], [2, 9, 7, 2, 1], [8, 1, 2, 2, 0], [10, 7, 2, 3, -3], [0, 7, 2, 2, 0]],
  [[0, 8, 2, 2, 0], [2, 2, 4, 2, -2], [6, 2, 2, 5, 2], [3, 9, 5, 2, 0], [8, 5, 2, 2, -5], [10, 9, 2, 2, 0], [4, 5, 2, 2, 4]],
  [[1, 4, 2, 2, -3], [4, 1, 2, 4, 0], [6, 4, 2, 3, 3], [1, 10, 6, 2, 0], [8, 8, 2, 2, 0], [10, 3, 2, 2, 0], [7, 1, 2, 2, -2]],
  [[0, 3, 2, 2, 0], [3, 1, 2, 2, 0], [5, 3, 2, 4, 0], [2, 10, 6, 2, 0], [8, 7, 2, 2, 0], [10, 10, 2, 2, 0], [7, 0, 2, 2, 0]],
];

function centerOf([col, row, w, h, r]: Pose) {
  return {
    x: ORIGIN_X + (col + w / 2) * C,
    y: ORIGIN_Y + (row + h / 2) * C,
    w: w * C,
    h: h * C,
    r: r || 0,
  };
}

// Fade the LEFT edge so the grid bleeds irregularly into the middle and
// reaches full-bleed at the right viewport edge.
const EDGE_FADE = "linear-gradient(to right, transparent 0%, #000 32%, #000 100%)";

export default function FluidGrid({ className = "" }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const blocks = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll(".fg-block"));
    const rects = blocks.map((b) => b.querySelector("rect") as SVGRectElement);
    const blur = svg.querySelector("#fg-blur") as SVGFEGaussianBlurElement | null;

    const setPose = (frame: Frame) => {
      blocks.forEach((block, i) => {
        const p = centerOf(frame[i]);
        gsap.set(block, { x: p.x, y: p.y, rotation: p.r, transformOrigin: "50% 50%" });
        gsap.set(rects[i], { attr: { x: -p.w / 2, y: -p.h / 2, width: p.w, height: p.h, rx: 12, ry: 12 } });
      });
    };

    const ctx = gsap.context(() => {
      setPose(POSES[0]);

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.18, defaults: { ease: "expo.inOut" } });
      for (let s = 1; s < POSES.length; s++) {
        const next = POSES[s].map(centerOf);

        tl.to(blur, { attr: { stdDeviation: 8.8 }, duration: 0.28, ease: "sine.inOut" });
        tl.to(blocks, {
          duration: 1.38,
          x: (i: number) => next[i].x,
          y: (i: number) => next[i].y,
          rotation: (i: number) => next[i].r + gsap.utils.random(-7, 7),
          scaleX: () => gsap.utils.random(0.96, 1.04),
          scaleY: () => gsap.utils.random(0.96, 1.04),
          stagger: { each: 0.028, from: "random" },
        }, "<");
        tl.to(rects, {
          duration: 1.38,
          attr: {
            x: (i: number) => -next[i].w / 2,
            y: (i: number) => -next[i].h / 2,
            width: (i: number) => next[i].w,
            height: (i: number) => next[i].h,
            rx: 13,
            ry: 13,
          },
          stagger: { each: 0.018, from: "random" },
        }, "<");
        tl.to(blocks, {
          duration: 0.42,
          rotation: (i: number) => next[i].r,
          scaleX: 1,
          scaleY: 1,
          ease: "power2.out",
          stagger: { each: 0.015, from: "center" },
        }, "-=0.28");
        tl.to(blur, { attr: { stdDeviation: 5.2 }, duration: 0.5, ease: "sine.out" }, "<");
        tl.to({}, { duration: 0.32 });
      }
    }, svg);

    return () => ctx.revert();
  }, []);

  const lines = Array.from({ length: Math.floor(VB_W / C) + 1 }, (_, i) => i * C);
  const rows = Array.from({ length: Math.floor(VB_H / C) + 1 }, (_, i) => i * C);

  return (
    <div className={className} style={{ WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }} aria-hidden>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
      >
        <defs>
          <filter
            id="fg-goo"
            filterUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={VB_W}
            height={VB_H}
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur id="fg-blur" in="SourceGraphic" stdDeviation="5.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9"
            />
          </filter>
        </defs>

        {/* faint engineering grid — behind the modules */}
        <g style={{ stroke: "var(--hairline)" }} strokeWidth={1} fill="none">
          {lines.map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={VB_H} vectorEffect="non-scaling-stroke" />
          ))}
          {rows.map((y) => (
            <line key={`h${y}`} x1={0} y1={y} x2={VB_W} y2={y} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* morphing ink modules, merged by the goo filter */}
        <g filter="url(#fg-goo)" style={{ fill: "var(--ink)" }}>
          {Array.from({ length: BLOCKS }, (_, i) => (
            <g className="fg-block" key={i}>
              <rect />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
