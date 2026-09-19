import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field } from "../../components/ui/Field";
import { HelpLink } from "../../components/ui/HelpLink";
import { inputClass } from "../../components/ui/formStyles";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { Table, Td, Th } from "../../components/ui/Table";
import { api, ApiError } from "../../lib/api/client";
import { keys, useBatches } from "../../lib/api/queries";
import { formatCount, formatDateTime, formatINR } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { CsvUpload } from "./CsvUpload";

export function BatchesPage() {
  useDocumentTitle("Batches");
  const batches = useBatches();
  const [mode, setMode] = useState<"generate" | "csv">("generate");

  return (
    <>
      <PageHeader
        title="Batches"
        description="A batch is a list of students and what each is owed; its budget is exactly enough to pay everyone once. The quickest way to test one is New test."
        actions={
          <>
            <HelpLink section="csv" label="CSV format" />
            <ButtonLink to="/new" variant="primary">
              New test
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <Card>
          <CardHeader title="All batches" />
          {batches.error ? (
            <ErrorState error={batches.error} onRetry={() => batches.refetch()} />
          ) : batches.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : (batches.data ?? []).length === 0 ? (
            <EmptyState title="No batches yet" body="Create one with the form on this page." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="text-right">Students</Th>
                  <Th className="text-right">Budget</Th>
                  <Th className="hidden sm:table-cell">Created</Th>
                </tr>
              </thead>
              <tbody>
                {(batches.data ?? []).map((batch) => (
                  <tr key={batch.batch_id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={`/batches/${batch.batch_id}`} className="font-medium hover:underline">
                        {batch.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge tone={batch.source === "demo" ? "accent" : "muted"}>{batch.source}</Badge>
                        <span className="figures text-[11.5px] text-faint">{batch.batch_id}</span>
                      </div>
                    </Td>
                    <Td className="figures text-right">{formatCount(batch.count)}</Td>
                    <Td className="figures text-right">{formatINR(batch.total_budget_paise)}</Td>
                    <Td className="hidden whitespace-nowrap text-muted sm:table-cell">
                      {formatDateTime(batch.created_at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            title="New batch"
            subtitle="Use synthetic data only — do not upload real student names, IDs or bank details."
          />
          <CardBody>
            <div
              role="tablist"
              aria-label="How to create the batch"
              className="mb-4 grid grid-cols-2 rounded-lg bg-surface-2 p-1"
            >
              {(["generate", "csv"] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={cx(
                    "h-8 rounded-md text-[13px] font-medium",
                    mode === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                  )}
                >
                  {value === "generate" ? "Generate" : "Upload CSV"}
                </button>
              ))}
            </div>
            {mode === "generate" ? <GenerateForm /> : <CsvUpload />}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function GenerateForm() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [count, setCount] = useState("100");
  const [rupees, setRupees] = useState("10000");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const parsedCount = Number(count);
  const parsedRupees = Number(rupees);
  const valid =
    Number.isInteger(parsedCount) &&
    parsedCount >= 1 &&
    parsedCount <= 500 &&
    Number.isInteger(parsedRupees) &&
    parsedRupees >= 1;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const { batch } = await api.generateBatch({
        name: name.trim() || undefined,
        // The form takes whole rupees; the API stores integer paise.
        generate: { count: parsedCount, amount_paise: parsedRupees * 100 },
      });
      await client.invalidateQueries({ queryKey: keys.batches });
      navigate(`/batches/${batch.batch_id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new Error("Could not create the batch."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name (optional)" htmlFor="batch-name">
        <input
          id="batch-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className={inputClass}
          placeholder="Generated batch"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Students (1–500)" htmlFor="batch-count">
          <input
            id="batch-count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className={cx(inputClass, "figures")}
          />
        </Field>
        <Field label="Amount each (₹)" htmlFor="batch-amount">
          <input
            id="batch-amount"
            inputMode="numeric"
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
            className={cx(inputClass, "figures")}
          />
        </Field>
      </div>
      <p className="text-[12px] text-muted">
        Budget:{" "}
        <span className="figures text-ink">{valid ? formatINR(parsedCount * parsedRupees * 100) : "—"}</span>.
        Names come from a fixed synthetic list.
      </p>
      {error !== null && <ErrorState error={error} compact />}
      <Button type="submit" variant="primary" disabled={!valid} loading={busy}>
        Create batch
      </Button>
    </form>
  );
}
