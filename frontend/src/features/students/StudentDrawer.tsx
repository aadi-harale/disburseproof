import { Link } from "react-router";

import { Badge, type Tone } from "../../components/ui/Badge";
import { cx } from "../../components/ui/cx";
import { Drawer } from "../../components/ui/Drawer";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Skeleton } from "../../components/ui/Skeleton";
import { useStudent } from "../../lib/api/queries";
import type { DeliveryOutcome, DeliveryRecord } from "../../lib/api/types";
import { formatINR, formatTimeMs } from "../../lib/format";
import { STUDENT_STATES } from "../runs/studentStates";

const OUTCOMES: Record<DeliveryOutcome, { label: string; tone: Tone }> = {
  COMMITTED: { label: "Paid", tone: "success" },
  DUPLICATE_SUPPRESSED: { label: "Duplicate suppressed", tone: "accent" },
  BUDGET_EXHAUSTED: { label: "Rejected: budget exhausted", tone: "danger" },
};

/** Every delivery for one student, in the order the processor handled them. */
export function StudentDrawer({
  runId,
  beneficiaryId,
  live,
  onClose,
}: {
  runId: string;
  beneficiaryId: string | undefined;
  live: boolean;
  onClose: () => void;
}) {
  const detail = useStudent(runId, beneficiaryId, live);
  const data = detail.data;
  const tile = data?.entitlements[0];

  return (
    <Drawer
      open={Boolean(beneficiaryId)}
      onClose={onClose}
      title={data ? data.student.display_name : (beneficiaryId ?? "Student")}
      subtitle={<span className="figures">{beneficiaryId} · synthetic beneficiary</span>}
    >
      {detail.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}
      {detail.error && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
      {data && tile && (
        <div className="space-y-6">
          <section className="grid grid-cols-3 gap-3">
            {data.entitlements.map((entitlement) => (
              <div
                key={entitlement.entitlement_key}
                className={cx("col-span-3 rounded-lg px-3 py-2.5", STUDENT_STATES[entitlement.state].soft)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{STUDENT_STATES[entitlement.state].name}</span>
                  <span className="figures text-[12px]">
                    {entitlement.payments} payment{entitlement.payments === 1 ? "" : "s"} ·{" "}
                    {entitlement.deliveries} deliver{entitlement.deliveries === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div
                  className="figures mt-1 truncate text-[12px] opacity-80"
                  title={entitlement.entitlement_key}
                >
                  {entitlement.entitlement_key} · {formatINR(entitlement.amount_paise)}
                </div>
              </div>
            ))}
          </section>

          {data.rejections.length > 0 && (
            <section className="rounded-lg border border-unpaid/30 p-3">
              <h3 className="text-[13px] font-semibold text-unpaid-text">Why this student received ₹0</h3>
              {data.rejections.map((rejection) => (
                <p key={rejection.delivery_id} className="mt-1 text-[13px] text-muted">
                  At <span className="figures text-ink">{formatTimeMs(rejection.processed_at)}</span> the
                  processor refused the payment: the remaining budget was{" "}
                  <span className="figures text-ink">
                    {formatINR(rejection.budget_remaining_paise_at_rejection ?? 0)}
                  </span>
                  , less than the <span className="figures text-ink">{formatINR(tile.amount_paise)}</span>{" "}
                  owed.
                </p>
              ))}
              {data.double_paid_students.length > 0 && (
                <>
                  <p className="mt-2 text-[13px] text-muted">
                    By then the fixed budget had already paid {data.double_paid_students.length} students
                    twice:
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {data.double_paid_students.map((student) => (
                      <li key={student.beneficiary_id}>
                        <Link
                          to={`/runs/${runId}/students/${student.beneficiary_id}`}
                          className="figures inline-flex h-6 items-center rounded-md bg-twice-soft px-2 text-[12px] font-medium text-twice-text hover:underline"
                          title={student.display_name}
                        >
                          {student.beneficiary_id} ×{student.payments}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-3 text-[13px] font-semibold">Delivery timeline</h3>
            {data.deliveries.length === 0 ? (
              <p className="text-[13px] text-muted">No deliveries recorded for this student yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-line pl-4">
                {data.deliveries.map((delivery) => (
                  <DeliveryItem key={delivery.delivery_id} delivery={delivery} />
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function DeliveryItem({ delivery }: { delivery: DeliveryRecord }) {
  const outcome = OUTCOMES[delivery.outcome];
  const phase =
    delivery.phase === "A"
      ? `Phase A · retry wave · copy ${delivery.copy_index} of 2`
      : "Phase B · delivered once";
  return (
    <li className="relative">
      <span
        className={cx(
          "absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface",
          delivery.outcome === "COMMITTED"
            ? "bg-paid"
            : delivery.outcome === "BUDGET_EXHAUSTED"
              ? "bg-unpaid"
              : "bg-accent",
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={outcome.tone}>{outcome.label}</Badge>
        <span className="figures text-[12px] text-muted">{formatTimeMs(delivery.processed_at)}</span>
      </div>
      <div className="mt-1 text-[12px] text-muted">{phase}</div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-faint">Delivery</dt>
        <dd className="min-w-0">
          <Hash value={delivery.delivery_id} length={18} label="delivery ID" />
        </dd>
        <dt className="text-faint">Logical event</dt>
        <dd className="figures">{delivery.logical_event_id}</dd>
        <dt className="text-faint">Lambda request</dt>
        <dd className="min-w-0">
          <Hash value={delivery.lambda_request_id} length={18} label="Lambda request ID" />
        </dd>
        <dt className="text-faint">Attempt</dt>
        <dd className="figures">{delivery.attempt}</dd>
        {delivery.effect_id && (
          <>
            <dt className="text-faint">Ledger effect</dt>
            <dd className="min-w-0">
              <Hash value={delivery.effect_id} length={18} label="effect ID" />
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
