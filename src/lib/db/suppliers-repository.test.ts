import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppActor } from "@/lib/db/app-repository";

const serviceState = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
  getSupabaseServiceStatus: () => ({ missing: [] }),
}));

import { listSuppliers } from "@/lib/db/suppliers-repository";

type QueryResponse = { data: unknown[]; error: null; count?: number };

function queryBuilder(response: QueryResponse, calls: Array<{ method: string; args: unknown[] }>) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "is", "order", "or", "eq", "in", "range", "limit"];

  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: QueryResponse) => unknown) => resolve(response);

  return builder;
}

const actor = {
  id: "actor-1",
  isAdmin: false,
  branches: [{ id: "branch-1", code: "1017", name: "Filial 1017", fluigLabel: null, active: true }],
  branchCodes: ["1017"],
  fluigUsername: "actor@example.com",
  fluigUserId: "00130",
  email: "actor@example.com",
} as AppActor;

const supplier = {
  id: "supplier-1",
  cnpj: null,
  cnpj_normalizado: null,
  razao_social: "Fornecedor Teste",
  nome_fantasia: null,
  contatos: [],
  default_payload: {},
  source_system: "LOCAL",
  sync_status: "SINCRONIZADO",
  status: "ATIVO",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  deleted_at: null,
};

function request(id: string, branchCode: string) {
  return {
    id,
    app_supplier_id: supplier.id,
    module_slug: "compras",
    fluig_request_id: id,
    branch_code: branchCode,
    last_status_check_at: "2026-07-10T00:00:00.000Z",
    created_by_user_id: "other-actor",
    sync_owner_user_id: "other-actor",
    fluig_requester_login: "other@example.com",
    fluig_requester_code: "99999",
    requester: "Outro usuario",
  };
}

describe("listSuppliers request visibility", () => {
  beforeEach(() => {
    serviceState.client = null;
  });

  it("usa o mesmo escopo do ator na contagem e nos resumos", async () => {
    const visibleRequest = request("visible-request", "1017");
    const hiddenRequest = request("hidden-request", "9999");
    const callsByTable: Record<string, Array<{ method: string; args: unknown[] }>> = {};
    const responses: Record<string, QueryResponse[]> = {
      app_suppliers: [{ data: [supplier], error: null, count: 1 }],
      app_supplier_branch_links: [{
        data: [{
          supplier_id: supplier.id,
          branch_id: "branch-1",
          default_branch: true,
          branch: { id: "branch-1", code: "1017", name: "Filial 1017", fluig_label: null, active: true },
        }],
        error: null,
      }],
      fluig_requests: [
        { data: [visibleRequest, hiddenRequest], error: null },
        { data: [visibleRequest, hiddenRequest], error: null },
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

    const result = await listSuppliers(actor, {
      search: null,
      status: null,
      sourceSystem: null,
      syncStatus: null,
      branchId: null,
      attention: null,
      page: 1,
      pageSize: 25,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].requestCount).toBe(1);
    expect(result.items[0].requests.map((item) => item.id)).toEqual(["visible-request"]);

    const requestCalls = callsByTable.fluig_requests;
    expect(requestCalls.filter((call) => call.method === "or")).toHaveLength(2);
    for (const call of requestCalls.filter((item) => item.method === "or")) {
      expect(call.args[0]).toContain('branch_code.in.("1017")');
    }
    expect(requestCalls.findIndex((call) => call.method === "or"))
      .toBeLessThan(requestCalls.findIndex((call) => call.method === "limit"));
  });
});
