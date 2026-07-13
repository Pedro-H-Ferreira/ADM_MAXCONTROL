import { describe, expect, it } from "vitest";
import {
  filterProductRows,
  isGenericProductDescription,
  normalizeProductApiItem,
  normalizeProductCatalogsResponse,
  productCatalogPageNumbers,
} from "@/components/pages/products-page";

describe("ProductsPage domain", () => {
  it("carrega todas as paginas do catalogo quando a API limita cada lote", () => {
    expect(productCatalogPageNumbers(548)).toEqual([2, 3, 4, 5, 6]);
    expect(productCatalogPageNumbers(100)).toEqual([]);
    expect(productCatalogPageNumbers(101)).toEqual([2]);
  });

  it("preserva categoria financeira, classificacao e links com papeis distintos", () => {
    const product = normalizeProductApiItem({
      id: "product-1",
      sku: "FLG-001",
      name: "Oleo BSE32",
      item_type: "MATERIAL",
      category_code: "4010210",
      category_label: "Materiais de manutencao",
      status: "ACTIVE",
      classification: "MATERIAL",
      classification_confidence: 0.92,
      classification_source: "FLUIG_RULES",
      product_url: "https://fornecedor.example/oleo-bse32",
      last_fluig_request_id: "1103651",
      occurrences: [
        {
          id: "occurrence-1",
          fluig_request_id: "1103651",
          branch_label: "CD Principal",
          quantity: "2",
          unit: "UN",
          unit_price_cents: 129050,
          observed_at: "2026-07-13T12:00:00.000Z",
        },
      ],
    });

    expect(product).toMatchObject({
      categoryCode: "4010210",
      categoryLabel: "Materiais de manutencao",
      kind: "MATERIAL",
      classification: "MATERIAL",
      classificationConfidence: 0.92,
      classificationSource: "FLUIG_RULES",
      externalUrl: "https://fornecedor.example/oleo-bse32",
      latestFluigRequestId: "1103651",
    });
    expect(product.latestFluigRequestUrl).toContain("1103651");
    expect(product.latestFluigRequestUrl).not.toBe(product.externalUrl);
    expect(product.occurrences).toHaveLength(1);
  });

  it("marca descricoes genericas como indefinidas e pendentes de revisao", () => {
    expect(isGenericProductDescription("DESCRICAO ACIMA")).toBe(true);
    expect(isGenericProductDescription("EPI")).toBe(true);
    expect(isGenericProductDescription("EPI", "Luva nitrilica tamanho G")).toBe(false);

    expect(normalizeProductApiItem({ id: "generic-1", name: "PEDIDO EM ANEXO", itemType: "MATERIAL", status: "ACTIVE" }))
      .toMatchObject({ kind: "INDEFINIDO", status: "REVISAR" });
  });

  it("normaliza categorias, tipos e unidades retornados pelo endpoint de catalogos", () => {
    const catalogs = normalizeProductCatalogsResponse({
      catalogs: {
        categories: {
          allowCustom: true,
          options: [{ id: "5ef0dc3a-0a21-4ba8-967c-894a22bad3bd", code: "501", label: "Insumos operacionais" }],
        },
        materialTypes: {
          allowCustom: false,
          options: [{ id: "2e3ce03d-fb5d-491c-91c1-3fb7cf350cce", code: "EPI", label: "Equipamento de protecao" }],
        },
        units: {
          allowCustom: true,
          options: ["UN", "CX"],
        },
      },
    });

    expect(catalogs.categories).toEqual({
      allowCustom: true,
      options: [{ value: "5ef0dc3a-0a21-4ba8-967c-894a22bad3bd", label: "Insumos operacionais", code: "501" }],
    });
    expect(catalogs.materialTypes.options[0]).toEqual({
      value: "2e3ce03d-fb5d-491c-91c1-3fb7cf350cce",
      label: "Equipamento de protecao",
      code: "EPI",
    });
    expect(catalogs.units.allowCustom).toBe(true);
  });

  it("filtra por busca, categoria, tipo e status", () => {
    const material = normalizeProductApiItem({
      id: "material-1",
      sku: "MAT-01",
      name: "Filtro de oleo",
      itemType: "MATERIAL",
      categoryLabel: "Manutencao",
      status: "ACTIVE",
    });
    const service = normalizeProductApiItem({
      id: "service-1",
      sku: "SER-01",
      name: "Limpeza de reservatorio",
      itemType: "SERVICO",
      categoryLabel: "Servicos prediais",
      status: "REVIEW",
    });

    expect(filterProductRows([material, service], {
      query: "reservatorio",
      category: "Servicos prediais",
      kind: "SERVICO",
      status: "REVISAR",
    })).toEqual([service]);
  });
});
