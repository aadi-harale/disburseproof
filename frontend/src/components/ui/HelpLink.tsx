import { Link } from "react-router";

/** A "?" that opens the matching Docs section. */
export function HelpLink({ section, label }: { section: string; label: string }) {
  return (
    <Link
      to={`/docs#${section}`}
      aria-label={`Help: ${label}`}
      title={`Help: ${label}`}
      className="inline-grid size-9 place-items-center rounded-full border border-line-strong text-muted hover:bg-surface-2 hover:text-ink"
    >
      <span aria-hidden className="text-[15px] font-semibold">
        ?
      </span>
    </Link>
  );
}
