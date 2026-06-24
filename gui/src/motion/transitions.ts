/**
 * Flowmap motion presets for Motion (framer-motion).
 * Mirrors the `motion` group in design-tokens.json so JS springs and CSS
 * easings stay in lockstep. Import these instead of inlining transitions.
 */
import type { Transition, Variants } from "motion/react";

/* Durations (seconds — Motion uses seconds, CSS uses ms) */
export const duration = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
  expand: 0.42,
} as const;

/* Easings — must match --ds-ease-* in tokens.css */
export const easing = {
  standard: [0.2, 0.8, 0.2, 1],
  decelerate: [0, 0, 0.2, 1],
  accelerate: [0.4, 0, 1, 1],
} as const;

/* The spring that drives node → overlay expansion. Snappy, settles clean. */
export const expandSpring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 1,
};

export const gentleSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
};

/* Tween fallback used when the user prefers reduced motion. */
export const reducedTween: Transition = {
  duration: duration.base,
  ease: easing.standard,
};

/**
 * Pick the transition for the shared-element expand based on the user's
 * reduced-motion preference. Pass the boolean from `useReducedMotion()`.
 */
export function expandTransition(reduce: boolean): Transition {
  return reduce ? reducedTween : expandSpring;
}

/* Scrim + content fade for the overlay (content cross-fades; the window
   itself moves via layout/layoutId, not these variants). */
export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.base } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

export const overlayContentVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: easing.decelerate, delay: 0.06 } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};
