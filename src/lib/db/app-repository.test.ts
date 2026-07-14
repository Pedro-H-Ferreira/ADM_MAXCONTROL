import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppActor, AppUserProfile } from "@/lib/db/app-repository";

const serviceState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
  getSupabaseServiceStatus: () => ({ missing: [] }),
}));

import {
  createFluigJob,
  listActorBranches,
  listBranches,
  upsertAppUser,
} from "@/lib/db/app-repository";

type Response = { data: unknown; error: null; count?: number };

function queryBuilder(response: Response, calls: Array<{ method: string; args: unknown[] }>) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "gte", "order", "limit", "insert", "single", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return method === "single" || method === "maybeSingle" ? Promise.resolve(response) : builder;
    };
  }
  builder.then = (resolve: (value: Response) => unknown) => resolve(response);
  return builder;
}

const masterProfile: AppUserProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "master@example.com",
  displayName: "Master",
  role: "ADMIN_MASTER",
  fluigUsername: null,
  fluigUserId: null,
  homeBranchId: null,
  active: true,
  approvalStatus: "APPROVED",
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
};

const dbMaster = {
  id: masterProfile.id,
  auth_user_id: masterProfile.authUserId,
  email: masterProfile.email,
  display_name: masterProfile.displayName,
  role: masterProfile.role,
  fluig_username: null,
  fluig_user_id: null,
  home_branch_id: null,
  active: true,
  approval_status: "APPROVED",
  approved_at: null,
  rejected_at: null,
  rejection_reason: null,
};

const jobBranches: AppActor["branches"] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "1016",
    name: "Santo Andre",
    fluigLabel: "1016 - 1016-SAD",
    active: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    code: "1022",
    name: "Campinas",
    fluigLabel: "1022 - 1022-CA",
    active: true,
  },
];

function jobActor(isAdmin = false): AppActor {
  return {
    ...masterProfile,
    role: isAdmin ? "ADMIN" : "ADMINISTRATIVO",
    isAdmin,
    branches: jobBranches,
    branchCodes: jobBranches.map((branch) => branch.code),
    pageSlugs: ["pagamentos"],
    pageAccess: [{ pageSlug: "pagamentos", canView: true, canCreate: true, canUpdate: true, canApprove: true }],
  };
}

function successfulJobClient(branchCode: string, branchLabel: string) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const jobRow = {
    id: "44444444-4444-4444-8444-444444444444",
    requested_by_user_id: masterProfile.id,
    assigned_agent_id: null,
    module_slug: "pagamentos",
    operation: "sync_history",
    status: "queued",
    branch_code: branchCode,
    branch_label: branchLabel,
    fluig_username: null,
    request_payload: {},
    result_payload: {},
    error_message: null,
    progress_stage: null,
    progress_label: null,
    attempts: 0,
    max_attempts: 3,
    next_attempt_at: "2026-07-13T12:00:00.000Z",
    last_attempt_at: null,
    expires_at: "2026-07-13T12:10:00.000Z",
    created_at: "2026-07-13T12:00:00.000Z",
    updated_at: "2026-07-13T12:00:00.000Z",
    finished_at: null,
  };
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: { expired: 0, retried: 0 }, error: null }),
    from: vi.fn((table: string) =>
      queryBuilder(
        table === "fluig_user_agents" ? { data: { id: "agent-1" }, error: null } : { data: jobRow, error: null },
        calls
      )
    ),
  };
  return { calls, client };
}

describe("app user branch access", () => {
  beforeEach(() => {
    serviceState.client = null;
  });

  it("lista somente filiais ativas e nao excluidas", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const client = {
      from: () => queryBuilder({ data: [], error: null }, calls),
    };

    await listBranches(client as never);

    expect(calls).toContainEqual({ method: "eq", args: ["active", true] });
    expect(calls).toContainEqual({ method: "is", args: ["deleted_at", null] });
  });

  it("aplica os mesmos filtros nas filiais de um ator nao administrador", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const client = {
      from: () => queryBuilder({ data: [], error: null }, calls),
    };

    await listActorBranches(client as never, { ...masterProfile, role: "LEITURA" });

    expect(calls).toContainEqual({ method: "eq", args: ["branch.active", true] });
    expect(calls).toContainEqual({ method: "is", args: ["branch.deleted_at", null] });
  });
});

