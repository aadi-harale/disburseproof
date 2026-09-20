import { useState } from "react";

import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import { api } from "../../lib/api/client";
import { useOverview } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { downloadText } from "../../lib/csv";
import { shortHash } from "../../lib/format";

/**
 * What can be checked about this result, in one line: the verdict the backend
 * decided, the test's replay fingerprint, the receipt's digest, the region, and
 * links to the stored receipt and the real Step Functions execution.
 * Every field is hidden when the API does not provide it; nothing is faked.
 */
export function VerificationPill({ run }: { run: Run }) {
  const overview = useOverview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pass = run.verdict === "PASS";
  const region = overview.data?.region;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const receipt = await api.receipt(run.run_id);
      downloadText(`disburseproof-receipt-${run.run_id}.json`, receipt.receipt_json, "application/json");
    } catch {
      setError("The receipt could not be fetched. Open the receipt page instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-quiet mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-3.5 py-2.5">
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[14px] font-semibold text-white",
          pass ? "bg-paid" : "bg-unpaid",
        )}
      >
        <Icon name={pass ? "check" : "close"} size={15} strokeWidth={2.6} />
        {pass ? "Integrity verified" : "Integrity failed"}
      </span>
      <dl className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5" title={run.fingerprint}>
          <dt className="text-faint">Replay fingerprint</dt>
          <dd className="figures text-ink">{shortHash(run.fingerprint, 10)}</dd>
        </span>
        {run.receipt_sha256 && (
          <span className="flex items-center gap-1.5" title={run.receipt_sha256}>
            <dt className="text-faint">Result digest</dt>
            <dd className="figures text-ink">{shortHash(run.receipt_sha256, 10)}</dd>
          </span>
        )}
        {region && (
          <span className="flex items-center gap-1.5">
            <dt className="sr-only">Region</dt>
            <dd className="figures">{region}</dd>
          </span>
        )}
      </dl>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {run.receipt_s3_key && (
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            <Icon name="download" size={13} /> {busy ? "Fetching…" : "Download receipt (JSON)"}
          </button>
        )}
        {run.console_url && (
          <a
            href={run.console_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2"
          >
            Open Step Functions execution <Icon name="external" size={13} />
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-unpaid-text">
          {error}
        </p>
      )}
    </div>
  );
}
