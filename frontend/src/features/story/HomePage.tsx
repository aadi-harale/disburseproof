import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { Button, ButtonLink } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { ErrorState } from "../../components/ui/ErrorState";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { ApiError } from "../../lib/api/client";
import { useGoldenPair, type RunPair } from "../../lib/api/pairing";
import { useDeliveries, useExperiment, useOverview, useStartRun, useStudents } from "../../lib/api/queries";
import type { Batch, Experiment, Processor, Run, StudentTile } from "../../lib/api/types";
import { formatCount, formatINR, shortHash } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR, TERMS } from "../../lib/labels";
import { EvidenceDrawer } from "../evidence/EvidenceDrawer";
import { STATE_ORDER, STUDENT_STATES } from "../runs/studentStates";
import { StudentGrid } from "../runs/StudentGrid";
import { inspect } from "../theater/replay";
import { RunStage } from "../theater/RunStage";

const STEPS = [
  { id: "define", n: "01", label: "Define" },
  { id: "break", n: "02", label: "Break" },
  { id: "protect", n: "03", label: "Protect" },
  { id: "prove", n: "04", label: "Prove" },
] as const;

function scrollToId(id: string) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/**
 * The home page is the story: 01 Define → 02 Break → 03 Protect → 04 Prove.
 * Break and Prove replay the latest recorded pair of the golden experiment by
 * default; either can be run live on AWS on demand.
 */
export function HomePage() {
  useDocumentTitle(undefined);
  const overview = useOverview();
  const pair = useGoldenPair();
  const experiment = pair.experiment;
  const batch = overview.data?.demo.batch ?? null;
  const detail = useExperiment(experiment?.experiment_id);
  const [breakToken, setBreakToken] = useState(0);
  const [proveToken, setProveToken] = useState(0);

  const repeated = useMemo(
    () =>
      new Set(
        (detail.data?.logical_events ?? []).filter((e) => e.phase === "A").map((e) => e.beneficiary_id),
      ),
    [detail.data],
  );
  const previewTiles = useMemo<StudentTile[] | undefined>(
    () =>
      detail.data?.logical_events.map((event) => ({
        entitlement_key: event.logical_event_id,
        beneficiary_id: event.beneficiary_id,
        display_name: event.display_name,
        installment: event.installment,
        amount_paise: event.amount_paise,
        state: "pending",
        payments: 0,
        deliveries: 0,
      })),
    [detail.data],
  );

  if (overview.error) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;

  return (
    <div className="-mt-6 sm:-mt-8">
      <StepRail />
      <div className="space-y-8 pt-4 sm:space-y-10">
        <Hero
          experiment={experiment}
          batch={batch}
          tiles={previewTiles}
          repeated={repeated}
          onStart={() => {
            scrollToId("break");
            setBreakToken((token) => token + 1);
          }}
        />
        <Define experiment={experiment} batch={batch} />
        <StorySection
          id="break"
          n="02"
          processor="vulnerable"
          title="Let's see what retries can break."
          intro={
            experiment
              ? `The unprotected processor handles all ${formatCount(experiment.expected_deliveries)} instructions, including the ${formatCount(experiment.duplicate_count)} repeats.`
              : undefined
          }
          recorded={pair.unprotected}
          experiment={experiment}
          loading={pair.loading}
          playToken={breakToken}
        />
        <Protect
          pair={pair}
          onReplay={() => {
            scrollToId("prove");
            setProveToken((token) => token + 1);
          }}
        />
        <StorySection
          id="prove"
          n="04"
          processor="protected"
          title="The same test, protected."
          intro="Same students, same budget, same repeats. Watch what happens to each repeat instruction."
          recorded={pair.matched ? pair.protected : (pair.protected ?? null)}
          experiment={experiment}
          loading={pair.loading}
          playToken={proveToken}
          verifiedSubline={pair.matched ? "Same test. Correct outcome." : undefined}
          after={(run) => <ProveActions run={run} pair={pair} />}
        />
      </div>
    </div>
  );
}

/* ---- Sticky rail --------------------------------------------------------- */

