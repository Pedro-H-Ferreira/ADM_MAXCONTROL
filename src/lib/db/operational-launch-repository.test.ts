import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppActor } from "@/lib/db/app-repository";
import type { OperationalLaunchValidateInput } from "@/lib/operational-launch";

const serviceState = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
  getSupabaseServiceStatus: () => ({ missing: [] }),
}));

import { createValidatedOperationalLaunch } from "@/lib/db/operational-launch-repository";

type QueryResponse = { data: unknown; error: Error | null };
type QueryCall = { method: string; args: unknown[] };

function queryBuilder(response: QueryResponse, calls: QueryCall[]) {
  const builder: Record<string, unknown> = {};
  const chainMethods = ["select", "eq", "is", "order", "limit", "insert"];

  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push({ method: "maybeSingle", args: [] });
    return Promise.resolve(response);
  };
  builder.single = () => {
    calls.push({ method: "single", args: [] });
    return Promise.resolve(response);
  };
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(response).then(resolve, reject);

  return builder;
}

const actor = {
  id: "admin-1",
  isAdmin: true,
  branches: [{ id: "branch-1", code: "1017", name: "Filial 1017", fluigLabel: null, active: true }],
  branchCodes: ["1017"],
} as AppActor;

const supplier = {
  id: "supplier-1",
  razao_social: "Fornecedor Teste",
  cnpj_normalizado: "12345678000195",
  fluig_name: null,
  fluig_code: null,
  fluig_supplier_label: null,
  default_payload: {},
};

const input: OperationalLaunchValidateInput = {
  module: "pagamentos",
  sourceRequestId: "1163476",
  title: "Pagamento mensal",
  supplierId: supplier.id,
  branchCode: "1017",
  fieldOverrides: {},
  attachments: [],
};

function launchRow() {
  return {
    id: "launch-1",
    module_slug: "pagamentos",
    status: "VALIDADO",
    title: input.title,
    description: null,
    app_supplier_id: supplier.id,
    supplier_name: supplier.razao_social,
    supplier_cnpj: supplier.cnpj_normalizado,
    branch_id: "branch-1",
    branch_code: "1017",
    branch_label: "Filial 1017",
    source_request_id: input.sourceRequestId,
    fluig_job_id: null,
    fluig_request_id: null,
    fluig_request_row_id: null,
    amount_cents: null,
    due_date: null,
    field_overrides: {
      fornecedorC: supplier.razao_social,
      codCNPJ: "12.345.678/0001-95",
      unidadeFilial: "Filial 1017",
    },
    attachment_metadata: [],
    review_fingerprint: "fingerprint",
    progress_stage: "validated",
    progress_label: "Lancamento validado e aguardando confirmacao.",
    last_error_message: null,
    result_payload: null,
    validated_at: "2026-07-13T12:00:00.000Z",
    queued_at: null,
    opened_at: null,
    failed_at: null,
    created_by_user_id: actor.id,
    updated_by_user_id: actor.id,
    created_at: "2026-07-13T12:00:00.000Z",
    updated_at: "2026-07-13T12:00:00.000Z",
    deleted_at: null,
    job: null,
    items: [],
  };
}

function serviceClient(responses: Record<string, QueryResponse[]>, callsByTable: Record<string, QueryCall[]>) {
  return {
    from(table: string) {
      const response = responses[table]?.shift();
      if (!response) throw new Error(`Consulta inesperada para ${table}`);
      return queryBuilder(response, (callsByTable[table] ||= []));
    },
  };
}

describe("createValidatedOperationalLaunch supplier branch scope", () => {
  beforeEach(() => {
    serviceState.client = null;
  });

  it("rejeita fornecedor ativo sem vinculo com a filial selecionada ate para admin", async () => {
    const callsByTable: Record<string, QueryCall[]> = {};
    serviceState.client = serviceClient({
      app_suppliers: [{ data: supplier, error: null }],
      app_supplier_branch_links: [{ data: null, error: null }],
    }, callsByTable);

    await expect(createValidatedOperationalLaunch(actor, input))
      .rejects.toThrow("Fornecedor nao pertence a filial selecionada.");

    expect(callsByTable.app_supplier_branch_links).toEqual(expect.arrayContaining([
      { method: "eq", args: ["supplier_id", supplier.id] },
      { method: "eq", args: ["branch_id", "branch-1"] },
    ]));
    expect(callsByTable.app_fluig_launches).toBeUndefined();
  });

  it("aceita fornecedor ativo vinculado a filial selecionada", async () => {
    const callsByTable: Record<string, QueryCall[]> = {};
    const launch = launchRow();
    serviceState.client = serviceClient({
      app_suppliers: [{ data: supplier, error: null }],
      app_supplier_branch_links: [{ data: { supplier_id: supplier.id }, error: null }],
      app_fluig_launches: [
        { data: null, error: null },
        { data: launch, error: null },
        { data: [launch], error: null },
      ],
      app_fluig_launch_events: [{ data: null, error: null }],
    }, callsByTable);

    const result = await createValidatedOperationalLaunch(actor, input);

    expect(result.id).toBe(launch.id);
    expect(result.supplierId).toBe(supplier.id);
    expect(result.branchId).toBe("branch-1");
    expect(callsByTable.app_fluig_launches.some((call) => call.method === "insert")).toBe(true);
  });
});
