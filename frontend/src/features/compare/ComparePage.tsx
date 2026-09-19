import { Link, useSearchParams } from "react-router";

import { ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { HelpLink } from "../../components/ui/HelpLink";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useGoldenPair } from "../../lib/api/pairing";
import { useRun, useRuns, useStudents } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { formatCount, formatDateTime, shortHash, shortRunId } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR, TERMS } from "../../lib/labels";
import { METRIC_ROWS } from "../runs/runFacts";
import { StudentGrid } from "../runs/StudentGrid";
import { VersusHeader } from "./VersusHeader";

/**
 * Two runs side by side. Opened pre-paired (?a=unprotected&b=protected) from the home
 * story or from "Run both"; with no parameters it shows the golden recorded pair.
 */
export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const golden = useGoldenPair();
  const runs = useRuns();
  const a = params.get("a") ?? golden.unprotected?.run_id ?? undefined;
  const b = params.get("b") ?? golden.protected?.run_id ?? undefined;
  const runA = useRun(a);
  const runB = useRun(b);
  const ra = runA.data;
  const rb = runB.data;
  const same = Boolean(ra && rb && ra.fingerprint === rb.fingerprint);
  const different = Boolean(ra?.verdict && rb?.verdict && ra.verdict !== rb.verdict);
  const title = same && different ? "Same test. Different outcome." : "Compare two runs";
  useDocumentTitle(same && different ? "Same test, different outcome" : "Compare runs");

  const choose = (slot: "a" | "b", runId: string) => {
    const next = new URLSearchParams(params);
    if (a) next.set("a", a);
    if (b) next.set("b", b);
    next.set(slot, runId);
    setParams(next, { replace: true });
  };

  const choices = (runs.data ?? []).filter((run) => run.processor !== "naive");

  return (
    <>
      <PageHeader
        eyebrow="Engineering · Compare"
        title={title}
        description="Two runs of a test, side by side. Matching same-test proofs mean both processors saw exactly the same students, budget and repeats."
        actions={<HelpLink section="results" label="reading a result" />}
      />
      {!a && !b && !golden.loading ? (
        <Card>
          <EmptyState
            title="Nothing to compare yet"
            body="Run a test with both processors (New test → Run both), or watch the story on the home page first."
            action={<ButtonLink to="/new">Start a new test</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {(runA.error || runB.error) && <ErrorState error={runA.error ?? runB.error} compact />}
          {ra && rb ? <MatchBanner a={ra} b={rb} /> : <Skeleton className="h-16" />}
          {ra && rb && <VersusHeader a={ra} b={rb} />}
          {same && ra && rb && ra.processor !== rb.processor && (
            <p className="rounded-xl border border-line bg-surface px-5 py-4 text-[17px] leading-relaxed">
              <span className="font-semibold">What changed?</span> Not the students, the budget or the repeats
              — only how the processor handles a payment&apos;s identity.
            </p>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <GridCard run={ra} />
            <GridCard run={rb} />
          </div>

          <Card>
            <CardHeader
              title="Every number"
              subtitle="Computed by the backend from DynamoDB after each run; nothing here is typed in"
            />
            {ra && rb ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Measure</Th>
                    <Th className="text-right">{PROCESSOR[ra.processor].primary}</Th>
                    <Th className="text-right">{PROCESSOR[rb.processor].primary}</Th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => (
                    <tr key={row.key}>
                      <Td>
                        <span className="text-[14px]">{row.label}</span>
                        {row.technical && (
                          <span className="ml-2 text-[11.5px] text-faint">{row.technical}</span>
                        )}
                      </Td>
                      {[ra, rb].map((run) => (
                        <Td
                          key={run.run_id}
                          className={cx(
                            "figures text-right text-[14px] font-medium",
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

          <Card>
            <CardHeader
              title="Choose other runs"
              subtitle="Any two runs; the same-test proof tells you if the comparison is like for like"
            />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <RunPicker label="Left run" value={a} runs={choices} onChange={(id) => choose("a", id)} />
              <RunPicker label="Right run" value={b} runs={choices} onChange={(id) => choose("b", id)} />
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function MatchBanner({ a, b }: { a: Run; b: Run }) {
  const same = a.fingerprint === b.fingerprint;
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-5 py-3.5",
        same ? "border-paid/40 bg-paid-soft" : "border-twice/40 bg-twice-soft",
      )}
    >
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[15px] font-semibold text-white",
          same ? "bg-paid" : "bg-twice",
        )}
      >
        <Icon name={same ? "check" : "alert"} size={16} strokeWidth={2.4} />{" "}
        {same ? "Match" : "Different tests"}
      </span>
      <span className={cx("text-[15px]", same ? "text-paid-text" : "text-twice-text")}>
        {same
          ? a.processor !== b.processor
            ? "Same students. Same repeats. Same test. Only the processor changed."
            : "Same test, same processor: a repeat of the same run."
          : "These runs used different tests, so the comparison is not like for like."}
      </span>
      <span
        className="figures text-[13px] text-muted sm:ml-auto"
        title={`${a.fingerprint} / ${b.fingerprint}`}
      >
        {shortHash(a.fingerprint, 12)} {same ? "=" : "≠"} {shortHash(b.fingerprint, 12)}
      </span>
      <span className="w-full text-[12px] text-faint">
        {TERMS.fingerprint.primary}: {TERMS.fingerprint.technical} (SHA-256 of the test definition)
      </span>
    </div>
  );
}

function GridCard({ run }: { run: Run | undefined }) {
  const live = Boolean(run && !run.is_terminal);
  const students = useStudents(run?.run_id, live);
  if (!run) return <Skeleton className="h-96" />;
  const counts = students.data?.counts;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {PROCESSOR[run.processor].primary} processor <RunOutcomeBadge run={run} />
          </span>
        }
        subtitle={
          <Link to={`/runs/${run.run_id}`} className="figures hover:text-ink hover:underline">
            {shortRunId(run.run_id)} · {live ? "running now, updating" : formatDateTime(run.finished_at)}
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <StudentGrid
          items={students.data?.items}
          expected={run.logical_events}
          label={`${run.processor} run students`}
        />
        {counts && (
          <p className="figures text-[13px] text-muted">
            ✓ {formatCount(counts.paid_once)} paid once · ×2 {formatCount(counts.paid_twice)} paid twice · ₹0{" "}
            {formatCount(counts.unpaid)} unpaid
            {counts.pending ? ` · ${formatCount(counts.pending)} waiting` : ""}
          </p>
        )}
      </CardBody>
    </Card>
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
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="figures h-10 w-full rounded-lg border border-line-strong bg-surface px-2 text-[13px]"
      >
        {!value && <option value="">Select a run</option>}
        {options.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {run.processor ? `${PROCESSOR[run.processor].primary} · ${run.verdict ?? run.status} · ` : ""}
            {run.batch_name ? `${run.batch_name} · ` : ""}
            {run.created_at ? `${formatDateTime(run.created_at)} · ` : ""}
            {shortRunId(run.run_id)}
          </option>
        ))}
      </select>
    </div>
  );
}
