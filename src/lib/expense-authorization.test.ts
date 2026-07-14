import { describe, expect, it } from "vitest";
import { expenseAuthorizationSourceData } from "@/lib/expense-authorization";

describe("expenseAuthorizationSourceData", () => {
  it("preserva as referencias do pagamento ou da cotacao usadas na ADF", () => {
    expect(
      expenseAuthorizationSourceData({
        sourceRequestId: " Processo de Compras ",
        fieldOverrides: {
          dataPedido: " 14/07/2026 ",
          referenciaCotacao: " COT-184 ",
          vazio: "   ",
        },
      })
    ).toEqual({
      sourceRequestId: "Processo de Compras",
      sourceFields: {
        dataPedido: "14/07/2026",
        referenciaCotacao: "COT-184",
      },
    });
  });

  it("retorna uma origem vazia para snapshots antigos ou invalidos", () => {
    expect(expenseAuthorizationSourceData(null)).toEqual({ sourceRequestId: null, sourceFields: {} });
    expect(expenseAuthorizationSourceData([])).toEqual({ sourceRequestId: null, sourceFields: {} });
  });
});
