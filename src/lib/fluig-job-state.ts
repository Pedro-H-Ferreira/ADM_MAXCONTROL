import type { FluigAdmJobSummary, FluigUserSyncStateRecord } from "@/lib/fluig-api";
import type { FluigJobRecord } from "@/lib/db/app-repository";

export type FluigProjectedState =
  | "idle"
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export type FluigProjectableJob = FluigAdmJobSummary | FluigJobRecord;

export type FluigJobStateProjection = {
  state: FluigProjectedState;
  source: "job" | "sync_state" | "none";
  terminal: boolean;
  busy: boolean;
  job: FluigProjectableJob | null;
  syncState: FluigUserSyncStateRecord | null;
  label: string;
  progressLabel: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
};

export type ProjectFluigJobStateInput = {
  jobs?: readonly FluigProjectableJob[] | null;
  syncState?: FluigUserSyncStateRecord | null;
};

const runningStatuses = new Set([
  "agent_claimed",
  "authenticating",
  "opening_fluig",
  "reading_page",
  "filling_form",
  "submitting",
  "waiting_protocol",
  "syncing_result",
  "running",
]);

const terminalStates = new Set<FluigProjectedState>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

const defaultLabels: Record<FluigProjectedState, string> = {
  idle: "Sem sincronizacao",
  queued: "Aguardando agente local",
  running: "Execucao em andamento",
  retry_wait: "Nova tentativa agendada",
  succeeded: "Sincronizado",
  failed: "Falha na sincronizacao",
  cancelled: "Execucao cancelada",
  expired: "Execucao expirada",
};

function optionalTimestamp(value: string | null | undefined) {
  return value || null;
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function newestJob(jobs: readonly FluigProjectableJob[]) {
  return [...jobs].sort(
    (left, right) =>
      timestamp(right.updatedAt || right.createdAt) - timestamp(left.updatedAt || left.createdAt)
  )[0] || null;
}

export function normalizeFluigJobState(
  status: string | null | undefined,
  nextAttemptAt?: string | null,
  updatedAt?: string | null
): FluigProjectedState | null {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "queued") {
    return nextAttemptAt && timestamp(nextAttemptAt) > timestamp(updatedAt) ? "retry_wait" : "queued";
  }
  if (normalized === "retry_wait") return "retry_wait";
  if (runningStatuses.has(normalized)) return "running";
  if (normalized === "success" || normalized === "succeeded") return "succeeded";
  if (normalized === "error" || normalized === "failed") return "failed";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  if (normalized === "expired") return "expired";
  return null;
}

export function fluigSyncStateJobId(syncState: FluigUserSyncStateRecord | null | undefined) {
  return syncState ? metadataText(syncState.metadata, "jobId") : null;
}

export function findCorrelatedFluigJob(
  jobs: readonly FluigProjectableJob[],
  syncState?: FluigUserSyncStateRecord | null
) {
  const jobId = fluigSyncStateJobId(syncState);
  if (!jobId) return null;
  return jobs.find((job) => job.id === jobId) || null;
}

function projectJob(job: FluigProjectableJob, state: FluigProjectedState): FluigJobStateProjection {
  const progressLabel = job.progressLabel || null;
  return {
    state,
    source: "job",
    terminal: terminalStates.has(state),
    busy: state === "queued" || state === "running" || state === "retry_wait",
    job,
    syncState: null,
    label: progressLabel || defaultLabels[state],
    progressLabel,
    errorMessage: job.errorMessage || null,
    createdAt: optionalTimestamp(job.createdAt),
    updatedAt: optionalTimestamp(job.updatedAt),
    finishedAt: optionalTimestamp(job.finishedAt),
    expiresAt: optionalTimestamp(job.expiresAt),
    nextAttemptAt: optionalTimestamp(job.nextAttemptAt),
    lastAttemptAt: optionalTimestamp(job.lastAttemptAt),
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
  };
}

function projectSyncState(syncState: FluigUserSyncStateRecord): FluigJobStateProjection {
  const successAt = timestamp(syncState.lastSuccessAt);
  const errorAt = timestamp(syncState.lastErrorAt);
  const state: FluigProjectedState =
    syncState.status === "started"
      ? "queued"
      : syncState.status === "error"
      ? "failed"
      : syncState.status === "success" && syncState.lastSuccessAt
        ? "succeeded"
        : syncState.lastErrorAt && errorAt > successAt
          ? "failed"
          : syncState.lastSuccessAt
            ? "succeeded"
            : "idle";
  const metadataLabel = metadataText(syncState.metadata, "progressLabel") || metadataText(syncState.metadata, "label");

  return {
    state,
    source: "sync_state",
    terminal: terminalStates.has(state),
    busy: state === "queued",
    job: null,
    syncState,
    label: metadataLabel || (state === "failed" ? syncState.lastErrorMessage : null) || defaultLabels[state],
    progressLabel: metadataLabel,
    errorMessage: state === "failed" ? syncState.lastErrorMessage : null,
    createdAt: syncState.createdAt,
    updatedAt: syncState.updatedAt,
    finishedAt: null,
    expiresAt: null,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSyncAt: syncState.lastSyncAt,
    lastSuccessAt: syncState.lastSuccessAt,
    lastErrorAt: syncState.lastErrorAt,
  };
}

export function projectFluigJobState({
  jobs = [],
  syncState = null,
}: ProjectFluigJobStateInput = {}): FluigJobStateProjection {
  const projectableJobs = (jobs || []).map((job) => ({
    job,
    state: normalizeFluigJobState(job.status, job.nextAttemptAt, job.updatedAt),
  }));
  const activeJob = newestJob(
    projectableJobs
      .filter(({ state }) => state === "queued" || state === "running" || state === "retry_wait")
      .map(({ job }) => job)
  );

  if (activeJob) {
    return projectJob(
      activeJob,
      normalizeFluigJobState(activeJob.status, activeJob.nextAttemptAt, activeJob.updatedAt) || "running"
    );
  }

  const terminalJobs = projectableJobs
    .filter(({ state }) => state && terminalStates.has(state))
    .map(({ job }) => job);
  const correlatedJobId = fluigSyncStateJobId(syncState);
  const terminalJob = correlatedJobId
    ? findCorrelatedFluigJob(terminalJobs, syncState)
    : newestJob(terminalJobs);

  if (terminalJob) {
    return projectJob(
      terminalJob,
      normalizeFluigJobState(terminalJob.status, terminalJob.nextAttemptAt, terminalJob.updatedAt) || "failed"
    );
  }

  if (syncState) return projectSyncState(syncState);

  return {
    state: "idle",
    source: "none",
    terminal: false,
    busy: false,
    job: null,
    syncState: null,
    label: defaultLabels.idle,
    progressLabel: null,
    errorMessage: null,
    createdAt: null,
    updatedAt: null,
    finishedAt: null,
    expiresAt: null,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
  };
}
