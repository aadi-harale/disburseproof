import { useCallback, useEffect, useRef, useState } from "react";

export type ReplayStatus = "idle" | "playing" | "done";

/** Timers keep firing (throttled) in a hidden tab, where requestAnimationFrame is paused. */
const CATCH_UP_MS = 250;

/**
 * Plays a schedule (ms offsets, ascending): `cursor` is how many entries are due.
 * `initial` decides what is shown before anything plays: nothing ("empty") or the
 * final state ("final"). The clock never delays the data: `skip` jumps to the end.
 *
 * Progress is a function of elapsed wall-clock time, driven by an animation frame
 * for smoothness and by an interval as well, so a hidden or throttled tab catches
 * up instead of stalling.
 */
export function useReplay(schedule: number[], initial: "empty" | "final") {
  const total = schedule.length;
  const [status, setStatus] = useState<ReplayStatus>(initial === "final" ? "done" : "idle");
  const [cursor, setCursor] = useState(0);
  const frame = useRef(0);
  const timer = useRef(0);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    clearInterval(timer.current);
  };

  const play = useCallback(() => {
    stop();
    const times = schedule;
    if (times.length === 0) return;
    const started = performance.now();
    setCursor(0);
    setStatus("playing");
    let shown = 0;
    /** Moves the cursor to wherever the wall clock says it should be. Returns true when finished. */
    const advance = () => {
      const elapsed = performance.now() - started;
      let next = shown;
      while (next < times.length && times[next]! <= elapsed) next += 1;
      if (next !== shown) {
        shown = next;
        setCursor(next);
      }
      if (shown >= times.length) {
        stop();
        setStatus("done");
        return true;
      }
      return false;
    };
    const tick = () => {
      if (!advance()) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    timer.current = window.setInterval(advance, CATCH_UP_MS);
  }, [schedule]);

  const skip = useCallback(() => {
    stop();
    setStatus("done");
  }, []);

  useEffect(() => stop, []);

  return {
    status,
    // "done" always means everything is shown, even if rows arrived after the replay finished.
    cursor: status === "done" ? total : cursor,
    play,
    skip,
  };
}