describe("upsertAppUser", () => {
  it("preserva campos omitidos e salva tudo por uma unica RPC", async () => {
    const fromCalls: string[] = [];
    const rpc = vi.fn().mockResolvedValue({ data: { ...dbMaster, display_name: "Master Atualizado" }, error: null });
    const updateUserById = vi.fn();
    const createUser = vi.fn();
    serviceState.client = {
      from(table: string) {
        fromCalls.push(table);
        return queryBuilder({ data: dbMaster, error: null }, []);
      },
      rpc,
      auth: { admin: { updateUserById, createUser } },
    };

    await upsertAppUser({
      actor: { id: masterProfile.id, role: "ADMIN_MASTER" },
      id: masterProfile.id,
      displayName: " Master Atualizado ",
    });

    expect(fromCalls).toEqual(["app_user_profiles"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_app_user_access", {
      p_actor_id: masterProfile.id,
      p_payload: { id: masterProfile.id, display_name: "Master Atualizado" },
    });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("impede ADMIN de alterar ADMIN_MASTER", async () => {
    serviceState.client = {
      from: () => queryBuilder({ data: dbMaster, error: null }, []),
      rpc: vi.fn(),
    };

    await expect(upsertAppUser({
      actor: { id: "44444444-4444-4444-8444-444444444444", role: "ADMIN" },
      id: masterProfile.id,
      displayName: "Tentativa",
    })).rejects.toMatchObject({ code: "ADMIN_MASTER_REQUIRED", status: 403 });
  });

  it("impede remover o ultimo ADMIN_MASTER", async () => {
    let query = 0;
    serviceState.client = {
      from: () => {
        query += 1;
        return queryBuilder(
          query === 1 ? { data: dbMaster, error: null } : { data: null, error: null, count: 1 },
          []
        );
      },
      rpc: vi.fn(),
    };

    await expect(upsertAppUser({
      actor: { id: masterProfile.id, role: "ADMIN_MASTER" },
      id: masterProfile.id,
      role: "ADMIN",
    })).rejects.toMatchObject({ code: "LAST_ADMIN_MASTER", status: 409 });
  });

  it("rejeita filial inativa antes de chamar a RPC", async () => {
    const rpc = vi.fn();
    let query = 0;
    serviceState.client = {
      from: () => {
        query += 1;
        return queryBuilder(
          query === 1 ? { data: dbMaster, error: null } : { data: [], error: null },
          []
        );
      },
      rpc,
    };

    await expect(upsertAppUser({
      actor: { id: masterProfile.id, role: "ADMIN_MASTER" },
      id: masterProfile.id,
      branchIds: ["22222222-2222-4222-8222-222222222222"],
      homeBranchId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toMatchObject({ code: "INVALID_BRANCH", status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("exige matriz de filial ao remover o acesso global de administrador", async () => {
    const rpc = vi.fn();
    const dbAdmin = {
      ...dbMaster,
      id: "55555555-5555-4555-8555-555555555555",
      auth_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "admin@example.com",
      display_name: "Admin",
      role: "ADMIN",
    };
    serviceState.client = {
      from: () => queryBuilder({ data: dbAdmin, error: null }, []),
      rpc,
    };

    await expect(upsertAppUser({
      actor: { id: masterProfile.id, role: "ADMIN_MASTER" },
      id: dbAdmin.id,
      role: "LEITURA",
    })).rejects.toMatchObject({ code: "INVALID_BRANCH_MATRIX", status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("createFluigJob branch resolution", () => {
  it("rejeita modulo e acao sem permissao antes de acessar o banco", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    serviceState.client = { from, rpc };

    await expect(createFluigJob({
      actor: { ...jobActor(), pageSlugs: [], pageAccess: [] },
      module: "pagamentos",
      operation: "sync_status",
    })).rejects.toMatchObject({ code: "FLUIG_MODULE_ACCESS_DENIED", status: 403 });

    await expect(createFluigJob({
      actor: {
        ...jobActor(),
        pageAccess: [{ pageSlug: "pagamentos", canView: true, canCreate: false, canUpdate: false, canApprove: false }],
      },
      module: "pagamentos",
      operation: "sync_status",
    })).rejects.toMatchObject({ code: "FLUIG_ACTION_ACCESS_DENIED", status: 403 });

    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejeita branchCode explicito fora das filiais acessiveis", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    serviceState.client = { from, rpc };

    await expect(createFluigJob({
      actor: jobActor(),
      module: "pagamentos",
      operation: "sync_history",
      branchCode: "9999",
    })).rejects.toMatchObject({
      code: "FLUIG_BRANCH_ACCESS_DENIED",
      status: 403,
      message: 'Usuario sem acesso a filial solicitada: codigo "9999".',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejeita branchLabel explicito fora do catalogo carregado para admin", async () => {
    serviceState.client = { from: vi.fn(), rpc: vi.fn() };

    await expect(createFluigJob({
      actor: jobActor(true),
      module: "pagamentos",
      operation: "sync_history",
      branchLabel: "9999 - FILIAL INEXISTENTE",
    })).rejects.toMatchObject({
      code: "FLUIG_BRANCH_ACCESS_DENIED",
      status: 403,
      message: 'Usuario sem acesso a filial solicitada: identificacao "9999 - FILIAL INEXISTENTE".',
    });
  });

  it("rejeita codigo e identificacao de filiais acessiveis diferentes", async () => {
    serviceState.client = { from: vi.fn(), rpc: vi.fn() };

    await expect(createFluigJob({
      actor: jobActor(),
      module: "pagamentos",
      operation: "sync_history",
      branchCode: "1016",
      branchLabel: "1022 - 1022-CA",
    })).rejects.toMatchObject({ code: "FLUIG_BRANCH_MISMATCH", status: 400 });
  });

  it("resolve a filial pelo branchLabel explicito quando o codigo nao e informado", async () => {
    const { calls, client } = successfulJobClient("1022", "1022 - 1022-CA");
    serviceState.client = client;

    await createFluigJob({
      actor: jobActor(),
      module: "pagamentos",
      operation: "sync_history",
      branchLabel: "1022 - 1022-CA",
    });

    expect(calls.find((call) => call.method === "insert")?.args[0]).toMatchObject({
      branch_id: jobBranches[1].id,
      branch_code: "1022",
      branch_label: "1022 - 1022-CA",
    });
  });

  it("preserva o fallback para a primeira filial quando nenhuma e explicita", async () => {
    const { calls, client } = successfulJobClient("1016", "1016 - 1016-SAD");
    serviceState.client = client;

    await createFluigJob({
      actor: jobActor(),
      module: "pagamentos",
      operation: "sync_history",
    });

    expect(calls.find((call) => call.method === "insert")?.args[0]).toMatchObject({
      branch_id: jobBranches[0].id,
      branch_code: "1016",
      branch_label: "1016 - 1016-SAD",
    });
  });
});
