/**
 * CSV helpers for the New test wizard: the downloadable template and plain-language
 * versions of the backend's row errors. Validation itself happens on the server
 * (POST /batches with dry_run); this file only rewords what it returns.
 */
import type { CsvRowPreview } from "../../lib/api/types";

export const CSV_COLUMNS = ["beneficiary_id", "display_name", "amount_paise", "installment"] as const;
/** Mirrors the backend limit (MAX_CSV_CHARACTERS); checked first so a big file fails fast and clearly. */
export const MAX_CSV_CHARACTERS = 200_000;
export const MAX_ROWS = 500;

export const TEMPLATE_CSV = [
  CSV_COLUMNS.join(","),
  "STU-001,Aarav Iyer,1000000,1",
  "STU-002,Ananya Kulkarni,1000000,1",
  "STU-003,Kabir Menon,750000,1",
  "STU-004,Diya Nair,1250000,1",
  "STU-004,Diya Nair,1250000,2",
].join("\r\n");

const FIELD_NAMES: Record<string, string> = {
  beneficiary_id: "student ID",
  display_name: "name",
  amount_paise: "amount (in paise)",
  installment: "installment",
};

/** "amount_paise: a whole number of paise from 1 to …" -> "Line 14: amount (in paise) must be a whole number …". */
export function plainRowErrors(row: CsvRowPreview): string[] {
  return row.errors.map((error) => {
    const duplicate = /^duplicate of line (\d+)/.exec(error);
    if (duplicate) {
      const id = row.values.beneficiary_id ?? "This student";
      return `Line ${row.line}: ${id} appears twice for installment ${row.values.installment ?? "?"} (first on line ${duplicate[1]}). Remove one of the two rows.`;
    }
    const cells = /^expected (\d+) cells, found (\d+)/.exec(error);
    if (cells) {
      return `Line ${row.line}: has ${cells[2]} values but needs ${cells[1]} (student ID, name, amount in paise, installment). Check for a missing or extra comma.`;
    }
    const [field, ...rest] = error.split(": ");
    const message = rest.join(": ");
    const name = FIELD_NAMES[field ?? ""];
    if (!name) return `Line ${row.line}: ${error}`;
    return message === "is required"
      ? `Line ${row.line}: ${name} is required.`
      : `Line ${row.line}: ${name} must be ${message}.`;
  });
}
