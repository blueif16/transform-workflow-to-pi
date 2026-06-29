/* ============================================================
   AgentsP1 — the "second page": the first product layer (P1 ·
   Agents). Reference-matched full-bleed page (withmartian temper):
   a SHALLOW top rail that doubles as the section header — so the
   title costs no vertical height, it rides the SAME line as the
   pinned product breadcrumb — then a HUGE 2×3 card grid that owns
   the whole viewport between the rails, closed by a mirrored
   shallow bottom rail.

   Reconciliation (the fixed-widget vs title tension): the pinned
   top-left widget IS the breadcrumb — "[π] Product / Agents". The
   word "Product" still opens the directory on hover; "/ Agents"
   names the current page. The directory does double duty as the
   section title, so we never stack a heading beneath the widget.

   Card copy is placeholder DATA in CARDS[] — real content drops
   straight in. Angular HUD chrome with VARIED cuts per neighbour
   (design system §4); ONE orange spark for the whole viewport (the
   rail status dot). Reduced-motion safe.
   ============================================================ */
import ProductMenu from "@/components/ProductMenu";

// Brand glyph — inverted to the black mark on the white rail (see Hero).
function LogoMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/bw_icon.svg" alt="PiFlow" className="size-7 invert" />
  );
}

type Card = { tag: string; title: string; line: string; cut: string };

// PLACEHOLDER content — real copy supplied later. The `cut` per card is
// varied so the six silhouettes never restamp one mold (design system §4).
const CARDS: Card[] = [
  { tag: "P1 · 01", title: "Card one",   line: "One line of supporting copy lives here.", cut: "hud-frame [--hud-bevel:22px]" },
  { tag: "P1 · 02", title: "Card two",   line: "One line of supporting copy lives here.", cut: "hud-cut-tr [--hud-bevel:14px]" },
  { tag: "P1 · 03", title: "Card three", line: "One line of supporting copy lives here.", cut: "hud-frame-anti [--hud-bevel:22px]" },
  { tag: "P1 · 04", title: "Card four",  line: "One line of supporting copy lives here.", cut: "hud-cut-bl [--hud-bevel:14px]" },
  { tag: "P1 · 05", title: "Card five",  line: "One line of supporting copy lives here.", cut: "hud-cut-br [--hud-bevel:14px]" },
  { tag: "P1 · 06", title: "Card six",   line: "One line of supporting copy lives here.", cut: "hud-frame [--hud-bevel:18px]" },
];

function GridCard({ card }: { card: Card }) {
  return (
    <article
      className={`group relative flex min-h-[210px] flex-col justify-between ${card.cut} border border-[var(--hairline)] bg-[var(--surface-1)] p-7 shadow-[var(--shadow-sm)] transition-[transform,border-color,background] hover:-translate-y-0.5 hover:border-[var(--hairline-2)] hover:bg-[var(--surface-2)] sm:min-h-[240px] sm:p-8`}
    >
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
          {card.tag}
        </p>
        <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-fg sm:text-[28px]">
          {card.title}
        </h3>
      </div>
      <p className="mt-6 max-w-[34ch] text-[15px] leading-relaxed text-fg-muted">
        {card.line}
      </p>
      {/* illustration slot — reserved bottom-right for an iso motif later */}
      <span aria-hidden className="pointer-events-none absolute bottom-6 right-6 size-12" />
    </article>
  );
}

export default function AgentsP1() {
  return (
    <section id="agents" className="relative flex min-h-svh w-full flex-col bg-canvas">
      {/* ── TOP RAIL — shallow divider doubling as the section header.
            The pinned product breadcrumb sits left; the title rides the
            SAME line (no stacked height); section meta sits right. ── */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[rgba(255,255,255,0.72)] px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-10">
        {/* the fixed widget == breadcrumb: [π] Product / Agents */}
        <div className="flex items-center gap-1">
          <LogoMark />
          <ProductMenu />
          <span className="px-0.5 text-sm text-fg-faint" aria-hidden>
            /
          </span>
          <span className="flex items-center gap-2 px-1.5 text-sm font-medium text-fg">
            {/* the ONE orange spark in this viewport */}
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            Agents
          </span>
        </div>

        {/* section index + docs link */}
        <div className="flex items-center gap-5">
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint sm:inline">
            Layer P1
          </span>
          <a
            href="/docs"
            className="text-sm font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Docs
          </a>
        </div>
      </div>

      {/* ── 2×3 GRID — huge cards own the whole height between the rails.
            On desktop the two rows split the viewport (1fr 1fr); on mobile
            the cards keep a min height and the page scrolls. ── */}
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:gap-4 lg:p-5 lg:[grid-template-rows:1fr_1fr]">
        {CARDS.map((c) => (
          <GridCard key={c.tag} card={c} />
        ))}
      </div>

      {/* ── BOTTOM RAIL — shallow divider mirroring the top ── */}
      <div className="flex items-center justify-between gap-4 border-t border-[var(--hairline)] px-4 py-2.5 text-fg-faint sm:px-6 lg:px-10">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
          PiFlow · Agents
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em]">01 — 06</span>
      </div>
    </section>
  );
}
