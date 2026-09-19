import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/toast-context";
import { ProcessorBadge, RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useExperiment, useRun, useStudents } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { formatDateTime, formatDuration, processorLabel } from "../../lib/format";
import { useDocumentTitle, useOnChange } from "../../lib/hooks";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { StudentDrawer } from "../students/StudentDrawer";
import { InvariantList } from "./InvariantList";
import { PhaseIndicator } from "./PhaseIndicator";
import { RunCounters } from "./RunCounters";
import { runStory } from "./runFacts";
import { Scoreboard } from "./Scoreboard";
import { StateLegend } from "./StateLegend";
import { StudentGrid } from "./StudentGrid";
import { VerdictBanner } from "./VerdictBanner";

export function RunPage() {
  const { runId = "", beneficiaryId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const runQuery = useRun(runId);
  const run = runQuery.data;
  const live = run ? !run.is_terminal : true;
  const students = useStudents(runId, live);
  const experiment = useExperiment(run?.experiment_id);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  useDocumentTitle(run ? `${processorLabel(run.processor)} run ${run.run_id.slice(-6)}` : "Run");

  const retried = useMemo(
    () =>
      new Set(
        (experiment.data?.logical_events ?? [])
          .filter((event) => event.phase === "A")
          .map((e) => e.beneficiary_id),
      ),
    [experiment.data],
  );

  // When the run finishes while we watch: refresh the grid once more and announce it.
  const onTerminal = useCallback(
    (was: boolean | undefined, now: boolean | undefined) => {
      if (was === false && now === true && run) {
        void students.refetch();
        const story = runStory(run);
        toast({
          title:
            run.status === "FAILED"
              ? "Run failed"
              : `${processorLabel(run.processor)} run finished: ${run.verdict ?? "evaluated"}`,
          body: run.status === "FAILED" ? (run.failure_message ?? undefined) : (story ?? undefined),
          tone: run.status === "FAILED" || run.verdict === "FAIL" ? "danger" : "success",
        });
      }
    },
    [run, students, toast],
  );
  useOnChange(run?.is_terminal, onTerminal);

  const openStudent = (id: string) => navigate(`/runs/${runId}/students/${encodeURIComponent(id)}`);
  const closeStudent = useCallback(() => navigate(`/runs/${runId}`), [navigate, runId]);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);

  if (runQuery.error) return <ErrorState error={runQuery.error} onRetry={() => runQuery.refetch()} />;
  if (!run) return <RunPageSkeleton />;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link to="/runs" className="hover:text-ink">
              Runs
            </Link>
            <span aria-hidden>/</span>
            <span className="figures">{run.run_id}</span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {processorLabel(run.processor)} processor run <RunOutcomeBadge run={run} />
          </span>
        }
        description={`${run.batch_name} · ${run.logical_events} entitlements · ${run.duplicate_count} payment events delivered twice`}
        actions={
          <>
            <Button onClick={() => setEvidenceOpen(true)}>
              <Icon name="layers" /> AWS evidence
            </Button>
            <ButtonLink to={`/compare?a=${run.run_id}`}>Compare</ButtonLink>
            {run.status === "COMPLETED" ? (
              <ButtonLink to={`/runs/${run.run_id}/receipt`} variant="primary">
                <Icon name="shield" /> Integrity receipt
              </ButtonLink>
            ) : (
              <Button variant="primary" disabled title="Available when the run completes">
                <Icon name="shield" /> Integrity receipt
              </Button>
            )}
          </>
        }
      />

      {run.status === "FAILED" && <FailureBanner run={run} />}
      <VerdictBanner run={run} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <Card>
          <CardHeader
            title="Students"
            subtitle={
              live
                ? "Updates every 2 seconds while the run is in progress"
                : "Final state, computed from the ledger"
            }
            actions={<StudentSearch onFind={openStudent} />}
          />
          <CardBody className="space-y-4">
            <Scoreboard counts={students.data?.counts} total={run.logical_events} />
            <StudentGrid
              items={students.data?.items}
              expected={run.logical_events}
              retried={retried}
              onSelect={openStudent}
              selected={beneficiaryId}
              label={`Students in run ${run.run_id}`}
            />
            <StateLegend counts={students.data?.counts} showRetried={retried.size > 0} />
            {students.error && <ErrorState error={students.error} compact />}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Progress" subtitle={<ProcessorBadge processor={run.processor} />} />
            <CardBody className="space-y-6">
              <PhaseIndicator run={run} />
              <RunCounters run={run} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Invariants" subtitle="Decided in the backend from DynamoDB rows" />
            <CardBody>
              <InvariantList run={run} />
            </CardBody>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader title="Run details" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Run ID">
              <Hash value={run.run_id} length={40} label="run ID" />
            </Detail>
            <Detail label="Replay fingerprint">
              <Hash value={run.fingerprint} length={24} label="fingerprint" />
            </Detail>
            <Detail label="Experiment">
              <span className="figures">{run.experiment_id}</span>
            </Detail>
            <Detail label="Started">{formatDateTime(run.started_at ?? run.created_at)}</Detail>
            <Detail label="Finished">{formatDateTime(run.finished_at)}</Detail>
            <Detail label="Duration">{formatDuration(run.duration_ms)}</Detail>
            <Detail label="Step Functions execution" wide>
              <Hash value={run.sfn_execution_arn} length={48} label="execution ARN" />
            </Detail>
            {run.receipt_sha256 && (
              <Detail label="Receipt SHA-256" wide>
                <Hash value={run.receipt_sha256} length={32} label="receipt SHA-256" />
              </Detail>
            )}
          </dl>
        </CardBody>
      </Card>

      <StudentDrawer runId={runId} beneficiaryId={beneficiaryId} live={live} onClose={closeStudent} />
      <EvidenceDrawer runId={runId} open={evidenceOpen} onClose={closeEvidence} />
    </>
  );
}

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0">{children}</dd>
    </div>
  );
}

function FailureBanner({ run }: { run: Run }) {
  return (
    <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-unpaid/30 bg-unpaid-soft px-4 py-3">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-unpaid-text" />
      <div className="min-w-0 text-[13px]">
        <p className="font-semibold text-unpaid-text">
          The run failed{run.failure_reason ? ` (${run.failure_reason})` : ""}. No verdict was issued.
        </p>
        {run.failure_message && <p className="mt-1 text-ink">{run.failure_message}</p>}
        {typeof run.dlq_depth_at_failure === "number" && (
          <p className="mt-1 text-muted">Messages in the dead-letter queue: {run.dlq_depth_at_failure}</p>
        )}
      </div>
    </div>
  );
}

function StudentSearch({ onFind }: { onFind: (beneficiaryId: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const id = value.trim().toUpperCase();
    if (id) onFind(/^\d+$/.test(id) ? `STU-${id.padStart(3, "0")}` : id);
  };
  return (
    <form onSubmit={submit} className="flex items-center" role="search">
      <label htmlFor="student-search" className="sr-only">
        Find a student by ID
      </label>
      <div className="relative">
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
        />
        <input
          id="student-search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="STU-042"
          className="figures h-8 w-32 rounded-lg border border-line-strong bg-surface pr-2 pl-8 text-[13px] placeholder:text-faint"
        />
      </div>
    </form>
  );
}

function RunPageSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <Skeleton className="h-14 w-2/3" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[480px]" />
        <div className="space-y-5">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      </div>
      <Badge tone="muted">Loading run…</Badge>
    </div>
  );
}
