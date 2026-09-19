import { useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";

import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { inputClass } from "../../components/ui/formStyles";
import { Icon } from "../../components/ui/Icon";
import { Table, Td, Th } from "../../components/ui/Table";
import { api } from "../../lib/api/client";
import { keys } from "../../lib/api/queries";
import type { CsvPreview } from "../../lib/api/types";
import { formatCount, formatINR } from "../../lib/format";

const COLUMNS = ["beneficiary_id", "display_name", "amount_paise", "installment"] as const;
const SAMPLE = `beneficiary_id,display_name,amount_paise,installment
STU-001,Aarav Iyer,1000000,1
STU-002,Ananya Kulkarni,1000000,1
STU-002,Ananya Kulkarni,1000000,2`;

/** Upload or paste a CSV, validate it on the server (dry run), review row errors, then create. */
export function CsvUpload() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState<"validate" | "create" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setPreview(null);
  };

  const validate = async () => {
    setBusy("validate");
    setError(null);
    try {
      setPreview((await api.previewCsv(text)).preview);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const { batch } = await api.uploadCsv({ csv: text, name: name.trim() || undefined });
      await client.invalidateQueries({ queryKey: keys.batches });
      navigate(`/batches/${batch.batch_id}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted">
        Columns: <span className="figures text-ink">{COLUMNS.join(",")}</span>. Amounts are whole paise
        (₹10,000 = 1000000). Up to 500 rows; each (beneficiary_id, installment) pair once.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2 focus-within:ring-2 focus-within:ring-focus">
          <Icon name="upload" size={14} /> Choose file
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" />
        </label>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setText(SAMPLE);
            setPreview(null);
          }}
        >
          Use a sample
        </Button>
      </div>
      <Field label="CSV text" htmlFor="csv-text">
        <textarea
          id="csv-text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          rows={6}
          spellCheck={false}
          className="figures w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[12px] placeholder:text-faint"
          placeholder={SAMPLE}
        />
      </Field>
      <Field label="Name (optional)" htmlFor="csv-name">
        <input
          id="csv-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className={inputClass}
          placeholder="Uploaded batch"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={validate} disabled={!text.trim()} loading={busy === "validate"}>
          Validate
        </Button>
        <Button variant="primary" onClick={create} disabled={!preview?.valid} loading={busy === "create"}>
          Create batch
        </Button>
      </div>
      {error !== null && <ErrorState error={error} compact />}
      {preview && <PreviewTable preview={preview} />}
    </div>
  );
}

function PreviewTable({ preview }: { preview: CsvPreview }) {
  const problems = preview.rows.filter((row) => row.errors.length > 0).length;
  const headerErrors = preview.errors.filter((error) => !preview.rows.some((row) => row.line === error.line));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {preview.valid ? (
          <Badge tone="success">
            <Icon name="check" size={13} /> Valid
          </Badge>
        ) : (
          <Badge tone="danger">
            {formatCount(preview.errors.length)} problem{preview.errors.length === 1 ? "" : "s"}
          </Badge>
        )}
        <span className="text-muted">
          {formatCount(preview.entitlements)} valid entitlements · budget{" "}
          <span className="figures text-ink">{formatINR(preview.total_budget_paise)}</span>
          {problems > 0 && ` · ${problems} row${problems === 1 ? "" : "s"} to fix`}
        </span>
      </div>
      {headerErrors.length > 0 && (
        <ul className="list-disc pl-5 text-[12px] text-unpaid-text">
          {headerErrors.map((error, index) => (
            <li key={index}>
              {error.line ? `Line ${error.line}: ` : ""}
              {error.field} {error.message}
            </li>
          ))}
        </ul>
      )}
      {preview.rows.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <Table>
            <thead className="sticky top-0">
              <tr>
                <Th>Line</Th>
                {COLUMNS.map((column) => (
                  <Th key={column}>{column}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.line} className={cx(row.errors.length > 0 && "bg-unpaid-soft")}>
                  <Td className="figures text-faint">{row.line}</Td>
                  {row.values.raw !== undefined ? (
                    <Td colSpan={4} className="figures">
                      {row.values.raw}
                    </Td>
                  ) : (
                    COLUMNS.map((column) => (
                      <Td key={column} className="figures max-w-[160px] truncate">
                        {row.values[column]}
                      </Td>
                    ))
                  )}
                  {row.errors.length > 0 && <td className="sr-only">{row.errors.join("; ")}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {preview.rows.some((row) => row.errors.length > 0) && (
        <ul className="space-y-1 text-[12px] text-unpaid-text">
          {preview.rows
            .filter((row) => row.errors.length > 0)
            .slice(0, 20)
            .map((row) => (
              <li key={row.line}>
                <span className="figures">Line {row.line}</span>: {row.errors.join("; ")}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
