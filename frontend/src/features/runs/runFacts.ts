/**
 * Plain-language facts derived from a run's evaluated summary. Every number comes
 * from the API (computed from DynamoDB after the run); nothing here is a constant.
 */
import type { Invariant, Run } from "../../lib/api/types";
import { formatCount, formatINR, plural } from "../../lib/format";
import { CHECK } from "../../lib/labels";

export function invariantById(run: Run, id: string): Invariant | undefined {
  return run.invariants?.find((invariant) => invariant.id === id);
}

/** The human story of an evaluated run, e.g. "12 students were paid twice …". */
export function runStory(run: Run): string | null {
  const s = run.summary;
  if (!s || !run.verdict) return null;
  if (run.verdict === "PASS") {
    const refused = s.duplicates_suppressed
      ? ` ${plural(s.duplicates_suppressed, "repeat instruction")} ${s.duplicates_suppressed === 1 ? "was" : "were"} refused.`
      : "";
    return `All ${plural(s.paid_once, "eligible student")} ${s.paid_once === 1 ? "was" : "were"} paid exactly once.${refused}`;
  }
  const parts: string[] = [];
  if (s.double_paid > 0)
    parts.push(`${plural(s.double_paid, "student")} ${s.double_paid === 1 ? "was" : "were"} paid twice`);
  if (s.unpaid > 0) {
    parts.push(`${plural(s.unpaid, "eligible student")} got nothing`);
  }
  if (s.spent_paise > s.budget_paise)
    parts.push(`${formatINR(s.spent_paise - s.budget_paise)} was paid beyond the budget`);
  if (parts.length === 0) return "The run failed its checks.";
  const sentence = parts.join(". ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

export interface MetricRow {
  key: string;
  label: string;
  technical?: string;
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
  return value === undefined ? "—" : formatCount(value);
};

/** The headline comparison table, one row per metric. */
export const METRIC_ROWS: MetricRow[] = [
  {
    key: "deliveries",
    label: "Payment instructions arrived",
    technical: "deliveries",
    value: num((r) => r.summary?.deliveries),
  },
  {
    key: "effects",
    label: "Payments made",
    technical: "ledger effects",
    value: num((r) => r.summary?.ledger_effects),
  },
  {
    key: "paid_once",
    label: "Students paid exactly once",
    value: (r) =>
      r.summary ? `${formatCount(r.summary.paid_once)}/${formatCount(r.summary.eligible_entitlements)}` : "—",
  },
  {
    key: "double_paid",
    label: "Students paid twice",
    value: num((r) => r.summary?.double_paid),
    tone: (r) => ((r.summary?.double_paid ?? 0) > 0 ? "danger" : undefined),
  },
  {
    key: "unpaid",
    label: "Students who got ₹0",
    value: num((r) => r.summary?.unpaid),
    tone: (r) => ((r.summary?.unpaid ?? 0) > 0 ? "danger" : undefined),
  },
  {
    key: "suppressed",
    label: "Repeats refused",
    technical: "DUPLICATE_SUPPRESSED",
    value: num((r) => r.summary?.duplicates_suppressed),
  },
  {
    key: "budget_exhausted",
    label: "Not paid — budget ran out",
    technical: "BUDGET_EXHAUSTED",
    value: num((r) => r.summary?.budget_exhausted),
  },
  {
    key: "misallocated",
    label: "Misallocated (repeat payments)",
    value: (r) => (r.summary ? formatINR(r.summary.misallocated_paise) : "—"),
    tone: (r) => ((r.summary?.misallocated_paise ?? 0) > 0 ? "danger" : undefined),
  },
  {
    key: "one_payment",
    label: CHECK.one_payment_per_entitlement!.primary,
    technical: CHECK.one_payment_per_entitlement!.technical,
    value: passFail("one_payment_per_entitlement"),
    tone: invariantTone("one_payment_per_entitlement"),
  },
  {
    key: "every_paid",
    label: CHECK.every_eligible_paid!.primary,
    technical: CHECK.every_eligible_paid!.technical,
    value: (r) => {
      const invariant = invariantById(r, "every_eligible_paid");
      if (!invariant || !r.summary) return "—";
      const paid = r.summary.eligible_entitlements - r.summary.unpaid;
      return `${invariant.result} (${paid}/${r.summary.eligible_entitlements})`;
    },
    tone: invariantTone("every_eligible_paid"),
  },
  {
    key: "budget_guard",
    label: CHECK.budget_guard!.primary,
    technical: CHECK.budget_guard!.technical,
    value: passFail("budget_guard"),
    tone: invariantTone("budget_guard"),
  },
  {
    key: "verdict",
    label: "Verdict",
    value: (r) => r.verdict ?? "—",
    tone: (r) => (r.verdict === "FAIL" ? "danger" : r.verdict === "PASS" ? "success" : undefined),
  },
];
