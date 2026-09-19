import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ButtonLink } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { SortableTh, Table, Td, Th } from "../../components/ui/Table";
import { RunOutcomeBadge } from "../../components/ui/VerdictBadge";
import { useRuns } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { formatDateTime, formatDuration, processorLabel, shortHash } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";

type SortKey = "time" | "processor" | "verdict" | "duration";

const sorters: Record<SortKey, (run: Run) => string | number> = {
  time: (run) => run.created_at,
  processor: (run) => run.processor,
  verdict: (run) => run.verdict ?? run.status,
  duration: (run) => run.duration_ms ?? Number.MAX_SAFE_INTEGER,
};

export function RunsHistoryPage() {
  useDocumentTitle("Runs");
  const runs = useRuns();
  const navigate = useNavigate();
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "time",
    direction: "desc",
  });

  const rows = useMemo(() => {
    const pick = sorters[sort.key];
    return [...(runs.data ?? [])].sort((x, y) => {
      const a = pick(x);
      const b = pick(y);
      const order = a < b ? -1 : a > b ? 1 : 0;
      return sort.direction === "asc" ? order : -order;
    });
  }, [runs.data, sort]);

  const toggle = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every experiment run, newest first. Each row links to its live view, drill-down and receipt."
      />
      <Card>
        {runs.error ? (
          <ErrorState error={runs.error} onRetry={() => runs.refetch()} />
        ) : runs.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="play"
            title="No runs yet"
            body="Start a vulnerable or protected run on the demo workload from the overview."
            action={
              <ButtonLink to="/" variant="primary">
                Go to overview
              </ButtonLink>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <SortableTh
                  active={sort.key === "time"}
                  direction={sort.direction}
                  onSort={() => toggle("time")}
                >
                  Started
                </SortableTh>
                <SortableTh
                  active={sort.key === "processor"}
                  direction={sort.direction}
                  onSort={() => toggle("processor")}
                >
                  Processor
                </SortableTh>
                <Th className="hidden md:table-cell">Batch</Th>
                <Th>Fingerprint</Th>
                <SortableTh
                  active={sort.key === "verdict"}
                  direction={sort.direction}
                  onSort={() => toggle("verdict")}
                >
                  Verdict
                </SortableTh>
                <Th className="hidden text-right sm:table-cell">Paid twice</Th>
                <Th className="hidden text-right sm:table-cell">Paid ₹0</Th>
                <SortableTh
                  active={sort.key === "duration"}
                  direction={sort.direction}
                  onSort={() => toggle("duration")}
                  className="text-right"
                >
                  Duration
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr
                  key={run.run_id}
                  className="cursor-pointer hover:bg-surface-2"
                  onClick={() => navigate(`/runs/${run.run_id}`)}
                >
                  <Td className="whitespace-nowrap">
                    <Link
                      to={`/runs/${run.run_id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {formatDateTime(run.created_at)}
                    </Link>
                  </Td>
                  <Td>{processorLabel(run.processor)}</Td>
                  <Td className="hidden max-w-[260px] truncate text-muted md:table-cell">{run.batch_name}</Td>
                  <Td className="figures text-[12.5px]">{shortHash(run.fingerprint, 10)}</Td>
                  <Td>
                    <RunOutcomeBadge run={run} />
                  </Td>
                  <Td className="figures hidden text-right sm:table-cell">
                    {run.summary?.double_paid ?? "—"}
                  </Td>
                  <Td className="figures hidden text-right sm:table-cell">{run.summary?.unpaid ?? "—"}</Td>
                  <Td className="figures text-right">{formatDuration(run.duration_ms)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
