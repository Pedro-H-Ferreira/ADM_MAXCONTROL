import { describe, expect, it } from "vitest";
import {
  formatPurchaseItemsForFluig,
  operationalLaunchFingerprint,
  parseCurrencyToCents,
  validateOperationalLaunch,
  type OperationalLaunchValidateInput,
} from "@/lib/operational-launch";

function validPayment(overrides: Partial<OperationalLaunchValidateInput> = {}): OperationalLaunchValidateInput {
  return {
    module: "pagamentos",
    sourceRequestId: "1163476",
    title: "Pagamento mensal",
    supplierId: "64578ca8-a0e0-42ca-bb44-5df1c5249cc7",
    supplierName: "Fornecedor Exemplo",
    supplierCnpj: "12345678000199",
    branchCode: "1060",
    branchLabel: "1060 - Matriz",
    amountCents: 123456,
    dueDate: "2026-06-30",
    fieldOverrides: {
      fornecedorC: "Fornecedor Exemplo",
      codCNPJ: "12345678000199",
      unidadeFilial: "1060 - Matriz",
      codigonaturezaC: "Servicos",
      centroCusto: "8111001 - CD LOGISTICA",
      formaPagamento: "Boleto",
      nNotaFiscal: "123",
      dataEmissaoNF: "24/06/2026",
      vencPagNota: "30/06/2026",
      valorNF: "1.234,56",
      descricaoDemandaEnvio: "Pagamento referente a junho.",
    },
    attachments: [{ name: "nota.pdf", mimeType: "application/pdf", size: 1024 }],
    ...overrides,
  };
}

describe("operational launch rules", () => {
  it("converte valores brasileiros em centavos", () => {
    expect(parseCurrencyToCents("R$ 1.234,56")).toBe(123456);
    expect(parseCurrencyToCents("99,90")).toBe(9990);
    expect(parseCurrencyToCents("-1,00")).toBeNull();
    expect(parseCurrencyToCents("invalido")).toBeNull();
  });

  it("formata itens de compra para o campo de negocio do Fluig", () => {
    const formatted = formatPurchaseItemsForFluig([
      { description: "Filtro de ar", quantity: 2, unit: "UN", unitPriceCents: 2590 },
      { description: "Cabo eletrico", quantity: 10.5, unit: "M", unitPriceCents: 750 },
    ]).replace(/\u00a0/g, " ");

    expect(formatted).toContain("1. Filtro de ar - 2 UN - R$ 25,90 por unidade");
  });

  it("altera a impressao digital quando itens ou anexos mudam", () => {
    const base = {
      sourceRequestId: "123",
      fieldOverrides: { centroCusto: "8111001" },
      attachments: [{ name: "cotacao.pdf", mimeType: "application/pdf", size: 100 }],
      items: [{ description: "Material", quantity: 1, unit: "UN", unitPriceCents: 1000 }],
    };

    expect(operationalLaunchFingerprint(base)).not.toBe(
      operationalLaunchFingerprint({
        ...base,
        attachments: [{ ...base.attachments[0], size: 101 }],
      })
    );
    expect(operationalLaunchFingerprint(base)).not.toBe(
      operationalLaunchFingerprint({
        ...base,
        items: [{ ...base.items[0], quantity: 2 }],
      })
    );
  });

  it("exige fornecedor oficial e documento fiscal para pagamentos", () => {
    expect(validateOperationalLaunch(validPayment())).toEqual([]);
    expect(
      validateOperationalLaunch(
        validPayment({
          supplierId: null,
          attachments: [{ name: "foto.jpg", mimeType: "image/jpeg", size: 1024 }],
        })
      )
    ).toEqual([
      "Selecione um fornecedor oficial ativo do cadastro ADM.",
      "Anexe ao menos um PDF ou XML da nota fiscal.",
    ]);
  });

  it("exige ao menos um item estruturado para compras", () => {
    const errors = validateOperationalLaunch({
      module: "compras",
      sourceRequestId: "427",
      title: "Compra",
      branchCode: "1060",
      branchLabel: "1060 - Matriz",
      fieldOverrides: {
        dataPedido: "24/06/2026",
        codFilialPedido: "1060 - Matriz",
        centroCusto: "8111001 - CD LOGISTICA",
        contaCentroCusto: "Material de consumo",
        descricaoProduto: "Item pendente",
      },
      attachments: [],
      items: [],
    });

    expect(errors).toContain("Adicione ao menos um item na requisicao de compra.");
  });
});
