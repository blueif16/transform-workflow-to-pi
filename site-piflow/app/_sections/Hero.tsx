/* ============================================================
   Hero — minimal. Content sits directly on the grey field: no
   white passe-partout frame, no panel fill. Holds two top pills
   (left: logo + nav, right: GitHub) and the product title
   lower-left. Modular by design — the iso illustration
   (components/iso/art/HeroBlocksLight) and the coding panel
   (components/CodeEditor) live in their own files and can each be
   dropped back in with a single import.
   ============================================================ */

const GITHUB_URL = "https://github.com/blueif16/PiFlow";

// Brand mark — the PiFlow glyph. Source asset is a black square with a
// white glyph; `invert` flips it to the all-black mark on transparent, so
// on the white nav pill only the black glyph reads (theme is white).
function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/bw_icon.svg" alt="PiFlow" className="size-8 invert" />
  );
}

export default function Hero() {
  return (
    <section id="top" className="px-3 pt-3 sm:px-5 sm:pt-5">
      {/* stage — directly on the grey field (no frame, no surface fill) */}
      <div className="relative mx-auto w-full max-w-[1200px] overflow-hidden px-5 pt-4 pb-10 sm:px-8 sm:pt-5 sm:pb-14">
        {/* faint engineered grid */}
        <div className="gridpaper" aria-hidden />

        {/* targeting brackets on the two square corners (TL + BR) */}
        <span className="hud-corner hud-corner--tl" aria-hidden />
        <span className="hud-corner hud-corner--br" aria-hidden />

        {/* ── TOP PILLS ─────────────────────────────────────────── */}
        <nav className="relative z-20 flex items-center justify-between gap-3">
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

        {/* ── TITLE — lower-left ─────────────────────────────────── */}
        <div className="relative z-10 flex min-h-[360px] flex-col justify-end sm:min-h-[460px] lg:min-h-[540px]">
          <span className="hud-frame [--hud-bevel:8px] blur-in mb-5 inline-flex w-fit items-center gap-2 border border-[var(--hairline)] bg-white/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint backdrop-blur">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            Agentic workflow powered by the Pi Agents
          </span>
          <h1
            className="blur-in max-w-xl text-balance text-6xl font-semibold leading-[0.96] tracking-[-0.04em] text-fg sm:text-7xl"
            style={{ animationDelay: "0.05s" }}
          >
            Pi Flow
          </h1>
        </div>
      </div>
    </section>
  );
}
