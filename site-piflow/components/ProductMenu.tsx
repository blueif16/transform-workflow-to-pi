"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================
   ProductMenu — the top-left nav "Product" trigger + its mega-menu
   "directory". A horizontal bento that drops under the word: the
   Observability tile sits on the LEFT edge, the Agent/Workflow/Memory
   trio plays together on the RIGHT, joined by a shallow hairline
   connection (a workflow edge). Each tile carries its title top-left
   and reserves the bottom-right for an icon (added later). Angular HUD
   chrome, ink-only (no orange — the hero owns the spark), opens on
   hover/focus, closes on leave / Escape / outside-click, reduced-
   motion-safe.
   ============================================================ */

type Tile = { title: string; href: string };

// Agent / Workflow / Memory travel together; Observability is the separate
// left tile that observes them. Links are placeholders into /docs for now.
const TRIO: Tile[] = [
  { title: "Agent", href: "/docs" },
  { title: "Workflow", href: "/docs" },
  { title: "Memory", href: "/docs" },
];
const OBSERVABILITY: Tile = { title: "Observability", href: "/docs" };

// One notched corner per tile, varied so the row never restamps one mold.
function MenuTile({
  tile,
  cut,
  big = false,
}: {
  tile: Tile;
  cut: string;
  big?: boolean;
}) {
  return (
    <a
      href={tile.href}
      className={`group relative flex min-h-[170px] flex-col ${
        big ? "w-[212px]" : "w-[150px]"
      } ${cut} border border-[var(--hairline)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-sm)] transition-[transform,border-color,background] hover:-translate-y-0.5 hover:border-[var(--hairline-2)] hover:bg-[var(--surface-2)]`}
    >
      {/* title — top-left */}
      <span
        className={`font-semibold tracking-[-0.02em] text-fg ${
          big ? "text-base" : "text-[15px]"
        }`}
      >
        {tile.title}
      </span>
      {/* icon slot — bottom-right, reserved for later */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 right-3 size-7"
      />
    </a>
  );
}

export default function ProductMenu({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  // Escape + outside-click close (only while open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={openNow}
        className="inline-flex items-center gap-1 px-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg aria-expanded:text-fg"
      >
        Product
        <svg
          viewBox="0 0 24 24"
          className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* flyout — pt-2 is a transparent bridge so the hover survives the gap */}
      <div
        className={`absolute left-0 top-full z-50 pt-2 transition duration-200 ease-out ${
          open
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <div className="hud-frame [--hud-bevel:18px] flex items-stretch bg-white p-4 shadow-[var(--shadow-lg)]">
          {/* LEFT edge — Observability, the separate / larger tile */}
          <MenuTile tile={OBSERVABILITY} cut="hud-frame-anti [--hud-bevel:16px]" big />

          {/* the shallow connection — a workflow edge from Observability to the trio */}
          <div className="flex w-12 items-center px-1" aria-hidden>
            <span className="size-1.5 rounded-full bg-[var(--fg-faint)]" />
            <span className="h-px flex-1 bg-[var(--hairline-2)]" />
            <span className="size-1.5 rounded-full bg-[var(--fg-faint)]" />
          </div>

          {/* RIGHT — Agent / Workflow / Memory, playing together */}
          <div className="flex items-stretch gap-2.5">
            <MenuTile tile={TRIO[0]} cut="hud-cut-tr [--hud-bevel:11px]" />
            <MenuTile tile={TRIO[1]} cut="" />
            <MenuTile tile={TRIO[2]} cut="hud-cut-bl [--hud-bevel:11px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
