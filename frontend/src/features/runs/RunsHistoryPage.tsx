import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { HelpLink } from "../../components/ui/HelpLink";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { SortableTh, Table, Td, Th } from "../../components/ui/Table";
import { useRuns } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { formatCount, formatDateTime, formatDuration, shortRunId } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR } from "../../lib/labels";

type SortKey = "time" | "batch" | "scenario" | "processor" | "verdict" | "duration";
type Status = "running" | "passed" | "failed" | "incomplete";

const STATUS: Record<Status, { label: string; tone: "accent" | "success" | "danger" | "warning" }> = {
  running: { label: "Running", tone: "accent" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  incomplete: { label: "Incomplete", tone: "warning" },
};

function statusOf(run: Run): Status {
  if (!run.is_terminal) return "running";
  if (run.verdict === "PASS") return "passed";
  if (run.verdict === "FAIL") return "failed";
  return "incomplete";
}

const sorters: Record<SortKey, (run: Run) => string | number> = {
  time: (run) => run.created_at,
  batch: (run) => run.batch_name,
  scenario: (run) => run.duplicate_count / Math.max(1, run.logical_events),
  processor: (run) => run.processor,
  verdict: (run) => statusOf(run),
  duration: (run) => run.duration_ms ?? Number.MAX_SAFE_INTEGER,
};

/** Every run, newest first: sortable, filterable, searchable; running rows update live. */
export function RunsHistoryPage() {
  useDocumentTitle("My runs");
  const runs = useRuns();
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "time",
    direction: "desc",
  });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");

  const all = useMemo(() => runs.data ?? [], [runs.data]);
  const counts = useMemo(() => {
    const result: Record<Status, number> = { running: 0, passed: 0, failed: 0, incomplete: 0 };
    for (const run of all) result[statusOf(run)] += 1;
    return result;
  }, [all]);

  const q = query.trim().toUpperCase();
  const rows = useMemo(() => {
    const pick = sorters[sort.key];
    return all
      .filter((run) => status === "all" || statusOf(run) === status)
      .filter(
        (run) =>
          !q ||
          run.run_id.toUpperCase().includes(q) ||
          (run.summary?.double_paid_beneficiary_ids ?? []).includes(q) ||
          (run.summary?.unpaid_beneficiary_ids ?? []).includes(q),
      )
      .sort((x, y) => {
        const a = pick(x);
        const b = pick(y);
        const order = a < b ? -1 : a > b ? 1 : 0;
        return sort.direction === "asc" ? order : -order;
      });
  }, [all, sort, status, q]);

  const toggle = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));

  return (
    <>
      <PageHeader
        title="My runs"
        description="Every test run on this deployment, newest first. Click a row for its results, affected students and receipt."
        actions={
          <>
            <HelpLink section="first-test" label="running a test" />
            <ButtonLink to="/new" variant="primary">
              <Icon name="play" /> New test
            </ButtonLink>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="relative">
            <label htmlFor="run-search" className="sr-only">
              Search by run ID or student ID
            </label>
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <input
              id="run-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Run ID or student ID (e.g. STU-042)"
              className="figures h-10 w-72 rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-[14px] placeholder:text-faint"
            />
          </div>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {(["all", "running", "passed", "failed", "incomplete"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={cx(
                  "h-8 rounded-full border px-3 text-[13px] font-medium",
                  status === value
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                {value === "all"
                  ? `All ${formatCount(all.length)}`
                  : `${STATUS[value].label} ${formatCount(counts[value])}`}
              </button>
            ))}
          </div>
          {q.startsWith("STU") && (
            <p className="w-full text-[12.5px] text-muted">
              A student ID finds the runs where that student was paid twice or got ₹0.
            </p>
          )}
        </div>
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
        ) : runs.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon="play"
            title="No runs yet — start a new test"
            body="A test runs both processors on the same students and repeats, then checks every student's result."
            action={
              <ButtonLink to="/new" variant="primary">
                New test
              </ButtonLink>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="search"
            title="No runs match"
            body="Try another ID, or clear the filters."
            action={
              <ButtonLink
                to="/runs"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Clear filters
              </ButtonLink>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <SortableTh
                    active={sort.key === "time"}
                    direction={sort.direction}
                    onSort={() => toggle("time")}
                  >
                    Time
                  </SortableTh>
                  <SortableTh
                    active={sort.key === "batch"}
                    direction={sort.direction}
                    onSort={() => toggle("batch")}
                  >
                    Batch
                  </SortableTh>
                  <SortableTh
                    active={sort.key === "scenario"}
                    direction={sort.direction}
                    onSort={() => toggle("scenario")}
                  >
                    Scenario
                  </SortableTh>
                  <SortableTh
                    active={sort.key === "processor"}
                    direction={sort.direction}
                    onSort={() => toggle("processor")}
                  >
                    Processor
                  </SortableTh>
                  <SortableTh
                    active={sort.key === "verdict"}
                    direction={sort.direction}
                    onSort={() => toggle("verdict")}
                  >
                    Result
                  </SortableTh>
                  <SortableTh
                    active={sort.key === "duration"}
                    direction={sort.direction}
                    onSort={() => toggle("duration")}
                    className="text-right"
                  >
                    Duration
                  </SortableTh>
                  <Th className="sr-only">Open</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => {
                  const state = statusOf(run);
                  return (
                    <tr
                      key={run.run_id}
                      className="cursor-pointer hover:bg-surface-2"
                      onClick={() => navigate(`/runs/${run.run_id}`)}
                    >
                      <Td className="whitespace-nowrap">
                        <span className="block">{formatDateTime(run.created_at)}</span>
                        <span className="figures text-[12px] text-faint">{shortRunId(run.run_id)}</span>
                      </Td>
                      <Td className="max-w-[220px] truncate" title={run.batch_name}>
                        {run.batch_name}
                      </Td>
                      <Td className="figures whitespace-nowrap">
                        {formatCount(run.duplicate_count)} of {formatCount(run.logical_events)} repeated
                      </Td>
                      <Td>{PROCESSOR[run.processor].primary}</Td>
                      <Td>
                        <Badge tone={STATUS[state].tone}>
                          {state === "running" && (
                            <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
                          )}
                          {state === "passed" ? "✓ " : state === "failed" ? "✕ " : ""}
                          {STATUS[state].label}
                          {state === "running" ? ` ${run.delivered_count}/${run.expected_deliveries}` : ""}
                        </Badge>
                      </Td>
                      <Td className="figures text-right whitespace-nowrap">
                        {formatDuration(run.duration_ms)}
                      </Td>
                      <Td>
                        <Link
                          to={`/runs/${run.run_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="text-[13px] text-accent-text hover:underline"
                          aria-label={`Open run ${run.run_id}`}
                        >
                          Open
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-[13px] text-muted">
        Shows the latest 100 runs. Runs are public on this demo deployment: anyone with the link can view
        them.
      </p>
    </>
  );
}
