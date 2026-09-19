import { ApiError } from "../../lib/api/client";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";

/** Shows the backend's own error message, code and request ID. */
export function ErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const title =
    apiError?.status === 404 ? "Not found" : apiError?.status === 409 ? "Not now" : "Request failed";
  return (
    <div
      role="alert"
      className={cx(
        compact
          ? "flex items-start gap-2 rounded-lg border border-unpaid/30 bg-unpaid-soft px-3 py-2 text-[13px] text-unpaid-text"
          : "mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center",
      )}
    >
      {compact ? (
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      ) : (
        <div className="mb-3 grid size-10 place-items-center rounded-full bg-unpaid-soft text-unpaid-text">
          <Icon name="alert" size={18} />
        </div>
      )}
      <div className="min-w-0">
        <p className={compact ? "font-medium" : "text-[15px] font-semibold text-ink"}>{title}</p>
        <p className={compact ? "" : "mt-1 text-[13px] text-muted"}>{message}</p>
        {apiError && (apiError.code || apiError.requestId) && (
          <p className="figures mt-1 text-[11px] opacity-75">
            {apiError.code}
            {apiError.requestId ? ` · request ${apiError.requestId}` : ""}
          </p>
        )}
        {apiError && apiError.details.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-left text-[12px]">
            {apiError.details.slice(0, 8).map((detail, index) => (
              <li key={index}>
                {detail.line ? `Line ${detail.line}: ` : ""}
                {detail.field} {detail.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && !compact && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
