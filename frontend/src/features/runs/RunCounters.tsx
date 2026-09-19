import { Stat } from "../../components/ui/Stat";
import type { Run } from "../../lib/api/types";
import { formatCount, formatINR } from "../../lib/format";
import { useCountUp } from "../../lib/hooks";

/**
 * Live counters from the run record. Workers update them in the same DynamoDB
 * transaction that records each delivery; the verdict itself is recomputed from
 * the ledger afterwards.
 */
export function RunCounters({ run }: { run: Run }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat
          label="Deliveries recorded"
          value={run.delivered_count}
          format={formatCount}
          suffix={`/ ${formatCount(run.expected_deliveries)}`}
        />
        <Stat label="Payments committed" value={run.committed_count} format={formatCount} />
        <Stat
          label="Duplicates suppressed"
          value={run.suppressed_count}
          format={formatCount}
          tone={run.suppressed_count > 0 ? "success" : "default"}
        />
        <Stat
          label="Rejected: no budget"
          value={run.budget_exhausted_count}
          format={formatCount}
          tone={run.budget_exhausted_count > 0 ? "danger" : "default"}
        />
      </div>
      <BudgetBar remaining={run.budget_remaining_paise} total={run.total_budget_paise} />
    </div>
  );
}

function BudgetBar({ remaining, total }: { remaining: number; total: number }) {
  const shown = useCountUp(remaining);
  const percent = total > 0 ? Math.max(0, Math.min(100, (shown / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-muted">Budget remaining</span>
        <span className="figures text-muted">
          <span className="font-medium text-ink">{formatINR(shown)}</span> of {formatINR(total)}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label="Budget remaining"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={remaining}
        aria-valuetext={`${formatINR(remaining)} of ${formatINR(total)} remaining`}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
