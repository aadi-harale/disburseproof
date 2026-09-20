import type { ReactNode } from "react";

import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import type { ReplayDelivery, Run, StudentTile } from "../../lib/api/types";
import { formatCount, formatINR, formatTimeMs } from "../../lib/format";
import { useCountUp } from "../../lib/hooks";
import { CHECK, CHECK_ORDER, TERMS } from "../../lib/labels";
import { STATE_ORDER, STUDENT_STATES } from "../runs/studentStates";
import { StudentGrid } from "../runs/StudentGrid";
import { deriveTheater, inspect, type FeedLine, type TheaterState } from "./replay";
import { VerificationPill } from "./VerificationPill";

/**
 * The results view for any run: grid, budget, counters, feed and flow strip, then
 * the verdict climax once the backend has evaluated the run. `cursor` is how many of
 * the run's real delivery rows to show (all of them for a live or finished view).
 */
export function RunTheater({
  run,
  entitlements,
  deliveries,
  cursor,
  complete,
  view = "grid",
  viewToggle,
  onSelect,
  verifiedSubline,
  showInspector = true,
  climaxRef,
}: {
  run: Run;
  entitlements: StudentTile[] | undefined;
  deliveries: ReplayDelivery[] | undefined;
  cursor: number;
  /** Every row is shown and the run is terminal: the climax may appear. */
  complete: boolean;
  view?: "grid" | "list";
  viewToggle?: ReactNode;
  onSelect?: (beneficiaryId: string) => void;
  verifiedSubline?: string;
  showInspector?: boolean;
  climaxRef?: React.Ref<HTMLDivElement>;
}) {
  const ready = entitlements && deliveries;
  const state = ready ? deriveTheater(entitlements, deliveries, cursor) : null;
  // Once everything is shown, the tiles are the backend's evaluated states.
  const tiles = complete && run.verdict && entitlements ? entitlements : state?.tiles;
  const counts = complete && run.verdict && entitlements ? countStates(entitlements) : state?.counts;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-7">
        <div className="min-w-0">
          <StudentGrid
            items={tiles}
            expected={run.logical_events}
            size="lg"
            view={view}
            onSelect={onSelect}
            label={`${formatCount(run.logical_events)} students`}
          />
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
            <Legend counts={counts} />
            {viewToggle}
          </div>
        </div>
        <div className="min-w-0 space-y-5">
          <BudgetBar run={run} state={state} />
          <Counters run={run} state={state} />
          <Feed lines={state?.feed ?? []} waiting={!state || state.arrived === 0} />
        </div>
      </div>
      <FlowStrip run={run} state={state} complete={complete} />
      {run.status === "FAILED" ? (
        <Incomplete run={run} arrived={state?.arrived ?? run.delivered_count} />
      ) : complete && run.verdict && run.summary ? (
        <div ref={climaxRef} className="scroll-mt-28">
          <Climax run={run} verifiedSubline={verifiedSubline} tiles={tiles} />
          {showInspector && run.verdict === "FAIL" && entitlements && deliveries && (
            <WhyItFailed run={run} entitlements={entitlements} deliveries={deliveries} onSelect={onSelect} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function countStates(tiles: StudentTile[]) {
  const counts = { paid_once: 0, paid_twice: 0, unpaid: 0, pending: 0 };
  for (const tile of tiles) counts[tile.state] += 1;
  return counts;
}

function Legend({ counts }: { counts: Record<string, number> | undefined }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 text-[13px] text-muted" aria-label="Legend">
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
          <span className="figures font-semibold text-ink">
            {counts ? formatCount(counts[key] ?? 0) : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The budget, and where it goes: green first payments, amber repeat payments (the
 * leak), the rest remaining. Every figure is the replayed or live delivery rows.
 */
function BudgetBar({ run, state }: { run: Run; state: TheaterState | null }) {
  const budget = run.total_budget_paise;
  const first = state?.spentFirst ?? 0;
  const repeat = state?.spentRepeat ?? 0;
  const remaining = Math.max(0, budget - first - repeat);
  const pct = (value: number) => (budget > 0 ? `${(value / budget) * 100}%` : "0%");
  const leaked = repeat > 0;
  const refused = state?.repeatsRefused ?? 0;
  const starved = state?.unpaid ?? 0;
  return (
    <div className="card-quiet rounded-xl px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[15px] font-medium">Synthetic scholarship budget</div>
        <div className="figures text-[13px] text-muted">{formatINR(budget)}</div>
      </div>
      <div
        className="relative mt-2 h-4 overflow-hidden rounded-full bg-pending"
        role="img"
        aria-label={`Budget: ${formatINR(first)} in first payments, ${formatINR(repeat)} in repeat payments, ${formatINR(remaining)} left`}
      >
        <div className="flex h-full">
          <div className="h-full bg-paid transition-[width] duration-300" style={{ width: pct(first) }} />
          <div className="h-full bg-twice transition-[width] duration-300" style={{ width: pct(repeat) }} />
        </div>
        {leaked && (
          // Keyed by the number of repeat payments: a new one remounts this and replays the flash.
          <span
            key={state?.repeatPayments ?? 0}
            className="leak-flash pointer-events-none absolute inset-0 bg-unpaid"
            aria-hidden
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-paid" aria-hidden /> First payments{" "}
          <span className="figures text-ink">{formatINR(first)}</span>
        </span>
        <span>
          Left{" "}
          <span className={cx("figures", remaining === 0 ? "text-unpaid" : "text-ink")}>
            {formatINR(remaining)}
          </span>
        </span>
      </div>
      <div className="mt-2 space-y-1 border-t border-line pt-2 text-[15px]" aria-live="polite">
        {leaked ? (
          <p className="text-twice">
            Repeat payments: <span className="figures font-semibold">−{formatINR(repeat)}</span>{" "}
            <span className="text-muted">
              ({formatCount(state?.paidTwice ?? 0)} student{(state?.paidTwice ?? 0) === 1 ? "" : "s"} paid
              twice)
            </span>
          </p>
        ) : refused > 0 ? (
          <p className="text-accent-text">
            Repeats refused: <span className="figures font-semibold">{formatCount(refused)}</span>{" "}
            <span className="text-muted">— {formatINR(0)} leaked</span>
          </p>
        ) : (
          <p className="text-faint">No repeat payment yet.</p>
        )}
        {remaining === 0 && starved > 0 && (
          <p className="text-unpaid">
            Budget used up — <span className="figures font-semibold">{formatCount(starved)}</span> eligible
            student
            {starved === 1 ? "" : "s"} got ₹0
          </p>
        )}
      </div>
    </div>
  );
}

function Counters({ run, state }: { run: Run; state: TheaterState | null }) {
  const protectedRun = run.processor === "protected";
  const items: { label: string; value: string; tone?: "twice" | "unpaid" | "accent" }[] = [
    {
      label: "Payment instructions arrived",
      value: `${formatCount(state?.arrived ?? 0)}/${formatCount(run.expected_deliveries)}`,
    },
    {
      label: "Payments made",
      value: `${formatCount(state?.payments ?? 0)}/${formatCount(run.logical_events)}`,
    },
    {
      label: "Paid twice",
      value: formatCount(state?.paidTwice ?? 0),
      tone: (state?.paidTwice ?? 0) > 0 ? "twice" : undefined,
    },
    {
      label: "₹0 so far",
      value: formatCount(state?.unpaid ?? 0),
      tone: (state?.unpaid ?? 0) > 0 ? "unpaid" : undefined,
    },
  ];
  if (protectedRun || (state?.repeatsRefused ?? 0) > 0) {
    items.push({
      label: "Repeats refused",
      value: formatCount(state?.repeatsRefused ?? 0),
      tone: (state?.repeatsRefused ?? 0) > 0 ? "accent" : undefined,
    });
  }
  return (
    <dl className="grid grid-cols-2 gap-2">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cx("card-quiet rounded-xl px-3.5 py-2", index === 4 && "col-span-2")}
        >
          <dt className="text-[12.5px] text-muted">{item.label}</dt>
          <dd
            className={cx(
              "figures mt-0.5 text-[24px] leading-8 font-medium",
              item.tone === "twice" && "text-twice",
              item.tone === "unpaid" && "text-unpaid",
              item.tone === "accent" && "text-accent-text",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const FEED_STYLE: Record<FeedLine["tone"], { glyph: string; className: string }> = {
  paid: { glyph: "✓", className: "text-paid" },
  twice: { glyph: "×2", className: "text-twice" },
  refused: { glyph: "⊘", className: "text-accent-text" },
  unpaid: { glyph: "₹0", className: "text-unpaid" },
};

/** The newest few things the processor did, in words; the rest on demand. */
function Feed({ lines, waiting }: { lines: FeedLine[]; waiting: boolean }) {
  const newest = lines.slice(0, 3);
  const rest = lines.slice(3);
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-muted">What the processor just did</div>
      <div className="card-quiet rounded-xl px-3 py-2">
        <ol className="min-h-[76px] space-y-0.5">
          {waiting && (
            <li className="py-1 text-[13.5px] text-faint">Waiting for the first payment instruction…</li>
          )}
          {newest.map((line, index) => (
            <FeedItem key={line.id} line={line} newest={index === 0} />
          ))}
        </ol>
        {rest.length > 0 && (
          <details className="mt-1 border-t border-line pt-1">
            <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">
              Show all ({formatCount(lines.length)} recent)
            </summary>
            <ol className="mt-1 space-y-0.5">
              {rest.map((line) => (
                <FeedItem key={line.id} line={line} />
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}

function FeedItem({ line, newest }: { line: FeedLine; newest?: boolean }) {
  return (
    <li
      className={cx(
        "flex items-center gap-2.5 py-[2px] text-[13.5px]",
        newest ? "rise text-ink" : "text-muted",
      )}
    >
      <span
        className={cx(
          "figures w-6 shrink-0 text-center text-[11.5px] font-semibold",
          FEED_STYLE[line.tone].className,
        )}
        aria-hidden
      >
        {FEED_STYLE[line.tone].glyph}
      </span>
      <span className="min-w-0 flex-1 truncate">{line.text}</span>
      <span className="figures shrink-0 text-[11px] text-faint">{formatTimeMs(line.at)}</span>
    </li>
  );
}

function FlowStrip({ run, state, complete }: { run: Run; state: TheaterState | null; complete: boolean }) {
  const arrived = state?.arrived ?? 0;
  const busy = arrived > 0 && !complete;
  const refused = (state?.repeatsRefused ?? 0) + (state?.budgetRefusals ?? 0);
  const verdict = complete ? run.verdict : null;
  const steps: { human: string; aws: string; value: ReactNode }[] = [
    { human: "Instructions", aws: "SQS queue", value: `${formatCount(arrived)} arrived` },
    { human: "Process", aws: "Lambda worker", value: `${formatCount(arrived)} handled` },
    { human: "Record", aws: "DynamoDB ledger", value: `${formatCount(state?.payments ?? 0)} payments` },
    {
      human: "Verify",
      aws: "evaluator",
      value: verdict ? (
        <span className={verdict === "PASS" ? "text-paid" : "text-unpaid"}>{verdict}</span>
      ) : run.status === "FAILED" ? (
        "not evaluated"
      ) : (
        "after all arrive"
      ),
    },
  ];
  return (
    <div className="card-quiet rounded-xl px-4 py-3">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-0" aria-label="Where each instruction goes">
        {steps.map((step, index) => (
          <li key={step.human} className="relative flex min-w-0 items-center sm:pr-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "size-2 shrink-0 rounded-full",
                    busy && index < 3 ? "animate-pulse bg-accent" : complete ? "bg-paid" : "bg-pending",
                  )}
                  aria-hidden
                />
                <span className="text-[15px] font-semibold">{step.human}</span>
                <span className="text-[12px] text-faint">{step.aws}</span>
              </div>
              <div className="figures mt-0.5 pl-4 text-[13px] text-muted">{step.value}</div>
            </div>
            {index < steps.length - 1 && (
              <span
                className={cx(
                  "absolute top-3 right-1 hidden h-[2px] w-4 sm:block",
                  busy ? "flow-x" : "bg-line-strong",
                )}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
      {refused > 0 && (
        <p className="mt-2 border-t border-line pt-2 text-[13px] text-muted">
          <span className="text-accent-text">↳ Refused before the ledger:</span>{" "}
          {state!.repeatsRefused > 0 && (
            <span className="figures text-ink">{formatCount(state!.repeatsRefused)} repeats refused</span>
          )}
          {state!.repeatsRefused > 0 && state!.budgetRefusals > 0 && " · "}
          {state!.budgetRefusals > 0 && (
            <span className="figures text-unpaid">
              {formatCount(state!.budgetRefusals)} not paid — budget ran out
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** The verdict moment. Every number is from the backend's evaluation of this run. */
export function Climax({
  run,
  verifiedSubline,
  tiles,
}: {
  run: Run;
  verifiedSubline?: string;
  tiles?: StudentTile[];
}) {
  const s = run.summary!;
  const pass = run.verdict === "PASS";
  const eligible = s.eligible_entitlements;
  const numbers: {
    value: number;
    format?: (v: number) => string;
    suffix?: string;
    label: string;
    tone?: string;
  }[] = pass
    ? [
        {
          value: s.paid_once,
          suffix: `/${formatCount(eligible)}`,
          label: "students paid",
          tone: "text-paid",
        },
        { value: s.double_paid, label: "paid twice" },
        { value: s.unpaid, label: "unpaid" },
        { value: s.duplicates_suppressed, label: "repeats refused", tone: "text-accent-text" },
        { value: s.misallocated_paise, format: formatINR, label: "misallocated" },
      ]
    : [
        { value: s.double_paid, label: "paid twice", tone: "text-twice" },
        { value: s.unpaid, label: "got ₹0", tone: "text-unpaid" },
        { value: s.misallocated_paise, format: formatINR, label: "misallocated", tone: "text-unpaid" },
        { value: s.paid_once, suffix: `/${formatCount(eligible)}`, label: "paid correctly" },
      ];
  return (
    <section
      aria-label={pass ? "Integrity verified" : "Payment integrity failed"}
      className={cx(
        "verdict-in card-quiet rounded-2xl p-5 sm:p-7",
        pass
          ? "glow-verdict-pass border-paid/40 bg-paid-soft/25"
          : "glow-verdict-fail border-unpaid/40 bg-unpaid-soft/25",
      )}
    >
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cx(
                "grid size-11 place-items-center rounded-full text-white",
                pass ? "bg-paid" : "bg-unpaid",
              )}
              aria-hidden
            >
              <Icon name={pass ? "check" : "close"} size={24} strokeWidth={2.6} />
            </span>
            <div>
              <h3
                className={cx(
                  "text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[36px]",
                  pass ? "text-paid" : "text-unpaid",
                )}
              >
                {pass ? `${TERMS.verified.primary}.` : TERMS.failed.primary}
              </h3>
              <p className="text-[15px] text-muted">
                {pass
                  ? (verifiedSubline ??
                    "Every eligible student received exactly one synthetic payment under the tested workload.")
                  : failSentence(s)}
                <span className="ml-2 text-[12px] text-faint">
                  {pass ? TERMS.verified.technical : TERMS.failed.technical}
                </span>
              </p>
            </div>
          </div>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
            {numbers.map((item) => (
              <BigFigure key={item.label} {...item} />
            ))}
          </dl>
        </div>
        {tiles && (
          <div className="hidden lg:block" aria-hidden>
            <StudentGrid
              items={tiles}
              expected={tiles.length}
              size="sm"
              caption={false}
              label="Final state"
            />
          </div>
        )}
      </div>
      <VerificationPill run={run} />
      <ul className="mt-3 flex flex-wrap gap-2">
        {CHECK_ORDER.map((id) => {
          const invariant = run.invariants?.find((item) => item.id === id);
          if (!invariant) return null;
          const ok = invariant.result === "PASS";
          const figure =
            id === "one_payment_per_entitlement"
              ? `${formatCount(s.double_paid)} paid twice`
              : id === "every_eligible_paid"
                ? `${formatCount(eligible - s.unpaid)}/${formatCount(eligible)}`
                : `${formatINR(s.spent_paise)} of ${formatINR(s.budget_paise)}`;
          return (
            <li
              key={id}
              title={`${invariant.title}: ${invariant.detail}`}
              className={cx(
                "card-quiet flex items-center gap-2 rounded-xl px-3 py-2",
                ok ? "border-paid/40" : "border-unpaid/40",
              )}
            >
              <span
                className={cx(
                  "figures inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-bold text-white",
                  ok ? "bg-paid" : "bg-unpaid",
                )}
              >
                <Icon name={ok ? "check" : "close"} size={12} strokeWidth={2.6} />
                {invariant.result}
              </span>
              <span className="text-[15px] font-semibold">{CHECK[id]?.primary ?? invariant.title}</span>
              <span className="figures text-[14px] text-muted">· {figure}</span>
              <span className="text-[11.5px] text-faint">{CHECK[id]?.technical}</span>
            </li>
          );
        })}
      </ul>
      {!pass && (
        <p className="mt-2 text-[14px] text-muted">
          {run.invariants?.find((item) => item.id === "budget_guard")?.result === "PASS"
            ? "The budget never overspent — the damage was who got the money."
            : ""}
        </p>
      )}
    </section>
  );
}

function failSentence(s: NonNullable<Run["summary"]>): string {
  if (s.double_paid > 0 && s.unpaid > 0)
    return "Repeats were paid again, and the fixed budget ran out before every eligible student was paid.";
  if (s.double_paid > 0) return "Some entitlements were paid more than once.";
  if (s.unpaid > 0) return "Some eligible students were not paid.";
  return "An integrity check failed.";
}

function BigFigure({
  value,
  format = formatCount,
  suffix,
  label,
  tone,
}: {
  value: number;
  format?: (v: number) => string;
  suffix?: string;
  label: string;
  tone?: string;
}) {
  const shown = useCountUp(value, 900);
  return (
    <div className="min-w-0">
      <dd
        className={cx(
          "figures text-[40px] leading-none font-semibold tracking-tight sm:text-[46px]",
          value > 0 ? tone : "text-ink",
        )}
      >
        {format(shown)}
        {suffix && <span className="text-[24px] text-muted">{suffix}</span>}
      </dd>
      <dt className="mt-1.5 text-[15px] text-muted">{label}</dt>
    </div>
  );
}

/** Two real examples from this run's rows, and the aggregate cause. */
function WhyItFailed({
  run,
  entitlements,
  deliveries,
  onSelect,
}: {
  run: Run;
  entitlements: StudentTile[];
  deliveries: ReplayDelivery[];
  onSelect?: (beneficiaryId: string) => void;
}) {
  const facts = inspect(entitlements, deliveries);
  const s = run.summary!;
  if (!facts.doublePaid && !facts.unpaid) return null;
  const exact = facts.unpaidStudents > 0 && s.misallocated_paise === facts.unpaidNeed;
  return (
    <section aria-label="Why it failed" className="mt-5">
      <h3 className="text-[20px] font-semibold">Why it failed</h3>
      <p className="text-[13px] text-faint">Two real students from this run</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {facts.doublePaid && (
          <Example
            tone="twice"
            student={facts.doublePaid.beneficiaryId}
            onSelect={onSelect}
            lead={`Should receive ${formatINR(facts.doublePaid.amount)} once.`}
            rows={facts.doublePaid.payments.map((row, index) => ({
              label: index === 0 ? "1st instruction" : `${ordinal(index + 1)} instruction (repeat)`,
              id: row.delivery_id,
              at: row.processed_at,
              result:
                index === 0
                  ? `paid ${formatINR(facts.doublePaid!.amount)}`
                  : `paid again ${formatINR(facts.doublePaid!.amount)}`,
            }))}
            close="Same entitlement, two payments."
          />
        )}
        {facts.unpaid && (
          <Example
            tone="unpaid"
            student={facts.unpaid.beneficiaryId}
            onSelect={onSelect}
            lead={`Eligible for ${formatINR(facts.unpaid.amount)}.`}
            rows={[
              {
                label: "Instruction",
                id: facts.unpaid.refusal.delivery_id,
                at: facts.unpaid.refusal.processed_at,
                result: `arrived after the budget ran out → ₹0`,
              },
            ]}
            close={
              typeof facts.unpaid.refusal.budget_remaining_paise_at_rejection === "number"
                ? `Budget left when it arrived: ${formatINR(facts.unpaid.refusal.budget_remaining_paise_at_rejection)}.`
                : "Not paid — budget ran out."
            }
          />
        )}
      </div>
      {facts.repeatPayments > 0 && facts.unpaidStudents > 0 && (
        <p className="mt-4 max-w-3xl text-[16px] leading-relaxed">
          The {formatCount(facts.repeatPayments)} repeat payments used{" "}
          <span className="figures font-semibold text-twice">{formatINR(s.misallocated_paise)}</span>.{" "}
          {exact ? (
            <>
              That&apos;s exactly the money the last {formatCount(facts.unpaidStudents)} eligible students
              needed.
            </>
          ) : (
            <>
              The {formatCount(facts.unpaidStudents)} eligible students left with ₹0 needed{" "}
              <span className="figures font-semibold text-unpaid">{formatINR(facts.unpaidNeed)}</span>, and
              the budget had run out before their instructions arrived.
            </>
          )}
        </p>
      )}
    </section>
  );
}

function ordinal(n: number): string {
  return n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

function Example({
  tone,
  student,
  lead,
  rows,
  close,
  onSelect,
}: {
  tone: "twice" | "unpaid";
  student: string;
  lead: string;
  rows: { label: string; id: string; at: string; result: string }[];
  close: string;
  onSelect?: (beneficiaryId: string) => void;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border bg-surface p-4",
        tone === "twice" ? "border-twice/40" : "border-unpaid/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cx(
            "figures rounded-md px-2 py-0.5 text-[15px] font-semibold",
            tone === "twice" ? "bg-twice-soft text-twice-text" : "bg-unpaid-soft text-unpaid-text",
          )}
        >
          {student} · {tone === "twice" ? "×2 Paid twice" : "₹0 Unpaid"}
        </span>
        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(student)}
            className="text-[13px] text-accent-text hover:underline"
          >
            Open student
          </button>
        )}
      </div>
      <p className="mt-3 text-[15px]">{lead}</p>
      <ol className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 text-[14.5px]">
            <span className="font-medium">{row.label}</span>
            <span className="figures text-[12px] text-faint" title={row.id}>
              {row.id.slice(0, 8)}… · {formatTimeMs(row.at)}
            </span>
            <span className="text-muted">→ {row.result}</span>
          </li>
        ))}
      </ol>
      <p className={cx("mt-2 text-[14.5px] font-medium", tone === "twice" ? "text-twice" : "text-unpaid")}>
        {close}
      </p>
    </div>
  );
}

function Incomplete({ run, arrived }: { run: Run; arrived: number }) {
  return (
    <section role="alert" className="rounded-2xl border border-twice/50 bg-twice-soft/40 p-5">
      <h3 className="text-[22px] font-semibold text-twice">
        Experiment incomplete — {formatCount(arrived)}/{formatCount(run.expected_deliveries)} instructions
        processed
      </h3>
      <p className="mt-1 text-[15px] text-muted">
        No verdict is shown for an incomplete run.{run.failure_message ? ` ${run.failure_message}` : ""}
      </p>
      {typeof run.dlq_depth_at_failure === "number" && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-twice/50 px-3 py-1.5 text-[15px]">
          Dead-letter queue depth
          <span className="figures text-[20px] font-semibold text-twice">{run.dlq_depth_at_failure}</span>
        </p>
      )}
    </section>
  );
}
