import type { Run, Verdict } from "../../lib/api/types";
import { Badge } from "./Badge";
import { Icon } from "./Icon";

export function VerdictBadge({ verdict }: { verdict: Verdict | null | undefined }) {
  if (verdict === "PASS")
    return (
      <Badge tone="success">
        <Icon name="check" size={13} /> PASS
      </Badge>
    );
  if (verdict === "FAIL")
    return (
      <Badge tone="danger">
        <Icon name="close" size={13} /> FAIL
      </Badge>
    );
  return <Badge tone="muted">Pending</Badge>;
}

/** The verdict once evaluated; otherwise the run's status. */
export function RunOutcomeBadge({ run }: { run: Pick<Run, "status" | "verdict"> }) {
  if (run.verdict) return <VerdictBadge verdict={run.verdict} />;
  if (run.status === "FAILED") return <Badge tone="danger">Run failed</Badge>;
  if (run.status === "COMPLETED") return <Badge tone="muted">Completed</Badge>;
  return (
    <Badge tone="accent">
      <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      {run.status === "QUEUED" ? "Queued" : "Running"}
    </Badge>
  );
}

export function ProcessorBadge({ processor }: { processor: string }) {
  const label = processor === "protected" ? "Protected" : processor === "vulnerable" ? "Vulnerable" : "Naive";
  return <Badge tone={processor === "protected" ? "accent" : "neutral"}>{label} processor</Badge>;
}
