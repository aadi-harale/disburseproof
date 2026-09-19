import type { ReactNode } from "react";

import { cx } from "./cx";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";

const tones: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface text-ink",
  accent: "border-transparent bg-accent-soft text-accent-text",
  success: "border-transparent bg-paid-soft text-paid-text",
  warning: "border-transparent bg-twice-soft text-twice-text",
  danger: "border-transparent bg-unpaid-soft text-unpaid-text",
  muted: "border-transparent bg-surface-2 text-muted",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  mono,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] font-medium whitespace-nowrap",
        mono && "figures",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
