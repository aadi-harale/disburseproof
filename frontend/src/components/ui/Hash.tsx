import { useState } from "react";

import { shortHash } from "../../lib/format";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** A shortened hash or ID in monospace, with the full value on hover and a copy button. */
export function Hash({
  value,
  length = 12,
  className,
  label,
}: {
  value: string | null | undefined;
  length?: number;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-faint">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the full value is still in the title attribute.
    }
  };
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="figures truncate text-[12.5px]" title={value}>
        {shortHash(value, length)}
      </span>
      <button
        type="button"
        onClick={copy}
        className="no-print rounded p-0.5 text-faint hover:bg-surface-2 hover:text-ink"
        aria-label={copied ? "Copied" : `Copy ${label ?? "value"}`}
        title={copied ? "Copied" : "Copy"}
      >
        <Icon name={copied ? "check" : "copy"} size={13} />
      </button>
    </span>
  );
}
