import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50 select-none";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover shadow-card",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2 shadow-card",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-unpaid text-white hover:opacity-90 shadow-card",
};
const sizes: Record<ButtonSize, string> = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm" };

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return cx(base, variants[variant], sizes[size]);
}
