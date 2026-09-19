/**
 * TanStack Query hooks. Live screens poll: a run every 1 s and its student grid
 * every 2 s, and both stop polling once the run is terminal.
 */
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./client";
import type { Processor, Run } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => error instanceof ApiError && error.isTransient && failureCount < 6,
      retryDelay: (attempt) => Math.min(8000, 500 * 2 ** attempt) * (0.5 + Math.random() / 2),
    },
  },
});

export const keys = {
  overview: ["overview"] as const,
  runs: ["runs"] as const,
  run: (runId: string) => ["run", runId] as const,
  students: (runId: string) => ["students", runId] as const,
  student: (runId: string, beneficiaryId: string) => ["student", runId, beneficiaryId] as const,
  receipt: (runId: string) => ["receipt", runId] as const,
  evidence: (runId: string) => ["evidence", runId] as const,
  batches: ["batches"] as const,
  batch: (batchId: string) => ["batch", batchId] as const,
  experiment: (experimentId: string) => ["experiment", experimentId] as const,
};

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: api.overview,
    // Poll faster while something is running so results appear without a reload.
    refetchInterval: (query) => ((query.state.data?.active_runs.length ?? 0) > 0 ? 2000 : 10000),
  });
}

export function useRuns() {
  return useQuery({
    queryKey: keys.runs,
    queryFn: async () => (await api.listRuns()).items,
    refetchInterval: 10000,
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: keys.run(runId ?? ""),
    queryFn: async () => (await api.getRun(runId!)).run,
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data?.is_terminal ? false : 1000),
  });
}

/** `live` is true while the run is in progress; the grid then refreshes every 2 s. */
export function useStudents(runId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: keys.students(runId ?? ""),
    queryFn: () => api.students(runId!),
    enabled: Boolean(runId),
    refetchInterval: live ? 2000 : false,
  });
}

export function useStudent(runId: string | undefined, beneficiaryId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: keys.student(runId ?? "", beneficiaryId ?? ""),
    queryFn: () => api.student(runId!, beneficiaryId!),
    enabled: Boolean(runId && beneficiaryId),
    refetchInterval: live ? 2000 : false,
  });
}

export function useReceipt(runId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.receipt(runId ?? ""),
    queryFn: () => api.receipt(runId!),
    enabled: Boolean(runId) && enabled,
    staleTime: Infinity,
  });
}

export function useEvidence(runId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.evidence(runId ?? ""),
    queryFn: () => api.evidence(runId!),
    enabled: Boolean(runId) && enabled,
    staleTime: 5000,
  });
}

export function useBatches() {
  return useQuery({ queryKey: keys.batches, queryFn: async () => (await api.listBatches()).items });
}

export function useBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: keys.batch(batchId ?? ""),
    queryFn: () => api.getBatch(batchId!),
    enabled: Boolean(batchId),
  });
}

export function useExperiment(experimentId: string | undefined) {
  return useQuery({
    queryKey: keys.experiment(experimentId ?? ""),
    queryFn: () => api.getExperiment(experimentId!),
    enabled: Boolean(experimentId),
    staleTime: Infinity, // experiments are immutable
  });
}

export function useStartRun() {
  const client = useQueryClient();
  return useMutation<Run, ApiError, { experimentId: string; processor: Processor }>({
    mutationFn: async ({ experimentId, processor }) => (await api.startRun(experimentId, processor)).run,
    onSuccess: (run) => {
      client.setQueryData(keys.run(run.run_id), run);
      void client.invalidateQueries({ queryKey: keys.overview });
      void client.invalidateQueries({ queryKey: keys.runs });
    },
  });
}
