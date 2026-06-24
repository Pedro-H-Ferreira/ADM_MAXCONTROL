import { describe, expect, it } from "vitest";
import {
  consolidateSupplierPreRegistrations,
  supplierLegalName,
} from "@/lib/supplier-pre-registration";

describe("supplier pre-registration", () => {
  it("remove codigo Fluig e CNPJ do nome juridico exibido", () => {
    expect(
      supplierLegalName(
        "2755860 - TOTVS S.A. - RIBEIRAO PRETO - 53113791003490",
        "53113791003490",
        "2755860"
      )
    ).toBe("TOTVS S.A. - RIBEIRAO PRETO");
  });

  it("consolida candidatos que representam o mesmo CNPJ canonico", () => {
    const result = consolidateSupplierPreRegistrations([
      {
        id: "candidate-a",
        candidateKey: "801587000138",
        supplierName: "2119453 - IRONBR AMBIENTE SEGURO LTDA - 801587000138",
        cnpj: "801587000138",
        fluigCode: "2119453",
        confidence: 0.95,
        sourceRequestIds: ["1164218"],
        suggestedDefaults: { unidadeFilial: "1016 - 1016-SAD" },
      },
      {
        id: "candidate-b",
        candidateKey: "00801587000138",
        supplierName: "2119453 - IRONBR AMBIENTE SEGURO LTDA - 00801587000138",
        cnpj: "00801587000138",
        fluigCode: "2119453",
        confidence: 0.95,
        sourceRequestIds: ["1164219"],
        suggestedDefaults: { centroCusto: "3311003 - EXPANSAO MANUTENCAO" },
      },
    ]);

    expect(result.invalidCnpj).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      cnpj: "00801587000138",
      razaoSocial: "IRONBR AMBIENTE SEGURO LTDA",
      fluigCode: "2119453",
      sourceRequestIds: ["1164218", "1164219"],
    });
    expect(result.items[0].defaultPayload).toMatchObject({
      branchCode: "1016",
      centroCusto: "3311003 - EXPANSAO MANUTENCAO",
    });
  });

  it("ignora identificadores que nao podem ser validados como CNPJ", () => {
    const result = consolidateSupplierPreRegistrations([
      {
        supplierName: "Pessoa sem CNPJ",
        cnpj: "7182631113",
      },
    ]);

    expect(result.items).toEqual([]);
    expect(result.invalidCnpj).toBe(1);
  });
});
