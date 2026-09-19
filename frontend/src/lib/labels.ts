/**
 * Display labels: the one place where code-level names become words people read.
 * Each entry has a plain primary label and the muted technical term shown under it.
 * Code, API fields and stored values keep their technical names.
 */
import type { DeliveryOutcome, Processor } from "./api/types";

export interface Label {
  primary: string;
  technical: string;
}

export const PROCESSOR: Record<Processor, Label> = {
  vulnerable: { primary: "Unprotected", technical: "unprotected processor" },
  protected: { primary: "Protected", technical: "protected processor" },
  naive: { primary: "Check-then-write", technical: "naive processor" },
};

export const OUTCOME: Record<DeliveryOutcome, Label> = {
  COMMITTED: { primary: "Paid", technical: "COMMITTED" },
  DUPLICATE_SUPPRESSED: { primary: "Repeat refused", technical: "DUPLICATE_SUPPRESSED" },
  BUDGET_EXHAUSTED: { primary: "Not paid — budget ran out", technical: "BUDGET_EXHAUSTED" },
};

/** The three checks, keyed by the backend's invariant IDs. */
export const CHECK: Record<string, Label> = {
  one_payment_per_entitlement: { primary: "No double payment", technical: "uniqueness invariant" },
  every_eligible_paid: { primary: "Every student paid", technical: "completeness invariant" },
  budget_guard: { primary: "Budget preserved", technical: "budget guard" },
};
export const CHECK_ORDER = ["one_payment_per_entitlement", "every_eligible_paid", "budget_guard"];

export const TERMS = {
  instruction: { primary: "payment instruction", technical: "delivery" },
  instructions: { primary: "payment instructions", technical: "deliveries" },
  payment: { primary: "payment", technical: "ledger effect" },
  entitlement: { primary: "entitlement", technical: "what one student is owed for one installment" },
  fingerprint: { primary: "Same-test proof", technical: "replay fingerprint" },
  failed: { primary: "Payment integrity failed", technical: "invariant violation" },
  verified: { primary: "Integrity verified", technical: "all invariants hold" },
} satisfies Record<string, Label>;

export function processorName(processor: string): string {
  return PROCESSOR[processor as Processor]?.primary ?? processor;
}
