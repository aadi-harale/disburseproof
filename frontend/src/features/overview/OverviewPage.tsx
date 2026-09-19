import { useMemo } from "react";
import { Link, useNavigate } from "react-router";

import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { Stat } from "../../components/ui/Stat";
import { ProcessorBadge, RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useExperiment, useOverview, useStartRun, useStudents } from "../../lib/api/queries";
import type { Experiment, Processor, Run } from "../../lib/api/types";
import { formatCount, formatINR, formatRelative } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { runStory } from "../runs/runFacts";
import { StateLegend } from "../runs/StateLegend";
import { StudentGrid } from "../runs/StudentGrid";

export function OverviewPage() {
  useDocumentTitle("Overview");
  const overview = useOverview();
  const start = useStartRun();
  const navigate = useNavigate();
  const data = overview.data;
  const experiment = data?.demo.experiment ?? null;
  const active = data?.active_runs ?? [];

  const launch = (processor: Processor) => {
    if (!experiment) return;
    start.mutate(
      { experimentId: experiment.experiment_id, processor },
      { onSuccess: (run) => navigate(`/runs/${run.run_id}`) },
    );
  };

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  return (
    <div className="space-y-8">
      <section className="pt-2 sm:pt-6">
        {experiment ? (
          <h1 className="max-w-4xl text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[40px]">
            <span className="figures">{formatCount(experiment.logical_events)}</span> eligible students.{" "}
            <span className="figures">{formatCount(experiment.expected_deliveries)}</span> payment events.{" "}
            <span className="text-muted">How many got paid exactly once?</span>
          </h1>
        ) : (
          <Skeleton className="h-24 max-w-3xl" />
        )}
        <p className="mt-4 max-w-2xl text-[15px] text-muted">
          {experiment
            ? `Retries delivered ${experiment.duplicate_count} payment events twice. Run the identical, fingerprinted workload through two disbursement processors on AWS, and check from the ledger whether every eligible student was paid exactly once.`
            : "Loading the demo experiment…"}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            size="md"
            onClick={() => launch("vulnerable")}
            disabled={!experiment || active.length > 0}
            loading={start.isPending && start.variables?.processor === "vulnerable"}
          >
            <Icon name="play" /> Run vulnerable processor
          </Button>
          <Button
            size="md"
            variant="primary"
            onClick={() => launch("protected")}
            disabled={!experiment || active.length > 0}
            loading={start.isPending && start.variables?.processor === "protected"}
          >
            <Icon name="shield" /> Run protected processor
          </Button>
          {active.length > 0 && (
            <p className="text-[13px] text-muted">
              A run is in progress.{" "}
              <Link
                to={`/runs/${active[0]!.run_id}`}
                className="font-medium text-accent-text hover:underline"
              >
                Watch it live
              </Link>
              ; the buttons unlock when it finishes.
            </p>
          )}
        </div>
        {start.error && (
          <div className="mt-3 max-w-xl">
            <ErrorState error={start.error} compact />
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-semibold">Latest results on the demo workload</h2>
            <p className="text-[13px] text-muted">
              Same experiment, same replay fingerprint, two processors.
            </p>
          </div>
          {data?.latest.vulnerable && data.latest.protected && (
            <ButtonLink
              size="sm"
              to={`/compare?a=${data.latest.vulnerable.run_id}&b=${data.latest.protected.run_id}`}
            >
              Compare side by side <Icon name="arrowRight" size={14} />
            </ButtonLink>
          )}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {(["vulnerable", "protected"] as const).map((processor) =>
            overview.isLoading ? (
              <Skeleton key={processor} className="h-[420px]" />
            ) : (
              <LatestRunCard
                key={processor}
                processor={processor}
                run={data?.latest[processor] ?? null}
                onRun={() => launch(processor)}
                disabled={!experiment || active.length > 0}
              />
            ),
          )}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {experiment ? <WorkloadCard experiment={experiment} /> : <Skeleton className="h-64" />}
        <HowItWorks />
      </section>
    </div>
  );
}

function LatestRunCard({
  processor,
  run,
  onRun,
  disabled,
}: {
  processor: Processor;
  run: Run | null;
  onRun: () => void;
  disabled: boolean;
}) {
  const students = useStudents(run?.run_id, Boolean(run && !run.is_terminal));
  if (!run) {
    return (
      <Card>
        <CardHeader title={<ProcessorBadge processor={processor} />} />
        <EmptyState
          icon="play"
          title={`No ${processor} run yet`}
          body="Start one to see which students get paid. A run takes about half a minute."
          action={
            <Button
              variant={processor === "protected" ? "primary" : "secondary"}
              onClick={onRun}
              disabled={disabled}
            >
              Run {processor} processor
            </Button>
          }
        />
      </Card>
    );
  }
  const summary = run.summary;
  const story = runStory(run);
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ProcessorBadge processor={processor} /> <RunOutcomeBadge run={run} />
          </span>
        }
        subtitle={`${formatRelative(run.created_at)} · run ${run.run_id.slice(-8)}`}
        actions={
          <ButtonLink size="sm" variant="ghost" to={`/runs/${run.run_id}`}>
            Open <Icon name="arrowRight" size={14} />
          </ButtonLink>
        }
      />
      <CardBody className="flex flex-1 flex-col gap-4">
        <p className="min-h-[3em] text-[14px] font-medium">
          {story ??
            (run.status === "FAILED"
              ? `The run failed: ${run.failure_message ?? run.failure_reason}`
              : "Running…")}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Paid twice"
            value={summary?.double_paid ?? 0}
            tone={(summary?.double_paid ?? 0) > 0 ? "warning" : "default"}
          />
          <Stat
            label="Paid ₹0"
            value={summary?.unpaid ?? 0}
            tone={(summary?.unpaid ?? 0) > 0 ? "danger" : "default"}
          />
          <Stat label="Suppressed" value={summary?.duplicates_suppressed ?? run.suppressed_count} />
          <Stat label="Misallocated" value={summary?.misallocated_paise ?? 0} format={formatINR} />
        </div>
        <StudentGrid
          items={students.data?.items}
          expected={run.logical_events}
          size="sm"
          label={`${processor} run students`}
        />
        <StateLegend counts={students.data?.counts} />
      </CardBody>
    </Card>
  );
}

