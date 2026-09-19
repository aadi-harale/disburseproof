import { VerdictBadge } from "../../components/ui/VerdictBadge";
import type { Run } from "../../lib/api/types";

// Shown before evaluation. The labels are fixed; results only ever come from the API.
const PENDING = [
  { id: "one_payment_per_entitlement", title: "At most one payment per entitlement" },
  { id: "every_eligible_paid", title: "Every eligible student paid" },
  { id: "budget_guard", title: "Total paid within budget" },
];

/** The three invariants. They flip from Pending to PASS/FAIL when evaluation finishes. */
export function InvariantList({ run }: { run: Run }) {
  const evaluated = run.invariants ?? [];
  return (
    <ul className="divide-y divide-line">
      {PENDING.map((placeholder) => {
        const invariant = evaluated.find((item) => item.id === placeholder.id);
        return (
          <li
            key={placeholder.id}
            className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{invariant?.title ?? placeholder.title}</div>
              <div className="figures mt-0.5 text-[12px] text-muted">
                {invariant?.detail ??
                  (run.status === "FAILED" ? "Not evaluated" : "Evaluated after both phases drain")}
              </div>
            </div>
            <VerdictBadge verdict={invariant?.result} />
          </li>
        );
      })}
    </ul>
  );
}
