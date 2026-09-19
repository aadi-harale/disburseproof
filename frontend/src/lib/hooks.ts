import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { rateLimitStore } from "./api/client";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(reducedMotionQuery);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}

/** Animates from the previous value to `target` (ease-out). Jumps instantly for reduced motion. */
export function useCountUp(target: number, durationMs = 600): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (reduced || from === target) {
      fromRef.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const current = Math.round(from + (target - from) * eased);
      setValue(current);
      fromRef.current = current;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return value;
}

export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · DisburseProof` : "DisburseProof";
  }, [title]);
}

export function useRateLimited(): boolean {
  return useSyncExternalStore(rateLimitStore.subscribe, rateLimitStore.isLimited, () => false);
}

/** Calls `onChange(previous, next)` when `value` changes between renders (e.g. a run finishing). */
export function useOnChange<T>(value: T, onChange: (previous: T, next: T) => void): void {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current !== value) {
      onChange(previous.current, value);
      previous.current = value;
    }
  }, [value, onChange]);
}
