import { useSearchParams } from "react-router";

import { Card, CardBody } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { useGoldenPair } from "../../lib/api/pairing";
import { useRuns } from "../../lib/api/queries";
import { formatDateTime, shortRunId } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR } from "../../lib/labels";
import { EvidencePanel } from "./EvidenceDrawer";

/** AWS evidence for one run (default: the recorded protected run of the golden test). */
export function EvidencePage() {
  useDocumentTitle("AWS evidence");
  const [params, setParams] = useSearchParams();
  const golden = useGoldenPair();
  const runs = useRuns();
  const runId = params.get("run") ?? golden.protected?.run_id ?? golden.unprotected?.run_id ?? undefined;
  return (
    <>
      <PageHeader
        eyebrow="Engineering · AWS evidence"
        title="Proof that AWS really ran it"
        description="The service path of one run, read live from Step Functions, SQS and CloudWatch Logs, plus the run's own records."
      />
      <Card className="mb-5">
        <CardBody>
          <label htmlFor="evidence-run" className="mb-1 block text-[13px] font-medium text-muted">
            Run
          </label>
          <select
            id="evidence-run"
            value={runId ?? ""}
            onChange={(event) => setParams({ run: event.target.value }, { replace: true })}
            className="figures h-10 w-full max-w-xl rounded-lg border border-line-strong bg-surface px-2 text-[13px]"
          >
            {!runId && <option value="">Select a run</option>}
            {(runs.data ?? []).map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {PROCESSOR[run.processor].primary} · {run.verdict ?? run.status} · {run.batch_name} ·{" "}
                {formatDateTime(run.created_at)} · {shortRunId(run.run_id)}
              </option>
            ))}
          </select>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          {runId ? (
            <EvidencePanel key={runId} runId={runId} />
          ) : golden.loading ? (
            <Skeleton className="h-96" />
          ) : (
            <EmptyState title="No runs yet" body="Run a test first; its AWS evidence appears here." />
          )}
        </CardBody>
      </Card>
    </>
  );
}
