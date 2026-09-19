import type { ReactNode } from "react";

import { Icon } from "../../components/ui/Icon";
import type { StudentState } from "../../lib/api/types";

/** The only place student states get a colour, glyph and name. */
export const STUDENT_STATES: Record<
  StudentState,
  { name: string; tile: string; soft: string; glyph: ReactNode }
> = {
  paid_once: {
    name: "Paid once",
    tile: "bg-paid text-white",
    soft: "bg-paid-soft text-paid-text",
    glyph: <Icon name="check" size={13} strokeWidth={2.4} />,
  },
  paid_twice: {
    name: "Paid twice",
    tile: "bg-twice text-[#3b2503]",
    soft: "bg-twice-soft text-twice-text",
    glyph: "×2",
  },
  unpaid: {
    name: "Paid ₹0",
    tile: "bg-unpaid text-white",
    soft: "bg-unpaid-soft text-unpaid-text",
    glyph: "₹0",
  },
  pending: {
    name: "Pending",
    tile: "bg-pending text-pending-text",
    soft: "bg-surface-2 text-muted",
    glyph: null,
  },
};

export const STATE_ORDER: StudentState[] = ["paid_once", "paid_twice", "unpaid", "pending"];
