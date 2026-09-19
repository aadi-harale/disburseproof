import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { useEvidence, useRun } from "../../lib/api/queries";
import type { Evidence, EvidenceLogLine, Run } from "../../lib/api/types";
import { formatCount, formatDateTime, formatDuration, formatTimeMs } from "../../lib/format";

/** Read-only evidence that the run executed on AWS, in a side drawer. */
export function EvidenceDrawer({
  runId,
  open,
  onClose,
}: {
  runId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="AWS evidence"
      subtitle="Read live from AWS APIs for this run"
      width="max-w-2xl"
    >
      <EvidencePanel runId={runId} enabled={open} />
    </Drawer>
  );
}

/** The service path first (one real value per step), then the raw evidence. */
export function EvidencePanel({ runId, enabled = true }: { runId: string; enabled?: boolean }) {
  const evidence = useEvidence(runId, enabled);
  const run = useRun(runId).data;
  const data = evidence.data;
  return (
    <div>
      {evidence.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      )}
      {evidence.error && <ErrorState error={evidence.error} onRetry={() => evidence.refetch()} />}
      {data && (
        <div className="space-y-7">
          {run && <ServicePath run={run} evidence={data} />}
          <section>
            <SectionTitle title="Step Functions execution" />
            {data.execution_arn ? (
              <div className="space-y-2 text-[13px]">
                <Hash value={data.execution_arn} length={64} label="execution ARN" className="max-w-full" />
                {data.console_url && (
                  <a
                    href={data.console_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent-text hover:underline"
                  >
                    Open in the Step Functions console <Icon name="external" size={13} />
                  </a>
                )}
                <p className="text-[12px] text-faint">The console link needs access to the AWS account.</p>
              </div>
            ) : (
              <p className="text-[13px] text-muted">The execution has not started.</p>
            )}
          </section>

          <section>
            <SectionTitle
              title="Per-state durations"
              hint="Drain checks loop every 2 s until the phase is recorded"
            />
            <Table>
              <thead>
                <tr>
                  <Th>State</Th>
                  <Th className="text-right">Runs</Th>
                  <Th className="text-right">Total time</Th>
                </tr>
              </thead>
              <tbody>
                {data.states.map((state) => (
                  <tr key={state.name}>
                    <Td>
                      <span className="font-medium">{state.name}</span>
                      <span className="ml-2 text-[11px] text-faint">{state.type}</span>
                    </Td>
                    <Td className="figures text-right">{state.runs}</Td>
                    <Td className="figures text-right">{formatDuration(state.total_ms)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>

          <section>
            <SectionTitle title="SQS deliveries queue" hint="Approximate counts, shown as context only" />
            <div className="grid grid-cols-3 gap-3">
              <QueueStat label="Visible" value={data.queue.visible} />
              <QueueStat label="In flight" value={data.queue.in_flight} />
              <QueueStat
                label="Dead-letter queue"
                value={data.queue.dlq_visible}
                alert={data.queue.dlq_visible > 0}
              />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <SectionTitle
                title={`Structured log lines (last ${data.logs.length})`}
                hint={data.log_groups.join(" · ")}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => evidence.refetch()}
                loading={evidence.isFetching}
              >
                Refresh
              </Button>
            </div>
            {data.logs.length === 0 ? (
              <p className="text-[13px] text-muted">
                No log lines yet. CloudWatch Logs can take a few seconds to index new lines.
              </p>
            ) : (
              <ol className="divide-y divide-line rounded-lg border border-line">
                {data.logs.map((line, index) => (
                  <LogLine key={`${line.timestamp}-${index}`} line={line} />
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {hint && <p className="figures truncate text-[11.5px] text-faint">{hint}</p>}
    </div>
  );
}

function QueueStat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`figures text-[18px] font-medium ${alert ? "text-unpaid-text" : ""}`}>{value}</div>
    </div>
  );
}

function LogLine({ line }: { line: EvidenceLogLine }) {
  const message = typeof line.message === "string" ? { message: line.message } : line.message;
  const text = String(message.message ?? "");
  const outcome = typeof message.outcome === "string" ? message.outcome : null;
  const delivery = typeof message.delivery_id === "string" ? message.delivery_id : null;
  return (
    <li className="px-3 py-2">
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[12px]">
          <span className="figures text-faint">{formatTimeMs(new Date(line.timestamp).toISOString())}</span>
          <Badge tone="muted">{line.source}</Badge>
          <span className="font-medium">{text}</span>
          {outcome && <span className="figures text-muted">{outcome}</span>}
          {delivery && <span className="figures text-faint">{delivery.slice(0, 8)}…</span>}
        </summary>
        <pre className="figures mt-2 overflow-x-auto rounded-md bg-surface-2 p-2 text-[11.5px] leading-5">
          {JSON.stringify(message, null, 2)}
        </pre>
      </details>
    </li>
  );
}

/** Orchestrate → Deliver → Process → Record → Verify → Prove, each with a value read from AWS or the run record. */
function ServicePath({ run, evidence }: { run: Run; evidence: Evidence }) {
  const s = run.summary;
  const evaluate = evidence.states.find((state) => state.name === "Evaluate");
  const execution = evidence.execution_arn?.split(":").pop();
  const steps: { human: string; service: string; value: React.ReactNode }[] = [];
  if (evidence.execution_arn) {
    steps.push({
      human: "Orchestrate",
      service: "Step Functions",
      value: (
        <>
          {run.status.toLowerCase()} ·{" "}
          <span className="figures">
            {execution && execution.length > 18 ? `…${execution.slice(-12)}` : execution}
          </span>
          {evidence.console_url && (
            <a
              href={evidence.console_url}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 text-accent-text hover:underline"
            >
              Open in AWS console <Icon name="external" size={12} />
            </a>
          )}
        </>
      ),
    });
  }
  steps.push({
    human: "Deliver",
    service: "SQS",
    value: (
      <>
        {formatCount(run.delivered_count)} payment instructions delivered · dead-letter queue{" "}
        <span className={evidence.queue.dlq_visible > 0 ? "font-semibold text-unpaid-text" : ""}>
          {formatCount(evidence.queue.dlq_visible)}
        </span>
      </>
    ),
  });
  if (s) {
    steps.push({
      human: "Process",
      service: "Lambda worker",
      value: `${formatCount(s.deliveries)} instructions processed`,
    });
    steps.push({
      human: "Record",
      service: "DynamoDB",
      value: `${formatCount(s.ledger_effects)} payments · ${formatCount(s.duplicates_suppressed + s.budget_exhausted)} refusals`,
    });
  }
  if (run.verdict) {
    steps.push({
      human: "Verify",
      service: "evaluator (Lambda)",
      value: `${run.verdict}${evaluate ? ` in ${formatDuration(evaluate.total_ms)}` : ""} · ${formatDateTime(run.completed_at ?? run.finished_at)}`,
    });
  }
  if (run.receipt_s3_key) {
    steps.push({
      human: "Prove",
      service: "S3",
      value: <span className="figures break-all">s3://…/{run.receipt_s3_key}</span>,
    });
  }
  return (
    <section>
      <SectionTitle
        title="Service path"
        hint={`Region ${evidence.region}${run.duration_ms ? ` · run took ${formatDuration(run.duration_ms)}` : ""}`}
      />
      <ol className="relative space-y-3 border-l-2 border-line pl-5">
        {steps.map((step) => (
          <li key={step.human} className="relative">
            <span
              className="absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-surface bg-paid"
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[15px] font-semibold">{step.human}</span>
              <span className="text-[12px] text-faint">{step.service}</span>
            </div>
            <div className="text-[13.5px] text-muted">{step.value}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
