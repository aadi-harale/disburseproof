import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { Button, ButtonLink } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { cx } from "../../components/ui/cx";
import { ErrorState } from "../../components/ui/ErrorState";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { api, ApiError } from "../../lib/api/client";
import { keys, useBatches, useOverview, useRun } from "../../lib/api/queries";
import type { Batch, CsvPreview, Experiment, Processor, Run } from "../../lib/api/types";
import { downloadText } from "../../lib/csv";
import { formatCount, formatINR, shortHash, shortRunId } from "../../lib/format";
import { useDocumentTitle } from "../../lib/hooks";
import { PROCESSOR, TERMS } from "../../lib/labels";
import { CSV_COLUMNS, MAX_CSV_CHARACTERS, MAX_ROWS, plainRowErrors, TEMPLATE_CSV } from "./csvHelp";

type Source = "demo" | "generate" | "csv" | "saved";
const SEED_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const PRESETS = [
  { label: "Small retry wave", share: 0.05 },
  { label: "Heavy retry storm", share: 0.25 },
  { label: "Max stress", share: 0.5 },
];

/**
 * New test: choose students → choose the retry scenario → run. Every step calls the
 * existing API (POST /batches, POST /experiments, POST /runs); nothing is simulated.
 */
export function NewTestPage() {
  useDocumentTitle("New test");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [experiment, setExperiment] = useState<Experiment | null>(null);

  return (
    <>
      <PageHeader
        title="New test"
        description="Test both processors on your own students and retry scenario. Three steps; about a minute."
        actions={
          <Link
            to="/docs#first-test"
            className="inline-flex items-center gap-1 text-[14px] text-accent-text hover:underline"
          >
            <Icon name="info" size={15} /> How this works
          </Link>
        }
      />
      <ol className="mb-5 grid gap-2 sm:grid-cols-3" aria-label="Steps">
        {["Choose students", "Choose the retry scenario", "Run"].map((label, index) => {
          const n = (index + 1) as 1 | 2 | 3;
          return (
            <li
              key={label}
              aria-current={step === n ? "step" : undefined}
              className={cx(
                "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[14px]",
                step === n
                  ? "border-accent bg-accent-soft font-semibold text-accent-text"
                  : "border-line text-muted",
              )}
            >
              <span
                className={cx(
                  "figures grid size-6 place-items-center rounded-full text-[12px]",
                  step > n ? "bg-paid text-white" : step === n ? "bg-accent text-on-accent" : "bg-surface-2",
                )}
              >
                {step > n ? "✓" : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <StepStudents
          initial={batch}
          onNext={(chosen) => {
            if (chosen.batch_id !== batch?.batch_id) setExperiment(null);
            setBatch(chosen);
            setStep(2);
          }}
        />
      )}
      {step === 2 && batch && (
        <StepScenario
          batch={batch}
          initial={experiment}
          onBack={() => setStep(1)}
          onNext={(created) => {
            setExperiment(created);
            setStep(3);
          }}
        />
      )}
      {step === 3 && batch && experiment && (
        <StepRun batch={batch} experiment={experiment} onBack={() => setStep(2)} />
      )}
    </>
  );
}

/* ---- Step 1 --------------------------------------------------------------- */

function StepStudents({ initial, onNext }: { initial: Batch | null; onNext: (batch: Batch) => void }) {
  const overview = useOverview();
  const demo = overview.data?.demo.batch ?? null;
  const [source, setSource] = useState<Source>("demo");
  const options: { value: Source; title: string; body: string }[] = [
    {
      value: "demo",
      title: "Demo batch",
      body: demo
        ? `${formatCount(demo.count)} students · ${formatINR(demo.total_budget_paise)}`
        : "The golden test's students",
    },
    { value: "generate", title: "Generate students", body: "Pick how many and how much each" },
    { value: "csv", title: "Upload a CSV", body: "Your own synthetic list, up to 500 rows" },
    { value: "saved", title: "A saved batch", body: "One you created before" },
  ];
  return (
    <Card>
      <CardBody className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-[16px] font-semibold">Who is being paid?</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {options.map((option) => (
              <label
                key={option.value}
                className={cx(
                  "cursor-pointer rounded-xl border px-4 py-3 focus-within:ring-2 focus-within:ring-focus",
                  source === option.value ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2",
                )}
              >
                <input
                  type="radio"
                  name="source"
                  value={option.value}
                  checked={source === option.value}
                  onChange={() => setSource(option.value)}
                  className="sr-only"
                />
                <span className="block text-[15px] font-semibold">{option.title}</span>
                <span className="block text-[13px] text-muted">{option.body}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {source === "demo" &&
          (demo ? (
            <NextBar onNext={() => onNext(demo)} label="Use the demo batch" />
          ) : (
            <Skeleton className="h-10 w-48" />
          ))}
        {source === "generate" && <GenerateStep onCreated={onNext} />}
        {source === "csv" && <CsvStep onCreated={onNext} />}
        {source === "saved" && <SavedStep initial={initial} onPick={onNext} />}
      </CardBody>
    </Card>
  );
}

function NextBar({
  onNext,
  label = "Next",
  disabled,
  reason,
  loading,
  back,
}: {
  onNext: () => void;
  label?: string;
  disabled?: boolean;
  reason?: string | null;
  loading?: boolean;
  back?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      {back && (
        <Button onClick={back}>
          <Icon name="arrowRight" size={14} className="rotate-180" /> Back
        </Button>
      )}
      <Button variant="primary" onClick={onNext} disabled={disabled} loading={loading}>
        {label} <Icon name="arrowRight" size={14} />
      </Button>
      {disabled && reason && <span className="text-[13px] text-muted">{reason}</span>}
    </div>
  );
}

function FieldRow({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[14px] font-medium">
        {label}
        {required && (
          <span className="text-unpaid-text" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-[13px] text-unpaid-text">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>
      )}
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] placeholder:text-faint aria-[invalid=true]:border-unpaid";

function useCreate<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<T>, done: (value: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      done(await fn());
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function GenerateStep({ onCreated }: { onCreated: (batch: Batch) => void }) {
  const client = useQueryClient();
  const [count, setCount] = useState("250");
  const [rupees, setRupees] = useState("10000");
  const [name, setName] = useState("");
  const create = useCreate<Batch>();
  const n = Number(count);
  const r = Number(rupees);
  const countError =
    count.trim() === ""
      ? "Enter how many students."
      : !Number.isInteger(n) || n < 2 || n > 500
        ? "A whole number from 2 to 500."
        : null;
  const amountError =
    rupees.trim() === ""
      ? "Enter an amount."
      : !Number.isInteger(r) || r < 1 || r > 1_00_00_000
        ? "Whole rupees, from ₹1 to ₹1,00,00,000."
        : null;
  const reason = countError ?? amountError;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldRow id="gen-count" label="Students" required hint="2 to 500" error={countError}>
          <input
            id="gen-count"
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-invalid={Boolean(countError)}
            aria-describedby={countError ? "gen-count-error" : undefined}
            className={cx(input, "figures")}
          />
        </FieldRow>
        <FieldRow id="gen-amount" label="Amount each (₹)" required hint="Whole rupees" error={amountError}>
          <input
            id="gen-amount"
            inputMode="numeric"
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
            aria-invalid={Boolean(amountError)}
            aria-describedby={amountError ? "gen-amount-error" : undefined}
            className={cx(input, "figures")}
          />
        </FieldRow>
        <FieldRow id="gen-name" label="Name" hint="Optional">
          <input
            id="gen-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className={input}
            placeholder="Generated batch"
          />
        </FieldRow>
      </div>
      <p className="text-[14px] text-muted">
        Budget:{" "}
        <span className="figures font-semibold text-ink">{reason ? "—" : formatINR(n * r * 100)}</span> —
        exactly enough to pay everyone once. Names come from a fixed synthetic list.
      </p>
      {create.error !== null && <ErrorState error={create.error} compact />}
      <NextBar
        label="Create students and continue"
        disabled={Boolean(reason)}
        reason={reason ? `Fix the form first: ${reason}` : null}
        loading={create.busy}
        onNext={() =>
          create.run(
            async () =>
              (
                await api.generateBatch({
                  name: name.trim() || undefined,
                  generate: { count: n, amount_paise: r * 100 },
                })
              ).batch,
            (batch) => {
              void client.invalidateQueries({ queryKey: keys.batches });
              onCreated(batch);
            },
          )
        }
      />
    </div>
  );
}

function CsvStep({ onCreated }: { onCreated: (batch: Batch) => void }) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<unknown>(null);
  const create = useCreate<Batch>();
  const tooBig = text.length > MAX_CSV_CHARACTERS;

  // Validate on the server as the user types (a dry run writes nothing and uses no allowance).
  useEffect(() => {
    if (!text.trim() || tooBig) return;
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setChecking(true);
      try {
        const result = (await api.previewCsv(text)).preview;
        if (!cancelled) {
          setPreview(result);
          setCheckError(null);
        }
      } catch (caught) {
        if (!cancelled) setCheckError(caught);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [text, tooBig]);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSV_CHARACTERS) {
      setFileNote(
        `${file.name} is ${Math.round(file.size / 1024)} KB. The limit is ${MAX_CSV_CHARACTERS / 1000} KB (about ${MAX_ROWS} rows). Nothing was loaded.`,
      );
      return;
    }
    setFileNote(`Loaded ${file.name}. You can fix any problem directly in the box below.`);
    setPreview(null);
    setText(await file.text());
  };

  const rowProblems = (preview?.rows ?? []).flatMap(plainRowErrors);
  const fileProblems = (preview?.errors ?? [])
    .filter((error) => !preview?.rows.some((row) => row.line === error.line))
    .map(
      (error) =>
        `${error.line ? `Line ${error.line}: ` : ""}${error.field === "header" ? "the header row has " : `${error.field} `}${error.message}`,
    );
  const reason = !text.trim()
    ? "Choose a file or paste CSV text."
    : tooBig
      ? "The text is over the size limit."
      : checking || !preview
        ? "Checking the file…"
        : !preview.valid
          ? `Fix the ${formatCount(rowProblems.length + fileProblems.length)} problem${rowProblems.length + fileProblems.length === 1 ? "" : "s"} listed below.`
          : null;

  return (
    <div className="space-y-4">
      <p
        role="note"
        className="rounded-lg border border-twice/40 bg-twice-soft px-3 py-2 text-[14px] text-twice-text"
      >
        Use synthetic data only — do not upload real student names, IDs or bank details.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-[14px] font-medium hover:bg-surface-2 focus-within:ring-2 focus-within:ring-focus">
          <Icon name="upload" size={15} /> Choose a CSV file
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
        </label>
        <Button onClick={() => downloadText("disburseproof-template.csv", TEMPLATE_CSV + "\r\n")}>
          <Icon name="download" /> Download the template
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setText(TEMPLATE_CSV);
            setFileNote("Template loaded. Edit it or replace it with your own.");
          }}
        >
          Start from the template
        </Button>
      </div>
      {fileNote && <p className="text-[13px] text-muted">{fileNote}</p>}
      <FieldRow
        id="csv-text"
        label="CSV"
        required
        hint={
          <>
            Columns <span className="figures">{CSV_COLUMNS.join(",")}</span>. Amount is in paise (₹10,000 =
            1000000). Up to {MAX_ROWS} rows; each student + installment once.{" "}
            <Link to="/docs#csv" className="text-accent-text hover:underline">
              CSV format
            </Link>
          </>
        }
        error={
          tooBig
            ? `This is ${formatCount(text.length)} characters; the limit is ${formatCount(MAX_CSV_CHARACTERS)}.`
            : null
        }
      >
        <textarea
          id="csv-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          spellCheck={false}
          aria-invalid={tooBig || (preview ? !preview.valid : undefined)}
          className="figures w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13px] placeholder:text-faint"
          placeholder={TEMPLATE_CSV}
        />
      </FieldRow>
      {checkError !== null && <ErrorState error={checkError} compact />}
      {preview && text.trim() && !tooBig && (
        <div className="space-y-2" aria-live="polite">
          <p className="text-[14px]">
            {preview.valid ? (
              <span className="font-semibold text-paid-text">✓ Looks good.</span>
            ) : (
              <span className="font-semibold text-unpaid-text">
                {formatCount(rowProblems.length + fileProblems.length)} problem
                {rowProblems.length + fileProblems.length === 1 ? "" : "s"} to fix.
              </span>
            )}{" "}
            <span className="text-muted">
              {formatCount(preview.entitlements)} valid rows · budget{" "}
              <span className="figures text-ink">{formatINR(preview.total_budget_paise)}</span>
              {checking ? " · checking…" : ""}
            </span>
          </p>
          {(fileProblems.length > 0 || rowProblems.length > 0) && (
            <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border border-unpaid/30 bg-unpaid-soft px-3 py-2 text-[13.5px] text-unpaid-text">
              {[...fileProblems, ...rowProblems].slice(0, 50).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Line</th>
                    {CSV_COLUMNS.map((column) => (
                      <th key={column} className="px-2 py-1.5 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.slice(0, 100).map((row) => (
                    <tr key={row.line} className={cx(row.errors.length > 0 && "bg-unpaid-soft")}>
                      <td className="figures px-2 py-1 text-faint">{row.line}</td>
                      {row.values.raw !== undefined ? (
                        <td colSpan={4} className="figures px-2 py-1">
                          {row.values.raw}
                        </td>
                      ) : (
                        CSV_COLUMNS.map((column) => (
                          <td key={column} className="figures max-w-[180px] truncate px-2 py-1">
                            {row.values[column]}
                          </td>
                        ))
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <FieldRow id="csv-name" label="Name" hint="Optional">
        <input
          id="csv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className={cx(input, "sm:max-w-sm")}
          placeholder="Uploaded batch"
        />
      </FieldRow>
      {create.error !== null && <ErrorState error={create.error} compact />}
      <NextBar
        label="Save students and continue"
        disabled={Boolean(reason)}
        reason={reason}
        loading={create.busy}
        onNext={() =>
          create.run(
            async () => (await api.uploadCsv({ csv: text, name: name.trim() || undefined })).batch,
            (batch) => {
              void client.invalidateQueries({ queryKey: keys.batches });
              onCreated(batch);
            },
          )
        }
      />
    </div>
  );
}

function SavedStep({ initial, onPick }: { initial: Batch | null; onPick: (batch: Batch) => void }) {
  const batches = useBatches();
  const [id, setId] = useState(initial?.batch_id ?? "");
  const list = batches.data ?? [];
  const chosen = list.find((batch) => batch.batch_id === id) ?? null;
  if (batches.error) return <ErrorState error={batches.error} compact />;
  if (batches.isLoading) return <Skeleton className="h-10" />;
  if (list.length === 0)
    return <p className="text-[14px] text-muted">No saved batches yet — generate or upload one.</p>;
  return (
    <div className="space-y-4">
      <FieldRow id="saved-batch" label="Batch" required>
        <select
          id="saved-batch"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className={cx(input, "sm:max-w-lg")}
        >
          <option value="">Select a batch</option>
          {list.map((batch) => (
            <option key={batch.batch_id} value={batch.batch_id}>
              {batch.name} · {formatCount(batch.count)} rows · {formatINR(batch.total_budget_paise)}
            </option>
          ))}
        </select>
      </FieldRow>
      <NextBar onNext={() => chosen && onPick(chosen)} disabled={!chosen} reason="Select a batch first." />
    </div>
  );
}

/* ---- Step 2 --------------------------------------------------------------- */

function StepScenario({
  batch,
  initial,
  onBack,
  onNext,
}: {
  batch: Batch;
  initial: Experiment | null;
  onBack: () => void;
  onNext: (experiment: Experiment) => void;
}) {
  const overview = useOverview();
  const golden = overview.data?.demo.experiment;
  const isDemo = batch.source === "demo";
  const n = batch.count;
  const max = Math.floor(n / 2);
  const [count, setCount] = useState(
    String(
      initial?.duplicate_count ??
        (isDemo && golden ? golden.duplicate_count : Math.max(1, Math.round(n * 0.12))),
    ),
  );
  const [seed, setSeed] = useState(initial?.seed ?? (isDemo && golden ? golden.seed : "my-test-1"));
  const create = useCreate<Experiment>();
  const d = Number(count);
  const countError =
    !Number.isInteger(d) || d < 1 || d > max
      ? `A whole number from 1 to ${formatCount(max)} (half of ${formatCount(n)}).`
      : null;
  const seedError = !SEED_PATTERN.test(seed) ? "1–64 letters, digits, '.', '_', ':' or '-'." : null;
  const reason = max < 1 ? "A test needs at least 2 students." : (countError ?? seedError);

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-[16px] font-semibold">How many payment instructions get sent twice?</h2>
          <p className="text-[14px] text-muted">
            {batch.name} · {formatCount(n)} students · budget {formatINR(batch.total_budget_paise)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
          {PRESETS.map((preset) => {
            const value = Math.min(max, Math.max(1, Math.round(n * preset.share)));
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setCount(String(value))}
                className={cx(
                  "rounded-lg border px-3 py-2 text-left text-[14px]",
                  d === value
                    ? "border-accent bg-accent-soft text-accent-text"
                    : "border-line hover:bg-surface-2",
                )}
              >
                <span className="block font-medium">{preset.label}</span>
                <span className="figures block text-[12.5px] text-muted">
                  {Math.round(preset.share * 100)}% · {formatCount(value)} repeat{value === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
          <FieldRow
            id="dup-count"
            label="Repeated instructions"
            required
            hint={`From 1 to ${formatCount(max)}. At most half the students, so every test has both repeated and single instructions.`}
            error={countError}
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={Math.max(1, max)}
                value={Number.isInteger(d) ? Math.min(Math.max(d, 1), max) : 1}
                onChange={(e) => setCount(e.target.value)}
                aria-label="Repeated instructions (slider)"
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
              <input
                id="dup-count"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                aria-invalid={Boolean(countError)}
                className="figures h-10 w-28 shrink-0 rounded-lg border border-line-strong bg-surface px-3 text-[14px] aria-[invalid=true]:border-unpaid"
              />
            </div>
          </FieldRow>
          <FieldRow
            id="seed"
            label="Seed"
            required
            hint="Why a seed? It picks which students' instructions are repeated. Same students + same seed + same count = the same test, with the same fingerprint."
            error={seedError}
          >
            <input
              id="seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              aria-invalid={Boolean(seedError)}
              className={cx(input, "figures")}
            />
          </FieldRow>
        </div>
        {!countError && (
          <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[16px]" aria-live="polite">
            Of <span className="figures font-semibold">{formatCount(n)}</span> instructions,{" "}
            <span className="figures font-semibold text-twice">{formatCount(d)}</span> will be sent twice →{" "}
            <span className="figures font-semibold">{formatCount(n + d)}</span> arrivals. A correct processor
            still makes exactly {formatCount(n)} payments.
          </p>
        )}
        {create.error !== null && <ErrorState error={create.error} compact />}
        <NextBar
          back={onBack}
          label="Create the test"
          disabled={Boolean(reason)}
          reason={reason ? `Fix the form first: ${reason}` : null}
          loading={create.busy}
          onNext={() =>
            create.run(
              async () =>
                (await api.createExperiment({ batch_id: batch.batch_id, seed, duplicate_count: d }))
                  .experiment,
              onNext,
            )
          }
        />
      </CardBody>
    </Card>
  );
}

/* ---- Step 3 --------------------------------------------------------------- */

function isBusy(error: unknown) {
  return error instanceof ApiError && (error.status === 409 || error.status === 429);
}

function StepRun({
  batch,
  experiment,
  onBack,
}: {
  batch: Batch;
  experiment: Experiment;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const overview = useOverview();
  const [busy, setBusy] = useState<"both" | Processor | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [first, setFirst] = useState<Run | null>(null);
  const active = overview.data?.active_runs.length ?? 0;
  const limit = overview.data?.max_active_runs ?? 2;
  const full = active >= limit;

  const start = (processor: Processor) =>
    api.startRun(experiment.experiment_id, processor).then((r) => r.run);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: keys.runs });
    void client.invalidateQueries({ queryKey: keys.overview });
  };

  const runBoth = async () => {
    setBusy("both");
    setError(null);
    let unprotected: Run | null = null;
    try {
      unprotected = await start("vulnerable");
      const protectedRun = await start("protected");
      refresh();
      navigate(`/compare?a=${unprotected.run_id}&b=${protectedRun.run_id}`);
    } catch (caught) {
      refresh();
      if (unprotected) setFirst(unprotected);
      setError(caught);
    } finally {
      setBusy(null);
    }
  };
  const runOne = async (processor: Processor) => {
    setBusy(processor);
    setError(null);
    try {
      const run = await start(processor);
      refresh();
      navigate(`/runs/${run.run_id}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardBody className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h2 className="text-[16px] font-semibold">Your test</h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
              <dt className="text-muted">Students</dt>
              <dd className="figures">
                {formatCount(experiment.logical_events)} · {batch.name}
              </dd>
              <dt className="text-muted">Budget</dt>
              <dd className="figures">{formatINR(batch.total_budget_paise)}</dd>
              <dt className="text-muted">Sent twice</dt>
              <dd className="figures">
                {formatCount(experiment.duplicate_count)} → {formatCount(experiment.expected_deliveries)}{" "}
                arrivals
              </dd>
              <dt className="text-muted">Seed</dt>
              <dd className="figures">{experiment.seed}</dd>
            </dl>
          </div>
          <div className="rounded-xl border border-paid/40 bg-paid-soft px-4 py-3">
            <div className="text-[13px] font-medium text-paid-text">{TERMS.fingerprint.primary}</div>
            <div className="figures mt-1 text-[18px] font-semibold break-all" title={experiment.fingerprint}>
              {shortHash(experiment.fingerprint, 24)}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              Both processors will run exactly this test. The fingerprint ({TERMS.fingerprint.technical},
              SHA-256 of the test definition) proves it.
            </p>
          </div>
        </div>

        {full && !first && (
          <p className="rounded-lg border border-twice/40 bg-twice-soft px-3 py-2 text-[14px] text-twice-text">
            {formatCount(active)} live run{active === 1 ? " is" : "s are"} in progress (the public limit is{" "}
            {formatCount(limit)} at a time). The buttons unlock when one finishes — usually within 15 seconds.
          </p>
        )}

        {error !== null &&
          (isBusy(error) ? (
            <div
              role="alert"
              className="rounded-lg border border-twice/40 bg-twice-soft px-4 py-3 text-[14px]"
            >
              <p className="font-semibold text-twice-text">
                {first ? "Only the unprotected run could start right now." : "Live runs are busy right now."}
              </p>
              <p className="mt-1 text-muted">{(error as ApiError).message}</p>
              {first && (
                <p className="mt-1 text-muted">
                  Nothing was queued. Start the protected run when the first one finishes:
                </p>
              )}
            </div>
          ) : (
            <ErrorState error={error} compact />
          ))}

        {first ? (
          <SecondRun first={first} experiment={experiment} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button onClick={onBack}>
              <Icon name="arrowRight" size={14} className="rotate-180" /> Back
            </Button>
            <Button
              variant="primary"
              className="h-11 px-5 text-[15px]"
              onClick={runBoth}
              disabled={active + 2 > limit || busy !== null}
              loading={busy === "both"}
            >
              <Icon name="play" /> Run both (recommended)
            </Button>
            <Button
              onClick={() => runOne("vulnerable")}
              disabled={full || busy !== null}
              loading={busy === "vulnerable"}
            >
              {PROCESSOR.vulnerable.primary} only
            </Button>
            <Button
              onClick={() => runOne("protected")}
              disabled={full || busy !== null}
              loading={busy === "protected"}
            >
              {PROCESSOR.protected.primary} only
            </Button>
            {active + 2 > limit && !full && (
              <span className="text-[13px] text-muted">
                “Run both” needs two free slots; one run is in progress.
              </span>
            )}
          </div>
        )}
        <p className="text-[13px] text-muted">
          Runs take about 5–15 seconds on AWS. You can leave the page — the run keeps going, and it will be in{" "}
          <Link to="/runs" className="text-accent-text hover:underline">
            My runs
          </Link>
          .
        </p>
      </CardBody>
    </Card>
  );
}

/** After "Run both" could start only the first run: offer the second once a slot frees up. */
function SecondRun({ first, experiment }: { first: Run; experiment: Experiment }) {
  const navigate = useNavigate();
  const run = useRun(first.run_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const done = run.data?.is_terminal ?? false;
  const status = useMemo(
    () =>
      run.data ? `${run.data.delivered_count}/${run.data.expected_deliveries} instructions` : "starting",
    [run.data],
  );
  const startSecond = async () => {
    setBusy(true);
    setError(null);
    try {
      const second = (await api.startRun(experiment.experiment_id, "protected")).run;
      navigate(`/compare?a=${first.run_id}&b=${second.run_id}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-[14px]">
        Unprotected run{" "}
        <Link to={`/runs/${first.run_id}`} className="figures text-accent-text hover:underline">
          {shortRunId(first.run_id)}
        </Link>
        : {done ? "finished." : `running (${status}).`}
      </p>
      {error !== null && <ErrorState error={error} compact />}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={startSecond} disabled={!done || busy} loading={busy}>
          <Icon name="shield" /> Start the protected run
        </Button>
        <ButtonLink to={`/runs/${first.run_id}`}>Watch the unprotected run</ButtonLink>
      </div>
      {!done && <p className="text-[13px] text-muted">This button unlocks when the first run finishes.</p>}
    </div>
  );
}
