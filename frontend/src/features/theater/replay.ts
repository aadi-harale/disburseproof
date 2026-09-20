/**
 * Replay: rebuild a run's picture from its real Deliveries rows, one row at a time.
 *
 * Everything here is a pure function of rows the backend returned (GET
 * /runs/{id}/deliveries, oldest first) and the run's entitlement list (GET
 * /runs/{id}/students). Nothing is generated or padded: showing the first k rows
 * is exactly the state the ledger was in after the processor handled k deliveries.
 * The verdict is never derived here; it only ever comes from the run record.
 */
import type { ReplayDelivery, StudentState, StudentTile } from "../../lib/api/types";
import { formatINR } from "../../lib/format";

export type FeedTone = "paid" | "twice" | "refused" | "unpaid";

export interface FeedLine {
  id: string;
  tone: FeedTone;
  text: string;
  at: string;
}

export interface TheaterState {
  /** Instructions (deliveries) handled so far. */
  arrived: number;
  /** Payments (ledger effects) made so far. */
  payments: number;
  paidTwice: number;
  /** Payments that were a second (or later) payment of the same entitlement. */
  repeatPayments: number;
  unpaid: number;
  repeatsRefused: number;
  budgetRefusals: number;
  /** Money paid as first payments and as repeat payments, in paise. */
  spentFirst: number;
  spentRepeat: number;
  tiles: StudentTile[];
  counts: Record<StudentState, number>;
  /** Newest first, at most FEED_LINES. */
  feed: FeedLine[];
}

/** Kept in state; the feed shows the newest few and reveals the rest on demand. */
export const FEED_LINES = 12;

function tileState(commits: number, refused: boolean): StudentState {
  if (commits >= 2) return "paid_twice";
  if (commits === 1) return "paid_once";
  return refused ? "unpaid" : "pending";
}

function who(row: ReplayDelivery): string {
  return row.installment > 1 ? `${row.beneficiary_id} (installment ${row.installment})` : row.beneficiary_id;
}

/** The state after the first `cursor` deliveries. */
export function deriveTheater(
  entitlements: StudentTile[],
  deliveries: ReplayDelivery[],
  cursor: number,
): TheaterState {
  const amountByKey = new Map(entitlements.map((tile) => [tile.entitlement_key, tile.amount_paise]));
  const commits = new Map<string, number>();
  const seen = new Map<string, number>();
  const refused = new Set<string>();
  const lines: FeedLine[] = [];
  let payments = 0;
  let repeatPayments = 0;
  let repeatsRefused = 0;
  let budgetRefusals = 0;
  let spentFirst = 0;
  let spentRepeat = 0;

  const upto = Math.min(cursor, deliveries.length);
  for (let index = 0; index < upto; index += 1) {
    const row = deliveries[index]!;
    const key = row.entitlement_key;
    const amount = row.amount_paise ?? amountByKey.get(key) ?? 0;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    let line: Omit<FeedLine, "id" | "at"> | null = null;
    if (row.outcome === "COMMITTED") {
      const before = commits.get(key) ?? 0;
      commits.set(key, before + 1);
      payments += 1;
      if (before === 0) {
        spentFirst += amount;
        line = { tone: "paid", text: `${who(row)} paid ${formatINR(amount)}` };
      } else {
        repeatPayments += 1;
        spentRepeat += amount;
        line = { tone: "twice", text: `${who(row)} paid again (repeat instruction)` };
      }
    } else if (row.outcome === "DUPLICATE_SUPPRESSED") {
      repeatsRefused += 1;
      line = { tone: "refused", text: `Repeat for ${who(row)} refused` };
    } else if (row.outcome === "BUDGET_EXHAUSTED") {
      budgetRefusals += 1;
      refused.add(key);
      line = { tone: "unpaid", text: `Budget used up — ${who(row)} gets ₹0` };
    }
    // Only the newest lines are kept, so build them only near the cursor.
    if (line && index >= upto - FEED_LINES) {
      lines.push({ ...line, id: row.delivery_id, at: row.processed_at });
    }
  }

  const counts: Record<StudentState, number> = { paid_once: 0, paid_twice: 0, unpaid: 0, pending: 0 };
  const tiles = entitlements.map((tile) => {
    const paid = commits.get(tile.entitlement_key) ?? 0;
    const state = tileState(paid, refused.has(tile.entitlement_key));
    counts[state] += 1;
    return { ...tile, state, payments: paid, deliveries: seen.get(tile.entitlement_key) ?? 0 };
  });

  return {
    arrived: upto,
    payments,
    paidTwice: counts.paid_twice,
    repeatPayments,
    unpaid: counts.unpaid,
    repeatsRefused,
    budgetRefusals,
    spentFirst,
    spentRepeat,
    tiles,
    counts,
    feed: lines.reverse(),
  };
}

