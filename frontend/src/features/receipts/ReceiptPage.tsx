import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button, ButtonLink } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { HelpLink } from "../../components/ui/HelpLink";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { VerdictBadge } from "../../components/ui/VerdictBadge";
import { useReceipt, useRun } from "../../lib/api/queries";
import type { Receipt } from "../../lib/api/types";
import { formatCount, formatDateTime, formatDuration, formatINR } from "../../lib/format";
import { CHECK, PROCESSOR, TERMS } from "../../lib/labels";
import { useDocumentTitle } from "../../lib/hooks";

/** SHA-256 of the exact stored bytes, computed in this browser with Web Crypto. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ReceiptPage() {
  const { runId = "" } = useParams();
  const run = useRun(runId);
  const completed = run.data?.status === "COMPLETED";
  const receipt = useReceipt(runId, completed);
  const [browserHash, setBrowserHash] = useState<string | null>(null);
  useDocumentTitle(`Receipt ${runId.slice(-6)}`);

  const raw = receipt.data?.receipt_json;
  useEffect(() => {
    if (!raw) return;
    let cancelled = false;
    sha256Hex(raw)
      .then((hash) => !cancelled && setBrowserHash(hash))
      .catch(() => !cancelled && setBrowserHash(null));
    return () => {
      cancelled = true;
    };
  }, [raw]);

  if (run.error) return <ErrorState error={run.error} onRetry={() => run.refetch()} />;
  if (run.data && !completed) {
    return (
      <EmptyState
        icon="shield"
        title="No receipt yet"
        body={
          run.data.status === "FAILED"
            ? "This run failed before evaluation, so no receipt was issued."
            : "The receipt is written when the run completes."
        }
        action={<ButtonLink to={`/runs/${runId}`}>Back to the run</ButtonLink>}
      />
    );
  }
  if (receipt.error) return <ErrorState error={receipt.error} onRetry={() => receipt.refetch()} />;
  if (!receipt.data) return <Skeleton className="mx-auto h-[720px] max-w-3xl" />;

  const data = receipt.data;
  const doc = data.receipt;
  const download = () => {
    const blob = new Blob([data.receipt_json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `disburseproof-receipt-${doc.run_id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const browserMatches = browserHash !== null && browserHash === data.sha256;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to={`/runs/${runId}`} className="text-[13px] font-medium text-muted hover:text-ink">
          ← Back to the run
        </Link>
        <div className="flex items-center gap-2">
          <HelpLink section="receipt" label="reading the receipt" />
          <Button size="sm" onClick={download}>
            <Icon name="download" size={14} /> Download JSON
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Icon name="printer" size={14} /> Print or save as PDF
          </Button>
        </div>
      </div>

      <article className="print-document rounded-xl border border-line bg-surface p-5 shadow-card sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="text-[12px] font-medium tracking-wide text-muted uppercase">DisburseProof</div>
            <h1 className="mt-1 text-[22px] font-semibold">Integrity receipt</h1>
            <p className="mt-1 text-[13px] text-muted">
              {PROCESSOR[doc.processor].primary} processor · {doc.batch.name}
            </p>
          </div>
          <div className="text-right">
            <VerdictBadge verdict={doc.verdict} />
            <div className="figures mt-2 text-[12px] text-muted">{doc.run_id}</div>
          </div>
        </header>

        <HumanSummary receipt={doc} />

        <Section title="The three checks">
          <ul className="divide-y divide-line">
            {doc.invariants.map((invariant) => (
              <li key={invariant.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="text-[14px] font-medium">
                    {CHECK[invariant.id]?.primary ?? invariant.title}{" "}
                    <span className="text-[11.5px] font-normal text-faint">
                      {CHECK[invariant.id]?.technical}
                    </span>
                  </div>
                  <div className="figures text-[12px] text-muted">{invariant.detail}</div>
                </div>
                <VerdictBadge verdict={invariant.result} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Counts">
          <CountsTable receipt={doc} />
        </Section>

        {(doc.double_paid_beneficiary_ids.length > 0 || doc.unpaid_beneficiary_ids.length > 0) && (
          <Section title="Affected students">
            <IdList label="Paid more than once" ids={doc.double_paid_beneficiary_ids} tone="warning" />
            <IdList label="Got ₹0" ids={doc.unpaid_beneficiary_ids} tone="danger" />
          </Section>
        )}

        <Section title="Technical record">
          <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <Field label="Run ID" value={doc.run_id} mono wide />
            <Field
              label={`${TERMS.fingerprint.primary} (${TERMS.fingerprint.technical})`}
              value={doc.replay_fingerprint}
              mono
              wide
            />
            <Field label="Batch content SHA-256" value={doc.batch.content_sha256} mono wide />
            <Field label="Test (experiment)" value={doc.experiment_id} mono />
            <Field label="Processor" value={`${PROCESSOR[doc.processor].primary} (${doc.processor})`} />
            <Field label="Scheme · year" value={`${doc.batch.scheme_id} · ${doc.batch.academic_year}`} mono />
            <Field label="Started" value={formatDateTime(doc.execution.started_at)} />
            <Field label="Finished" value={formatDateTime(doc.execution.finished_at)} />
            <Field label="Duration" value={formatDuration(doc.execution.duration_ms)} />
            <Field
              label="Step Functions execution"
              value={doc.execution.step_functions_execution_arn}
              mono
              wide
            />
          </dl>
        </Section>

        <Section title="Receipt checksum (SHA-256)">
          <div className="figures rounded-lg bg-surface-2 p-3 text-[12px] break-all">{data.sha256}</div>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            <Check ok label="Recorded on the run when the receipt was written to S3" />
            <Check ok={data.sha256_matches} label={`Recomputed by the API from s3://…/${data.s3_key}`} />
            <Check
              ok={browserMatches}
              pending={browserHash === null}
              label="Recomputed in this browser from the downloaded bytes (Web Crypto)"
            />
          </ul>
          <p className="mt-3 text-[12px] text-muted">
            A matching checksum shows this file has not changed since it was written. It is not a signature
            and not tamper-proof: anyone with write access to the bucket could rewrite both.
          </p>
        </Section>

        <footer className="mt-6 border-t border-line pt-4 text-[12px] text-muted">
          {doc.claim_boundary}
        </footer>
      </article>
    </div>
  );
}

/** One plain sentence per fact, from the receipt's own counts. */
function HumanSummary({ receipt }: { receipt: Receipt }) {
  const c = receipt.counts;
  const eligible = receipt.batch.entitlements;
  const pass = receipt.verdict === "PASS";
  const paid = eligible - c.unpaid;
  return (
    <section
      className={cx(
        "print-break-avoid mt-6 rounded-xl border px-5 py-4",
        pass ? "border-paid/40 bg-paid-soft" : "border-unpaid/40 bg-unpaid-soft",
      )}
    >
      <p
        className={cx("text-[20px] leading-snug font-semibold", pass ? "text-paid-text" : "text-unpaid-text")}
      >
        {formatCount(paid)}/{formatCount(eligible)} eligible students paid.{" "}
        {c.double_paid === 0
          ? "No entitlement paid twice."
          : `${formatCount(c.double_paid)} entitlement${c.double_paid === 1 ? "" : "s"} paid twice.`}{" "}
        {formatINR(c.misallocated_paise)} misallocated.
      </p>
      <p className="mt-1 text-[14px] text-muted">
        {pass
          ? "Every eligible student received exactly one synthetic payment under the tested workload."
          : "This run failed at least one check. The affected students are listed below."}
      </p>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-break-avoid mt-6">
      <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function CountsTable({ receipt }: { receipt: Receipt }) {
  const c = receipt.counts;
  const rows: [string, string][] = [
    ["Eligible students (entitlements)", formatCount(receipt.batch.entitlements)],
    ["Payment instructions (deliveries)", formatCount(c.deliveries)],
    ["Payments made (ledger effects)", formatCount(c.ledger_effects)],
    ["Paid exactly once", formatCount(c.paid_once)],
    ["Paid more than once", formatCount(c.double_paid)],
    ["Got ₹0", formatCount(c.unpaid)],
    ["Repeats refused", formatCount(c.duplicates_suppressed)],
    ["Not paid — budget ran out", formatCount(c.budget_exhausted)],
    ["Budget", formatINR(receipt.batch.total_budget_paise)],
    ["Paid out", formatINR(c.spent_paise)],
    ["Misallocated", formatINR(c.misallocated_paise)],
  ];
  return (
    <dl className="grid grid-cols-1 text-[13px] sm:grid-cols-2 sm:gap-x-8">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between border-b border-line py-1.5">
          <dt className="text-muted">{label}</dt>
          <dd className="figures font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function IdList({ label, ids, tone }: { label: string; ids: string[]; tone: "warning" | "danger" }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[12px] text-muted">
        {label} ({ids.length})
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <Badge key={id} tone={tone} mono>
            {id}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={cx("break-all", mono && "figures text-[12px]")}>{value}</dd>
    </div>
  );
}

function Check({ ok, pending, label }: { ok: boolean; pending?: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cx(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
          pending
            ? "bg-surface-2 text-muted"
            : ok
              ? "bg-paid-soft text-paid-text"
              : "bg-unpaid-soft text-unpaid-text",
        )}
      >
        <Icon name={pending ? "info" : ok ? "check" : "close"} size={11} strokeWidth={2.4} />
      </span>
      <span>
        {label}
        {!pending && !ok && <strong className="ml-1 text-unpaid-text">mismatch</strong>}
      </span>
    </li>
  );
}
