import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";

import { Badge } from "../components/ui/Badge";
import { cx } from "../components/ui/cx";
import { Icon } from "../components/ui/Icon";
import { ToastProvider } from "../components/ui/ToastProvider";
import { API_URL } from "../lib/api/client";
import { useOverview } from "../lib/api/queries";
import { useRateLimited } from "../lib/hooks";
import { useTheme } from "../lib/theme";

/** Primary: where people do their own work. Engineering: deep-dives for reviewers. */
const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/runs", label: "My runs", end: false },
  { to: "/batches", label: "Batches", end: false },
];
const ENGINEERING = [
  { to: "/compare", label: "Compare", hint: "Two runs of the same test, side by side" },
  { to: "/race", label: "Concurrency Lab", hint: "20 copies of one payment at the same moment" },
];
const REPO_URL = "https://github.com/aadi-harale/disburseproof";

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
        <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              {item.label}
            </NavLink>
          ))}
          <EngineeringMenu />
        </nav>
        <div className="flex-1 md:hidden" />
        {region && (
          // Wrapped: the badge sets its own display, which would override "hidden".
          <span className="hidden md:block">
            <Badge tone="muted">
              <span className="size-1.5 rounded-full bg-paid" aria-hidden /> AWS · {region}
            </Badge>
          </span>
        )}
        <MobileMenu />
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

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    "rounded-md px-2.5 py-1.5 text-[14px] font-medium whitespace-nowrap",
    isActive ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
  );

/** A small popover: closes on route change, outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [path, setPath] = useState(location.pathname);
  if (path !== location.pathname) {
    setPath(location.pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-3.5"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function EngineeringMenu() {
  const { open, setOpen, ref } = usePopover();
  const location = useLocation();
  const active = ENGINEERING.some((item) => location.pathname.startsWith(item.to));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[14px] font-medium",
          active || open ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
        )}
      >
        Engineering <Chevron />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {ENGINEERING.map((item) => (
            <Link key={item.to} to={item.to} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
              <span className="block text-[14px] font-medium">{item.label}</span>
              <span className="block text-[12.5px] text-muted">{item.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileMenu() {
  const { open, setOpen, ref } = usePopover();
  const itemClass = ({ isActive }: { isActive: boolean }) => cx(navClass({ isActive }), "block");
  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen(!open)}
        className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-5"
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path d={open ? "M5 5l10 10M15 5 5 15" : "M3 6h14M3 10h14M3 14h14"} />
        </svg>
      </button>
      {open && (
        <nav
          aria-label="Main"
          className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop"
        >
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={itemClass}>
              {item.label}
            </NavLink>
          ))}
          <div className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-[12px] font-medium text-faint uppercase">
            Engineering
          </div>
          {ENGINEERING.map((item) => (
            <NavLink key={item.to} to={item.to} className={itemClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
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
    <footer className="no-print border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-[13px] text-muted sm:px-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="font-semibold text-ink">
            Synthetic sandbox — no real money or personal data.
          </strong>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">
            GitHub repo
          </a>
          {!API_URL && <span className="text-unpaid-text">API URL not configured.</span>}
        </p>
        <p>
          Privacy: we store only the synthetic data you upload, for this demo. A PASS means every eligible
          student received exactly one synthetic payment under the tested workload. It is not a claim of
          exactly-once delivery, or about how any government or bank system is built.
        </p>
      </div>
    </footer>
  );
}
