import { Link } from "react-router";

import { Badge, type Tone } from "../../components/ui/Badge";
import { cx } from "../../components/ui/cx";
import { Drawer } from "../../components/ui/Drawer";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Skeleton } from "../../components/ui/Skeleton";
import { useStudent } from "../../lib/api/queries";
import type { Run, StudentDetail } from "../../lib/api/types";
import type { DeliveryOutcome, DeliveryRecord } from "../../lib/api/types";
import { formatCount, formatINR, formatTimeMs } from "../../lib/format";
import { PROCESSOR } from "../../lib/labels";
import { OUTCOME } from "../../lib/labels";
import { STUDENT_STATES } from "../runs/studentStates";

const TONES: Record<DeliveryOutcome, Tone> = {
  COMMITTED: "success",
  DUPLICATE_SUPPRESSED: "accent",
  BUDGET_EXHAUSTED: "danger",
};

/** Every payment instruction (delivery) for one student, in the order the processor handled them. */
export function StudentDrawer({
  runId,
  beneficiaryId,
  live,
  onClose,
  otherRunId,
}: {
  runId: string;
  beneficiaryId: string | undefined;
  live: boolean;
  onClose: () => void;
  /** The other recorded run of the same test: shown beside this one. */
  otherRunId?: string;
}) {
  const detail = useStudent(runId, beneficiaryId, live);
  const other = useStudent(otherRunId, beneficiaryId, false);
  const data = detail.data;
  const tile = data?.entitlements[0];

  return (
    <Drawer
      open={Boolean(beneficiaryId)}
      onClose={onClose}
      title={data ? data.student.display_name : (beneficiaryId ?? "Student")}
      subtitle={
        <span className="figures">
          {beneficiaryId}
          {data?.entitlements[0] ? ` · entitlement ${data.entitlements[0].entitlement_key}` : ""}
        </span>
      }
      width="max-w-3xl"
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
                    {entitlement.deliveries} instruction{entitlement.deliveries === 1 ? "" : "s"}
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

          <SideBySide
            here={data}
            there={other.data ?? null}
            loading={Boolean(otherRunId) && other.isLoading}
          />

          <RootCause detail={data} />

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
                    By then the fixed budget had already paid {data.double_paid_students.length} other
                    students twice:
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
            <h3 className="mb-3 text-[13px] font-semibold">
              Payment instructions <span className="font-normal text-faint">deliveries</span>
            </h3>
            {data.deliveries.length === 0 ? (
              <p className="text-[13px] text-muted">
                No payment instruction has arrived for this student yet.
              </p>
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
  const outcome = OUTCOME[delivery.outcome];
  const phase =
    delivery.phase === "A"
      ? `Sent twice: ${delivery.copy_index === 1 ? "1st" : "2nd"} copy (retry wave, phase A)`
      : "Sent once (phase B)";
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
        <Badge tone={TONES[delivery.outcome]}>{outcome.primary}</Badge>
        <span className="figures text-[11px] text-faint">{outcome.technical}</span>
        <span className="figures text-[12px] text-muted">{formatTimeMs(delivery.processed_at)}</span>
      </div>
      <div className="mt-1 text-[12px] text-muted">{phase}</div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-faint">Instruction ID</dt>
        <dd className="min-w-0">
          <Hash value={delivery.delivery_id} length={18} label="delivery ID" />
        </dd>
        <dt className="text-faint">Entitlement event</dt>
        <dd className="figures">{delivery.logical_event_id}</dd>
        <dt className="text-faint">Lambda request</dt>
        <dd className="min-w-0">
          <Hash value={delivery.lambda_request_id} length={18} label="Lambda request ID" />
        </dd>
        <dt className="text-faint">Attempt</dt>
        <dd className="figures">{delivery.attempt}</dd>
        {delivery.effect_id && (
          <>
            <dt className="text-faint">Payment ID</dt>
            <dd className="min-w-0">
              <Hash value={delivery.effect_id} length={18} label="effect ID" />
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}

/** One line per payment instruction, for this run and the other run of the same test. */
function SideBySide({
  here,
  there,
  loading,
}: {
  here: StudentDetail;
  there: StudentDetail | null;
  loading: boolean;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <RunColumn detail={here} />
      {there ? (
        <RunColumn detail={there} />
      ) : loading ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-muted">
          No matching run of the same test by the other processor yet.
        </div>
      )}
    </section>
  );
}

function ordinal(index: number): string {
  return index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `${index + 1}th`;
}

function RunColumn({ detail }: { detail: StudentDetail }) {
  const run: Run = detail.run;
  const received = detail.payments.reduce((sum, payment) => sum + payment.amount_paise, 0);
  // How many payments this entitlement had already had when each instruction arrived.
  const paidBefore = detail.deliveries.map(
    (_, index) =>
      detail.deliveries.slice(0, index).filter((earlier) => earlier.outcome === "COMMITTED").length,
  );
  return (
    <div className="rounded-lg border border-line px-3 py-2.5">
      <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">
        {PROCESSOR[run.processor].primary} run
      </div>
      <ol className="mt-2 space-y-1.5">
        {detail.deliveries.map((delivery, index) => {
          const committed = delivery.outcome === "COMMITTED";
          const again = committed && (paidBefore[index] ?? 0) > 0;
          const result = committed
            ? again
              ? "paid again"
              : "paid"
            : delivery.outcome === "DUPLICATE_SUPPRESSED"
              ? "refused"
              : "not paid — budget ran out";
          return (
            <li key={delivery.delivery_id} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
              <span className="font-medium">{ordinal(index)} instruction</span>
              <span className="figures text-[11.5px] text-faint" title={delivery.delivery_id}>
                {delivery.delivery_id.slice(0, 8)}… · {formatTimeMs(delivery.processed_at)}
              </span>
              <span
                className={cx(
                  again
                    ? "text-twice"
                    : committed
                      ? "text-paid"
                      : delivery.outcome === "DUPLICATE_SUPPRESSED"
                        ? "text-accent-text"
                        : "text-unpaid",
                )}
              >
                → {result}
              </span>
            </li>
          );
        })}
        {detail.deliveries.length === 0 && (
          <li className="text-[13px] text-muted">No payment instruction arrived.</li>
        )}
      </ol>
      <p className="mt-2 border-t border-line pt-2 text-[14px]">
        Total received: <span className="figures font-semibold">{formatINR(received)}</span>
      </p>
    </div>
  );
}

/** Why this student's result happened, in the wording the demo uses. */
function RootCause({ detail }: { detail: StudentDetail }) {
  const run = detail.run;
  const summary = run.summary;
  const state = detail.entitlements[0]?.state;
  const refused = detail.deliveries.some((delivery) => delivery.outcome === "DUPLICATE_SUPPRESSED");
  let text: string | null = null;
  if (state === "paid_twice") {
    text =
      "The unprotected processor pays every instruction it receives. It never checks whether this entitlement was already paid.";
  } else if (state === "unpaid" && summary) {
    // Repeat payments = payments beyond one per paid entitlement, from this run's own evaluation.
    const repeats = Math.max(0, summary.ledger_effects - (summary.paid_once + summary.double_paid));
    text = `This student's instruction arrived after the budget ran out. The ${formatCount(repeats)} repeat payments had already used ${formatINR(summary.misallocated_paise)}.`;
  } else if (refused) {
    text =
      "Refused because this entitlement's “paid” record already existed. The record and the payment are written in one DynamoDB transaction, so a repeat cannot create a second payment.";
  }
  if (!text) return null;
  return (
    <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[14px] leading-relaxed">
      {text}
    </p>
  );
}
