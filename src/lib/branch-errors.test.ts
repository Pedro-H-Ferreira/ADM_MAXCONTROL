import { describe, expect, it } from "vitest";
import { branchErrorResponse } from "@/lib/branch-errors";

async function expectMappedError(error: unknown, status: number) {
  const response = branchErrorResponse(error, "Falha ao processar filial.");
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ success: false });
}

describe("branchErrorResponse", () => {
  it.each([
    [new Error("BRANCH_FORBIDDEN"), 403],
    [new Error("BRANCH_NOT_FOUND"), 404],
    [new Error("BRANCH_CODE_CONFLICT"), 409],
    [new Error("BRANCH_HOME_IN_USE"), 409],
    [new Error("BRANCH_CODE_REQUIRED"), 400],
    [Object.assign(new Error("Acesso negado."), { code: "42501" }), 403],
    [new Error("Usuario sem permissao para alterar filiais."), 403],
    [Object.assign(new Error("Filial nao encontrada."), { code: "P0002" }), 404],
    [Object.assign(new Error("Codigo de filial ja cadastrado."), { code: "23505" }), 409],
    [Object.assign(new Error("UF invalida."), { code: "23514" }), 400],
  ])("mapeia erros conhecidos para HTTP %i", async (error, status) => {
    await expectMappedError(error, status);
  });

  it("nao expoe o codigo interno do erro de dominio", async () => {
    const response = branchErrorResponse(new Error("BRANCH_CODE_LOCKED"), "Falha.");
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "O codigo da filial nao pode ser alterado porque possui vinculos.",
    });
  });

  it("mantem 500 para falhas inesperadas", async () => {
    await expectMappedError(new Error("Banco indisponivel."), 500);
  });

  it("usa a mensagem de fallback para valores desconhecidos", async () => {
    const response = branchErrorResponse(null, "Falha ao listar filiais.");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Falha ao listar filiais.",
    });
  });
});
