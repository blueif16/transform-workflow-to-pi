"use client";

/* ============================================================
   SnapPages — the demo→composition (#start → #layers) forced jump.
   ------------------------------------------------------------
   The rest of the spine pages with FORCE: ProductScreens (#agents)
   pins and an Observer (preventDefault) turns ONE gesture into ONE
   discrete jump, handing DOWN into #start. This makes the #start edge
   feel identical:
     · a ScrollTrigger bound to #start ARMS the handoff only while the
       demo fills the viewport (onEnter / onEnterBack) and disarms it
       the moment you cross out — up into #agents or down into #layers;
     · while armed, ONE forward gesture = a single eased scrollTo
       #layers, then it RELEASES so the ComposeOutro morph scrubs on
       native scroll; one back gesture = scrollTo #agents, where
       ProductScreens' onEnterBack catches you on its last panel.

   TWO things make this fragile, both handled here:
   1. POSITION. ProductScreens' pinSpacing shifts every trigger below
      it down one viewport, but #start isn't INSIDE that pin so
      ScrollTrigger can't auto-compensate — it depends on the pin
      refreshing FIRST. That's enforced by `refreshPriority: 1` on the
      pin (see ProductScreens); without it this trigger anchors one
      viewport too high and silently mis-fires.
   2. THE IFRAME. The GUI demo (react-flow) is a same-origin iframe
      that swallows wheel/touch — child documents don't bubble scroll
      to the parent, so a window Observer never sees a gesture made
      over the demo and the page would trap there. We mirror the jump
      with a CAPTURE-phase wheel listener inside the iframe so it fires
      before react-flow's own zoom/pan handlers and still forces the
      page on.
   Desktop + motion-safe only; everything else scrolls natively.
   ============================================================ */

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Observer } from "gsap/Observer";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollTrigger, Observer, ScrollToPlugin);

export default function SnapPages() {
  useEffect(() => {
    const mm = gsap.matchMedia();

    // Gate matches ProductScreens / ComposeOutro: only where the paged
    // feel (and the morph) actually run.
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const start = document.querySelector<HTMLElement>("#start");
      const layers = document.querySelector<HTMLElement>("#layers");
      const agents = document.querySelector<HTMLElement>("#agents");
      if (!start || !layers || !agents) return;
      const frame = start.querySelector<HTMLIFrameElement>("iframe");

      let armed = false;
      let animating = false;
      let lockUntil = 0; // swallow the momentum that carried us onto #start

      const blocked = () => animating || performance.now() < lockUntil;

      // ONE eased jump to an adjacent section, then RELEASE control: the
      // handoff disarms so the destination's native-scroll mechanics take
      // over (the morph scrub below, the pin catch above). The controlling
      // ScrollTrigger re-arms it on re-entry to #start.
      const jump = (target: string) => {
        animating = true;
        obs.disable();
        gsap.to(window, {
          scrollTo: target,
          duration: 0.6,
          ease: "power2.inOut",
          onComplete: () => {
            animating = false;
          },
        });
      };

      // — chrome (margins, keys): a window-level Observer —
      const obs = Observer.create({
        target: window,
        type: "wheel,touch",
        wheelSpeed: -1, // match ProductScreens: onUp == a forward / down-the-page gesture
        tolerance: 10,
        preventDefault: true,
        onUp: () => {
          if (armed && !blocked()) jump("#layers"); // forward → composition first-frame
        },
        onDown: () => {
          if (armed && !blocked()) jump("#agents"); // back → product section (last panel)
        },
      });
      obs.disable();

      // — over the demo iframe: a capture-phase wheel listener that beats
      //   react-flow and forces the same jump (same-origin, so reachable) —
      const onFrameWheel = (e: WheelEvent) => {
        if (!armed || blocked() || Math.abs(e.deltaY) < 8) return;
        e.preventDefault();
        jump(e.deltaY > 0 ? "#layers" : "#agents"); // down → composition, up → product
      };
      const attachFrame = () => {
        try {
          frame?.contentWindow?.addEventListener("wheel", onFrameWheel, {
            passive: false,
            capture: true,
          });
        } catch {
          /* cross-origin (shouldn't happen for /gui-demo): window Observer only */
        }
      };
      const detachFrame = () => {
        try {
          frame?.contentWindow?.removeEventListener("wheel", onFrameWheel, true);
        } catch {
          /* contentWindow gone */
        }
      };
      if (frame) {
        frame.addEventListener("load", attachFrame);
        if (frame.contentDocument?.readyState === "complete") attachFrame();
      }

      const arm = () => {
        armed = true;
        animating = false;
        lockUntil = performance.now() + 450; // let the entry momentum die first
        obs.enable();
      };
      const disarm = () => {
        armed = false;
        obs.disable();
      };

      const st = ScrollTrigger.create({
        trigger: start,
        start: "top top",
        end: "bottom top",
        onEnter: arm, // arrived scrolling down from #agents
        onEnterBack: arm, // scrolled back up out of the #layers morph
        onLeave: disarm, // continued down into #layers
        onLeaveBack: disarm, // continued up into #agents
      });

      // Reload / deep-link landing already inside #start: arm the handoff
      // (onEnter only fires on a crossing, not when we start in-range).
      if (st.isActive) arm();

      // — the composition (#layers) leg, mirrored —
      // Going DOWN into #layers scrubs the morph (the reveal), so that stays
      // native. Going UP from anywhere in the composition forces the SAME jump
      // back to the demo. That's direction-specific, which an Observer's
      // all-or-nothing preventDefault can't express — so this is a plain
      // capture-free wheel listener that only acts on an UP gesture once the
      // composition fills the viewport (scrollY past #layers' top).
      const onLayersWheel = (e: WheelEvent) => {
        if (blocked() || e.deltaY > -6) return; // ignore everything but a real UP gesture
        if (window.scrollY < layers.offsetTop - 2) return; // not in the composition yet
        e.preventDefault();
        jump("#start"); // back up → the demo, same eased jump
      };
      window.addEventListener("wheel", onLayersWheel, { passive: false });

      return () => {
        if (frame) frame.removeEventListener("load", attachFrame);
        detachFrame();
        window.removeEventListener("wheel", onLayersWheel);
        obs.kill();
        st.kill();
      };
    });

    return () => mm.revert();
  }, []);

  return null;
}
