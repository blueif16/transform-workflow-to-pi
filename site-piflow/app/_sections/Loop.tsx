"use client";

import { useRef } from "react";
import { PencilRuler, Boxes, Sparkles } from "lucide-react";
import { AnimatedBeam } from "@/components/ui/animated-beam";

const ACCENT = "#3df2a7";
const ACCENT_SOFT = "#a7ffd8";

function Station({
  refEl,
  tag,
  title,
  sub,
  Icon,
}: {
  refEl: React.RefObject<HTMLDivElement | null>;
  tag: string;
  title: string;
  sub: string;
  Icon: React.ElementType;
}) {
  return (
    <div
      ref={refEl}
      className="lift relative z-10 flex w-[30%] max-w-[230px] flex-col gap-3 rounded-xl border border-[var(--hairline)] bg-surface-1/90 p-5 backdrop-blur-sm"
    >
      <span className="flex size-9 items-center justify-center rounded-lg border border-[var(--hairline)] bg-surface-2 text-accent">
        <Icon className="size-4.5" strokeWidth={1.6} />
      </span>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">{tag}</p>
        <h3 className="mt-1 text-base font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm leading-snug text-fg-muted">{sub}</p>
      </div>
    </div>
  );
}

export default function Loop() {
  const container = useRef<HTMLDivElement>(null);
  const compose = useRef<HTMLDivElement>(null);
  const run = useRef<HTMLDivElement>(null);
  const improve = useRef<HTMLDivElement>(null);

  return (
    <section id="loop" className="relative mx-auto w-full max-w-6xl px-6 py-28 sm:py-36">
      <div className="reveal mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">The shape</p>
        <h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">
          A loop, not a pipeline.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
          Design the graph. Run it. Learn from the run — then refine and run again. The output of
          one run is the input to the next.
        </p>
      </div>

      <div
        ref={container}
        className="relative mt-16 flex items-center justify-between"
        style={{ minHeight: 320 }}
      >
        <Station
          refEl={compose}
          tag="L2 · Compose"
          title="Compose"
          sub="An agent designs and routes the graph."
          Icon={PencilRuler}
        />
        <Station
          refEl={run}
          tag="L1 · Run"
          title="Run"
          sub="Sealed full-agent nodes execute it."
          Icon={Boxes}
        />
        <Station
          refEl={improve}
          tag="L3 · Improve"
          title="Improve"
          sub="A learning loop makes it better."
          Icon={Sparkles}
        />

        {/* forward edges */}
        <AnimatedBeam
          containerRef={container}
          fromRef={compose}
          toRef={run}
          curvature={-44}
          duration={4}
          pathColor="rgba(255,255,255,0.10)"
          pathWidth={1.5}
          gradientStartColor={ACCENT}
          gradientStopColor={ACCENT_SOFT}
        />
        <AnimatedBeam
          containerRef={container}
          fromRef={run}
          toRef={improve}
          curvature={-44}
          duration={4}
          delay={0.6}
          pathColor="rgba(255,255,255,0.10)"
          pathWidth={1.5}
          gradientStartColor={ACCENT}
          gradientStopColor={ACCENT_SOFT}
        />
        {/* feedback edge — the loop */}
        <AnimatedBeam
          containerRef={container}
          fromRef={improve}
          toRef={compose}
          curvature={150}
          duration={5}
          delay={1.2}
          reverse
          pathColor="rgba(255,255,255,0.10)"
          pathWidth={1.5}
          gradientStartColor={ACCENT_SOFT}
          gradientStopColor={ACCENT}
        />
      </div>

      <p className="reveal mt-4 text-center font-mono text-xs text-fg-faint">
        re-compose a new flow — or refine this one and repeat
      </p>
    </section>
  );
}
