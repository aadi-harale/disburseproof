import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-faint">{hint}</p>}
    </div>
  );
}