function WorkloadCard({ experiment }: { experiment: Experiment }) {
  const detail = useExperiment(experiment.experiment_id);
  const duplicated = useMemo(
    () => (detail.data?.logical_events ?? []).filter((event) => event.phase === "A"),
    [detail.data],
  );
  const amount = detail.data?.logical_events[0]?.amount_paise;
  return (
    <Card>
      <CardHeader title="The workload" subtitle={experiment.batch_name} />
      <CardBody className="space-y-4 text-[13px]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-muted">Entitlements</dt>
            <dd className="figures mt-0.5 text-ink">
              {formatCount(experiment.logical_events)}
              {amount !== undefined ? ` × ${formatINR(amount)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Seed · duplicates</dt>
            <dd className="figures mt-0.5">
              {experiment.seed} · D = {experiment.duplicate_count}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Phase A (retry wave)</dt>
            <dd className="figures mt-0.5">{experiment.phase_a_deliveries} deliveries</dd>
          </div>
          <div>
            <dt className="text-muted">Phase B</dt>
            <dd className="figures mt-0.5">
              {experiment.expected_deliveries - experiment.phase_a_deliveries} deliveries
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted">Replay fingerprint</dt>
            <dd className="mt-0.5">
              <Hash value={experiment.fingerprint} length={32} label="replay fingerprint" />
            </dd>
          </div>
        </dl>
        <div>
          <div className="text-muted">Payment events delivered twice</div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {duplicated.map((event) => (
              <li
                key={event.logical_event_id}
                className="figures rounded-md bg-surface-2 px-2 py-0.5 text-[12px]"
                title={`${event.logical_event_id}: ${event.display_name}`}
              >
                {event.beneficiary_id}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-faint">
            Chosen by ranking sha256(seed + ":" + event ID) and taking the first {experiment.duplicate_count}.
            Anyone can recompute it.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function HowItWorks() {
  const steps = [
    {
      title: "Phase A: the retry wave",
      body: "Step Functions starts the run and a Lambda sends each duplicated payment event to SQS Standard twice.",
    },
    {
      title: "Phase B: everyone else",
      body: "Only after every Phase A delivery is recorded, the other events are sent once. This fixes how many students a vulnerable processor starves.",
    },
    {
      title: "Process",
      body: "A worker Lambda reads SQS. The protected processor claims the payment's business key and pays in one DynamoDB transaction.",
    },
    {
      title: "Prove",
      body: "The evaluator recomputes every count from DynamoDB, and a SHA-256 fingerprinted receipt is written to S3.",
    },
  ];
  return (
    <Card>
      <CardHeader title="How a run works" subtitle="Real AWS services; synthetic data" />
      <CardBody>
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="figures grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-medium text-accent-text">
                {index + 1}
              </span>
              <div>
                <div className="text-[13px] font-semibold">{step.title}</div>
                <p className="text-[13px] text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
