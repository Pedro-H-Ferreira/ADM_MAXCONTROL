import { describe, expect, it } from "vitest";
import { supplierErrorResponse } from "@/lib/supplier-errors";

describe("supplierErrorResponse", () => {
  it("retorna conflito para CNPJ duplicado", async () => {
    const error = Object.assign(new Error("Fornecedor ja cadastrado para o CNPJ informado."), {
      code: "23505",
    });
    const response = supplierErrorResponse(error, "Falha ao salvar fornecedor.");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ success: false });
  });

  it("retorna proibido para violacao de escopo", () => {
    const error = Object.assign(new Error("Usuario sem permissao."), { code: "42501" });
    expect(supplierErrorResponse(error, "Falha.").status).toBe(403);
  });
});
