import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { HelpLink } from "../../components/ui/HelpLink";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useSiblingRun } from "../../lib/api/pairing";
import { useRun, useStudents } from "../../lib/api/queries";
import type { StudentTile } from "../../lib/api/types";
import { formatDateTime, formatDuration, shortRunId } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR, processorName, TERMS } from "../../lib/labels";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { StudentDrawer } from "../students/StudentDrawer";
import { RunStage } from "../theater/RunStage";
import { downloadAffectedCsv } from "./affectedCsv";

/** One run, any run: shareable at /runs/:id and loads cold from the API alone. */
export function RunPage() {
  const { runId = "", beneficiaryId } = useParams();
  const navigate = useNavigate();
  const runQuery = useRun(runId);
  const run = runQuery.data;
  const live = run ? !run.is_terminal : true;
  const students = useStudents(runId, live);
  const sibling = useSiblingRun(run);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  useDocumentTitle(run ? `${processorName(run.processor)} run ${run.run_id.slice(-6)}` : "Run");

  const openStudent = useCallback(
    (id: string) => navigate(`/runs/${runId}/students/${encodeURIComponent(id)}`),
    [navigate, runId],
  );
  const closeStudent = useCallback(() => navigate(`/runs/${runId}`), [navigate, runId]);
  const closeEvidence = useCallback(() => setEvidenceOpen(false), []);

  if (runQuery.error) return <ErrorState error={runQuery.error} onRetry={() => runQuery.refetch()} />;
  if (!run) return <RunPageSkeleton />;

  const affected = (students.data?.items ?? []).filter(
    (tile) => tile.state === "paid_twice" || tile.state === "unpaid",
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link to="/runs" className="hover:text-ink">
              My runs
            </Link>
            <span aria-hidden>/</span>
            <span className="figures">{shortRunId(run.run_id)}</span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {PROCESSOR[run.processor].primary} processor run <RunOutcomeBadge run={run} />
          </span>
        }
        description={`${run.batch_name} · ${run.logical_events} students · ${run.duplicate_count} of ${run.logical_events} payment instructions sent twice (${run.expected_deliveries} arrivals)`}
        actions={
          <>
            <HelpLink section="results" label="reading a result" />
            <CopyLinkButton />
            <Button onClick={() => setEvidenceOpen(true)}>
              <Icon name="layers" /> AWS evidence
            </Button>
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
      {live && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-2.5 text-[14px] text-muted">
          This run keeps going on AWS if you leave the page. Come back any time from{" "}
          <Link to="/runs" className="text-accent-text hover:underline">
            My runs
          </Link>{" "}
          or this link.
        </p>
      )}

      <RunStage
        runId={runId}
        initial="final"
        onSelect={openStudent}
        toastOnFinish
        after={
          <div className="flex flex-wrap gap-2 pt-1">
            <ButtonLink to={`/compare?${run.processor === "protected" ? "b" : "a"}=${run.run_id}`}>
              Compare with the other processor <Icon name="arrowRight" size={14} />
            </ButtonLink>
            <Button onClick={() => downloadAffectedCsv(run, affected)} disabled={affected.length === 0}>
              <Icon name="download" /> Download affected students (CSV)
            </Button>
            {affected.length === 0 && (
              <span className="self-center text-[13px] text-muted">
                No student was paid twice or left unpaid.
              </span>
            )}
          </div>
        }
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Find a student"
            subtitle="Every payment instruction for one student, in the order the processor handled them"
          />
          <CardBody>
            <StudentSearch onFind={openStudent} tiles={students.data?.items} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Run details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <Detail label="Run ID" wide>
                <Hash value={run.run_id} length={40} label="run ID" />
              </Detail>
              <Detail label={`${TERMS.fingerprint.primary} (${TERMS.fingerprint.technical})`} wide>
                <Hash value={run.fingerprint} length={32} label="fingerprint" />
              </Detail>
              <Detail label="Test (experiment)">
                <span className="figures">{run.experiment_id}</span>
              </Detail>
              <Detail label="Duration">{formatDuration(run.duration_ms)}</Detail>
              <Detail label="Started">{formatDateTime(run.started_at ?? run.created_at)}</Detail>
              <Detail label="Finished">{formatDateTime(run.finished_at)}</Detail>
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
      </div>

      <StudentDrawer
        runId={runId}
        beneficiaryId={beneficiaryId}
        live={live}
        onClose={closeStudent}
        otherRunId={sibling?.run_id}
      />
      <EvidenceDrawer runId={runId} open={evidenceOpen} onClose={closeEvidence} />
    </>
  );
}

export function CopyLinkButton() {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href.replace(/\/students\/[^/]+$/, ""));
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    window.setTimeout(() => setCopied(null), 2000);
  };
  return (
    <Button onClick={copy} aria-live="polite">
      <Icon name={copied === "yes" ? "check" : "copy"} />
      {copied === "yes"
        ? "Link copied"
        : copied === "no"
          ? "Copy blocked — use the address bar"
          : "Copy link"}
    </Button>
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

function StudentSearch({
  onFind,
  tiles,
}: {
  onFind: (id: string) => void;
  tiles: StudentTile[] | undefined;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = value.trim().toUpperCase();
    if (!raw) {
      setError("Type a student ID, e.g. STU-042 or just 42.");
      return;
    }
    const id = /^\d+$/.test(raw) ? `STU-${raw.padStart(3, "0")}` : raw;
    if (tiles && !tiles.some((tile) => tile.beneficiary_id === id)) {
      setError(`${id} is not in this run's batch.`);
      return;
    }
    setError(null);
    onFind(id);
  };
  return (
    <form onSubmit={submit} role="search" className="space-y-2">
      <label htmlFor="student-search" className="block text-[13px] font-medium">
        Student ID
      </label>
      <div className="flex gap-2">
        <input
          id="student-search"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="STU-042"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "student-search-error" : undefined}
          className="figures h-10 w-44 rounded-lg border border-line-strong bg-surface px-3 text-[14px] placeholder:text-faint"
        />
        <Button type="submit">
          <Icon name="search" /> Open
        </Button>
      </div>
      {error && (
        <p id="student-search-error" className="text-[13px] text-unpaid-text">
          {error}
        </p>
      )}
      <p className="text-[12.5px] text-muted">Or click any tile above (arrow keys + Enter work too).</p>
    </form>
  );
}

function RunPageSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-12" />
      <div className="grid gap-5 lg:grid-cols-[460px_minmax(0,1fr)]">
        <Skeleton className="h-[460px]" />
        <Skeleton className="h-[460px]" />
      </div>
      <Badge tone="muted">Loading run…</Badge>
    </div>
  );
}
