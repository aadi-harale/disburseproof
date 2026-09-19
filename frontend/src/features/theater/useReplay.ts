import { useCallback, useEffect, useRef, useState } from "react";

export type ReplayStatus = "idle" | "playing" | "done";

/**
 * Plays a schedule (ms offsets, ascending): `cursor` is how many entries are due.
 * `initial` decides what is shown before anything plays: nothing ("empty") or the
 * final state ("final"). The clock never delays the data: `skip` jumps to the end.
 */
export function useReplay(schedule: number[], initial: "empty" | "final") {
  const total = schedule.length;
  const [status, setStatus] = useState<ReplayStatus>(initial === "final" ? "done" : "idle");
  const [cursor, setCursor] = useState(0);
  const frame = useRef(0);

  const stop = () => cancelAnimationFrame(frame.current);

  const play = useCallback(() => {
    stop();
    const times = schedule;
    if (times.length === 0) return;
    const started = performance.now();
    setCursor(0);
    setStatus("playing");
    let shown = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      let next = shown;
      while (next < times.length && times[next]! <= elapsed) next += 1;
      if (next !== shown) {
        shown = next;
        setCursor(next);
      }
      if (shown >= times.length) {
        setStatus("done");
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
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
