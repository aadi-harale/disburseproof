/**
 * Typed API client. Every request goes through `request`, which turns HTTP
 * errors into `ApiError` carrying the backend's code, message and request ID,
 * so screens can show exactly what the server said.
 */
import type {
  BatchDetail,
  Batch,
  CsvPreview,
  Evidence,
  Experiment,
  ExperimentDetail,
  FieldError,
  Overview,
  Processor,
  Race,
  RaceDetail,
  ReceiptResponse,
  Run,
  StudentDetail,
  StudentsResponse,
} from "./types";

export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details: FieldError[];

  constructor(status: number, code: string, message: string, requestId?: string, details: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Worth retrying automatically: throttled, network failure or a server error. */
  get isTransient(): boolean {
    return this.status === 429 || this.status >= 500 || this.code === "NETWORK";
  }
}

/* ---- Rate-limit signal -------------------------------------------------------
 * The public API is throttled to 10 requests/second for all visitors together.
 * When a 429 arrives we record it so a banner can explain the pause. */
let rateLimitedUntil = 0;
const listeners = new Set<() => void>();

function noteRateLimited(): void {
  rateLimitedUntil = Date.now() + 6000;
  listeners.forEach((listener) => listener());
  window.setTimeout(() => listeners.forEach((listener) => listener()), 6100);
}

export const rateLimitStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  isLimited(): boolean {
    return Date.now() < rateLimitedUntil;
  },
};

async function request<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, "NOT_CONFIGURED", "The API URL is not configured (VITE_API_URL).");
  }
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      // GETs send no custom headers, so the browser does not need a CORS preflight.
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the API. Check your connection and try again.");
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = (
      body as { error?: { code?: string; message?: string; request_id?: string; details?: FieldError[] } }
    )?.error;
    if (response.status === 429 && !error) {
      // API Gateway stage throttling (no JSON error body). Our own hourly cost guard
      // also returns 429, but with an error body whose message is shown as is.
      noteRateLimited();
      throw new ApiError(429, "THROTTLED", "The public API is rate limited. Retrying shortly.");
    }
    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `The API returned HTTP ${response.status}.`,
      error?.request_id,
      error?.details ?? [],
    );
  }
  return body as T;
}

const encode = encodeURIComponent;

export const api = {
  overview: () => request<Overview>("/overview"),

  listRuns: () => request<{ items: Run[] }>("/runs"),
  getRun: (runId: string) => request<{ run: Run }>(`/runs/${encode(runId)}`),
  startRun: (experimentId: string, processor: Processor) =>
    request<{ run: Run }>("/runs", { method: "POST", body: { experiment_id: experimentId, processor } }),
  students: (runId: string) => request<StudentsResponse>(`/runs/${encode(runId)}/students`),
  student: (runId: string, beneficiaryId: string) =>
    request<StudentDetail>(`/runs/${encode(runId)}/students/${encode(beneficiaryId)}`),
  receipt: (runId: string) => request<ReceiptResponse>(`/runs/${encode(runId)}/receipt`),
  evidence: (runId: string) => request<Evidence>(`/runs/${encode(runId)}/evidence`),

  listBatches: () => request<{ items: Batch[] }>("/batches"),
  getBatch: (batchId: string) => request<BatchDetail>(`/batches/${encode(batchId)}`),
  generateBatch: (body: { name?: string; generate: { count: number; amount_paise: number } }) =>
    request<{ batch: Batch }>("/batches", { method: "POST", body }),
  previewCsv: (csv: string) =>
    request<{ preview: CsvPreview }>("/batches", { method: "POST", body: { csv, dry_run: true } }),
  uploadCsv: (body: { name?: string; csv: string }) =>
    request<{ batch: Batch }>("/batches", { method: "POST", body }),

  startRace: (processor: "naive" | "protected", copies: number) =>
    request<{ race: Race }>("/race", { method: "POST", body: { processor, copies } }),
  listRaces: () => request<{ items: Race[] }>("/races"),
  getRace: (runId: string) => request<RaceDetail>(`/races/${encode(runId)}`),

  getExperiment: (experimentId: string) => request<ExperimentDetail>(`/experiments/${encode(experimentId)}`),
  createExperiment: (body: { batch_id: string; seed: string; duplicate_count: number }) =>
    request<{ experiment: Experiment }>("/experiments", { method: "POST", body }),
};
