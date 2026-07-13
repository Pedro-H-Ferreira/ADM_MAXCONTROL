import { describe, expect, it } from "vitest";
import {
  buildProductDedupeKey,
  extractProductsFromFluigRequest,
  isGenericProductDescription,
  normalizeProductName,
  parseFluigMoneyCents,
} from "@/lib/products";

describe("extractProductsFromFluigRequest", () => {
  it("usa a tabela principal como identidade e apenas complementa valores pela numeracao", () => {
    const rows = extractProductsFromFluigRequest({
      fluigRequestId: "123",
      branchId: "branch-1",
      branchCode: "1017",
      branchLabel: "CD Goiania",
      formFields: {
        solProdutoServico___7: "Oleo BSE32",
        SolEspecTecnica___7: "Balde de 20 litros",
        solnumProdutoPedido___7: "2",
        solQtdProduto___7: "3",
        solUnMedidaProduto___7: "Balde",
        ItemSelect___1: "Descricao da cotacao que nao deve virar produto",
        especTecnica___1: "Especificacao secundaria",
        numProduto___1: "2",
        qtdProduto___1: "4,5",
        unMedidaProduto___1: "UN",
        valorProduto___1: "1.290,50",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fluigRequestId: "123",
      sourceTable: "solTabelaProdutos",
      sourceRowIndex: 7,
      sourceItemNumber: "2",
      name: "Oleo BSE32",
      specification: "Balde de 20 litros",
      quantity: "3",
      unit: "Balde",
      unitPriceCents: 129050,
      itemType: "MATERIAL",
      materialTypeLabel: "Material geral",
      classificationConfidence: 0.7,
      classificationSource: "DESCRIPTION_RULE",
      branchId: "branch-1",
      branchCode: "1017",
    });
    expect(rows[0].sourcePayload.secondaryComplement).toMatchObject({
      ItemSelect: "Descricao da cotacao que nao deve virar produto",
      qtdProduto: "4,5",
      unMedidaProduto: "UN",
    });
  });

  it("usa o indice como fallback de vinculo sem cadastrar a tabela secundaria", () => {
    const rows = extractProductsFromFluigRequest({
      fluigRequestId: "456",
      formFields: {
        solProdutoServico___3: "Filtro de oleo",
        solQtdProduto___3: "2",
        ItemSelect___3: "Filtro cotado",
        qtdProduto___3: "5",
        valorProduto___3: "27,70",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Filtro de oleo",
      quantity: "2",
      unitPriceCents: 2770,
      sourceTable: "solTabelaProdutos",
    });
  });

  it("usa ItemSelect e especTecnica apenas quando a request nao tem tabela principal", () => {
    const rows = extractProductsFromFluigRequest({
      fluigRequestId: "789",
      formFields: {
        ItemSelect___4: "Servico de limpeza",
        especTecnica___4: "Caixa de 35 mil litros",
        numProduto___4: "1",
        qtdProduto___4: "01",
        unMedidaProduto___4: "Caixa",
        valorProduto___4: "3.800,00",
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceTable: "tabelaProdutos",
      sourceRowIndex: 4,
      name: "Servico de limpeza",
      specification: "Caixa de 35 mil litros",
      quantity: "1",
      unit: "Caixa",
      unitPriceCents: 380000,
    });
  });
});

describe("normalizacao de produtos", () => {
  it("normaliza acentos e pontuacao sem fazer merge fuzzy", () => {
    expect(normalizeProductName("  Oleo BSE-32  ")).toBe("OLEO BSE 32");
    expect(buildProductDedupeKey("Oleo BSE-32", "20 litros")).toBe(
      buildProductDedupeKey("oleo bse 32", "20 LITROS")
    );
    expect(buildProductDedupeKey("Oleo BSE-32", "20 litros")).not.toBe(
      buildProductDedupeKey("Oleo BSE-32", "35 litros")
    );
  });

  it("isola descricoes genericas por ocorrencia e exige revisao", () => {
    const first = extractProductsFromFluigRequest({
      fluigRequestId: "100",
      formFields: { solProdutoServico___1: "PEDIDO EM ANEXO" },
    })[0];
    const second = extractProductsFromFluigRequest({
      fluigRequestId: "101",
      formFields: { solProdutoServico___1: "PEDIDO EM ANEXO" },
    })[0];

    expect(isGenericProductDescription("EPI", null)).toBe(true);
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.sku).not.toBe(second.sku);
    expect(first).toMatchObject({
      itemType: "INDEFINIDO",
      classificationConfidence: 0,
      classificationSource: "GENERIC_DESCRIPTION",
      reviewRequired: true,
    });
  });

  it("le a categoria financeira dos campos corretos da request", () => {
    const row = extractProductsFromFluigRequest({
      fluigRequestId: "102",
      formFields: {
        contaCentroCusto: "5150103",
        codContaFin: "5150103 - MATERIAL DE LIMPEZA",
        centroCusto: "AREA QUE NAO E CATEGORIA",
        solProdutoServico___1: "Material de limpeza",
      },
    })[0];

    expect(row).toMatchObject({
      categoryCode: "5150103",
      categoryLabel: "5150103 - MATERIAL DE LIMPEZA",
      itemType: "MATERIAL",
      materialTypeLabel: "Limpeza e higiene",
    });
  });

  it("usa a categoria do Fluig para diferenciar servico e material", () => {
    const service = extractProductsFromFluigRequest({
      fluigRequestId: "103",
      formFields: {
        codContaFin: "5060108 - LOCACAO DE EMPILHADEIRA",
        solProdutoServico___1: "01 EMPILHADEIRA GASEIRA",
      },
    })[0];
    const material = extractProductsFromFluigRequest({
      fluigRequestId: "104",
      formFields: {
        codContaFin: "121000 - IMOBILIZADO",
        solProdutoServico___1: "Notebook Dell I5",
      },
    })[0];

    expect(service).toMatchObject({ itemType: "SERVICO", classificationConfidence: 0.75 });
    expect(material).toMatchObject({
      itemType: "MATERIAL",
      materialTypeLabel: "TI e comunicacao",
      classificationConfidence: 0.7,
    });
  });

  it("assume material revisavel quando o catalogo de compras nao tem sinal forte", () => {
    const row = extractProductsFromFluigRequest({
      fluigRequestId: "105",
      formFields: { solProdutoServico___1: "Porta de acesso" },
    })[0];

    expect(row).toMatchObject({
      itemType: "MATERIAL",
      classificationConfidence: 0.55,
      classificationSource: "PURCHASE_CATALOG_DEFAULT",
      reviewRequired: true,
    });
  });

  it("converte valores monetarios pt-BR para centavos", () => {
    expect(parseFluigMoneyCents("13.862,38")).toBe(1386238);
    expect(parseFluigMoneyCents("27,70")).toBe(2770);
    expect(parseFluigMoneyCents(12.5)).toBe(1250);
  });
});
