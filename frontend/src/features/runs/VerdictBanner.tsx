import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import type { Run } from "../../lib/api/types";
import { formatINR } from "../../lib/format";
import { runStory } from "./runFacts";

/** The verdict, revealed once when evaluation finishes. Every figure comes from the evaluated summary. */
export function VerdictBanner({ run }: { run: Run }) {
  const story = runStory(run);
  if (!story || !run.summary || !run.verdict) return null;
  const pass = run.verdict === "PASS";
  const s = run.summary;
  return (
    <section
      aria-live="polite"
      className={cx(
        "verdict-in mb-5 overflow-hidden rounded-2xl border bg-surface",
        pass ? "glow-success border-paid/40" : "glow-danger border-unpaid/40",
      )}
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div
          className={cx(
            "grid size-16 shrink-0 place-items-center rounded-2xl text-white",
            pass ? "bg-paid" : "bg-unpaid",
          )}
        >
          <Icon name={pass ? "check" : "close"} size={34} strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cx(
              "text-[12px] font-semibold tracking-[0.14em] uppercase",
              pass ? "text-paid-text" : "text-unpaid-text",
            )}
          >
            Verdict: {run.verdict}
          </div>
          <p className="mt-1 text-[18px] leading-snug font-semibold sm:text-[20px]">{story}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-3 gap-5 text-right sm:gap-6">
          <Figure
            label="Paid twice"
            value={String(s.double_paid)}
            tone={s.double_paid > 0 ? "warn" : undefined}
          />
          <Figure label="Paid ₹0" value={String(s.unpaid)} tone={s.unpaid > 0 ? "danger" : undefined} />
          <Figure
            label="Misallocated"
            value={formatINR(s.misallocated_paise)}
            tone={s.misallocated_paise > 0 ? "danger" : undefined}
          />
        </dl>
      </div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warn" | "danger" }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd
        className={cx(
          "figures text-[22px] leading-7 font-medium",
          tone === "warn" && "text-twice-text",
          tone === "danger" && "text-unpaid-text",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
