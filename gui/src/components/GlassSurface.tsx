/**
 * GlassSurface — the Liquid-Glass material primitive.
 * The ONLY component allowed to use backdrop-filter. Use for the expanded
 * overlay window and floating toolbars — never for individual nodes.
 *
 * Polymorphic via `as` so it can be a <section>, <aside>, <dialog>, etc.
 */
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from "react";
import "../styles/glass.css";

type GlassSurfaceProps<T extends ElementType> = {
  as?: T;
  /** "soft" = lighter blur + smaller radius (toolbars). Default full window glass. */
  variant?: "window" | "soft";
  /** Lift inner text legibility when glass sits over busy content. */
  legibleText?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function GlassSurface<T extends ElementType = "div">({
  as,
  variant = "window",
  legibleText = false,
  className,
  children,
  ...rest
}: GlassSurfaceProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  const classes = [
    "ds-glass",
    variant === "soft" ? "ds-glass--soft" : "",
    legibleText ? "ds-glass__legible" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}
