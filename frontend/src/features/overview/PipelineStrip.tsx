import { Fragment } from "react";

const NODES = [
  { name: "Step Functions", detail: "Orchestrates Phase A, then Phase B" },
  { name: "SQS Standard", detail: "At-least-once, unordered deliveries" },
  { name: "Lambda worker", detail: "Vulnerable or protected processor" },
  { name: "DynamoDB", detail: "Ledger; one transaction per payment" },
  { name: "S3", detail: "SHA-256 fingerprinted receipt" },
];

/** The AWS path a payment event takes, with animated connectors. */
export function PipelineStrip() {
  return (
    <ol className="flex flex-col items-stretch gap-0 md:flex-row md:items-center" aria-label="AWS pipeline">
      {NODES.map((node, index) => (
        <Fragment key={node.name}>
          <li className="rise min-w-0 flex-1" style={{ ["--delay" as string]: `${index * 90}ms` }}>
            <div className="h-full rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card">
              <div className="flex items-center gap-2">
                <span className="figures grid size-5 shrink-0 place-items-center rounded-md bg-accent-soft text-[11px] font-semibold text-accent-text">
                  {index + 1}
                </span>
                <span className="truncate text-[13px] font-semibold">{node.name}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted">{node.detail}</p>
            </div>
          </li>
          {index < NODES.length - 1 && (
            <li aria-hidden className="flex shrink-0 items-center justify-center md:w-8">
              <span className="flow-y block h-5 w-[2px] rounded-full opacity-70 md:hidden" />
              <span className="flow-x hidden h-[2px] w-full rounded-full opacity-70 md:block" />
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}
