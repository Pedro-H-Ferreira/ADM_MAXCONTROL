import { describe, expect, it } from "vitest";
import { buildSupplierCandidates } from "@/lib/db/fluig-repository";
import type { FluigHistoryItem } from "@/lib/fluig/server-client";

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
});
