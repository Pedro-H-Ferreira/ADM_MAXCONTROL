import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUserProfile } from "@/lib/db/app-repository";

const serviceState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
  getSupabaseServiceStatus: () => ({ missing: [] }),
}));

import {
  listActorBranches,
  listBranches,
  upsertAppUser,
} from "@/lib/db/app-repository";

type Response = { data: unknown; error: null; count?: number };

function queryBuilder(response: Response, calls: Array<{ method: string; args: unknown[] }>) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return method === "maybeSingle" ? Promise.resolve(response) : builder;
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
