import { describe, expect, it } from "vitest";
import { supplierListFiltersSchema, supplierListFilterValues } from "@/lib/supplier-list-filters";

describe("supplier list filters", () => {
  it("normaliza filtros operacionais validos", () => {
    const params = new URLSearchParams({
      q: "Fornecedor XPTO",
      status: "ATIVO",
      branchId: "c2df69b3-d2d0-4eb6-b1ed-54702fc3a1fe",
      attention: "PENDING",
      page: "2",
      pageSize: "50",
    });

    expect(supplierListFiltersSchema.parse(supplierListFilterValues(params))).toEqual({
      search: "Fornecedor XPTO",
      status: "ATIVO",
      sourceSystem: null,
      syncStatus: null,
      branchId: "c2df69b3-d2d0-4eb6-b1ed-54702fc3a1fe",
      attention: "PENDING",
      page: 2,
      pageSize: 50,
    });
  });

  it("rejeita filial, situacao e paginacao invalidas", () => {
    const params = new URLSearchParams({
      branchId: "filial-invalida",
      attention: "UNKNOWN",
      pageSize: "500",
    });

    expect(supplierListFiltersSchema.safeParse(supplierListFilterValues(params)).success).toBe(false);
  });
});
