import { NavLink, Outlet, ScrollRestoration } from "react-router";

import { Badge } from "../components/ui/Badge";
import { cx } from "../components/ui/cx";
import { Icon } from "../components/ui/Icon";
import { ToastProvider } from "../components/ui/ToastProvider";
import { API_URL } from "../lib/api/client";
import { useOverview } from "../lib/api/queries";
import { useRateLimited } from "../lib/hooks";
import { useTheme } from "../lib/theme";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/runs", label: "Runs", end: false },
  { to: "/compare", label: "Compare", end: false },
  { to: "/batches", label: "Batches", end: false },
];

export function AppLayout() {
  // Inside the router, so toasts can link to runs.
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <Header />
        <RateLimitBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
        <Footer />
        <ScrollRestoration />
      </div>
    </ToastProvider>
  );
}

function Header() {
  const overview = useOverview();
  const [theme, toggleTheme] = useTheme();
  const region = overview.data?.region;
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-[-0.01em]">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="hidden sm:inline">DisburseProof</span>
        </NavLink>
        <nav aria-label="Main" className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "rounded-md px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap",
                  isActive ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {region && (
          // Wrapped: the badge sets its own display, which would override "hidden".
          <span className="hidden md:block">
            <Badge tone="muted">
              <span className="size-1.5 rounded-full bg-paid" aria-hidden /> AWS · {region}
            </Badge>
          </span>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>
    </header>
  );
}

function RateLimitBanner() {
  const limited = useRateLimited();
  if (!limited) return null;
  return (
    <div role="status" className="no-print border-b border-twice/40 bg-twice-soft">
      <p className="mx-auto max-w-7xl px-4 py-2 text-[13px] text-twice-text sm:px-6">
        The public API allows 10 requests per second for all visitors together. Pausing briefly and retrying
        automatically.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-[12.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <strong className="font-semibold text-ink">
            Synthetic sandbox — no real money or personal data.
          </strong>{" "}
          No bank APIs, no Aadhaar, and no claim about how any government system is built.
        </p>
        <p className="sm:text-right">
          Verdicts mean one business effect per entitlement under the tested replay, not exactly-once
          delivery.
          {!API_URL && <span className="ml-1 text-unpaid-text">API URL not configured.</span>}
        </p>
      </div>
    </footer>
  );
}