function StepRail() {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.intersectionRatio);
        let best: string | null = null;
        let ratio = 0;
        for (const step of STEPS) {
          const value = visible.get(step.id) ?? 0;
          if (value > ratio) {
            ratio = value;
            best = step.id;
          }
        }
        setCurrent(ratio > 0 ? best : null);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75], rootMargin: "-100px 0px -35% 0px" },
    );
    for (const step of STEPS) {
      const node = document.getElementById(step.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
  return (
    <nav
      aria-label="Story steps"
      className="no-print sticky top-14 z-20 -mx-4 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:-mx-6 sm:px-6"
    >
      <ol className="mx-auto flex h-11 max-w-7xl items-center gap-1 overflow-x-auto">
        {STEPS.map((step, index) => (
          <li key={step.id} className="flex items-center">
            <button
              type="button"
              onClick={() => scrollToId(step.id)}
              aria-current={current === step.id ? "step" : undefined}
              className={cx(
                "flex items-center gap-2 rounded-md px-2.5 py-1 text-[14px] font-medium whitespace-nowrap",
                current === step.id ? "bg-accent-soft text-accent-text" : "text-muted hover:text-ink",
              )}
            >
              <span className="figures text-[12px] opacity-70">{step.n}</span>
              {step.label}
            </button>
            {index < STEPS.length - 1 && (
              <Icon name="arrowRight" size={13} className="mx-0.5 text-faint" aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ---- Hero ---------------------------------------------------------------- */

function Hero({
  experiment,
  batch,
  tiles,
  repeated,
  onStart,
}: {
  experiment: Experiment | null;
  batch: Batch | null;
  tiles: StudentTile[] | undefined;
  repeated: Set<string>;
  onStart: () => void;
}) {
  const ready = experiment && batch;
  return (
    <section
      aria-labelledby="hero-question"
      className="stage grid items-center gap-8 px-5 py-8 ring-1 ring-white/10 sm:rounded-3xl sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12"
    >
      <div className="min-w-0">
        {ready ? (
          <h1
            id="hero-question"
            className="rise text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] sm:text-[44px] xl:text-[50px]"
          >
            Can <span className="figures">{formatCount(experiment.logical_events)}</span> students each get
            paid <span className="text-gradient">exactly once</span> when{" "}
            <span className="figures text-twice">{formatCount(experiment.duplicate_count)}</span> payment
            instructions are sent twice?
          </h1>
        ) : (
          <div aria-busy>
            <h1 id="hero-question" className="sr-only">
              Loading the test
            </h1>
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        <p
          className="rise mt-5 max-w-xl text-[17px] leading-relaxed text-muted"
          style={{ ["--delay" as string]: "80ms" }}
        >
          DisburseProof runs a synthetic scholarship payout on AWS and checks whether retries cause double
          payments or leave eligible students unpaid.
        </p>
        <dl className="rise mt-6 flex flex-wrap gap-x-8 gap-y-3" style={{ ["--delay" as string]: "140ms" }}>
          {ready ? (
            <>
              <HeroStat value={formatCount(experiment.logical_events)} label="students" />
              <HeroStat value={formatINR(batch.total_budget_paise)} label="budget" />
              <HeroStat value={formatCount(experiment.expected_deliveries)} label="payment instructions" />
            </>
          ) : (
            <Skeleton className="h-14 w-96" />
          )}
        </dl>
        <div
          className="rise mt-7 flex flex-wrap items-center gap-4"
          style={{ ["--delay" as string]: "200ms" }}
        >
          <Button
            variant="primary"
            className="glow-accent h-12 px-6 text-[16px]"
            onClick={onStart}
            disabled={!ready}
          >
            See what goes wrong <Icon name="arrowRight" size={16} />
          </Button>
          <SandboxLabel />
        </div>
      </div>
      <div className="rise min-w-0" style={{ ["--delay" as string]: "240ms" }}>
        <div className="mx-auto max-w-[400px]">
          <StudentGrid
            items={tiles}
            expected={experiment?.logical_events ?? 100}
            highlight={repeated}
            label="Students in the test"
            caption={false}
          />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted" aria-label="Legend">
            {STATE_ORDER.map((key) => (
              <li key={key} className="flex items-center gap-1.5">
                <span
                  className={cx(
                    "figures grid size-[18px] place-items-center rounded-[4px] text-[10px] font-semibold",
                    STUDENT_STATES[key].tile,
                  )}
                  aria-hidden
                >
                  {STUDENT_STATES[key].glyph}
                </span>
                {STUDENT_STATES[key].name}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span
                className="figures grid size-[18px] place-items-center rounded-[4px] bg-pending text-[11px] font-semibold text-twice ring-2 ring-twice ring-inset"
                aria-hidden
              >
                ↻
              </span>
              Instruction sent twice{repeated.size ? ` (${formatCount(repeated.size)})` : ""}
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd className="figures text-[28px] leading-none font-semibold sm:text-[32px]">{value}</dd>
      <dt className="mt-1 text-[14px] text-muted">{label}</dt>
    </div>
  );
}

function SandboxLabel() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[13px] text-muted">
      <span className="size-1.5 rounded-full bg-paid" aria-hidden />
      Synthetic sandbox — no real money or personal data
    </span>
  );
}

/* ---- Section shell ------------------------------------------------------- */

function Section({
  id,
  n,
  title,
  technical,
  intro,
  aside,
  children,
}: {
  id: string;
  n: string;
  title: string;
  technical?: string;
  intro?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="stage scroll-mt-28 px-5 py-6 ring-1 ring-white/10 sm:rounded-3xl sm:px-10 sm:py-8"
    >
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="figures text-[13px] font-semibold tracking-[0.16em] text-accent-text">{n}</div>
          <h2
            id={`${id}-title`}
            className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]"
          >
            {title}
          </h2>
          {technical && <p className="mt-1 text-[13px] text-faint">{technical}</p>}
          {intro && <p className="mt-2 max-w-3xl text-[16px] leading-relaxed text-muted">{intro}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ---- 01 Define ----------------------------------------------------------- */

function Define({ experiment, batch }: { experiment: Experiment | null; batch: Batch | null }) {
  const detail = useExperiment(experiment?.experiment_id);
  const amounts = new Set((detail.data?.logical_events ?? []).map((event) => event.amount_paise));
  const each = amounts.size === 1 ? [...amounts][0]! : null;
  if (!experiment || !batch) {
    return (
      <Section id="define" n="01" title="The test">
        <Skeleton className="h-48" />
      </Section>
    );
  }
  const n = experiment.logical_events;
  const d = experiment.duplicate_count;
  return (
    <Section id="define" n="01" title="The test" technical="batch · experiment">
      <div className="grid gap-4 lg:grid-cols-3">
        <DefineCard step="What should happen">
          {each !== null ? (
            <>
              <Eq>
                {formatCount(n)} students × {formatINR(each)} = {formatINR(batch.total_budget_paise)}
              </Eq>
              <p>Exactly enough to pay everyone once.</p>
            </>
          ) : (
            <>
              <Eq>
                {formatCount(n)} students · {formatINR(batch.total_budget_paise)}
              </Eq>
              <p>Exactly enough to pay everyone what they are owed, once.</p>
            </>
          )}
        </DefineCard>
        <DefineCard step="What's normal">
          <Eq>Instructions get resent</Eq>
          <p>Payment systems resend instructions when something looks like it failed. That&apos;s normal.</p>
        </DefineCard>
        <DefineCard step="The question">
          <Eq>
            {formatCount(n)} instructions + <span className="text-twice">{formatCount(d)} repeats</span> ={" "}
            {formatCount(experiment.expected_deliveries)} arrivals
          </Eq>
          <p>Will we still get exactly {formatCount(n)} correct payments?</p>
        </DefineCard>
      </div>
      <dl className="mt-6 grid gap-3 text-[14px] sm:grid-cols-3">
        <Term name="Entitlement" technical="entitlement" value={`${formatCount(n)} of them`}>
          What one student is owed, for one installment.
        </Term>
        <Term
          name="Payment instruction"
          technical={TERMS.instruction.technical}
          value={`${formatCount(experiment.expected_deliveries)} arrive`}
        >
          A message asking the processor to pay an entitlement. Repeats are extra copies.
        </Term>
        <Term
          name="Payment"
          technical={TERMS.payment.technical}
          value={`should be exactly ${formatCount(n)}`}
        >
          Money actually recorded as paid in the ledger.
        </Term>
      </dl>
    </Section>
  );
}

function DefineCard({ step, children }: { step: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-[16px] leading-relaxed text-muted">
      <div className="mb-2 text-[13px] font-medium tracking-wide text-faint uppercase">{step}</div>
      {children}
    </div>
  );
}

function Eq({ children }: { children: ReactNode }) {
  return <p className="figures mb-2 text-[21px] leading-snug font-semibold text-ink">{children}</p>;
}

function Term({
  name,
  technical,
  value,
  children,
}: {
  name: string;
  technical: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <dt className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className="figures text-[13px] text-accent-text">{value}</span>
      </dt>
      <dd className="mt-1 text-muted">{children}</dd>
      <dd className="mt-1 text-[12px] text-faint">{technical}</dd>
    </div>
  );
}

/* ---- 02 Break / 04 Prove ------------------------------------------------- */

function isBusy(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.status === 409);
}

function StorySection({
  id,
  n,
  processor,
  title,
  intro,
  recorded,
  experiment,
  loading,
  playToken,
  verifiedSubline,
  after,
}: {
  id: string;
  n: string;
  processor: Processor;
  title: string;
  intro?: string;
  recorded: Run | null;
  experiment: Experiment | null;
  loading: boolean;
  playToken: number;
  verifiedSubline?: string;
  after?: (run: Run) => ReactNode;
}) {
  const overview = useOverview();
  const start = useStartRun();
  const navigate = useNavigate();
  const [liveRunId, setLiveRunId] = useState<string | undefined>();
  const [token, setToken] = useState(0);
  const [shown, setShown] = useState<Run | null>(null);
  const activeElsewhere = (overview.data?.active_runs ?? []).some((run) => run.run_id !== liveRunId);
  const liveRunning = shown ? shown.run_id === liveRunId && !shown.is_terminal : false;
  const runId = liveRunId ?? recorded?.run_id;
  const canGoLive = Boolean(experiment) && !start.isPending && !liveRunning && !activeElsewhere;

  const goLive = () => {
    if (!experiment) return;
    start.reset();
    start.mutate(
      { experimentId: experiment.experiment_id, processor },
      { onSuccess: (run) => setLiveRunId(run.run_id) },
    );
  };
  const watchRecorded = () => {
    start.reset();
    setLiveRunId(undefined);
    setToken((value) => value + 1);
  };
  const onRun = useCallback((run: Run) => setShown(run), []);

  const toggle = (
    <div
      role="group"
      aria-label="Recorded or live"
      className="inline-flex rounded-lg border border-line-strong p-0.5"
    >
      <button
        type="button"
        aria-pressed={!liveRunId}
        onClick={watchRecorded}
        disabled={!recorded}
        className={cx(
          "h-8 rounded-md px-3 text-[14px] font-medium disabled:opacity-50",
          !liveRunId ? "bg-accent-soft text-accent-text" : "text-muted hover:text-ink",
        )}
      >
        Watch the recorded run
      </button>
      <button
        type="button"
        aria-pressed={Boolean(liveRunId)}
        onClick={goLive}
        disabled={!canGoLive}
        title={activeElsewhere ? "Another live run is in progress" : undefined}
        className={cx(
          "inline-flex h-8 items-center gap-2 rounded-md px-3 text-[14px] font-medium disabled:opacity-50",
          liveRunId ? "bg-accent-soft text-accent-text" : "text-muted hover:text-ink",
        )}
      >
        {start.isPending && (
          <span
            className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        )}
        Run it live on AWS
      </button>
    </div>
  );

  return (
    <Section
      id={id}
      n={n}
      title={title}
      technical={PROCESSOR[processor].technical}
      intro={intro}
      aside={
        runId && (
          <Link to={`/runs/${runId}`} className="text-[14px] text-accent-text hover:underline">
            Open this run <Icon name="arrowRight" size={13} className="inline" />
          </Link>
        )
      }
    >
      {activeElsewhere && !liveRunId && (
        <p className="mb-3 text-[14px] text-muted">
          A live run is in progress — “Run it live” unlocks when it finishes.
        </p>
      )}
      {start.error &&
        (isBusy(start.error) ? (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-twice/40 bg-twice-soft/40 px-4 py-3"
          >
            <p className="text-[15px]">
              <span className="font-semibold">
                Live runs are busy right now — watch the recorded run instead.
              </span>{" "}
              <span className="text-muted">{start.error.message}</span>
            </p>
            <Button size="sm" onClick={watchRecorded} disabled={!recorded}>
              Watch the recorded run
            </Button>
          </div>
        ) : (
          <div className="mb-3">
            <ErrorState error={start.error} compact />
          </div>
        ))}

      {runId ? (
        <RunStage
          key={runId}
          runId={runId}
          toolbar={toggle}
          initial={liveRunId ? "final" : "empty"}
          playToken={playToken + token}
          autoplayOnView={!liveRunId}
          scrollOnClimax
          toastOnFinish={Boolean(liveRunId)}
          verifiedSubline={verifiedSubline}
          onSelect={(student) => navigate(`/runs/${runId}/students/${encodeURIComponent(student)}`)}
          onRun={onRun}
          after={shown && after ? after(shown) : undefined}
        />
      ) : loading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : (
        <div className="rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
          <p className="text-[18px] font-semibold">No recorded test yet — run it live.</p>
          <p className="mt-1 text-[15px] text-muted">
            It takes about 5–15 seconds on AWS. The result becomes the recorded run for everyone.
          </p>
          <Button variant="primary" className="mt-4" onClick={goLive} disabled={!canGoLive}>
            <Icon name="play" /> Run it live on AWS
          </Button>
        </div>
      )}
    </Section>
  );
}

/* ---- 03 Protect ---------------------------------------------------------- */

function Protect({ pair, onReplay }: { pair: RunPair; onReplay: () => void }) {
  // The same student the Break inspector shows: the first one paid twice in the recorded run.
  const runId = pair.unprotected?.run_id;
  const students = useStudents(runId, false);
  const deliveries = useDeliveries(runId, false);
  const example =
    students.data && deliveries.data
      ? (inspect(students.data.items, deliveries.data.items).doublePaid?.payments[0]?.entitlement_key ?? null)
      : null;
  const parts = example?.split("#") ?? null;
  const identity =
    parts && parts.length === 4
      ? [
          { name: "Scheme", value: parts[0]! },
          { name: "Student", value: parts[1]! },
          { name: "Year", value: parts[2]! },
          { name: "Installment", value: parts[3]!.replace(/^INST-/, "") },
        ]
      : null;
  return (
    <Section
      id="protect"
      n="03"
      title="Give every entitlement one identity."
      technical="idempotency key"
      intro="A repeat instruction is a new message, but it asks for the same entitlement. So the processor checks the entitlement, not the message."
    >
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-surface p-5">
            {identity ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {identity.map((part, index) => (
                    <span key={part.name} className="flex items-center gap-2">
                      <span className="rounded-lg border border-line-strong px-3 py-1.5">
                        <span className="block text-[12px] text-faint">{part.name}</span>
                        <span className="figures text-[15px] font-semibold">{part.value}</span>
                      </span>
                      {index < identity.length - 1 && <span className="text-faint">+</span>}
                    </span>
                  ))}
                </div>
                <div className="my-3 flex items-center gap-2 text-[13px] text-faint">
                  <span className="h-px flex-1 bg-line-strong" aria-hidden />
                  collapses into one identity
                  <span className="h-px flex-1 bg-line-strong" aria-hidden />
                </div>
                <p className="figures rounded-lg bg-accent-soft px-3 py-2 text-center text-[15px] font-semibold break-all text-accent-text">
                  {example}
                </p>
              </>
            ) : (
              <Skeleton className="h-36" />
            )}
          </div>
          <ol className="space-y-3">
            <FlowRow
              label="1st instruction"
              steps={["one all-or-nothing database step", "record “paid” + make the payment"]}
              result="paid"
              tone="paid"
            />
            <FlowRow
              label="2nd instruction"
              steps={["same identity already recorded"]}
              result="refused"
              tone="refused"
            />
          </ol>
          <p className="text-[16px] leading-relaxed">
            The “paid” record and the payment are saved together in one DynamoDB transaction, so a repeat —
            even a simultaneous one — can&apos;t create a second payment.{" "}
            <span className="text-[12px] text-faint">TransactWriteItems</span>
          </p>
          <details className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px]">
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <p className="mt-2 text-muted">
              One TransactWriteItems per payment instruction. All four writes commit together or none do; if
              any condition fails, nothing is written.
            </p>
            <pre className="figures mt-3 overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12.5px] leading-relaxed">
              {`TransactWriteItems([
  Put    Idempotency  if attribute_not_exists(idem_key)   # claim the identity
  Update Runs         if budget_remaining >= amount       # take the money
  Put    Ledger                                           # the payment
  Put    Deliveries   if attribute_not_exists(sk)         # this instruction's outcome
])
# A repeat fails the first condition -> recorded as DUPLICATE_SUPPRESSED, no payment.`}
            </pre>
          </details>
        </div>

        <SameTestCard pair={pair} onReplay={onReplay} />
      </div>
    </Section>
  );
}

function FlowRow({
  label,
  steps,
  result,
  tone,
}: {
  label: string;
  steps: string[];
  result: string;
  tone: "paid" | "refused";
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px]">
      <span className="w-full font-semibold sm:w-auto sm:min-w-[118px]">{label}</span>
      {steps.map((step) => (
        <span key={step} className="flex items-center gap-2">
          <Icon name="arrowRight" size={14} className="text-faint" aria-hidden />
          <span className="rounded-lg border border-line px-2.5 py-1 text-muted">{step}</span>
        </span>
      ))}
      <Icon name="arrowRight" size={14} className="text-faint" aria-hidden />
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold",
          tone === "paid" ? "bg-paid-soft text-paid-text" : "bg-accent-soft text-accent-text",
        )}
      >
        <span aria-hidden>{tone === "paid" ? "✓" : "⊘"}</span> {result}
      </span>
    </li>
  );
}

function SameTestCard({ pair, onReplay }: { pair: RunPair; onReplay: () => void }) {
  const a = pair.unprotected;
  const b = pair.protected;
  return (
    <div
      className={cx("rounded-2xl border p-6", pair.matched ? "glow-success border-paid/50" : "border-line")}
    >
      <div className="text-[13px] font-medium tracking-wide text-faint uppercase">
        {TERMS.fingerprint.primary}
      </div>
      <p className="mt-2 text-[22px] leading-snug font-semibold">
        Same students. Same repeats. Same test. Only the processor changed.
      </p>
      {pair.loading ? (
        <Skeleton className="mt-5 h-28" />
      ) : a && b ? (
        <dl className="mt-5 space-y-2.5">
          {[
            ["Unprotected run", a],
            ["Protected run", b],
          ].map(([label, run]) => (
            <div key={label as string} className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-[14px] text-muted">{label as string}</dt>
              <dd className="figures text-[20px] font-semibold" title={(run as Run).fingerprint}>
                {shortHash((run as Run).fingerprint, 16)}
              </dd>
            </div>
          ))}
          <div className="pt-1">
            {pair.matched ? (
              <span className="inline-flex items-center gap-2 rounded-lg bg-paid px-4 py-2 text-[20px] font-semibold text-white">
                <Icon name="check" size={20} strokeWidth={2.6} /> Match
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg bg-unpaid px-3 py-1.5 text-[15px] font-semibold text-white">
                Fingerprints differ — these runs are not the same test
              </span>
            )}
          </div>
        </dl>
      ) : (
        <p className="mt-5 text-[15px] text-muted">
          No matching pair yet: {a ? "the protected run" : "the unprotected run"} of this test hasn&apos;t
          been recorded. Use “Run it live on AWS” in {a ? "04 Prove" : "02 Break"} to record it.
        </p>
      )}
      <p className="mt-3 text-[12px] text-faint">
        {TERMS.fingerprint.technical} (SHA-256 of the test definition)
      </p>
      <div className="pt-6">
        <Button
          variant="primary"
          className="glow-accent h-12 w-full px-6 text-[16px]"
          onClick={onReplay}
          disabled={!b}
        >
          <Icon name="shield" size={18} /> Replay the same test, protected
        </Button>
      </div>
    </div>
  );
}

/* ---- After the verdict --------------------------------------------------- */

function ProveActions({ run, pair }: { run: Run; pair: RunPair }) {
  const [evidence, setEvidence] = useState(false);
  const close = useCallback(() => setEvidence(false), []);
  const other = pair.unprotected;
  const compare =
    other && other.fingerprint === run.fingerprint
      ? `/compare?a=${other.run_id}&b=${run.run_id}`
      : `/compare?b=${run.run_id}`;
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <ButtonLink to={compare} variant="primary" className="h-11 px-5 text-[15px]">
        Compare side by side <Icon name="arrowRight" size={15} />
      </ButtonLink>
      <ButtonLink to={`/runs/${run.run_id}/receipt`} className="h-11 px-5 text-[15px]">
        <Icon name="shield" /> Open integrity receipt
      </ButtonLink>
      <Button className="h-11 px-5 text-[15px]" onClick={() => setEvidence(true)}>
        <Icon name="layers" /> See AWS evidence
      </Button>
      <EvidenceDrawer runId={run.run_id} open={evidence} onClose={close} />
    </div>
  );
}
