import { cx } from "../../components/ui/cx";
import type { StudentTile } from "../../lib/api/types";
import { STUDENT_STATES } from "./studentStates";

/**
 * The signature visual: one tile per entitlement, updated live.
 * Green ✓ paid once, amber ×2 paid twice, red ₹0 received nothing, grey pending.
 * A small dot marks students whose payment event was delivered twice (the retry wave).
 */
export function StudentGrid({
  items,
  expected,
  retried,
  onSelect,
  selected,
  size = "md",
  label = "Students",
}: {
  items: StudentTile[] | undefined;
  expected: number;
  retried?: Set<string>;
  onSelect?: (beneficiaryId: string) => void;
  selected?: string;
  size?: "sm" | "md";
  label?: string;
}) {
  const count = items?.length ?? expected;
  const columns = count <= 100 ? 10 : count <= 200 ? 20 : 25;
  const showGlyphs = size === "md" && columns === 10;
  const gap = size === "sm" ? "gap-[3px]" : "gap-1 sm:gap-1.5";

  if (!items) {
    return (
      <div
        className={cx("grid", gap)}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        aria-busy
      >
        {Array.from({ length: Math.max(expected, 1) }, (_, index) => (
          <div key={index} className="aspect-square animate-pulse rounded-[4px] bg-surface-2" />
        ))}
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label={label}
      className={cx("grid", gap)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const state = STUDENT_STATES[item.state];
        const wasRetried = retried?.has(item.beneficiary_id) ?? false;
        const description =
          `${item.beneficiary_id} ${item.display_name}` +
          (item.installment > 1 ? ` (installment ${item.installment})` : "") +
          `: ${state.name}${wasRetried ? ", payment event delivered twice" : ""}`;
        const tileClass = cx(
          "relative grid aspect-square place-items-center rounded-[4px] transition-colors duration-300",
          size === "md" && "sm:rounded-[6px]",
          state.tile,
          selected === item.beneficiary_id && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
        );
        const content = (
          <>
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
          </>
        );
        return (
          <div role="listitem" key={item.entitlement_key}>
            {onSelect ? (
              <button
                type="button"
                title={description}
                aria-label={description}
                onClick={() => onSelect(item.beneficiary_id)}
                className={cx(
                  tileClass,
                  "w-full cursor-pointer hover:brightness-95 focus-visible:ring-2 focus-visible:ring-focus",
                )}
              >
                {content}
              </button>
            ) : (
              <div title={description} aria-label={description} className={tileClass}>
                {content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
