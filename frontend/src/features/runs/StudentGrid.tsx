import type { CSSProperties } from "react";

import { cx } from "../../components/ui/cx";
import type { StudentState, StudentTile } from "../../lib/api/types";
import { STUDENT_STATES } from "./studentStates";

/**
 * The signature visual: one tile per entitlement.
 * Green ✓ paid once, amber ×2 paid twice, red ₹0 received nothing, grey pending.
 * A small dot marks students whose payment event was delivered twice (the retry wave).
 *
 * Tiles animate when their state changes (each tile's content is keyed by its state,
 * so a change remounts it and replays the entrance). With `replay`, the final states
 * are revealed in the order the experiment produces them: retry-wave students first,
 * then Phase B payments, then the students refused for lack of budget.
 */
export function StudentGrid({
  items,
  expected,
  retried,
  onSelect,
  selected,
  size = "md",
  replay = false,
  replayMs = 2200,
  label = "Students",
}: {
  items: StudentTile[] | undefined;
  expected: number;
  retried?: Set<string>;
  onSelect?: (beneficiaryId: string) => void;
  selected?: string;
  size?: "sm" | "md";
  replay?: boolean;
  replayMs?: number;
  label?: string;
}) {
  const count = items?.length ?? expected;
  const columns = count <= 100 ? 10 : count <= 200 ? 20 : 25;
  const showGlyphs = size === "md" && columns === 10;
  const gap = size === "sm" ? "gap-[3px] sm:gap-1" : "gap-1 sm:gap-1.5";
  const radius = size === "sm" ? "rounded-[3px] sm:rounded-[4px]" : "rounded-[4px] sm:rounded-[6px]";
  const grid: CSSProperties = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  if (!items) {
    return (
      <div className={cx("grid", gap)} style={grid} aria-busy>
        {Array.from({ length: Math.max(expected, 1) }, (_, index) => (
          <div key={index} className={cx("tile-pending aspect-square bg-pending", radius)} />
        ))}
      </div>
    );
  }

  const delays = replay ? replayDelays(items, retried, replayMs) : null;

  return (
    <div role="list" aria-label={label} className={cx("grid", gap)} style={grid}>
      {items.map((item) => {
        const state = STUDENT_STATES[item.state];
        const wasRetried = retried?.has(item.beneficiary_id) ?? false;
        const description =
          `${item.beneficiary_id} ${item.display_name}` +
          (item.installment > 1 ? ` (installment ${item.installment})` : "") +
          `: ${state.name}${wasRetried ? ", payment event delivered twice" : ""}`;
        const pending = item.state === "pending";
        const tile = (
          <span
            // Keyed by state: a state change remounts the tile and replays its entrance.
            key={item.state}
            className={cx(
              "relative grid size-full place-items-center",
              radius,
              state.tile,
              pending ? "tile-pending" : "tile-enter",
              item.state === "unpaid" && "tile-alarm",
              item.state === "paid_twice" && "tile-warn",
            )}
            style={
              delays
                ? ({ "--delay": `${delays.get(item.entitlement_key) ?? 0}ms` } as CSSProperties)
                : undefined
            }
          >
            {showGlyphs && (
              <span className="figures text-[11px] leading-none font-semibold sm:text-[12px]">
                {state.glyph}
              </span>
            )}
            {wasRetried && size === "md" && (
              <span
                className="absolute top-[3px] right-[3px] size-[5px] rounded-full bg-current opacity-60"
                aria-hidden
              />
            )}
          </span>
        );
        return (
          <div role="listitem" key={item.entitlement_key} className="aspect-square">
            {onSelect ? (
              <button
                type="button"
                title={description}
                aria-label={description}
                onClick={() => onSelect(item.beneficiary_id)}
                className={cx(
                  "block size-full cursor-pointer transition-transform duration-150 hover:scale-110 hover:brightness-110",
                  radius,
                  selected === item.beneficiary_id && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                )}
              >
                {tile}
              </button>
            ) : (
              <div title={description} aria-label={description} className="size-full">
                {tile}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const REPLAY_ORDER: Record<StudentState, number> = { paid_twice: 0, paid_once: 1, unpaid: 2, pending: 3 };

/** Reveal order that mirrors the experiment: retry wave, then Phase B payments, then refusals. */
function replayDelays(
  items: StudentTile[],
  retried: Set<string> | undefined,
  totalMs: number,
): Map<string, number> {
  const rank = (item: StudentTile) => {
    if (retried?.has(item.beneficiary_id)) return 0; // Phase A: the retry wave lands first
    return 1 + REPLAY_ORDER[item.state];
  };
  const ordered = [...items].sort(
    (a, b) =>
      rank(a) - rank(b) || a.beneficiary_id.localeCompare(b.beneficiary_id) || a.installment - b.installment,
  );
  const step = totalMs / Math.max(ordered.length, 1);
  return new Map(ordered.map((item, index) => [item.entitlement_key, Math.round(index * step)]));
}
