import { cx } from "../../components/ui/cx";
import type { Run } from "../../lib/api/types";
import { formatINR } from "../../lib/format";
import { PROCESSOR } from "../../lib/labels";
import { runStory } from "../runs/runFacts";

/** Head-to-head summary of two runs: verdict stamps, the story, and the three numbers that matter. */
export function VersusHeader({ a, b }: { a: Run; b: Run }) {
  return (
    <section className="stage grid gap-6 rounded-3xl p-5 ring-1 ring-white/10 sm:p-8 md:grid-cols-[1fr_auto_1fr] md:items-center">
      <Side run={a} />
      <div className="flex items-center justify-center" aria-hidden>
        <span className="figures grid size-12 place-items-center rounded-full border border-line bg-surface text-[13px] font-semibold text-muted">
          VS
        </span>
      </div>
      <Side run={b} />
    </section>
  );
}

function Side({ run }: { run: Run }) {
  const s = run.summary;
  const pass = run.verdict === "PASS";
  return (
    <div className="rise min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold tracking-[0.14em] text-muted uppercase">
          {PROCESSOR[run.processor].primary} processor
        </div>
        {run.verdict && (
          <span
            className={cx(
              "figures -rotate-3 rounded-lg border-2 px-3 py-1 text-[18px] font-bold tracking-widest",
              pass ? "border-paid text-paid" : "border-unpaid text-unpaid",
            )}
          >
            {run.verdict}
          </span>
        )}
      </div>
      <p className="mt-3 min-h-[3.2em] text-[15px] leading-snug font-medium">
        {runStory(run) ?? (run.is_terminal ? "No verdict for this run." : "Running now…")}
      </p>
      {s && (
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Metric
            label="Paid twice"
            value={String(s.double_paid)}
            hot={s.double_paid > 0}
            tone="text-twice"
          />
          <Metric label="Got ₹0" value={String(s.unpaid)} hot={s.unpaid > 0} tone="text-unpaid" />
          <Metric
            label="Misallocated"
            value={formatINR(s.misallocated_paise)}
            hot={s.misallocated_paise > 0}
            tone="text-unpaid"
          />
        </dl>
      )}
    </div>
  );
}

function Metric({ label, value, hot, tone }: { label: string; value: string; hot: boolean; tone: string }) {
  return (
    <div className="min-w-0">
      <dd className={cx("figures truncate text-[24px] leading-8 font-medium", hot ? tone : "text-paid")}>
        {value}
      </dd>
      <dt className="text-[11.5px] text-muted">{label}</dt>
    </div>
  );
}
