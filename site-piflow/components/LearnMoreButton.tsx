"use client";

import gsap from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";

gsap.registerPlugin(ScrollToPlugin);

/* ============================================================
   LearnMoreButton — the hero's primary CTA. An angular ink button
   (matches the HUD button system) that GSAP-scrolls smoothly to the
   next section. Falls back to an instant jump under reduced-motion.
   ============================================================ */
export default function LearnMoreButton({
  target = "#agents",
  className = "",
  children = "Learn more",
}: {
  target?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  function scrollToTarget() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelector(target)?.scrollIntoView();
      return;
    }
    gsap.to(window, {
      duration: 1.1,
      ease: "power3.inOut",
      scrollTo: { y: target, autoKill: true },
    });
  }

  return (
    <button type="button" onClick={scrollToTarget} className={className}>
      {children}
    </button>
  );
}
