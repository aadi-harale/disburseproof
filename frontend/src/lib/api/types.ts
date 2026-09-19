/**
 * API response shapes: the single source of truth for what the backend returns.
 * Money is integer paise; timestamps are ISO-8601 UTC strings.
 */

export type Processor = "vulnerable" | "protected" | "naive";
export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export type RunPhase = "QUEUED" | "PHASE_A" | "PHASE_B" | "EVALUATING" | "COMPLETE" | "FAILED";
export type StudentState = "paid_once" | "paid_twice" | "unpaid" | "pending";
export type Verdict = "PASS" | "FAIL";
export type DeliveryOutcome = "COMMITTED" | "DUPLICATE_SUPPRESSED" | "BUDGET_EXHAUSTED";

export interface FieldError {
  field: string;
  message: string;
  line?: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; request_id: string; details?: FieldError[] };
}

export interface Invariant {
  id: "one_payment_per_entitlement" | "every_eligible_paid" | "budget_guard" | string;
  title: string;
  result: Verdict;
  detail: string;
}

export interface RunSummary {
  eligible_entitlements: number;
  deliveries: number;
  ledger_effects: number;
  paid_once: number;
  double_paid: number;
  unpaid: number;
  duplicates_suppressed: number;
  budget_exhausted: number;
  budget_paise: number;
  spent_paise: number;
  misallocated_paise: number;
  double_paid_entitlement_keys: string[];
  unpaid_entitlement_keys: string[];
  double_paid_beneficiary_ids: string[];
  unpaid_beneficiary_ids: string[];
}

export interface Run {
  run_id: string;
  experiment_id: string;
  batch_id: string;
  batch_name: string;
  fingerprint: string;
  processor: Processor;
  status: RunStatus;
  phase: RunPhase;
  created_at: string;
  started_at: string | null;
  phase_a_started_at: string | null;
  phase_b_started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  logical_events: number;
  duplicate_count: number;
  phase_a_target: number;
  expected_deliveries: number;
  total_budget_paise: number;
  budget_remaining_paise: number;
  delivered_count: number;
  committed_count: number;
  suppressed_count: number;
  budget_exhausted_count: number;
  summary: RunSummary | null;
  invariants: Invariant[] | null;
  verdict: Verdict | null;
  receipt_s3_key: string | null;
  receipt_sha256: string | null;
  sfn_execution_arn: string | null;
  failure_reason: string | null;
  failure_message: string | null;
  dlq_depth_at_failure: number | null;
  last_delivery_at: string | null;
  is_terminal: boolean;
  console_url: string | null;
  duration_ms: number | null;
}

export interface ExperimentDefinition {
  version: number;
  batch_id: string;
  batch_content_sha256: string;
  seed: string;
  logical_events: number;
  duplicate_count: number;
  duplicated_logical_ids: string[];
  phase_a: string[];
  phase_b: string[];
  scenario: string;
}

export interface Experiment {
  experiment_id: string;
  batch_id: string;
  batch_name: string;
  seed: string;
  duplicate_count: number;
  logical_events: number;
  duplicated_logical_ids: string[];
  phase_a: string[];
  phase_b: string[];
  fingerprint: string;
  created_at: string;
  expected_deliveries: number;
  phase_a_deliveries: number;
  definition: ExperimentDefinition;
}

export interface LogicalEvent {
  logical_event_id: string;
  beneficiary_id: string;
  display_name: string;
  installment: number;
  amount_paise: number;
  phase: "A" | "B";
}

export interface ExperimentDetail {
  experiment: Experiment;
  logical_events: LogicalEvent[];
}

export interface Batch {
  batch_id: string;
  name: string;
  scheme_id: string;
  academic_year: string;
  total_budget_paise: number;
  count: number;
  content_sha256: string;
  source: "demo" | "generated" | "csv";
  created_at: string;
}

export interface Entitlement {
  beneficiary_id: string;
  display_name: string;
  amount_paise: number;
  installment: number;
}

export interface BatchDetail {
  batch: Batch;
  entitlements: Entitlement[];
  experiments: Experiment[];
}

export interface CsvRowPreview {
  line: number;
  values: Record<string, string>;
  errors: string[];
}

