"use client";

/* ============================================================
   ProductScreens — the product section as THREE pinned screens
   that pan HORIZONTALLY as you scroll down: Agents → Workflow →
   Memory. The top + bottom rails stay put (the breadcrumb label
   and progress flip per panel); only the middle band pans. After
   the third panel, vertical scrolling resumes.

   Feel: a GSAP ScrollTrigger pin with SNAP-to-panel — the runway
   is deliberately long (scroll effort), but each panel→panel move
   snaps quickly and never RESTS in a half-and-half state, so you
   only ever settle on one whole grid. Gated by gsap.matchMedia to
   motion-safe desktop; reduced-motion desktop gets a hand-
   scrollable strip; below lg the panels stack and scroll
   vertically.

   Content is data-driven from `content/products.ts` (one source
   of truth, shared with the future click-through detail view).
   Presentation (HUD silhouette, grid layout) lives HERE. ONE
   orange spark per viewport (the active progress tick).
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import ProductMenu from "@/components/ProductMenu";
import { PRODUCTS, type ProductCard } from "@/content/products";

gsap.registerPlugin(ScrollTrigger);

// Per-panel grid layout (lg-only column/row/spacing). Mobile is a single
// column that stacks; these only kick in once the panels go side-by-side.
const LAYOUT: Record<string, string> = {
  // Agents — 3 columns × 2 rows
  agents: "lg:grid-cols-3 lg:[grid-template-rows:1fr_1fr] lg:gap-4 lg:p-5",
  // Workflow — one row, 3 columns
  workflow: "lg:grid-cols-3 lg:[grid-template-rows:1fr] lg:gap-4 lg:p-5",
  // Memory — one row, 2 columns, roomier (each card occupies more space)
  memory: "lg:grid-cols-2 lg:[grid-template-rows:1fr] lg:gap-6 lg:p-8",
};

// HUD silhouettes, rotated by position so neighbours never restamp one mold.
const CUTS = [
  "hud-frame [--hud-bevel:22px]",
  "hud-cut-tr [--hud-bevel:14px]",
  "hud-frame-anti [--hud-bevel:22px]",
  "hud-cut-bl [--hud-bevel:14px]",
  "hud-cut-br [--hud-bevel:14px]",
  "hud-frame [--hud-bevel:18px]",
];

const pad = (n: number) => String(n).padStart(2, "0");

// Brand glyph — inverted to the black mark on the white rail (see Hero).
function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/bw_icon.svg" alt="PiFlow" className="size-7 invert" />
  );
}

function GridCard({ card, tag, cut }: { card: ProductCard; tag: string; cut: string }) {
  return (
    <article
      className={`group relative flex min-h-[200px] flex-col justify-between ${cut} border border-[var(--hairline)] bg-[var(--surface-1)] p-7 shadow-[var(--shadow-sm)] transition-[transform,border-color,background] hover:-translate-y-0.5 hover:border-[var(--hairline-2)] hover:bg-[var(--surface-2)] sm:p-8 lg:min-h-0`}
    >
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
          {tag}
        </p>
        <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-[28px]">
          {card.title}
        </h3>
        {card.keywords.length > 0 && (
          <p className="mt-2.5 text-sm leading-relaxed text-fg-muted">
            {card.keywords.join("  ·  ")}
          </p>
        )}
      </div>
      {/* affordance — clicking a card will open its full-screen detail (next step) */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-6 right-6 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </span>
    </article>
  );
}

export default function ProductScreens() {
  const rootRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    const band = bandRef.current;
    const pin = pinRef.current;
    if (!track || !band || !pin) return;

    const mm = gsap.matchMedia();
    const lastIndex = PRODUCTS.length - 1;

    // Motion-safe desktop → pin the screen and SNAP the track between panels.
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const distance = () => track.scrollWidth - band.offsetWidth;
      const tween = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: pin,
          pin: pin,
          start: "top top",
          // Long runway = more scroll "effort" to commit to a turn…
          end: () => "+=" + distance() * 1.6,
          scrub: 0.5,
          // …but the turn itself snaps quickly to a WHOLE panel — you never
          // rest looking at two half-grids at once.
          snap: {
            snapTo: 1 / lastIndex,
            duration: { min: 0.18, max: 0.4 },
            delay: 0.02,
            ease: "power2.inOut",
            directional: true,
          },
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const i = Math.round(self.progress * lastIndex);
            setActive((prev) => (prev === i ? prev : i));
          },
        },
      });
      return () => tween.kill();
    });

    // Reduced-motion desktop → no pin/scroll-jack; let the strip scroll by hand.
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: reduce)", () => {
      band.style.overflowX = "auto";
      return () => {
        band.style.overflowX = "";
      };
    });

    return () => mm.revert();
  }, []);

  const current = PRODUCTS[active];

  return (
    <section id="agents" ref={rootRef} className="relative w-full">
      <div
        ref={pinRef}
        className="relative flex h-auto w-full flex-col bg-canvas lg:h-svh"
      >
        {/* ── TOP RAIL — static across all three panels; the breadcrumb
              label + progress are the only things that change. ── */}
        <div className="z-40 flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[rgba(255,255,255,0.72)] px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-10">
          {/* the pinned widget == breadcrumb: [π] Product / {panel} */}
          <div className="flex items-center gap-1">
            <LogoMark />
            <ProductMenu />
            <span className="px-0.5 text-sm text-fg-faint" aria-hidden>
              /
            </span>
            <span className="px-1.5 text-sm font-medium text-fg">{current.name}</span>
          </div>

          {/* progress — the active tick is the ONE orange spark in this viewport */}
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-1.5 sm:flex" aria-hidden>
              {PRODUCTS.map((p, i) => (
                <span
                  key={p.key}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === active ? "w-5 bg-accent" : "w-1.5 bg-[var(--surface-4)]"
                  }`}
                />
              ))}
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
              Layer {current.layer}
            </span>
          </div>
        </div>

        {/* ── BAND — clips the horizontal track (snapped by GSAP on desktop) ── */}
        <div ref={bandRef} className="relative flex-1 lg:overflow-hidden">
          <div ref={trackRef} className="flex flex-col lg:h-full lg:w-max lg:flex-row">
            {PRODUCTS.map((p) => (
              <div key={p.key} className="w-full shrink-0 lg:h-full lg:w-screen">
                <div
                  className={`grid h-full grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 ${LAYOUT[p.key]}`}
                >
                  {p.cards.map((c, i) => (
                    <GridCard
                      key={c.id}
                      card={c}
                      tag={`${p.layer} · ${pad(i + 1)}`}
                      cut={CUTS[i % CUTS.length]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── BOTTOM RAIL — static, mirrors the top ── */}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--hairline)] px-4 py-2.5 text-fg-faint sm:px-6 lg:px-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
            PiFlow · {current.name}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
            {pad(current.cards.length)} items
          </span>
        </div>
      </div>
    </section>
  );
}
