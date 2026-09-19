/**
 * Same-test pairing, found from backend data only: the latest completed,
 * evaluated unprotected and protected runs of one experiment, and whether their
 * replay fingerprints (recorded on each run by the backend) are identical.
 */
import { useOverview, useRuns } from "./queries";
import type { Experiment, Run } from "./types";

export interface RunPair {
  experiment: Experiment | null;
  unprotected: Run | null;
  protected: Run | null;
  /** Both runs exist and carry the same fingerprint as each other and the experiment. */
  matched: boolean;
  loading: boolean;
  error: unknown;
}

const evaluated = (run: Run) => run.status === "COMPLETED" && run.verdict !== null;

export function pairFor(runs: Run[], experiment: Experiment | null): Omit<RunPair, "loading" | "error"> {
  if (!experiment) return { experiment, unprotected: null, protected: null, matched: false };
  // GET /runs is newest first.
  const mine = runs.filter((run) => run.experiment_id === experiment.experiment_id && evaluated(run));
  const unprotected = mine.find((run) => run.processor === "vulnerable") ?? null;
  const protectedRun = mine.find((run) => run.processor === "protected") ?? null;
  const matched = Boolean(
    unprotected &&
    protectedRun &&
    unprotected.fingerprint === protectedRun.fingerprint &&
    unprotected.fingerprint === experiment.fingerprint,
  );
  return { experiment, unprotected, protected: protectedRun, matched };
}

/** The golden experiment (the demo batch's seeded experiment) and its recorded pair. */
export function useGoldenPair(): RunPair {
  const overview = useOverview();
  const runs = useRuns();
  const experiment = overview.data?.demo.experiment ?? null;
  return {
    ...pairFor(runs.data ?? [], experiment),
    loading: overview.isLoading || runs.isLoading,
    error: overview.error ?? runs.error,
  };
}
