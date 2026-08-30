"use client";

import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from the last shown value to a target. Never snaps back to 0 mid-stream. */
export function useCountUp(target: number, ms = 880): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const origin = from.current;
    if (prefersReducedMotion() || target === origin) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      setValue(origin + (target - origin) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return value;
}

export function CountInt({ value, className }: { value: number; className?: string }) {
  const n = useCountUp(value);
  return <span className={className}>{Math.round(n).toLocaleString("en-IN")}</span>;
}

export function CountRupees({ value, className }: { value: number; className?: string }) {
  const n = useCountUp(value);
  return (
    <span className={className}>
      ₹{Math.round(n).toLocaleString("en-IN")}
    </span>
  );
}

export function CountPct({ value, className }: { value: number; className?: string }) {
  const n = useCountUp(value * 100);
  return <span className={className}>{n.toFixed(0)}%</span>;
}
