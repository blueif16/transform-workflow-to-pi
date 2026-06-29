"use client";

/* ============================================================
   SECTION · Presentation / demo page  ·  #start  ·  data-section="presentation"
   ------------------------------------------------------------
   A reduced-width render frame sits centred on the field; beneath
   it two minimal keys — GUI (left) and TUI (right) — are just
   labels split by ONE hairline divider (the reference iOS | Android
   bar). No subtitle: a small ASCII glyph rides each key and swaps
   idle → active when selected. Click a key and the frame swaps to
   that surface (real GUI flowmap / terminal console; media dropped
   in later). This page sparks BLUE (.theme-blue) — see globals.css.
   (File is still named CTA.tsx — see the page.tsx glossary.)
   ============================================================ */

import { useState } from "react";

type View = {
  key: string;
  label: string;
  /** ASCII glyph on the key — swaps when selected */
  idle: string;
  active: string;
  /** real screenshot / recording dropped in later; empty → placeholder */
  media?: string;
};

const VIEWS: View[] = [
  { key: "gui", label: "GUI", idle: "(·_·)", active: "(^_^)" },
  { key: "tui", label: "TUI", idle: "[ _ ]", active: "[>_]" },
];

export default function CTA() {
  const [active, setActive] = useState(0);
  const current = VIEWS[active];

  return (
    <section
      id="start"
      data-section="presentation"
      className="theme-blue relative flex min-h-svh w-full flex-col overflow-hidden bg-canvas"
    >
      <div className="gridpaper pointer-events-none absolute inset-0" aria-hidden />

      {/* centred column — the frame + keys share a reduced width */}
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
        {/* ── render frame — large, but no longer full-bleed ── */}
        <div className="flex flex-1 items-stretch py-4 sm:py-6">
          <div className="hud-frame [--hud-bevel:28px] flex w-full bg-white p-3 shadow-[var(--shadow-lg)] sm:p-4">
            <div
              className="hud-frame [--hud-bevel:20px] relative flex min-h-[40vh] w-full items-center justify-center overflow-hidden bg-[var(--surface-3)]"
              aria-live="polite"
            >
              {/* ink targeting brackets on the two square corners */}
              <span className="hud-corner hud-corner--tl" aria-hidden />
              <span className="hud-corner hud-corner--br" aria-hidden />

              {/* slim mono breadcrumb — which surface is shown */}
              <span className="absolute left-5 top-4 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                piflow / {current.label}
              </span>

              {current.media ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.media}
                  alt={`${current.label} preview`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                  {current.label} preview
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── two keys — GUI | TUI, labels split by ONE hairline; a small
              ASCII glyph (idle → active) replaces the old subtitle ── */}
        <div className="grid grid-cols-2 border-t border-[var(--hairline)]">
          {VIEWS.map((v, i) => {
            const isActive = i === active;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={isActive}
                className={`group relative flex items-center justify-between gap-4 px-5 py-7 text-left outline-none transition-colors sm:px-8 sm:py-10 ${
                  i === 1 ? "border-l border-[var(--hairline)]" : ""
                }`}
              >
                <span
                  className={`border-b-2 pb-2 text-5xl font-semibold tracking-[-0.03em] transition-colors sm:text-7xl ${
                    isActive
                      ? "border-[var(--accent)] text-fg"
                      : "border-transparent text-fg-muted group-hover:text-fg"
                  }`}
                >
                  {v.label}
                </span>
                <span
                  className={`font-mono text-xl transition-colors sm:text-3xl ${
                    isActive ? "text-fg" : "text-fg-faint"
                  }`}
                  aria-hidden
                >
                  {isActive ? v.active : v.idle}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
