"use client";

import { FileText, Globe, TerminalSquare, GitBranch, Puzzle, Box } from "lucide-react";
import { OrbitingCircles } from "@/components/ui/orbiting-circles";

function Tool({
  Icon,
  label,
  granted = false,
}: {
  Icon?: React.ElementType;
  label?: string;
  granted?: boolean;
}) {
  return (
    <div
      className={
        "flex size-11 items-center justify-center rounded-xl border text-xs font-mono " +
        (granted
          ? "border-[var(--accent-30)] bg-surface-2 text-accent"
          : "border-[var(--hairline)] bg-surface-1 text-fg-faint")
      }
    >
      {Icon ? <Icon className="size-4.5" strokeWidth={1.6} /> : label}
    </div>
  );
}

export default function NodeL1() {
  return (
    <section id="node" className="mx-auto w-full max-w-6xl px-6 py-28">
      <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-[0.95fr_1.05fr]">
        {/* Illustration — orbiting tool bindings around a sealed node */}
        <div className="reveal relative mx-auto aspect-square w-full max-w-[420px]">
          {/* the sealed node */}
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="relative flex size-28 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--accent-30)] bg-surface-2">
              <span className="absolute inset-0 rounded-2xl ring-1 ring-[var(--accent-30)] [box-shadow:0_0_40px_-8px_var(--accent-glow)]" />
              <Box className="size-6 text-accent" strokeWidth={1.5} />
              <span className="font-mono text-[11px] text-fg-muted">sealed node</span>
            </div>
          </div>

          <OrbitingCircles radius={150} duration={32} iconSize={44} path>
            <Tool Icon={GitBranch} />
            <Tool label="mcp" />
            <Tool Icon={Puzzle} granted />
            <Tool label="openclaw" granted />
          </OrbitingCircles>

          <OrbitingCircles radius={86} duration={20} iconSize={44} reverse path={false}>
            <Tool Icon={FileText} granted />
            <Tool Icon={Globe} />
            <Tool Icon={TerminalSquare} granted />
          </OrbitingCircles>
        </div>

        {/* Copy */}
        <div className="reveal">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">L1 · The node</p>
          <h2 className="mt-4 max-w-md text-balance text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
            Every node is a full agent in a sealed box.
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-fg-muted">
            Not a thin model call — a complete agent, isolated in its own sandbox, holding exactly the
            tools and files you grant it. Bind anything: built-ins, your own functions, or the wider
            OpenClaw community ecosystem.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              "Sealed sandbox per node",
              "Declarative tool bindings",
              "Native OpenClaw tools",
              "Verified, never assumed",
            ].map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-fg">
                <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
