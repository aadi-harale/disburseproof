import { useSearchParams } from "react-router";

import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { ProcessorBadge, RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useOverview, useRun, useRuns, useStudents } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { formatDateTime, processorLabel, shortHash } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { METRIC_ROWS } from "../runs/runFacts";
import { StateLegend } from "../runs/StateLegend";
import { StudentGrid } from "../runs/StudentGrid";

export function ComparePage() {
  useDocumentTitle("Compare runs");
  const [params, setParams] = useSearchParams();
  const overview = useOverview();
  const runs = useRuns();
  const a = params.get("a") ?? overview.data?.latest.vulnerable?.run_id ?? undefined;
  const b = params.get("b") ?? overview.data?.latest.protected?.run_id ?? undefined;
  const runA = useRun(a);
  const runB = useRun(b);

  const choose = (slot: "a" | "b", runId: string) => {
    const next = new URLSearchParams(params);
    if (a) next.set("a", a);
    if (b) next.set("b", b);
    next.set(slot, runId);
    setParams(next, { replace: true });
  };

  const completed = (runs.data ?? []).filter((run) => run.status === "COMPLETED");

  return (
    <>
      <PageHeader
        title="Compare runs"
        description="Two runs of the same experiment. A matching replay fingerprint means both processors saw the identical workload."
      />
      {!a && !b && !overview.isLoading ? (
        <Card>
          <EmptyState
            title="Nothing to compare yet"
            body="Run the vulnerable and the protected processor on the demo workload, then come back."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <RunPicker label="Run A" value={a} runs={completed} onChange={(id) => choose("a", id)} />
            <RunPicker label="Run B" value={b} runs={completed} onChange={(id) => choose("b", id)} />
          </div>

          {runA.data && runB.data && <FingerprintCheck a={runA.data} b={runB.data} />}
          {(runA.error || runB.error) && <ErrorState error={runA.error ?? runB.error} compact />}

          <Card>
            <CardHeader
              title="Headline comparison"
              subtitle="Every value computed by the backend from DynamoDB after the run"
            />
            {runA.data && runB.data ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    <Th className="text-right">{processorLabel(runA.data.processor)}</Th>
                    <Th className="text-right">{processorLabel(runB.data.processor)}</Th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => (
                    <tr key={row.key}>
                      <Td className="text-muted">{row.label}</Td>
                      {[runA.data, runB.data].map((run) => (
                        <Td
                          key={run.run_id}
                          className={cx(
                            "figures text-right font-medium",
                            row.tone?.(run) === "danger" && "text-unpaid-text",
                            row.tone?.(run) === "success" && "text-paid-text",
                          )}
                        >
                          {row.value(run)}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody>
                <Skeleton className="h-72" />
              </CardBody>
            )}
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <GridCard run={runA.data} />
            <GridCard run={runB.data} />
          </div>
        </div>
      )}
    </>
  );
}

function RunPicker({
  label,
  value,
  runs,
  onChange,
}: {
  label: string;
  value: string | undefined;
  runs: Run[];
  onChange: (runId: string) => void;
}) {
  const id = `picker-${label.replace(/\s/g, "-").toLowerCase()}`;
  const options =
    value && !runs.some((run) => run.run_id === value) ? [{ run_id: value } as Run, ...runs] : runs;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="figures h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]"
      >
        {!value && <option value="">Select a completed run</option>}
        {options.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {run.processor ? `${processorLabel(run.processor)} · ${run.verdict ?? run.status} · ` : ""}
            {run.created_at ? `${formatDateTime(run.created_at)} · ` : ""}
            {run.run_id.slice(-8)}
          </option>
        ))}
      </select>
    </div>
  );
}

function FingerprintCheck({ a, b }: { a: Run; b: Run }) {
  const same = a.fingerprint === b.fingerprint;
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]",
        same ? "border-paid/30 bg-paid-soft text-paid-text" : "border-twice/40 bg-twice-soft text-twice-text",
      )}
    >
      <Icon name={same ? "check" : "alert"} size={16} />
      {same ? (
        <span>
          Same replay fingerprint <span className="figures font-medium">{shortHash(a.fingerprint, 16)}</span>:
          both runs processed the identical workload.
        </span>
      ) : (
        <span>
          Different fingerprints ({shortHash(a.fingerprint, 10)} vs {shortHash(b.fingerprint, 10)}): these
          runs used different workloads, so the comparison is not like for like.
        </span>
      )}
    </div>
  );
}

function GridCard({ run }: { run: Run | undefined }) {
  const students = useStudents(run?.run_id, Boolean(run && !run.is_terminal));
  if (!run) return <Skeleton className="h-96" />;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ProcessorBadge processor={run.processor} /> <RunOutcomeBadge run={run} />
          </span>
        }
        subtitle={<Hash value={run.run_id} length={32} label="run ID" />}
      />
      <CardBody className="space-y-3">
        <StudentGrid
          items={students.data?.items}
          expected={run.logical_events}
          label={`${run.processor} run students`}
        />
        <StateLegend counts={students.data?.counts} />
      </CardBody>
    </Card>
  );
}
