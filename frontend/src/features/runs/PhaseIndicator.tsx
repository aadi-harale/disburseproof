import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import type { Run, RunPhase } from "../../lib/api/types";

const STEPS: { phase: RunPhase; label: string; hint: (run: Run) => string }[] = [
  { phase: "QUEUED", label: "Start", hint: () => "Step Functions" },
  { phase: "PHASE_A", label: "Phase A", hint: (run) => `retry wave · ${run.phase_a_target} deliveries` },
  {
    phase: "PHASE_B",
    label: "Phase B",
    hint: (run) => `remaining events · ${run.expected_deliveries - run.phase_a_target}`,
  },
  { phase: "EVALUATING", label: "Evaluate", hint: () => "recompute from DynamoDB" },
  { phase: "COMPLETE", label: "Receipt", hint: () => "SHA-256 to S3" },
];

/** Where the run is: Phase A (retry wave) → Phase B → evaluation → receipt. */
export function PhaseIndicator({ run }: { run: Run }) {
  const failed = run.status === "FAILED";
  const current = STEPS.findIndex((step) => step.phase === run.phase);
  const done = (index: number) => run.status === "COMPLETED" || index < current;

  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Run progress">
      {STEPS.map((step, index) => {
        const isDone = done(index);
        const isCurrent = !failed && index === current && run.status !== "COMPLETED";
        return (
          <li key={step.phase} className="min-w-0" aria-current={isCurrent ? "step" : undefined}>
            <div
              className={cx(
                "h-1.5 rounded-full",
                failed
                  ? "bg-unpaid/40"
                  : isDone
                    ? "bg-accent"
                    : isCurrent
                      ? "animate-pulse bg-accent/60"
                      : "bg-surface-2",
              )}
            />
            <div className="mt-2 flex items-center gap-1 text-[12px] font-medium">
              {isDone && !failed && <Icon name="check" size={12} className="shrink-0 text-accent-text" />}
              <span className={cx("truncate", isDone || isCurrent ? "text-ink" : "text-faint")}>
                {step.label}
              </span>
            </div>
            <div className="hidden truncate text-[11px] text-faint sm:block">{step.hint(run)}</div>
          </li>
        );
      })}
    </ol>
  );
}
