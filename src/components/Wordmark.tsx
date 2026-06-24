import type { CSSProperties } from "react";

/**
 * The "Edmini" wordmark (edmini-oej). Wordplay on "Ed mini" — "Ed" (short for Edgar) carries the live
 * brand accent; "mini" is rendered smaller, lighter, and dimmer so the pun reads at a glance. Single
 * source for the logo treatment — tweak the "mini" styling here and all three logos follow.
 */
export function Wordmark({
  color = "#f59e0b",
  className,
  style,
}: {
  /** Color of the "Ed" part — the brand accent (may be status-driven in the live header). */
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <h1 className={className} style={{ fontFamily: "var(--font-syne)", ...style }}>
      <span style={{ color, transition: "color 0.4s ease" }}>Ed</span>
      <span style={{ color: "rgba(255,255,255,0.30)", fontSize: "0.62em", fontWeight: 500 }}>mini</span>
    </h1>
  );
}
