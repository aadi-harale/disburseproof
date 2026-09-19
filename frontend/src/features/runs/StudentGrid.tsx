import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { cx } from "../../components/ui/cx";
import type { StudentState, StudentTile } from "../../lib/api/types";
import { formatINR } from "../../lib/format";
import { STUDENT_STATES } from "./studentStates";

/**
 * The signature visual: one tile per entitlement.
 * ✓ paid once (green), ×2 paid twice (amber), ₹0 unpaid (red), · waiting (neutral).
 * `highlight` marks students whose payment instruction is sent twice.
 *
 * Tiles animate when their state changes (each tile's content is keyed by its state,
 * so a change remounts it and replays its entrance). With `replay`, final states are
 * revealed in the order the experiment produces them.
 *
 * Keyboard: the grid is one tab stop; arrow keys, Home and End move between tiles,
 * Enter opens the student. Hover or focus shows the student's ID and status below.
 */
export function StudentGrid({
  items,
  expected,
  retried,
  highlight,
  onSelect,
  selected,
  size = "md",
  replay = false,
  replayMs = 2200,
  label = "Students",
  view = "grid",
  caption = true,
}: {
  items: StudentTile[] | undefined;
  expected: number;
  retried?: Set<string>;
  highlight?: Set<string>;
  onSelect?: (beneficiaryId: string) => void;
  selected?: string;
  size?: "sm" | "md" | "lg";
  replay?: boolean;
  replayMs?: number;
  label?: string;
  view?: "grid" | "list";
  caption?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  const count = items?.length ?? expected;
  const columns = count <= 100 ? 10 : count <= 200 ? 20 : 25;
  const glyphSize =
    columns === 10
      ? size === "sm"
        ? null
        : size === "lg"
          ? "text-[13px]"
          : "text-[12px]"
      : columns === 20 && size !== "sm"
        ? "text-[8px]"
        : null;
  const gap =
    size === "sm" ? "gap-[3px] sm:gap-1" : columns > 10 ? "gap-[2px] sm:gap-[3px]" : "gap-1 sm:gap-1.5";
  const radius =
    size === "sm" || columns > 10 ? "rounded-[3px] sm:rounded-[4px]" : "rounded-[4px] sm:rounded-[6px]";
  const grid: CSSProperties = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  if (!items) {
    return (
      <div className={cx("grid", gap)} style={grid} aria-busy aria-label={`${label}: loading`}>
        {Array.from({ length: Math.max(expected, 1) }, (_, index) => (
          <div key={index} className={cx("tile-pending aspect-square bg-pending", radius)} />
        ))}
      </div>
    );
  }

  if (view === "list") return <StudentList items={items} onSelect={onSelect} label={label} />;

  const delays = replay ? replayDelays(items, retried, replayMs) : null;
  const describe = (item: StudentTile) =>
    `${item.beneficiary_id}${item.installment > 1 ? ` (installment ${item.installment})` : ""} · ${
      STUDENT_STATES[item.state].name
    }${highlight?.has(item.beneficiary_id) && item.state === "pending" ? " · instruction will be sent twice" : ""}${
      retried?.has(item.beneficiary_id) ? " · instruction sent twice" : ""
    }`;

  const move = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight"
        ? Math.min(last, index + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : event.key === "ArrowDown"
            ? Math.min(last, index + columns)
            : event.key === "ArrowUp"
              ? Math.max(0, index - columns)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? last
                  : null;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    setActive(next);
    refs.current[next]?.focus();
  };

  const shown = active !== null ? items[active] : undefined;

  return (
    <div>
      <div role="group" aria-label={label} className={cx("grid", gap)} style={grid}>
        {items.map((item, index) => {
          const state = STUDENT_STATES[item.state];
          const marked = highlight?.has(item.beneficiary_id) ?? false;
          const wasRetried = retried?.has(item.beneficiary_id) ?? false;
          const pending = item.state === "pending";
          const description = describe(item);
          const tile = (
            <span
              // Keyed by state: a state change remounts the tile and replays its entrance.
              key={item.state}
              className={cx(
                "relative grid size-full place-items-center",
                radius,
                state.tile,
                pending ? (marked ? "" : "tile-pending") : "tile-enter",
                item.state === "unpaid" && "tile-alarm",
                item.state === "paid_twice" && "tile-warn",
                marked && pending && "ring-2 ring-twice ring-inset",
              )}
              style={
                delays
                  ? ({ "--delay": `${delays.get(item.entitlement_key) ?? 0}ms` } as CSSProperties)
                  : undefined
              }
            >
              {glyphSize && (
                <span
                  className={cx(
                    "figures leading-none font-semibold",
                    glyphSize,
                    marked && pending && "text-twice",
                  )}
                  aria-hidden
                >
                  {marked && pending ? "↻" : state.glyph}
                </span>
              )}
              {wasRetried && size !== "sm" && !pending && (
                <span
                  className="absolute top-[3px] right-[3px] size-[5px] rounded-full bg-current opacity-60"
                  aria-hidden
                />
              )}
            </span>
          );
          const common = {
            ref: (node: HTMLElement | null) => {
              refs.current[index] = node;
            },
            tabIndex: index === focusIndex ? 0 : -1,
            "aria-label": description,
            onKeyDown: (event: KeyboardEvent) => move(event, index),
            onFocus: () => {
              setFocusIndex(index);
              setActive(index);
            },
            onMouseEnter: () => setActive(index),
            onMouseLeave: () => setActive(null),
            onBlur: () => setActive(null),
          };
          return onSelect ? (
            <button
              key={item.entitlement_key}
              type="button"
              {...common}
              onClick={() => onSelect(item.beneficiary_id)}
              aria-current={selected === item.beneficiary_id || undefined}
              className={cx(
                "block aspect-square cursor-pointer transition-transform duration-150 hover:scale-110 hover:brightness-110",
                radius,
                selected === item.beneficiary_id && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
              )}
            >
              {tile}
            </button>
          ) : (
            <div key={item.entitlement_key} {...common} role="img" className={cx("aspect-square", radius)}>
              {tile}
            </div>
          );
        })}
      </div>
      {caption && (
        <p className="figures mt-2 h-5 truncate text-[13px] text-muted" aria-live="polite">
          {shown ? (
            <>
              <span className="text-ink">{describe(shown)}</span>
              {shown.payments > 0 ? ` · ${shown.payments} payment${shown.payments === 1 ? "" : "s"}` : ""}
              {onSelect ? " · Enter to open" : ""}
            </>
          ) : (
            <span className="text-faint">Hover or tab to a tile to see the student</span>
          )}
        </p>
      )}
    </div>
  );
}

/** The same data as a list: for small screens and screen readers. */
function StudentList({
  items,
  onSelect,
  label,
}: {
  items: StudentTile[];
  onSelect?: (beneficiaryId: string) => void;
  label: string;
}) {
  return (
    <div className="max-h-[460px] overflow-auto rounded-lg border border-line">
      <table className="w-full text-[13px]" aria-label={label}>
        <thead className="sticky top-0 bg-surface-2 text-left text-[12px] text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Owed</th>
            <th className="px-3 py-2 text-right font-medium">Payments</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => {
            const state = STUDENT_STATES[item.state];
            return (
              <tr key={item.entitlement_key}>
                <td className="px-3 py-1.5">
                  {onSelect ? (
                    <button
                      type="button"
                      className="figures text-accent-text hover:underline"
                      onClick={() => onSelect(item.beneficiary_id)}
                    >
                      {item.beneficiary_id}
                    </button>
                  ) : (
                    <span className="figures">{item.beneficiary_id}</span>
                  )}
                  {item.installment > 1 && <span className="text-faint"> · inst. {item.installment}</span>}
                </td>
                <td className="px-3 py-1.5">
                  <span className={cx("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5", state.soft)}>
                    <span className="figures text-[11px] font-semibold" aria-hidden>
                      {state.glyph}
                    </span>
                    {state.name}
                  </span>
                </td>
                <td className="figures px-3 py-1.5 text-right">{formatINR(item.amount_paise)}</td>
                <td className="figures px-3 py-1.5 text-right">{item.payments}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    if (retried?.has(item.beneficiary_id)) return 0; // the retry wave lands first
    return 1 + REPLAY_ORDER[item.state];
  };
  const ordered = [...items].sort(
    (a, b) =>
      rank(a) - rank(b) || a.beneficiary_id.localeCompare(b.beneficiary_id) || a.installment - b.installment,
  );
  const step = totalMs / Math.max(ordered.length, 1);
  return new Map(ordered.map((item, index) => [item.entitlement_key, Math.round(index * step)]));
}