export type ReplaySpeed = "demo" | "real";
export const DEMO_PACE_MS = 20_000;

/**
 * When each delivery appears, in ms from the start of the replay.
 * "real": the gaps between the rows' processed_at timestamps (1× real time).
 * "demo": the same rows in the same order, evenly spaced over ~20 s.
 */
export function replaySchedule(deliveries: ReplayDelivery[], speed: ReplaySpeed): number[] {
  if (deliveries.length === 0) return [];
  if (speed === "demo") {
    const step = DEMO_PACE_MS / Math.max(deliveries.length - 1, 1);
    return deliveries.map((_, index) => Math.round(index * step));
  }
  const start = Date.parse(deliveries[0]!.processed_at);
  return deliveries.map((row) => Math.max(0, Date.parse(row.processed_at) - start));
}

export interface Inspection {
  /** The first student paid twice (by the time of their first payment), with both paying instructions. */
  doublePaid: { beneficiaryId: string; amount: number; payments: ReplayDelivery[] } | null;
  /** The first eligible student refused because the budget had run out. */
  unpaid: { beneficiaryId: string; amount: number; refusal: ReplayDelivery } | null;
  /** Money spent on second (and later) payments of the same entitlement. */
  repeatSpend: number;
  repeatPayments: number;
  /** What the students left with ₹0 were owed. */
  unpaidNeed: number;
  unpaidStudents: number;
}

/** Facts for the "why it failed" inspector, chosen from the run's real rows. */
export function inspect(entitlements: StudentTile[], deliveries: ReplayDelivery[]): Inspection {
  const amountByKey = new Map(entitlements.map((tile) => [tile.entitlement_key, tile.amount_paise]));
  const paying = new Map<string, ReplayDelivery[]>();
  for (const row of deliveries) {
    if (row.outcome !== "COMMITTED") continue;
    paying.set(row.entitlement_key, [...(paying.get(row.entitlement_key) ?? []), row]);
  }
  let repeatSpend = 0;
  let repeatPayments = 0;
  let doublePaid: Inspection["doublePaid"] = null;
  for (const [key, rows] of paying) {
    if (rows.length < 2) continue;
    const amount = rows[0]!.amount_paise ?? amountByKey.get(key) ?? 0;
    repeatPayments += rows.length - 1;
    repeatSpend += amount * (rows.length - 1);
    // `paying` preserves insertion order, i.e. the order of first payments.
    doublePaid ??= { beneficiaryId: rows[0]!.beneficiary_id, amount, payments: rows };
  }
  const unpaidTiles = entitlements.filter((tile) => (paying.get(tile.entitlement_key)?.length ?? 0) === 0);
  const refusal = deliveries.find(
    (row) => row.outcome === "BUDGET_EXHAUSTED" && !paying.has(row.entitlement_key),
  );
  return {
    doublePaid,
    unpaid: refusal
      ? {
          beneficiaryId: refusal.beneficiary_id,
          amount: refusal.amount_paise ?? amountByKey.get(refusal.entitlement_key) ?? 0,
          refusal,
        }
      : null,
    repeatSpend,
    repeatPayments,
    unpaidNeed: unpaidTiles.reduce((sum, tile) => sum + tile.amount_paise, 0),
    unpaidStudents: unpaidTiles.length,
  };
}
