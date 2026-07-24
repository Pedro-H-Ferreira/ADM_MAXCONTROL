import { describe, expect, it } from "vitest";
import { getFluigJobProgress } from "@/lib/fluig-job-progress";

describe("getFluigJobProgress", () => {
  it("traduz a sincronizacao incremental e marca a consulta como etapa atual", () => {
    const progress = getFluigJobProgress({
      operation: "sync_user_incremental_batch",
      status: "reading_page",
      progressStage: "reading_page",
      progressLabel: "Consultando tarefas pendentes e solicitacoes abertas diretamente no Fluig.",
    });

    expect(progress.operationLabel).toBe("Sincronização de tarefas e solicitações");
    expect(progress.currentStepLabel).toBe("Consultando dados");
    expect(progress.currentStepIndex).toBe(4);
    expect(progress.description).toBe(
      "Consultando tarefas pendentes e solicitações abertas diretamente no Fluig.",
    );
    expect(progress.steps.map((step) => step.label)).not.toContain("Enviando");
  });

  it("inclui as etapas de preparacao e envio em operacoes que alteram o Fluig", () => {
    const progress = getFluigJobProgress({
      operation: "cancel_request",
      status: "waiting_protocol",
      progressStage: "waiting_protocol",
    });

    expect(progress.operationLabel).toBe("Cancelamento de solicitação");
    expect(progress.currentStepLabel).toBe("Enviando");
    expect(progress.steps.map((step) => step.label)).toContain("Preparando dados");
  });

  it("marca todas as etapas como concluidas quando o job termina com sucesso", () => {
    const progress = getFluigJobProgress({
      operation: "sync_status",
      status: "success",
      progressStage: "syncing_result",
    });

    expect(progress.terminalState).toBe("success");
    expect(progress.currentStepIndex).toBe(progress.steps.length - 1);
    expect(progress.currentStepLabel).toBe("Concluído");
  });
});
