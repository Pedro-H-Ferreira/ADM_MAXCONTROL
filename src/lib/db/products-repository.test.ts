import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppActor } from "@/lib/db/app-repository";

const serviceState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
  getSupabaseServiceStatus: () => ({ missing: [] }),
}));

vi.mock("@/lib/supabase/product-storage", () => ({
  createProductImageSignedUrls: vi.fn(async () => new Map()),
  removeProductImageObjects: vi.fn(async () => undefined),
  uploadProductImageObject: vi.fn(),
}));

import { listProducts, syncProductsFromFluigHistory } from "@/lib/db/products-repository";

type QueryResponse = { data: unknown[]; error: null; count?: number };

function queryBuilder(response: QueryResponse, calls: Array<{ method: string; args: unknown[] }>) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "is", "neq", "or", "order", "range", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: QueryResponse) => unknown) => resolve(response);
  return builder;
}

const branchActor = {
  id: "11111111-1111-4111-8111-111111111111",
  isAdmin: false,
  branches: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      code: "1017",
      name: "Filial 1017",
      fluigLabel: null,
      active: true,
    },
  ],
  branchCodes: ["1017"],
} as AppActor;

const product = {
  id: "33333333-3333-4333-8333-333333333333",
  sku: "FLG-123",
  name: "Filtro de oleo",
  normalized_name: "FILTRO DE OLEO",
  dedupe_key: "dedupe",
  description: "Filtro de oleo",
  specification: null,
  item_type: "MATERIAL",
  classification: "MATERIAL",
  classification_source: "DESCRIPTION_RULE",
  category: null,
  category_code: "5250304",
  category_label: "5250304 - INSUMOS DE MANUTENCAO",
  category_ref: null,
  material_type: null,
  material_type_ref: null,
  unit: "UN",
  status: "REVIEW",
  source_system: "FLUIG",
  sync_status: "SYNCED",
  sync_error: null,
  classification_confidence: 0.7,
  review_required: true,
  image_path: null,
  image_url: null,
  product_url: null,
  first_fluig_request_id: null,
  last_fluig_request_id: null,
  occurrence_count: 1,
  last_unit_price_cents: 2770,
  first_seen_at: null,
  last_seen_at: null,
  last_synced_at: null,
  metadata: {},
  created_by_user_id: null,
  updated_by_user_id: null,
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:00.000Z",
  deleted_at: null,
};

describe("products repository branch scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("limita produtos por ocorrencia da filial ou autoria manual", async () => {
    const callsByTable: Record<string, Array<{ method: string; args: unknown[] }>> = {};
    const responses: Record<string, QueryResponse[]> = {
      app_product_occurrences: [
        { data: [{ product_id: product.id }], error: null },
        { data: [], error: null },
      ],
      app_products: [
        { data: [product], error: null, count: 1 },
        { data: [], error: null, count: 1 },
        { data: [], error: null, count: 0 },
        { data: [], error: null, count: 1 },
        { data: [], error: null, count: 1 },
      ],
    };
    serviceState.client = {
      from(table: string) {
        const calls = (callsByTable[table] ||= []);
        const response = responses[table]?.shift();
        if (!response) throw new Error(`Consulta inesperada para ${table}`);
        return queryBuilder(response, calls);
      },
    };

    const result = await listProducts(branchActor, { page: 1, pageSize: 25 });

    expect(result.total).toBe(1);
    expect(result.summary).toEqual({ total: 1, services: 0, review: 1, fluig: 1 });
    expect(result.items[0].id).toBe(product.id);
    expect(callsByTable.app_product_occurrences).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["branch_id", [branchActor.branches[0].id]] },
        { method: "in", args: ["branch_code", ["1017"]] },
      ])
    );
    const scope = callsByTable.app_products.find((call) => call.method === "or");
    expect(scope?.args[0]).toContain(`created_by_user_id.eq.${branchActor.id}`);
    expect(scope?.args[0]).toContain(`id.in.(${product.id})`);
  });
});

describe("syncProductsFromFluigHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envia lote corrigido a RPC idempotente com origem estavel e confidence 0..1", async () => {
    const rpc = vi.fn(async (...args: [string, Record<string, unknown>]) => {
      void args;
      return { data: { productId: product.id }, error: null };
    });
    const requests = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        fluig_request_id: "1162998",
        branch_id: branchActor.branches[0].id,
        branch_code: "1017",
        branch_label: "Filial 1017",
        opened_at: "2026-07-01T00:00:00.000Z",
        last_synced_at: "2026-07-02T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
        raw_payload: {
          formFields: {
            contaCentroCusto: "5250304",
            codContaFin: "5250304 - INSUMOS DE MANUTENCAO",
            solProdutoServico___1: "Filtro de oleo",
            SolEspecTecnica___1: "Peca para refrigeracao",
            solQtdProduto___1: "2",
            solUnMedidaProduto___1: "UN",
            solnumProdutoPedido___1: "1",
            ItemSelect___8: "Filtro cotado",
            numProduto___8: "1",
            qtdProduto___8: "5",
            unMedidaProduto___8: "CX",
            valorProduto___8: "27,70",
          },
        },
      },
    ];
    serviceState.client = {
      from(table: string) {
        if (table !== "fluig_requests") throw new Error(`Consulta inesperada para ${table}`);
        return queryBuilder({ data: requests, error: null }, []);
      },
      rpc,
    };
    const admin = { ...branchActor, isAdmin: true } as AppActor;

    const first = await syncProductsFromFluigHistory(admin);
    const second = await syncProductsFromFluigHistory(admin);

    expect(first).toMatchObject({ requestsScanned: 1, requestsWithProducts: 1, occurrences: 1 });
    expect(second).toEqual(first);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][0]).toBe("upsert_fluig_product_history");
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_fluig_request_number: "1162998",
      p_source_table: "solTabelaProdutos",
      p_source_row_index: 1,
      p_quantity: 2,
      p_unit: "UN",
      p_unit_price_cents: 2770,
      p_classification_confidence: 0.7,
      p_material_type_label: "Refrigeracao",
      p_category_code: "5250304",
      p_category_label: "5250304 - INSUMOS DE MANUTENCAO",
    });
    expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[0][1]);
  });
});
