import { describe, expect, it } from "vitest";
import { expenseAuthorizationSourceData } from "@/lib/expense-authorization";
import {
  expenseAuthorizationCreateSchema,
  expenseAuthorizationUpdateSchema,
} from "@/lib/expense-authorization-validation";

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

describe("validacao da criacao e edicao de ADF", () => {
  it("aceita uma ADF manual sem lancamento operacional", () => {
    const parsed = expenseAuthorizationCreateSchema.safeParse({
      module: "pagamentos",
      creationSource: "MANUAL",
      issueDate: "2026-07-24",
      description: "Pagamento emergencial de manutencao.",
      branchId: null,
      invoiceNumber: null,
      invoiceDueDate: null,
      amountCents: 152300,
    });

    expect(parsed.success).toBe(true);
  });

  it("aceita os dados reconhecidos de PDF ou XML e mantem todos editaveis", () => {
    const created = expenseAuthorizationCreateSchema.safeParse({
      module: "pagamentos",
      creationSource: "DOCUMENTO_FISCAL",
      issueDate: "2026-07-20",
      description: "Nota fiscal 1987 de Fornecedor Teste",
      invoiceNumber: "1987",
      invoiceDueDate: "2026-08-10",
      supplierName: "Fornecedor Teste Ltda",
      supplierTaxId: "12.345.678/0001-90",
      sourceDocument: {
        name: "nf-1987.xml",
        mimeType: "application/xml",
        sourceType: "xml",
        warnings: [],
      },
    });
    const edited = expenseAuthorizationUpdateSchema.safeParse({
      module: "compras",
      branchId: null,
      supplierName: "Fornecedor Teste Atualizado",
      fluigRequestId: "1200456",
    });

    expect(created.success).toBe(true);
    expect(edited.success).toBe(true);
  });

  it("exige justificativa na criacao", () => {
    const parsed = expenseAuthorizationCreateSchema.safeParse({
      module: "pagamentos",
      creationSource: "MANUAL",
      issueDate: "2026-07-24",
      description: "",
    });

    expect(parsed.success).toBe(false);
  });
});
