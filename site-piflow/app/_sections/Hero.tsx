/* ============================================================
   Hero — full-screen. Fills the viewport (no width container, no
   white frame): content sits directly on the grey field. The
   engineering grid + morphing ink modules (components/FluidGrid)
   own the right half; nav rides the top, the product title the
   lower-left. Modular by design — FluidGrid and the coding panel
   (components/CodeEditor) live in their own files and drop back in
   with a single import.
   ============================================================ */
import FluidGrid from "@/components/FluidGrid";

const GITHUB_URL = "https://github.com/blueif16/PiFlow";

// Brand mark — the PiFlow icon AS AUTHORED: a black tile with the white
// π + triangle glyph. Render it straight (no invert) so the real mark
// reads; the dark chip sits inside the white nav pill with one beveled
// corner to match the angular system (§3 "dark logo chip").
function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/bw_icon.svg"
      alt="PiFlow"
      className="hud-cut-tl [--hud-bevel:7px] size-8"
    />
  );
}

export default function Hero() {
  return (
    <section id="top" className="relative min-h-svh w-full overflow-hidden">
      {/* right-half grid + morphing modules (desktop) */}
      <FluidGrid className="pointer-events-none absolute inset-y-0 right-0 z-0 hidden w-[56%] lg:block" />

      {/* targeting brackets on the two square corners (TL + BR) */}
      <span className="hud-corner hud-corner--tl" aria-hidden />
      <span className="hud-corner hud-corner--br" aria-hidden />

      {/* content layer — fills the viewport, nav top / title bottom */}
      <div className="relative z-10 flex min-h-svh flex-col px-4 pt-4 sm:px-6 sm:pt-6 lg:px-10 lg:pt-8">
        {/* ── TOP PILLS ───────────────────────────────────────── */}
        <nav className="flex items-center justify-between gap-3">
          {/* left pill: logo chip + minimal links — diagonal cut (TR+BL) */}
          <div className="hud-frame [--hud-bevel:14px] inline-flex items-center gap-1 bg-white py-1.5 pl-1.5 pr-2 shadow-[var(--shadow-sm)]">
            <LogoMark />
            <a
              href="/docs"
              className="ml-1.5 px-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Docs
            </a>
            <a
              href="#loop"
              className="px-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Demo
            </a>
          </div>

          {/* right pill: GitHub only — anti-diagonal cut (TL+BR), mirrors the left */}
          <div className="hud-frame-anti [--hud-bevel:14px] inline-flex items-center bg-white px-1 py-1.5 shadow-[var(--shadow-sm)]">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              GitHub
            </a>
          </div>
        </nav>

        {/* ── TITLE — lower-left ───────────────────────────────── */}
        <div className="mt-auto max-w-xl pb-12 sm:pb-16 lg:pb-20">
          <span className="hud-frame [--hud-bevel:8px] blur-in mb-5 inline-flex w-fit items-center gap-2 border border-[var(--hairline)] bg-white/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint backdrop-blur">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            Agentic workflow powered by the Pi Agents
          </span>
          <h1
            className="blur-in text-balance text-6xl font-semibold leading-[0.96] tracking-[-0.04em] text-fg sm:text-7xl"
            style={{ animationDelay: "0.05s" }}
          >
            Pi Flow
          </h1>
        </div>
      </div>
    </section>
  );
}
