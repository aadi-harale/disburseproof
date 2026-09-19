import { useCallback, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { cx } from "./cx";
import { Icon } from "./Icon";
import { ToastContext, type ToastInput } from "./toast-context";

interface Toast extends ToastInput {
  id: number;
}

let nextId = 1;

/** Toasts for finished runs. Announced politely to screen readers; auto-dismiss after 7 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-pop"
          >
            <span
              className={cx(
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                toast.tone === "success" && "bg-paid-soft text-paid-text",
                toast.tone === "danger" && "bg-unpaid-soft text-unpaid-text",
                (!toast.tone || toast.tone === "info") && "bg-accent-soft text-accent-text",
              )}
            >
              <Icon
                name={toast.tone === "success" ? "check" : toast.tone === "danger" ? "alert" : "info"}
                size={14}
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{toast.title}</p>
              {toast.body && <p className="mt-0.5 text-[13px] text-muted">{toast.body}</p>}
              {toast.href && (
                <Link
                  to={toast.href}
                  className="mt-1 inline-block text-[13px] font-medium text-accent-text hover:underline"
                >
                  Open run
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded p-1 text-faint hover:bg-surface-2 hover:text-ink"
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
