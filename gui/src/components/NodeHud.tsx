/**
 * NodeHud — the "clicked-up" view. Clicking a node deploys a small, centered
 * CLUSTER of cards (a bento, not a banded frame): the node morphs into the
 * identity card, then the rest of its info fans into cards sized to their
 * purpose — some half-width (Config, Signals, Telemetry pair up as "two middle
 * cards"), some full-width (Activity, Stream, Definition). Cards render only
 * when the node carries that data, so the cluster is as big as it needs to be
 * and no bigger. No fixed structure, no top/side/bottom rails.
 */
import type { ReactNode, Ref } from "react";
import * as motion from "motion/react-client";
import { Button } from "./Button";
import { ProgressBar } from "./ProgressBar";
import { FieldBlock } from "./FieldBlock";
import { MetricTile } from "./MetricTile";
import { Sparkline } from "./Sparkline";
import { ContentView } from "./ContentView";
import { StatusPill, HudCorners } from "./HudBits";
import { STATUS_LABEL, statusTone } from "./status";
import { expandTransition, easing } from "../motion/transitions";
import type { FlowNodeData, StreamLine } from "./WorkflowNode";
import "../styles/hud.css";

function ArrowGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h8M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** one fanned-in card (everything except the morphing identity card) */
function Card({ title, children, index, reduce, full }: { title: string; children: ReactNode; index: number; reduce: boolean; full?: boolean }) {
  return (
    <motion.div
      className={`ds-glass ds-glass--soft ds-hud-card${full ? " ds-hud-card--full" : ""}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      transition={{ duration: reduce ? 0 : 0.24, ease: easing.standard, delay: reduce ? 0 : 0.06 + index * 0.045 }}
    >
      <div className="ds-hud-card__title">{title}</div>
      <div className="ds-hud-card__body">{children}</div>
    </motion.div>
  );
}

export interface NodeHudProps {
  id: string;
  data: FlowNodeData;
  onClose: () => void;
  reduce: boolean;
  dialogRef: Ref<HTMLDivElement>;
}

export function NodeHud({ id, data, onClose, reduce, dialogRef }: NodeHudProps) {
  const status = data.status ?? "idle";
  const showProgress = data.progress != null || status === "running";
  const pct = data.progress != null ? `${Math.round(data.progress * 100)}%` : status === "running" ? "···" : "—";
  const logs: StreamLine[] = (data.logs ?? []).map((l) => (typeof l === "string" ? { text: l } : l));

  // half-width cards (pair up); full-width cards (own row)
  const narrow: { key: string; title: string; body: ReactNode }[] = [
    {
      key: "config",
      title: "Config",
      body: (
        <div className="ds-field-grid">
          <FieldBlock label="Status" value={STATUS_LABEL[status]} tone={statusTone(status)} />
          <FieldBlock label="Kind" value={data.kind} />
          <FieldBlock label="Type" value={data.typeLabel} mono />
          {data.meta?.map((m, i) => (
            <FieldBlock key={`${m.label}-${i}`} label={m.label} value={m.value} tone={m.tone} mono={m.mono} />
          ))}
        </div>
      ),
    },
  ];
  if (data.io?.inputs?.length || data.io?.outputs?.length) {
    narrow.push({
      key: "signals",
      title: "Signals",
      body: (
        <div className="ds-io">
          {data.io?.inputs?.map((x, i) => (
            <div key={`in-${i}`} className="ds-io__row">
              <span className="ds-io__arrow ds-io__arrow--in"><ArrowGlyph /></span>
              {x}
            </div>
          ))}
          {data.io?.outputs?.map((x, i) => (
            <div key={`out-${i}`} className="ds-io__row">
              <span className="ds-io__arrow ds-io__arrow--out"><ArrowGlyph /></span>
              {x}
            </div>
          ))}
        </div>
      ),
    });
  }
  if (data.metrics?.length) {
    narrow.push({
      key: "telemetry",
      title: "Telemetry",
      body: (
        <div className="ds-metric-grid">
          {data.metrics.map((m) => (
            <MetricTile key={m.label} metric={m} />
          ))}
        </div>
      ),
    });
  }

  const wide: { key: string; title: string; body: ReactNode }[] = [];
  if (data.activity && data.activity.length > 1) {
    wide.push({ key: "activity", title: "Activity", body: <span className="ds-hud__activity"><Sparkline data={data.activity} height={64} /></span> });
  }
  if (logs.length) {
    wide.push({
      key: "stream",
      title: "Output · Live",
      body: (
        <div className="ds-stream" role="log" aria-live="polite">
          {logs.map((l, i) => (
            <div key={i} className={`ds-stream__line${l.level ? ` ds-stream__line--${l.level}` : ""}`}>
              <span className="ds-stream__dot" aria-hidden="true" />
              <span>{l.text}</span>
            </div>
          ))}
          {status === "running" && (
            <div className="ds-stream__line">
              <span className="ds-stream__dot" aria-hidden="true" />
              <span><span className="ds-stream__cursor" aria-hidden="true" /></span>
            </div>
          )}
        </div>
      ),
    });
  }
  if (data.content ?? data.preview) {
    wide.push({ key: "definition", title: "Definition", body: <ContentView data={data} /> });
  }

  // a lone half-card would leave a gap → let it span full
  const lastNarrowFull = narrow.length % 2 === 1;
  let order = 0;

  return (
    <div className="ds-hud2" role="dialog" aria-modal="true" aria-label={`${data.title} details`} tabIndex={-1} ref={dialogRef}>
      {/* identity — the morph target (node card grows into this), spans the cluster */}
      <motion.div
        layoutId={`node-${id}`}
        transition={expandTransition(reduce)}
        className="ds-glass ds-glass--soft ds-hud-card ds-hud-card--full ds-hud2__ident"
      >
        <HudCorners />
        <div className="ds-hud-card__body">
          <div className="ds-hud2__ident-row">
            <div className="ds-hud2__ident-id">
              <div className="ds-hud__eyebrow">{data.typeLabel}</div>
              <h2 className="ds-hud__title">{data.title}</h2>
            </div>
            <StatusPill status={status} />
            <Button iconOnly size="sm" variant="ghost" aria-label="Close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </Button>
          </div>
          {showProgress && (
            <div className="ds-field__row">
              <ProgressBar size="block" value={data.progress} status={status} aria-label={`${data.title} progress`} />
              <span className="ds-field__pct">{pct}</span>
              {data.eta && <span className="ds-field__pct">ETA {data.eta}</span>}
            </div>
          )}
        </div>
      </motion.div>

      {narrow.map((c, i) => (
        <Card key={c.key} title={c.title} index={order++} reduce={reduce} full={lastNarrowFull && i === narrow.length - 1}>
          {c.body}
        </Card>
      ))}
      {wide.map((c) => (
        <Card key={c.key} title={c.title} index={order++} reduce={reduce} full>
          {c.body}
        </Card>
      ))}
    </div>
  );
}
