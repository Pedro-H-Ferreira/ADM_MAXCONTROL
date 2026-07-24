export const fluigActiveJobStatuses = [
  "queued",
  "agent_claimed",
  "authenticating",
  "opening_fluig",
  "reading_page",
  "filling_form",
  "submitting",
  "waiting_protocol",
  "syncing_result",
] as const;

export type FluigLifecycleStatus = (typeof fluigActiveJobStatuses)[number];

type FluigLifecycleJob = {
  operation: string;
  status: FluigLifecycleStatus;
  attempts: number;
  maxAttempts: number;
  updatedAt: string;
  expiresAt: string;
  nextAttemptAt?: string | null;
};

export type FluigLifecycleDecision =
  | { action: "keep" }
  | {
      action: "expire";
      label: string;
    }
  | {
      action: "retry";
      label: string;
      nextAttemptAt: string;
      expiresAt: string;
    };

const minute = 60 * 1000;

export function defaultFluigJobMaxAttempts(operation: string) {
  if (operation === "open_from_source" || operation === "attach_to_request" || operation === "cancel_request") return 1;
  if (operation === "health_check") return 2;
  return 3;
}

export function fluigJobQueueLifetimeMs(operation: string) {
  if (operation === "sync_history" || operation === "sync_initial_history" || operation === "supplier_lookup_by_cnpj") {
    return 6 * 60 * minute;
  }
  if (operation === "sync_user_incremental_batch") return 2 * 60 * minute;
  if (operation === "open_from_source" || operation === "attach_to_request" || operation === "cancel_request") return 60 * minute;
  if (operation === "health_check") return 15 * minute;
  return 90 * minute;
}

export function fluigJobLeaseTimeoutMs(operation: string) {
  if (operation === "sync_history" || operation === "sync_initial_history" || operation === "supplier_lookup_by_cnpj") {
    return 30 * minute;
  }
  if (operation === "open_from_source" || operation === "attach_to_request") return 20 * minute;
  return 15 * minute;
}

export function fluigJobRetryDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(attempts - 1, 4));
  return Math.min(5 * minute, 30_000 * 2 ** exponent);
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluateFluigJobLifecycle(
  job: FluigLifecycleJob,
  now = new Date()
): FluigLifecycleDecision {
  const nowMs = now.getTime();
  const expiresAtMs = timestamp(job.expiresAt);

  if (job.status === "queued") {
    if (expiresAtMs && expiresAtMs <= nowMs) {
      return {
        action: "expire",
        label: "Job expirou aguardando o executor interno da VPS. Tente novamente.",
      };
    }
    return { action: "keep" };
  }

  const updatedAtMs = timestamp(job.updatedAt);
  if (!updatedAtMs || nowMs - updatedAtMs < fluigJobLeaseTimeoutMs(job.operation)) {
    return { action: "keep" };
  }

  if (job.attempts >= job.maxAttempts) {
    const mutationWarning =
      job.operation === "open_from_source" || job.operation === "attach_to_request" || job.operation === "cancel_request"
        ? " O reenvio automatico foi bloqueado para evitar duplicidade; confira o Fluig antes de tentar novamente."
        : "";
    return {
      action: "expire",
      label: `Execucao interrompida sem retorno do executor da VPS apos ${job.attempts} tentativa(s).${mutationWarning}`,
    };
  }

  const nextAttemptAt = new Date(nowMs + fluigJobRetryDelayMs(job.attempts)).toISOString();
  const newExpiresAt = new Date(nowMs + fluigJobQueueLifetimeMs(job.operation)).toISOString();
  return {
    action: "retry",
    label: `Executor da VPS interrompeu a execucao. Nova tentativa ${job.attempts + 1}/${job.maxAttempts} agendada automaticamente.`,
    nextAttemptAt,
    expiresAt: newExpiresAt,
  };
}
