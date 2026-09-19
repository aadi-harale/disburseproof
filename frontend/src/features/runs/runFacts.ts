/**
 * Plain-language facts derived from a run's evaluated summary. Every number comes
 * from the API (computed from DynamoDB after the run); nothing here is a constant.
 */
import type { Invariant, Run } from "../../lib/api/types";
import { formatINR, plural } from "../../lib/format";

export function invariantById(run: Run, id: string): Invariant | undefined {
  return run.invariants?.find((invariant) => invariant.id === id);
}

/** The human story of an evaluated run, e.g. "12 students were paid twice …". */
export function runStory(run: Run): string | null {
  const s = run.summary;
  if (!s || !run.verdict) return null;
  if (run.verdict === "PASS") {
    const suppressed = s.duplicates_suppressed
      ? ` ${plural(s.duplicates_suppressed, "duplicate delivery", "duplicate deliveries")} ${s.duplicates_suppressed === 1 ? "was" : "were"} suppressed.`
      : "";
    return `All ${plural(s.paid_once, "eligible student")} ${s.paid_once === 1 ? "was" : "were"} paid exactly once.${suppressed}`;
  }
  const parts: string[] = [];
  if (s.double_paid > 0)
    parts.push(`${plural(s.double_paid, "student")} ${s.double_paid === 1 ? "was" : "were"} paid twice`);
  if (s.unpaid > 0) {
    const because = s.double_paid > 0 && s.budget_exhausted > 0 ? "because the budget is fixed, " : "";
    parts.push(`${because}${plural(s.unpaid, "other eligible student")} received ₹0`);
  }
  if (s.spent_paise > s.budget_paise)
    parts.push(`${formatINR(s.spent_paise - s.budget_paise)} was paid beyond the budget`);
  if (parts.length === 0) return "The run failed its invariants.";
  const sentence = parts.join(parts.length === 2 && s.unpaid > 0 && s.double_paid > 0 ? " and, " : "; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export interface MetricRow {
  key: string;
  label: string;
  value: (run: Run) => string;
  /** Tone of the value for highlighting in comparisons. */
  tone?: (run: Run) => "danger" | "success" | undefined;
}

const passFail = (id: string) => (run: Run) => invariantById(run, id)?.result ?? "—";
const invariantTone = (id: string) => (run: Run) => {
  const result = invariantById(run, id)?.result;
  return result === "FAIL" ? "danger" : result === "PASS" ? "success" : undefined;
};
const num = (pick: (run: Run) => number | undefined) => (run: Run) => {
  const value = pick(run);
  return value === undefined ? "—" : String(value);
};

/** The headline comparison table, one row per metric. */
export const METRIC_ROWS: MetricRow[] = [
  { key: "deliveries", label: "Deliveries", value: num((r) => r.summary?.deliveries) },
  { key: "effects", label: "Ledger effects (payments)", value: num((r) => r.summary?.ledger_effects) },
  {
    key: "double_paid",
    label: "Students paid twice",
    value: num((r) => r.summary?.double_paid),
    tone: (r) => ((r.summary?.double_paid ?? 0) > 0 ? "danger" : undefined),
  },
  {
    key: "unpaid",
    label: "Students paid ₹0",
    value: num((r) => r.summary?.unpaid),
    tone: (r) => ((r.summary?.unpaid ?? 0) > 0 ? "danger" : undefined),
  },
  { key: "suppressed", label: "Duplicates suppressed", value: num((r) => r.summary?.duplicates_suppressed) },
  {
    key: "budget_exhausted",
    label: "Rejected: budget exhausted",
    value: num((r) => r.summary?.budget_exhausted),
  },
  {
    key: "misallocated",
    label: "Misallocated amount",
    value: (r) => (r.summary ? formatINR(r.summary.misallocated_paise) : "—"),
    tone: (r) => ((r.summary?.misallocated_paise ?? 0) > 0 ? "danger" : undefined),
  },
  {
    key: "budget_guard",
    label: "Budget guard (spent ≤ budget)",
    value: passFail("budget_guard"),
    tone: invariantTone("budget_guard"),
  },
  {
    key: "one_payment",
    label: "Invariant: ≤1 payment per entitlement",
    value: passFail("one_payment_per_entitlement"),
    tone: invariantTone("one_payment_per_entitlement"),
  },
  {
    key: "every_paid",
    label: "Invariant: every eligible student paid",
    value: (r) => {
      const invariant = invariantById(r, "every_eligible_paid");
      if (!invariant || !r.summary) return "—";
      const paid = r.summary.eligible_entitlements - r.summary.unpaid;
      return `${invariant.result} (${paid}/${r.summary.eligible_entitlements})`;
    },
    tone: invariantTone("every_eligible_paid"),
  },
  {
    key: "verdict",
    label: "Verdict",
    value: (r) => r.verdict ?? "—",
    tone: (r) => (r.verdict === "FAIL" ? "danger" : r.verdict === "PASS" ? "success" : undefined),
  },
];
