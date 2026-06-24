import { describe, expect, it } from "vitest";
import {
  historicalCnpjMatches,
  historicalCnpjVariants,
  mergeSuggestionWithEvidence,
  normalizedLookupDefaults,
  payloadFormFields,
} from "@/lib/supplier-lookup";

describe("supplier lookup", () => {
  it("gera variantes para historicos que perderam zeros a esquerda", () => {
    expect(historicalCnpjVariants("00801587000138")).toEqual(
      expect.arrayContaining(["00801587000138", "00.801.587/0001-38", "801587000138"])
    );
    expect(historicalCnpjMatches("801587000138", "00801587000138")).toBe(true);
    expect(historicalCnpjMatches("32858158000193", "00801587000138")).toBe(false);
  });

  it("extrai campos tanto do mapa quanto da lista retornada pelo Fluig", () => {
    expect(
      payloadFormFields({
        raw: {
          formFields: [
            { field: "unidadeFilial", value: "1022 - 1022-CA" },
            { field: "centroCusto", value: "4141001 - Fiscal Tributario" },
          ],
        },
      })
    ).toEqual({
      unidadeFilial: "1022 - 1022-CA",
      centroCusto: "4141001 - Fiscal Tributario",
    });

    expect(payloadFormFields({ latestFields: { naturezaSalva: "5040108 - SERVICOS" } })).toEqual({
      naturezaSalva: "5040108 - SERVICOS",
    });
  });

  it("normaliza filial, centro de custo, natureza e solicitacao modelo", () => {
    const defaults = normalizedLookupDefaults({
      latestFields: {
        unidadeFilial: "1022 - 1022-CA",
        centroCusto: "4141001 - Fiscal Tributario",
        codigonaturezaC: "5040108 - SERVICOS ADVOCATICIOS",
        formaPagamento: "TRANSFERENCIA",
      },
      sourceRequestId: "1160072",
    });

    expect(defaults).toMatchObject({
      branchCode: "1022",
      branchLabel: "1022 - 1022-CA",
      centroCusto: "4141001 - Fiscal Tributario",
      codCentroCusto: "4141001",
      natureza: "5040108 - SERVICOS ADVOCATICIOS",
      formaPagamento: "TRANSFERENCIA",
      latestRequest: "1160072",
    });
  });

  it("mescla evidencia sem duplicar solicitacoes e sinaliza revisao manual", () => {
    const result = mergeSuggestionWithEvidence(
      {
        cnpj: "32858158000193",
        razaoSocial: "IPE RESIDUOS E SERVICOS LTDA",
        defaultPayload: { centroCusto: "3111001 - OPERACAO LOJA" },
        sourceRequestIds: ["1160208"],
      },
      {
        latestRequestId: "1160209",
        branchCode: "1026",
        branchLabel: "1026 - 1026-CESAR L.",
        supplierName: "IPE RESIDUOS E SERVICOS LTDA",
        defaults: { natureza: "5030106 - RESIDUOS" },
        sourceRequestIds: ["1160208", "1160209"],
      }
    );

    expect(result.sourceRequestIds).toEqual(["1160208", "1160209"]);
    expect(result.autoFilledFields).toEqual(
      expect.arrayContaining(["CNPJ", "Razao social", "Filial mais usada", "Centro de custo", "Natureza de despesa"])
    );
    expect(result.reviewFields).toEqual(["Nome fantasia", "Categoria", "Contato", "Endereco"]);
  });
});
