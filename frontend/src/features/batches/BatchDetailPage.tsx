import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { inputClass } from "../../components/ui/formStyles";
import { Hash } from "../../components/ui/Hash";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { api } from "../../lib/api/client";
import { keys, useBatch, useStartRun } from "../../lib/api/queries";
import type { Batch, Experiment, Processor } from "../../lib/api/types";
import { formatCount, formatDateTime, formatINR } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";

const PREVIEW_ROWS = 25;

export function BatchDetailPage() {
  const { batchId = "" } = useParams();
  const batch = useBatch(batchId);
  const [showAll, setShowAll] = useState(false);
  useDocumentTitle(batch.data?.batch.name ?? "Batch");

  if (batch.error) return <ErrorState error={batch.error} onRetry={() => batch.refetch()} />;
  if (!batch.data) return <Skeleton className="h-96" />;
  const { batch: meta, entitlements, experiments } = batch.data;
  const amounts = new Set(entitlements.map((e) => e.amount_paise));
  const rows = showAll ? entitlements : entitlements.slice(0, PREVIEW_ROWS);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/batches" className="hover:text-ink">
            Batches
          </Link>
        }
        title={meta.name}
        description={`${formatCount(meta.count)} entitlements · budget ${formatINR(meta.total_budget_paise)} · ${meta.scheme_id} · ${meta.academic_year}`}
        actions={<Badge tone={meta.source === "demo" ? "accent" : "muted"}>{meta.source}</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card>
          <CardHeader
            title="Entitlements"
            subtitle={
              <span className="flex items-center gap-1">
                Content SHA-256 <Hash value={meta.content_sha256} length={16} label="content hash" />
              </span>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Beneficiary</Th>
                <Th>Name</Th>
                <Th className="text-right">Installment</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entitlement) => (
                <tr key={`${entitlement.beneficiary_id}-${entitlement.installment}`}>
                  <Td className="figures">{entitlement.beneficiary_id}</Td>
                  <Td>{entitlement.display_name}</Td>
                  <Td className="figures text-right">{entitlement.installment}</Td>
                  <Td className="figures text-right">{formatINR(entitlement.amount_paise)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {entitlements.length > PREVIEW_ROWS && (
            <div className="px-4 py-3">
              <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show fewer" : `Show all ${formatCount(entitlements.length)}`}
              </Button>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <ExperimentForm batch={meta} unequalAmounts={amounts.size > 1} />
          <Card>
            <CardHeader title="Experiments on this batch" />
            {experiments.length === 0 ? (
              <EmptyState
                title="No experiments yet"
                body="Define one above, then run both processors on it."
              />
            ) : (
              <ul className="divide-y divide-line">
                {experiments.map((experiment) => (
                  <ExperimentRow key={experiment.experiment_id} experiment={experiment} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function ExperimentForm({ batch, unequalAmounts }: { batch: Batch; unequalAmounts: boolean }) {
  const client = useQueryClient();
  const max = Math.floor(batch.count / 2);
  const [seed, setSeed] = useState("FC-2026-0918");
  const [duplicates, setDuplicates] = useState(
    String(Math.max(1, Math.min(max, Math.round(batch.count * 0.12)))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const parsed = Number(duplicates);
  const valid = seed.trim().length > 0 && Number.isInteger(parsed) && parsed >= 1 && parsed <= max;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createExperiment({ batch_id: batch.batch_id, seed: seed.trim(), duplicate_count: parsed });
      await client.invalidateQueries({ queryKey: keys.batch(batch.batch_id) });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (max < 1) {
    return (
      <Card>
        <CardHeader title="Define a test" />
        <CardBody className="text-[13px] text-muted">
          A test needs at least 2 students, so that one instruction can be repeated.
        </CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Define a test"
        subtitle="The seed picks which payment instructions are sent twice. Same students + seed + count = the same test and fingerprint."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Seed" htmlFor="exp-seed">
              <input
                id="exp-seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                maxLength={64}
                className={cx(inputClass, "figures")}
              />
            </Field>
            <Field label={`Instructions sent twice (1–${max})`} htmlFor="exp-d">
              <input
                id="exp-d"
                inputMode="numeric"
                value={duplicates}
                onChange={(e) => setDuplicates(e.target.value)}
                className={cx(inputClass, "figures")}
              />
            </Field>
          </div>
          {unequalAmounts && (
            <p className="text-[12px] text-twice-text">
              Amounts differ between students, so how many students an unprotected run leaves unpaid is not
              fixed: it depends on the order SQS delivers the instructions.
            </p>
          )}
          {error !== null && <ErrorState error={error} compact />}
          <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
            Define test
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  const navigate = useNavigate();
  const start = useStartRun();
  const launch = (processor: Processor) =>
    start.mutate(
      { experimentId: experiment.experiment_id, processor },
      { onSuccess: (run) => navigate(`/runs/${run.run_id}`) },
    );
  return (
    <li className="space-y-2 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="figures">
          seed {experiment.seed} · {experiment.duplicate_count} sent twice · {experiment.expected_deliveries}{" "}
          instructions
        </span>
        <span className="text-[12px] text-faint">{formatDateTime(experiment.created_at)}</span>
      </div>
      <Hash value={experiment.fingerprint} length={24} label="fingerprint" />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => launch("vulnerable")}
          loading={start.isPending && start.variables?.processor === "vulnerable"}
        >
          Run unprotected
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => launch("protected")}
          loading={start.isPending && start.variables?.processor === "protected"}
        >
          Run protected
        </Button>
      </div>
      {start.error && <ErrorState error={start.error} compact />}
    </li>
  );
}