export interface CsvPreview {
  valid: boolean;
  rows: CsvRowPreview[];
  errors: FieldError[];
  entitlements: number;
  total_budget_paise: number;
  max_rows: number;
}

export interface StudentTile {
  entitlement_key: string;
  beneficiary_id: string;
  display_name: string;
  installment: number;
  amount_paise: number;
  state: StudentState;
  payments: number;
  deliveries: number;
}

export interface StudentsResponse {
  run_id: string;
  status: RunStatus;
  counts: Record<StudentState, number>;
  items: StudentTile[];
}

export interface DeliveryRecord {
  delivery_id: string;
  logical_event_id: string;
  entitlement_key: string;
  installment: number;
  phase: "A" | "B";
  copy_index: number;
  duplicate_of: string | null;
  outcome: DeliveryOutcome;
  processed_at: string;
  lambda_request_id: string;
  attempt: number;
  effect_id: string | null;
  budget_remaining_paise_at_rejection: number | null;
}

export interface StudentDetail {
  run: Run;
  student: { beneficiary_id: string; display_name: string };
  entitlements: StudentTile[];
  deliveries: DeliveryRecord[];
  payments: {
    effect_id: string;
    entitlement_key: string;
    amount_paise: number;
    delivery_id: string;
    committed_at: string;
  }[];
  rejections: DeliveryRecord[];
  double_paid_students: { beneficiary_id: string; display_name: string; payments: number }[];
}

export interface Overview {
  demo: { batch: Batch | null; experiment: Experiment | null };
  latest: { vulnerable: Run | null; protected: Run | null };
  active_runs: Run[];
  max_active_runs: number;
  region: string;
}

export interface Receipt {
  receipt_version: number;
  kind: string;
  run_id: string;
  processor: Processor;
  experiment_id: string;
  replay_fingerprint: string;
  batch: {
    batch_id: string;
    name: string;
    scheme_id: string;
    academic_year: string;
    entitlements: number;
    total_budget_paise: number;
    content_sha256: string;
  };
  counts: {
    deliveries: number;
    ledger_effects: number;
    paid_once: number;
    double_paid: number;
    unpaid: number;
    duplicates_suppressed: number;
    budget_exhausted: number;
    spent_paise: number;
    misallocated_paise: number;
  };
  double_paid_beneficiary_ids: string[];
  unpaid_beneficiary_ids: string[];
  invariants: Invariant[];
  verdict: Verdict;
  execution: {
    step_functions_execution_arn: string;
    started_at: string;
    finished_at: string;
    duration_ms: number;
  };
  claim_boundary: string;
}

export interface ReceiptResponse {
  run_id: string;
  s3_bucket: string;
  s3_key: string;
  sha256: string;
  sha256_recomputed: string;
  sha256_matches: boolean;
  receipt: Receipt;
  receipt_json: string;
}

export interface EvidenceState {
  name: string;
  type: string;
  runs: number;
  total_ms: number;
  first_entered_at: string;
}

export interface EvidenceLogLine {
  source: "worker" | "workflow";
  timestamp: number;
  message: Record<string, unknown> | string;
}

export interface Evidence {
  run_id: string;
  region: string;
  execution_arn: string | null;
  console_url: string | null;
  states: EvidenceState[];
  steps: { name: string; type: string; entered_at: string; duration_ms: number | null }[];
  queue: { visible: number; in_flight: number; dlq_visible: number };
  log_groups: string[];
  logs: EvidenceLogLine[];
}

export interface RaceSummary {
  copies: number;
  recorded: number;
  payments: number;
  suppressed: number;
  extra_payments: number;
  overpaid_paise: number;
}

export interface Race {
  run_id: string;
  processor: "naive" | "protected";
  copies: number;
  race_window_ms: number;
  amount_paise: number;
  status: RunStatus;
  phase: string;
  created_at: string;
  finished_at: string | null;
  verdict: Verdict | null;
  race: RaceSummary | null;
  failure_reason: string | null;
  failure_message: string | null;
  is_terminal: boolean;
  console_url: string | null;
}

export interface RaceLane {
  copy_index: number;
  outcome: DeliveryOutcome;
  processed_at: string;
  attempt: number;
  lambda_request_id: string;
}

export interface RaceDetail {
  race: Race;
  lanes: RaceLane[];
  payments_so_far: number;
}
