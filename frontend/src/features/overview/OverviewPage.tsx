import { useMemo } from "react";
import { Link, useNavigate } from "react-router";

import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { ErrorState } from "../../components/ui/ErrorState";
import { Hash } from "../../components/ui/Hash";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { useExperiment, useOverview, useStartRun, useStudents } from "../../lib/api/queries";
import type { Experiment, Processor, Run } from "../../lib/api/types";
import { formatCount, formatINR, formatRelative } from "../../lib/format";
import { useCountUp, useDocumentTitle } from "../../lib/hooks";
import { StudentGrid } from "../runs/StudentGrid";
import { PipelineStrip } from "./PipelineStrip";

export function OverviewPage() {
  useDocumentTitle("Overview");
  const overview = useOverview();
  const start = useStartRun();
  const navigate = useNavigate();
  const data = overview.data;
  const experiment = data?.demo.experiment ?? null;
  const detail = useExperiment(experiment?.experiment_id);
  const active = data?.active_runs ?? [];
  const retried = useMemo(
    () =>
      new Set(
        (detail.data?.logical_events ?? []).filter((e) => e.phase === "A").map((e) => e.beneficiary_id),
      ),
    [detail.data],
  );

  const launch = (processor: Processor) => {
    if (!experiment) return;
    start.mutate(
      { experimentId: experiment.experiment_id, processor },
      { onSuccess: (run) => navigate(`/runs/${run.run_id}`) },
    );
  };

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  const locked = !experiment || active.length > 0;
  return (
    <div className="space-y-10">
      <section className="stage -mx-4 px-5 pt-9 pb-8 ring-1 ring-white/10 sm:mx-0 sm:rounded-3xl sm:px-10 sm:pt-12 sm:pb-10">
        <div className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-muted">
          <span
            className="size-1.5 rounded-full bg-paid shadow-[0_0_8px_2px_rgb(47_168_100/0.6)]"
            aria-hidden
          />
          Live on AWS{data?.region ? ` · ${data.region}` : ""} · synthetic data
        </div>
        {experiment ? (
          <h1
            className="rise mt-5 max-w-5xl text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[48px]"
            style={{ ["--delay" as string]: "80ms" }}
          >
            <span className="tabular-nums">{formatCount(experiment.logical_events)}</span> eligible students.{" "}
            <span className="tabular-nums">{formatCount(experiment.expected_deliveries)}</span> payment
            events.
            <span className="text-gradient mt-1 block">How many got paid exactly once?</span>
          </h1>
        ) : (
          <Skeleton className="mt-5 h-32 max-w-3xl" />
        )}
        <p
          className="rise mt-5 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-[16px]"
          style={{ ["--delay" as string]: "160ms" }}
        >
          {experiment
            ? `Retries delivered ${experiment.duplicate_count} payment events twice. The budget is fixed, so every duplicate payment is money another student never gets. Run the identical, fingerprinted workload through two processors on real AWS and read the answer from the ledger.`
            : "Loading the demo experiment…"}
        </p>
        <div
          className="rise mt-7 flex flex-wrap items-center gap-3"
          style={{ ["--delay" as string]: "240ms" }}
        >
          <Button
            onClick={() => launch("vulnerable")}
            disabled={locked}
            loading={start.isPending && start.variables?.processor === "vulnerable"}
          >
            <Icon name="play" /> Run vulnerable processor
          </Button>
          <Button
            variant="primary"
            className="glow-accent"
            onClick={() => launch("protected")}
            disabled={locked}
            loading={start.isPending && start.variables?.processor === "protected"}
          >
            <Icon name="shield" /> Run protected processor
          </Button>
          {active.length > 0 && (
            <Link
              to={`/runs/${active[0]!.run_id}`}
              className="inline-flex items-center gap-2 text-[13px] font-medium text-accent-text hover:underline"
            >
              <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />A run is in
              progress. Watch it live
            </Link>
          )}
        </div>
        {start.error && (
          <div className="mt-3 max-w-xl">
            <ErrorState error={start.error} compact />
          </div>
        )}

        <div className="mt-9 grid gap-4 lg:grid-cols-2">
          {(["vulnerable", "protected"] as const).map((processor, index) => (
            <ReplayPanel
              key={processor}
              processor={processor}
              run={data?.latest[processor] ?? null}
              retried={retried}
              loading={overview.isLoading}
              delay={320 + index * 120}
            />
          ))}
        </div>
        {data?.latest.vulnerable && data.latest.protected && (
          <div className="mt-5 flex justify-end">
            <ButtonLink
              size="sm"
              to={`/compare?a=${data.latest.vulnerable.run_id}&b=${data.latest.protected.run_id}`}
            >
              Compare side by side <Icon name="arrowRight" size={14} />
            </ButtonLink>
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title="What happens in a run"
          subtitle="Every step runs on AWS. Nothing is simulated except the students and the money."
        />
        <PipelineStrip />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        {experiment ? (
          <WorkloadCard experiment={experiment} detailLoading={detail.isLoading} retried={retried} />
        ) : (
          <Skeleton className="h-64" />
        )}
        <WhyItWorks />
      </section>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
    </div>
  );
}

/** One side of the hero: the latest run of a processor, replayed tile by tile from its real final state. */
function ReplayPanel({
  processor,
  run,
  retried,
  loading,
  delay,
}: {
  processor: Processor;
  run: Run | null;
  retried: Set<string>;
  loading: boolean;
  delay: number;
}) {
  const live = Boolean(run && !run.is_terminal);
  const students = useStudents(run?.run_id, live);
  const s = run?.summary;
  const pass = run?.verdict === "PASS";
  const fail = run?.verdict === "FAIL";
  return (
    <div
      className={cx(
        "rise rounded-2xl border bg-surface p-4 backdrop-blur-sm sm:p-5",
        fail ? "border-unpaid/40" : pass ? "border-paid/40" : "border-line",
      )}
      style={{ ["--delay" as string]: `${delay}ms` }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">
            {processor} processor
          </div>
          <div className="mt-1 text-[13px] text-faint">
            {run
              ? `${live ? "Running now" : `Last run ${formatRelative(run.created_at)}`}`
              : loading
                ? "Loading…"
                : "Not run yet"}
          </div>
        </div>
        {run?.verdict ? (
          <span
            className={cx(
              "figures rounded-lg px-2.5 py-1 text-[13px] font-semibold tracking-wide text-white",
              pass ? "bg-paid" : "bg-unpaid",
            )}
          >
            {run.verdict}
          </span>
        ) : run ? (
          <span className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted">
            {run.status === "FAILED" ? "Run failed" : "In progress"}
          </span>
        ) : null}
      </div>

      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,300px)_minmax(0,1fr)] sm:gap-6">
        <StudentGrid
          items={run ? students.data?.items : undefined}
          expected={run?.logical_events ?? 100}
          retried={retried}
          size="sm"
          replay={Boolean(run?.is_terminal)}
          label={`${processor} run students`}
        />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-1 sm:gap-4">
          {processor === "vulnerable" ? (
            <>
              <BigNumber label="Paid twice" value={s?.double_paid} tone="warn" />
              <BigNumber label="Received ₹0" value={s?.unpaid} tone="danger" />
              <BigNumber
                label="Misallocated"
                value={s?.misallocated_paise}
                format={formatINR}
                tone="danger"
              />
            </>
          ) : (
            <>
              <BigNumber label="Paid exactly once" value={s?.paid_once} tone="success" />
              <BigNumber label="Duplicates stopped" value={s?.duplicates_suppressed} />
              <BigNumber label="Received ₹0" value={s?.unpaid} tone="danger" />
            </>
          )}
        </div>
      </div>
      {run && (
        <Link
          to={`/runs/${run.run_id}`}
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline"
        >
          Open run <Icon name="arrowRight" size={13} />
        </Link>
      )}
    </div>
  );
}

function BigNumber({
  label,
  value,
  format = formatCount,
  tone,
}: {
  label: string;
  value: number | undefined;
  format?: (value: number) => string;
  tone?: "warn" | "danger" | "success";
}) {
  const shown = useCountUp(value ?? 0, 1400);
  const active = (value ?? 0) > 0;
  return (
    <div className="min-w-0">
      <div
        className={cx(
          "figures truncate text-[22px] leading-7 font-medium sm:text-[26px]",
          !active && "text-faint",
          active && tone === "warn" && "text-twice",
          active && tone === "danger" && "text-unpaid",
          active && tone === "success" && "text-paid",
        )}
      >
        {value === undefined ? "—" : format(shown)}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted">{label}</div>
    </div>
  );
}

function WorkloadCard({
  experiment,
  retried,
  detailLoading,
}: {
  experiment: Experiment;
  retried: Set<string>;
  detailLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader title="The workload" subtitle={experiment.batch_name} />
      <CardBody className="space-y-4 text-[13px]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Fact label="Entitlements" value={formatCount(experiment.logical_events)} />
          <Fact label="Seed · duplicates" value={`${experiment.seed} · D = ${experiment.duplicate_count}`} />
          <Fact label="Phase A (retry wave)" value={`${experiment.phase_a_deliveries} deliveries`} />
          <Fact
            label="Phase B"
            value={`${experiment.expected_deliveries - experiment.phase_a_deliveries} deliveries`}
          />
          <div className="col-span-2">
            <dt className="text-muted">Replay fingerprint</dt>
            <dd className="mt-0.5">
              <Hash value={experiment.fingerprint} length={32} label="replay fingerprint" />
            </dd>
          </div>
        </dl>
        <div>
          <div className="text-muted">Students whose payment event is delivered twice</div>
          {detailLoading ? (
            <Skeleton className="mt-2 h-14" />
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {[...retried].sort().map((id) => (
                <li
                  key={id}
                  className="figures rounded-md bg-twice-soft px-2 py-0.5 text-[12px] text-twice-text"
                >
                  {id}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-faint">
            Chosen by ranking sha256(seed + ":" + event ID) and taking the first {experiment.duplicate_count}.
            Anyone can recompute it.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="figures mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function WhyItWorks() {
  return (
    <Card>
      <CardHeader
        title="Why the protected processor pays exactly once"
        subtitle="One DynamoDB transaction per payment"
      />
      <CardBody className="space-y-4 text-[13px]">
        <ol className="space-y-2.5">
          {[
            ["Claim", "Put the idempotency record for the entitlement, only if it does not exist."],
            ["Debit", "Take the amount from the run's budget, only if enough remains."],
            ["Pay", "Write the payment to the ledger."],
            ["Record", "Write this delivery's outcome, only if it is not recorded yet."],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-3">
              <span className="figures grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-medium text-accent-text">
                {index + 1}
              </span>
              <p>
                <span className="font-semibold">{title}.</span> <span className="text-muted">{body}</span>
              </p>
            </li>
          ))}
        </ol>
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-muted">
          All four commit together or not at all, so a crash can never leave a key claimed but unpaid. The
          vulnerable processor checks only the delivery ID, so a retry with a new ID pays again.
        </p>
      </CardBody>
    </Card>
  );
}
