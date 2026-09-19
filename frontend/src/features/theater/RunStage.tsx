import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "../../components/ui/cx";
import { ErrorState } from "../../components/ui/ErrorState";
import { useToast } from "../../components/ui/toast-context";
import { Icon } from "../../components/ui/Icon";
import { Skeleton } from "../../components/ui/Skeleton";
import { keys, useDeliveries, useRun, useStudents } from "../../lib/api/queries";
import type { Run } from "../../lib/api/types";
import { shortRunId } from "../../lib/format";
import { useOnChange } from "../../lib/hooks";
import { replaySchedule, type ReplaySpeed } from "./replay";
import { RunTheater } from "./RunTheater";
import { useReplay } from "./useReplay";
import { useRevealScroll } from "./useRevealScroll";

/**
 * One run on stage. A finished run is replayed from its recorded Deliveries rows
 * (demo pace or 1× real time); a running run is shown live, polling every 1.5 s.
 * `playToken` restarts the replay whenever it changes; `autoplayOnView` plays it the
 * first time the stage scrolls into view.
 */
export function RunStage({
  runId,
  initial = "final",
  playToken = 0,
  autoplayOnView = false,
  scrollOnClimax = false,
  verifiedSubline,
  onSelect,
  onRun,
  after,
  toolbar,
  toastOnFinish = false,
}: {
  runId: string;
  initial?: "empty" | "final";
  playToken?: number;
  autoplayOnView?: boolean;
  scrollOnClimax?: boolean;
  verifiedSubline?: string;
  onSelect?: (beneficiaryId: string) => void;
  onRun?: (run: Run) => void;
  /** Rendered under the climax once the verdict is shown. */
  after?: ReactNode;
  /** Shown at the start of the control bar (e.g. recorded/live switch). */
  toolbar?: ReactNode;
  /** Announce the verdict when a live run finishes while watched. */
  toastOnFinish?: boolean;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const runQuery = useRun(runId);
  const run = runQuery.data;
  const live = run ? !run.is_terminal : false;
  const students = useStudents(runId, live);
  const deliveries = useDeliveries(runId, live);
  const [speed, setSpeed] = useState<ReplaySpeed>("demo");
  const [view, setView] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 480px)").matches ? "list" : "grid",
  );

  // A live run just finished: fetch the final rows once and refresh every list that pairs runs.
  const onTerminal = useCallback(
    (was: boolean | undefined, now: boolean | undefined) => {
      if (was === false && now === true) {
        if (toastOnFinish && run) {
          toast({
            title:
              run.status === "FAILED"
                ? "Run finished without a verdict"
                : run.verdict === "PASS"
                  ? "Run finished: integrity verified"
                  : "Run finished: integrity failed",
            tone: run.verdict === "PASS" ? "success" : "danger",
            href: `/runs/${run.run_id}`,
          });
        }
        void students.refetch();
        void deliveries.refetch();
        void client.invalidateQueries({ queryKey: keys.runs });
        void client.invalidateQueries({ queryKey: keys.overview });
      }
    },
    [client, students, deliveries, toast, toastOnFinish, run],
  );
  useOnChange(run?.is_terminal, onTerminal);
  useEffect(() => {
    if (run) onRun?.(run);
  }, [run, onRun]);

  const rows = deliveries.data?.items;
  const schedule = useMemo(() => (rows && !live ? replaySchedule(rows, speed) : []), [rows, live, speed]);
  const replay = useReplay(schedule, initial);
  const ready = Boolean(run?.is_terminal && rows && students.data);

  // Play when asked (possibly before the data has loaded) or when first scrolled into view.
  const wanted = useRef(0);
  const played = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const { play } = replay;
  useEffect(() => {
    if (playToken > 0) wanted.current = playToken;
  }, [playToken]);
  useEffect(() => {
    if (ready && wanted.current > 0) {
      wanted.current = 0;
      played.current = true;
      play();
    }
  }, [ready, playToken, play, schedule]);
  useEffect(() => {
    if (!autoplayOnView || !ready || played.current || !container.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.intersectionRatio >= 0.35) && !played.current) {
          played.current = true;
          play();
        }
      },
      { threshold: [0.35] },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [autoplayOnView, ready, play]);

  const cursor = live ? (rows?.length ?? 0) : replay.cursor;
  const complete = Boolean(run?.is_terminal) && replay.status === "done";
  const climaxRef = useRevealScroll(complete && Boolean(run?.verdict), scrollOnClimax);

  if (runQuery.error) return <ErrorState error={runQuery.error} onRetry={() => runQuery.refetch()} compact />;
  if (!run) return <Skeleton className="h-[520px] w-full" />;

  const changeSpeed = (next: ReplaySpeed) => {
    setSpeed(next);
    // Restart at the new pace on the next render, once the schedule has changed.
    wanted.current = Date.now();
    played.current = true;
  };

  return (
    <div ref={container} className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2">
        {toolbar}
        {live ? (
          <p className="flex items-center gap-2 text-[14px]">
            <span className="size-2 animate-pulse rounded-full bg-paid" aria-hidden />
            <span className="font-medium">Live on AWS</span>
            <span className="figures text-muted">{shortRunId(run.run_id)} · updating every 1.5 s</span>
          </p>
        ) : (
          <p className="flex min-w-0 items-center gap-2 text-[14px]" aria-live="polite">
            <Icon
              name="play"
              size={14}
              className={cx(replay.status === "playing" ? "text-accent-text" : "text-faint")}
            />
            <span className="font-medium">
              {replay.status === "playing" ? "Replaying recorded run" : "Recorded run"}
            </span>
            <span
              className="figures truncate text-muted"
              title="Demo pace plays the same rows in the same order, evenly spaced over about 20 seconds. 1× real time uses the recorded timestamps."
            >
              {shortRunId(run.run_id)} · real data · {speed === "demo" ? "demo pace" : "1× real time"}
            </span>
          </p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!live && (
            <>
              <Segmented
                label="Replay speed"
                value={speed}
                options={[
                  ["demo", "Demo pace"],
                  ["real", "1× real time"],
                ]}
                onChange={(value) => changeSpeed(value as ReplaySpeed)}
              />
              {replay.status === "playing" ? (
                <SmallButton onClick={replay.skip}>Skip to result</SmallButton>
              ) : (
                <SmallButton
                  onClick={() => {
                    played.current = true;
                    play();
                  }}
                  disabled={!ready}
                >
                  <Icon name="play" size={12} /> {replay.status === "done" ? "Replay" : "Play"}
                </SmallButton>
              )}
            </>
          )}
        </div>
      </div>
      {deliveries.error && <ErrorState error={deliveries.error} compact />}
      <RunTheater
        run={run}
        entitlements={students.data?.items}
        deliveries={rows}
        cursor={cursor}
        complete={complete}
        view={view}
        viewToggle={
          <Segmented
            label="View"
            value={view}
            options={[
              ["grid", "Grid"],
              ["list", "List"],
            ]}
            onChange={(value) => setView(value as "grid" | "list")}
          />
        }
        onSelect={onSelect}
        verifiedSubline={verifiedSubline}
        climaxRef={climaxRef}
      />
      {complete && run.verdict && after}
    </div>
  );
}

function SmallButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line-strong p-0.5">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cx(
            "h-7 rounded-md px-2.5 text-[13px] font-medium",
            value === key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
