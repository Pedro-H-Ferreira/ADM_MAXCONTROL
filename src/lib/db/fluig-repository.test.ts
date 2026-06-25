import { describe, expect, it } from "vitest";
import {
  buildFluigHistoryRequestRow,
  buildFluigStatusRequestRow,
  buildSupplierCandidates,
} from "@/lib/db/fluig-repository";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";

function historyItem(
  processInstanceId: string,
  overrides: Partial<FluigHistoryItem["formFields"]> = {}
): FluigHistoryItem {
  return {
    processInstanceId,
    processId: "Atendimento Central de Lancamento - CONSINCO",
    processVersion: "162",
    status: "OPEN",
    startDate: "2026-06-01T00:00:00.000Z",
    requesterId: "00101",
    requesterName: "Administrativo",
    sourceUrl: "https://fluig.example/request",
    raw: {},
    formFields: {
      fornecedorC: "2119453 - IRONBR AMBIENTE SEGURO LTDA - 00801587000138",
      codCNPJ: "00801587000138",
      unidadeFilial: "1016 - 1016-SAD",
      centroCusto: "3311003 - EXPANSAO MANUTENCAO",
      codCentroCusto: "3311003",
      codigonaturezaC: "5030101 - MANUTENCAO",
      ...overrides,
    },
  };
}

describe("buildSupplierCandidates", () => {
  it("deduplica o mesmo fornecedor e preserva as solicitacoes de origem", () => {
    const candidates = buildSupplierCandidates([
      historyItem("1164218"),
      historyItem("1164219", { unidadeFilial: "1016 - 1016-SAD" }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      cnpj: "00801587000138",
      confidence: 0.95,
    });
    expect(candidates[0].sourceRequestIds).toEqual(["1164218", "1164219"]);
    expect(candidates[0].suggestedDefaults).toMatchObject({
      sourceRequestId: "1164218",
      unidadeFilial: "1016 - 1016-SAD",
      codCentroCusto: "3311003",
    });
  });

  it("usa os campos reais do formulario quando a API historica nao retorna solicitante", () => {
    const item = historyItem("1164220", {
      responsavelEnvio: "Administrativo DVA CD",
      matResponsavelEnvio: "00130",
    });
    item.requesterId = null;
    item.requesterName = null;

    expect(buildFluigHistoryRequestRow("pagamentos", item)).toMatchObject({
      requester: "Administrativo DVA CD",
      fluig_requester_login: "Administrativo DVA CD",
      fluig_requester_code: "00130",
    });
  });

  it("preserva formulario historico e etapa anterior quando o status vem parcial", () => {
    const statusItem: FluigStatusItem = {
      numeroFluig: "1164220",
      statusProcesso: "em_andamento",
      active: true,
      responsavelCodigo: "00130",
      dataUltimaConsulta: "2026-06-25T10:00:00.000Z",
    };

    const row = buildFluigStatusRequestRow(
      "pagamentos",
      statusItem,
      { ownerUserId: "2ff30ac3-e1c7-4df8-a12c-511318469cca", syncSource: "sync_user_open_tasks" },
      {
        status: "OPEN",
        current_task: "Realizar pagamento",
        task_owner: null,
        due_date: "2026-06-30",
        raw_payload: {
          formFields: {
            fornecedorC: "Fornecedor existente",
          },
        },
      }
    );

    expect(row).toMatchObject({
      current_task: "Realizar pagamento",
      task_owner: "00130",
      due_date: "2026-06-30",
      sync_owner_user_id: "2ff30ac3-e1c7-4df8-a12c-511318469cca",
      raw_payload: {
        formFields: {
          fornecedorC: "Fornecedor existente",
        },
        statusSnapshot: statusItem,
      },
    });
  });
});
