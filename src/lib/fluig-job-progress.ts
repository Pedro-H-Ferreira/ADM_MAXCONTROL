export type FluigJobProgressInput = {
  operation: string;
  status: string;
  progressStage?: string | null;
  progressLabel?: string | null;
};

export type FluigJobProgressStep = {
  id: string;
  label: string;
  statuses: string[];
};

export type FluigJobProgressPresentation = {
  operationLabel: string;
  description: string;
  currentStepIndex: number;
  currentStepLabel: string;
  steps: FluigJobProgressStep[];
  terminalState: "success" | "error" | null;
};

const operationLabels: Record<string, string> = {
  sync_history: "Sincronização do histórico",
  sync_status: "Atualização do status",
  open_from_source: "Abertura de solicitação",
  attach_to_request: "Inclusão de anexo na solicitação",
  cancel_request: "Cancelamento de solicitação",
  health_check: "Teste de conexão com o Fluig",
  sync_initial_history: "Sincronização inicial do histórico",
  sync_user_open_tasks: "Sincronização das tarefas do usuário",
  sync_user_open_requests: "Sincronização das solicitações do usuário",
  sync_user_incremental_batch: "Sincronização de tarefas e solicitações",
  sync_request_by_number: "Consulta de solicitação por número",
  supplier_lookup_by_cnpj: "Consulta de fornecedor por CNPJ",
};

const mutationOperations = new Set([
  "open_from_source",
  "attach_to_request",
  "cancel_request",
]);

const commonStartSteps: FluigJobProgressStep[] = [
  { id: "queued", label: "Na fila", statuses: ["queued", "pending"] },
  { id: "started", label: "Iniciando", statuses: ["agent_claimed", "running", "processing"] },
  { id: "auth", label: "Autenticando", statuses: ["authenticating", "login"] },
  { id: "open", label: "Abrindo o Fluig", statuses: ["opening_fluig", "open", "request"] },
];

const readOnlySteps: FluigJobProgressStep[] = [
  ...commonStartSteps,
  { id: "read", label: "Consultando dados", statuses: ["reading_page", "filling_form", "submitting", "waiting_protocol"] },
  { id: "save", label: "Salvando no ADM", statuses: ["syncing_result"] },
  { id: "done", label: "Concluído", statuses: ["success", "succeeded"] },
];

const mutationSteps: FluigJobProgressStep[] = [
  ...commonStartSteps,
  { id: "prepare", label: "Preparando dados", statuses: ["reading_page", "filling_form"] },
  { id: "send", label: "Enviando", statuses: ["submitting", "waiting_protocol"] },
  { id: "save", label: "Salvando no ADM", statuses: ["syncing_result"] },
  { id: "done", label: "Concluído", statuses: ["success", "succeeded"] },
];

function normalizeStatus(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function fallbackOperationLabel(operation: string) {
  const words = operation
    .trim()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
  return words ? words.charAt(0).toLocaleUpperCase("pt-BR") + words.slice(1) : "Execução no Fluig";
}

function progressDescription(status: string, operation: string, fallback?: string | null) {
  if (status === "queued" || status === "pending") return "Aguardando o executor interno da VPS.";
  if (status === "agent_claimed" || status === "running" || status === "processing") {
    return "O executor da VPS iniciou esta execução.";
  }
  if (status === "authenticating" || status === "login") {
    return "Entrando no Fluig com as credenciais configuradas.";
  }
  if (status === "opening_fluig" || status === "open" || status === "request") {
    return "Abrindo a área necessária no Fluig.";
  }
  if (status === "reading_page") {
    return operation === "sync_user_incremental_batch"
      ? "Consultando tarefas pendentes e solicitações abertas diretamente no Fluig."
      : "Consultando e conferindo os dados disponíveis no Fluig.";
  }
  if (status === "filling_form") return "Preenchendo os dados no formulário do Fluig.";
  if (status === "submitting") return "Enviando as informações ao Fluig.";
  if (status === "waiting_protocol") return "Aguardando a confirmação do Fluig.";
  if (status === "syncing_result") return "Salvando o retorno do Fluig no painel administrativo.";
  if (status === "success" || status === "succeeded") return "Execução concluída com sucesso.";
  if (status === "error" || status === "failed") return "A execução foi interrompida por uma falha.";
  if (status === "cancelled" || status === "canceled") return "A execução foi cancelada.";
  if (status === "expired") return "O tempo limite da execução foi atingido.";
  return fallback?.trim() || "Acompanhando a execução no Fluig.";
}

export function getFluigJobProgress(
  job: FluigJobProgressInput,
): FluigJobProgressPresentation {
  const status = normalizeStatus(job.status);
  const stage = normalizeStatus(job.progressStage) || status;
  const steps = mutationOperations.has(job.operation) ? mutationSteps : readOnlySteps;
  const terminalState =
    status === "success" || status === "succeeded"
      ? "success"
      : ["error", "failed", "cancelled", "canceled", "expired"].includes(status)
        ? "error"
        : null;

  let currentStepIndex = steps.findIndex((step) => step.statuses.includes(stage));
  if (terminalState === "success") currentStepIndex = steps.length - 1;
  if (currentStepIndex < 0) {
    currentStepIndex = steps.findIndex((step) => step.statuses.includes(status));
  }
  if (currentStepIndex < 0) currentStepIndex = 0;

  return {
    operationLabel: operationLabels[job.operation] || fallbackOperationLabel(job.operation),
    description: progressDescription(stage, job.operation, job.progressLabel),
    currentStepIndex,
    currentStepLabel: steps[currentStepIndex]?.label || "Em andamento",
    steps,
    terminalState,
  };
}
