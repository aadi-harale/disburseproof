import { useEffect, useRef } from "react";

/** Scrolls the climax into view once, when it first appears. */
export function useRevealScroll(show: boolean, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!show) {
      done.current = false;
      return;
    }
    if (!enabled || done.current || !ref.current) return;
    done.current = true;
    const id = window.setTimeout(
      () => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      150,
    );
    return () => window.clearTimeout(id);
  }, [show, enabled]);
  return ref;
}
