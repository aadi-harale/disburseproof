import { cx } from "../../components/ui/cx";
import type { StudentState } from "../../lib/api/types";
import { formatCount } from "../../lib/format";
import { useCountUp } from "../../lib/hooks";
import { STATE_ORDER, STUDENT_STATES } from "./studentStates";

const BAR: Record<StudentState, string> = {
  paid_once: "bg-paid",
  paid_twice: "bg-twice",
  unpaid: "bg-unpaid",
  pending: "bg-pending",
};
const VALUE: Record<StudentState, string> = {
  paid_once: "text-paid-text",
  paid_twice: "text-twice-text",
  unpaid: "text-unpaid-text",
  pending: "text-faint",
};

/** Four big numbers, one per student state, counted up live from the grid's data. */
export function Scoreboard({
  counts,
  total,
}: {
  counts: Record<StudentState, number> | undefined;
  total: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {STATE_ORDER.map((state) => (
        <ScoreCell
          key={state}
          state={state}
          value={counts?.[state] ?? (state === "pending" ? total : 0)}
          total={total}
        />
      ))}
    </div>
  );
}

function ScoreCell({ state, value, total }: { state: StudentState; value: number; total: number }) {
  const shown = useCountUp(value);
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="relative bg-surface px-4 pt-3 pb-3.5">
      <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-muted">
        <span>{STUDENT_STATES[state].name}</span>
        <span className="figures text-faint">{Math.round(share)}%</span>
      </div>
      <div
        className={cx(
          "figures mt-1 text-[34px] leading-none font-medium tracking-tight",
          value > 0 && VALUE[state],
        )}
      >
        {formatCount(shown)}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx("h-full rounded-full transition-[width] duration-500", BAR[state])}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}
