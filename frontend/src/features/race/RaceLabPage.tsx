import { useState, type ReactNode } from "react";

import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, Td, Th } from "../../components/ui/Table";
import { useRace, useRaces, useStartRace } from "../../lib/api/queries";
import type { Race, RaceLane } from "../../lib/api/types";
import { formatDateTime, formatINR, formatTimeMs } from "../../lib/format";
import { useCountUp, useDocumentTitle } from "../../lib/hooks";

type RaceProcessor = "naive" | "protected";
const COPY_OPTIONS = [5, 10, 20];

/**
 * Race Lab: N copies of ONE payment released at the same instant (a Step Functions
 * Map state invokes the worker directly). Check-then-write versus one transaction.
 */
export function RaceLabPage() {
  useDocumentTitle("Concurrency Lab");
  const [copies, setCopies] = useState(20);
  const [raceId, setRaceId] = useState<string | undefined>();
  const start = useStartRace();
  const races = useRaces();
  const current = useRace(raceId ?? races.data?.[0]?.run_id);

  const launch = (processor: RaceProcessor) =>
    start.mutate({ processor, copies }, { onSuccess: (race) => setRaceId(race.run_id) });
  const busy = start.isPending || (current.data ? !current.data.race.is_terminal : false);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Engineering deep-dive · Concurrency Lab"
        title="What if 20 workers process the same payment at the same moment?"
        description="Copies of one payment instruction for one student, released together. Exactly one payment is correct. This is separate from the home story's test."
      />

      <section className="stage grid gap-6 rounded-3xl p-5 ring-1 ring-white/10 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <RaceOption
            title="Naive: check, then write"
            body="Checks whether the student is already paid, waits an injected 200 ms race window, then pays and records it. Copies that overlap inside the window all see “not paid” and all pay. (idempotency check, then write)"
            action={
              <Button
                onClick={() => launch("naive")}
                disabled={busy}
                loading={start.isPending && start.variables?.processor === "naive"}
              >
                <Icon name="play" /> Race check-then-write
              </Button>
            }
          />
          <RaceOption
            title="Protected: one transaction"
            body="Records “paid”, takes the budget and makes the payment in one all-or-nothing database step. Only one copy can ever succeed. (DynamoDB TransactWriteItems)"
            action={
              <Button
                variant="primary"
                className="glow-accent"
                onClick={() => launch("protected")}
                disabled={busy}
                loading={start.isPending && start.variables?.processor === "protected"}
              >
                <Icon name="shield" /> Race protected
              </Button>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>Copies</span>
            {COPY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCopies(option)}
                aria-pressed={copies === option}
                className={cx(
                  "figures h-8 min-w-10 rounded-lg border px-2 text-[13px]",
                  copies === option
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-line hover:text-ink",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          {start.error && <ErrorState error={start.error} compact />}
          <p className="text-[12px] leading-relaxed text-faint">
            Honest caveats: the naive result varies between attempts, because only copies that overlap inside
            the race window pay twice. Copies run six at a time because this account&apos;s Lambda concurrency
            quota is 10 and the API needs headroom; later waves usually find the payment already claimed.
          </p>
        </div>

        <div className="min-w-0">
          {current.data ? (
            <RaceResult
              race={current.data.race}
              lanes={current.data.lanes}
              paymentsSoFar={current.data.payments_so_far}
            />
          ) : current.error ? (
            <ErrorState error={current.error} compact />
          ) : (
            <EmptyState
              icon="play"
              title="No race yet"
              body="Start one on the left. It takes a few seconds."
            />
          )}
        </div>
      </section>

      <Card>
        <CardHeader
          title="Recent races"
          subtitle="Payments made for one student; anything above 1 is a double payment"
        />
        {(races.data ?? []).length === 0 ? (
          <CardBody className="text-[13px] text-muted">No races yet.</CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Processor</Th>
                <Th className="text-right">Copies</Th>
                <Th className="text-right">Payments</Th>
                <Th className="text-right">Overpaid</Th>
                <Th>Verdict</Th>
              </tr>
            </thead>
            <tbody>
              {(races.data ?? []).map((race) => (
                <tr
                  key={race.run_id}
                  className={cx(
                    "cursor-pointer hover:bg-surface-2",
                    race.run_id === current.data?.race.run_id && "bg-surface-2",
                  )}
                  onClick={() => setRaceId(race.run_id)}
                >
                  <Td className="whitespace-nowrap">{formatDateTime(race.created_at)}</Td>
                  <Td>{race.processor === "naive" ? "Check-then-write" : "Protected"}</Td>
                  <Td className="figures text-right">{race.copies}</Td>
                  <Td
                    className={cx(
                      "figures text-right font-medium",
                      (race.race?.payments ?? 0) > 1 && "text-unpaid-text",
                    )}
                  >
                    {race.race?.payments ?? "—"}
                  </Td>
                  <Td className="figures text-right">
                    {race.race ? formatINR(race.race.overpaid_paise) : "—"}
                  </Td>
                  <Td>{race.verdict ?? (race.status === "FAILED" ? "Failed" : "Running")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function RaceOption({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

function RaceResult({
  race,
  lanes,
  paymentsSoFar,
}: {
  race: Race;
  lanes: RaceLane[];
  paymentsSoFar: number;
}) {
  const payments = race.race?.payments ?? paymentsSoFar;
  const shown = useCountUp(payments, 700);
  const byCopy = new Map(lanes.map((lane) => [lane.copy_index, lane]));
  const bad = payments > 1;
  return (
    <div
      className={cx(
        "rise rounded-2xl border bg-surface p-5",
        bad ? "glow-danger border-unpaid/40" : payments === 1 ? "glow-success border-paid/40" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">
            {race.processor} · {race.copies} copies
            {race.race_window_ms ? ` · ${race.race_window_ms} ms race window` : ""}
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className={cx(
                "figures text-[64px] leading-none font-semibold",
                bad ? "text-unpaid" : payments === 1 ? "text-paid" : "text-ink",
              )}
            >
              {shown}
            </span>
            <span className="text-[14px] text-muted">
              payment{payments === 1 ? "" : "s"} for one entitlement
              {race.is_terminal ? "" : " so far"}
            </span>
          </div>
          {race.race && race.race.overpaid_paise > 0 && (
            <p className="mt-2 text-[14px] font-medium text-unpaid">
              {formatINR(race.race.overpaid_paise)} paid more than once
            </p>
          )}
        </div>
        {race.verdict && (
          <span
            className={cx(
              "figures -rotate-3 rounded-lg border-2 px-3 py-1 text-[18px] font-bold tracking-widest",
              race.verdict === "PASS" ? "border-paid text-paid" : "border-unpaid text-unpaid",
            )}
          >
            {race.verdict}
          </span>
        )}
      </div>

      <ol className="mt-5 grid grid-cols-5 gap-2 sm:grid-cols-10" aria-label="Copies">
        {Array.from({ length: race.copies }, (_, index) => {
          const lane = byCopy.get(index + 1);
          const paid = lane?.outcome === "COMMITTED";
          const suppressed = lane?.outcome === "DUPLICATE_SUPPRESSED";
          const label = lane
            ? `Copy ${index + 1}: ${paid ? "paid" : suppressed ? "repeat refused" : lane.outcome} at ${formatTimeMs(lane.processed_at)}`
            : `Copy ${index + 1}: pending`;
          return (
            <li key={index} title={label} aria-label={label}>
              <span
                key={lane?.outcome ?? "pending"}
                className={cx(
                  "figures grid aspect-square place-items-center rounded-lg text-[11px] font-semibold",
                  paid && "tile-enter bg-paid text-white",
                  suppressed && "tile-enter bg-accent-soft text-accent-text",
                  !lane && "tile-pending bg-pending text-pending-text",
                  bad && paid && "tile-alarm",
                )}
              >
                {paid ? "₹" : suppressed ? "✕" : index + 1}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-paid" aria-hidden /> paid
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-accent-soft" aria-hidden /> repeat refused
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-pending" aria-hidden /> pending
        </span>
      </div>
      {race.status === "FAILED" && (
        <p className="mt-3 text-[13px] text-unpaid-text">{race.failure_message ?? "The race failed."}</p>
      )}
    </div>
  );
}
