import type { ReactNode } from "react";

import { useCountUp } from "../../lib/hooks";
import { cx } from "./cx";

type StatTone = "default" | "success" | "warning" | "danger" | "muted";

const toneClass: Record<StatTone, string> = {
  default: "text-ink",
  success: "text-paid-text",
  warning: "text-twice-text",
  danger: "text-unpaid-text",
  muted: "text-muted",
};

/** A labelled number that counts up when it changes (instantly with reduced motion). */
export function Stat({
  label,
  value,
  format = (v) => String(v),
  suffix,
  hint,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: number;
  format?: (value: number) => string;
  suffix?: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={cx("figures mt-1 text-[22px] leading-7 font-medium", toneClass[tone])}>
        {format(shown)}
        {suffix && <span className="ml-1 text-[13px] font-normal text-faint">{suffix}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
    </div>
  );
}
