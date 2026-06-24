/**
 * Button — Geist-discipline action atom.
 * variants: primary (ink fill) · secondary (white + shadow-as-border) · ghost.
 * Single accent reserved for `accent` variant (use sparingly: the one primary
 * action per surface). Polymorphic via `as`. Accessible: loading keeps focus,
 * icon-only requires aria-label.
 */
import type { ElementType, ComponentPropsWithoutRef, ReactNode, CSSProperties } from "react";
import "../styles/glass.css";

type ButtonOwnProps = {
  as?: ElementType;
  variant?: "primary" | "secondary" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  children?: ReactNode;
};

const sizeStyle: Record<NonNullable<ButtonOwnProps["size"]>, CSSProperties> = {
  sm: { height: 28, padding: "0 var(--ds-space-2)", fontSize: "var(--ds-text-sm)", gap: "var(--ds-space-1)" },
  md: { height: 32, padding: "0 var(--ds-space-3)", fontSize: "var(--ds-text-base)", gap: "var(--ds-space-2)" },
  lg: { height: 40, padding: "0 var(--ds-space-4)", fontSize: "var(--ds-text-md)", gap: "var(--ds-space-2)" },
};

const variantStyle: Record<NonNullable<ButtonOwnProps["variant"]>, CSSProperties> = {
  primary: { background: "var(--ds-text-primary)", color: "var(--ds-text-inverse)", boxShadow: "none" },
  accent: { background: "var(--ds-accent)", color: "var(--ds-text-inverse)", boxShadow: "none" },
  secondary: { background: "var(--ds-bg-surface)", color: "var(--ds-text-primary)", boxShadow: "var(--ds-shadow-ring)" },
  ghost: { background: "transparent", color: "var(--ds-text-secondary)", boxShadow: "none" },
};

export function Button({
  as,
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconOnly = false,
  children,
  style,
  disabled,
  ...rest
}: ButtonOwnProps & Omit<ComponentPropsWithoutRef<"button">, "children">) {
  const Tag = (as ?? "button") as ElementType;
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--ds-font-sans)",
    fontWeight: "var(--ds-weight-medium)" as unknown as number,
    letterSpacing: "var(--ds-tracking-tight)",
    borderRadius: "var(--ds-radius-md)",
    border: "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    minWidth: iconOnly ? "var(--ds-tap-target)" : undefined,
    transition: "background var(--ds-dur-fast) var(--ds-ease-standard), box-shadow var(--ds-dur-fast), transform var(--ds-dur-fast)",
    ...sizeStyle[size],
    ...variantStyle[variant],
    ...style,
  };

  return (
    <Tag
      className="ds-button"
      style={base}
      disabled={Tag === "button" ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : icon}
      {!iconOnly && children}
    </Tag>
  );
}
