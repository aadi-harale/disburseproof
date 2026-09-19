import { cx } from "../../components/ui/cx";
import type { StudentState } from "../../lib/api/types";
import { formatCount } from "../../lib/format";
import { STATE_ORDER, STUDENT_STATES } from "./studentStates";

export function StateLegend({
  counts,
  showRetried,
}: {
  counts?: Record<StudentState, number>;
  showRetried?: boolean;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
      {STATE_ORDER.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            className={cx(
              "figures grid size-[18px] place-items-center rounded-[4px] text-[9px] font-semibold",
              STUDENT_STATES[state].tile,
            )}
            aria-hidden
          >
            {STUDENT_STATES[state].glyph}
          </span>
          <span>{STUDENT_STATES[state].name}</span>
          {counts && <span className="figures font-medium text-ink">{formatCount(counts[state] ?? 0)}</span>}
        </li>
      ))}
      {showRetried && (
        <li className="flex items-center gap-1.5">
          <span className="relative size-[18px] rounded-[4px] border border-line-strong" aria-hidden>
            <span className="absolute top-[3px] right-[3px] size-[5px] rounded-full bg-muted" />
          </span>
          <span>Event delivered twice</span>
        </li>
      )}
    </ul>
  );
}
