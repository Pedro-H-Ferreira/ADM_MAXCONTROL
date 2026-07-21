import { describe, expect, it } from "vitest";
import { userAccessBodySchema } from "@/app/api/admin/users/route";

const userId = "11111111-1111-4111-8111-111111111111";
const branchA = "22222222-2222-4222-8222-222222222222";
const branchB = "33333333-3333-4333-8333-333333333333";

describe("userAccessBodySchema", () => {
  it("aceita atualizacao parcial sem preencher defaults destrutivos", () => {
    expect(userAccessBodySchema.parse({ id: userId, displayName: "Nome atualizado" })).toEqual({
      id: userId,
      displayName: "Nome atualizado",
    });
  });

  it("exige nome na criacao e valida enums e UUIDs", () => {
    expect(userAccessBodySchema.safeParse({ role: "ADMIN" }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({ id: "nao-e-uuid" }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({ id: userId, role: "SUPER_ADMIN" }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({ id: userId, approvalStatus: "BLOCKED" }).success).toBe(false);
  });

  it("exige uma unica filial principal pertencente a filiais sem duplicidade", () => {
    expect(userAccessBodySchema.safeParse({ id: userId, branchIds: [branchA] }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({ id: userId, homeBranchId: branchA }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      branchIds: [branchA, branchA],
      homeBranchId: branchA,
    }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      branchIds: [branchA],
      homeBranchId: branchB,
    }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      branchIds: [branchA, branchB],
      homeBranchId: branchA,
    }).success).toBe(true);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      role: "ADMIN",
      branchIds: [],
      homeBranchId: null,
    }).success).toBe(true);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      role: "LEITURA",
    }).success).toBe(false);
  });

  it("valida pagina, duplicidade e coerencia das permissoes", () => {
    const page = {
      pageSlug: "dashboard",
      canView: true,
      canCreate: false,
      canUpdate: false,
      canApprove: false,
    };
    expect(userAccessBodySchema.safeParse({ id: userId, pageAccess: [page] }).success).toBe(true);
    expect(userAccessBodySchema.safeParse({ id: userId, pageAccess: [page, page] }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      pageAccess: [{ ...page, pageSlug: "pagina-inexistente" }],
    }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({
      id: userId,
      pageAccess: [{ ...page, canView: false, canUpdate: true }],
    }).success).toBe(false);
  });

  it("aceita senha Fluig somente como entrada e limita seu tamanho", () => {
    expect(userAccessBodySchema.safeParse({ id: userId, fluigUsername: "usuario", fluigPassword: "segredo" }).success).toBe(true);
    expect(userAccessBodySchema.safeParse({ id: userId, fluigPassword: "x".repeat(257) }).success).toBe(false);
    expect(userAccessBodySchema.safeParse({ id: userId, clearFluigCredentials: true }).success).toBe(true);
  });
});
