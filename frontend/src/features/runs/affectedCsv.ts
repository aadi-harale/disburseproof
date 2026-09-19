import type { Run, StudentTile } from "../../lib/api/types";
import { downloadText, toCsv } from "../../lib/csv";
import { STUDENT_STATES } from "./studentStates";

/** Affected students (paid twice or left with ₹0), built from GET /runs/{id}/students. */
export function downloadAffectedCsv(run: Run, affected: StudentTile[]): void {
  const rupees = (paise: number) => (paise / 100).toFixed(2);
  const rows = affected.map((tile) => [
    tile.beneficiary_id,
    tile.display_name,
    tile.installment,
    rupees(tile.amount_paise),
    rupees(tile.amount_paise * tile.payments),
    STUDENT_STATES[tile.state].name,
    tile.payments,
  ]);
  const csv = toCsv(
    ["student_id", "name", "installment", "expected_amount_inr", "amount_received_inr", "status", "payments"],
    rows,
  );
  downloadText(`affected-students-${run.run_id}.csv`, csv);
}
