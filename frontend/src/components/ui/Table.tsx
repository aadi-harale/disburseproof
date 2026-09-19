import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cx } from "./cx";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("w-full border-collapse text-left text-[13px]", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        "border-b border-line bg-surface-2 px-3 py-2 text-[12px] font-medium whitespace-nowrap text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx("border-b border-line px-3 py-2 align-middle", className)} {...props} />;
}

/** A column header that sorts on click and announces its sort direction. */
export function SortableTh({
  children,
  active,
  direction,
  onSort,
  className,
}: {
  children: ReactNode;
  active: boolean;
  direction: "asc" | "desc";
  onSort: () => void;
  className?: string;
}) {
  return (
    <Th
      className={className}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={onSort} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <span aria-hidden className={cx("text-[10px]", active ? "text-ink" : "text-transparent")}>
          {direction === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </Th>
  );
}
