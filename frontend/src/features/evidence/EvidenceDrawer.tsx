import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Drawer } from "../../components/ui/Drawer";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { useEvidence } from "../../lib/api/queries";
import type { EvidenceLogLine } from "../../lib/api/types";
import { formatDuration, formatTimeMs } from "../../lib/format";

/** Read-only evidence that the run executed on AWS: execution history, queue depth, log lines. */
export function EvidenceDrawer({
  runId,
  open,
  onClose,
}: {
  runId: string;
  open: boolean;
  onClose: () => void;
}) {
  const evidence = useEvidence(runId, open);
  const data = evidence.data;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="AWS evidence"
      subtitle={data ? `Region ${data.region} · read live from AWS APIs` : "Read live from AWS APIs"}
      width="max-w-2xl"
    >
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
    </Drawer>
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
