import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj, onlyDigits } from "@/lib/cnpj";

describe("CNPJ", () => {
  it("aceita CNPJ valido com ou sem mascara", () => {
    expect(isValidCnpj("32.858.158/0001-93")).toBe(true);
    expect(isValidCnpj("32858158000193")).toBe(true);
  });

  it("normaliza e formata mantendo apenas os digitos", () => {
    expect(onlyDigits("32.858.158/0001-93")).toBe("32858158000193");
    expect(normalizeCnpj("32.858.158/0001-93")).toBe("32858158000193");
    expect(formatCnpj("32858158000193")).toBe("32.858.158/0001-93");
  });

  it("rejeita tamanho, sequencia e digitos verificadores invalidos", () => {
    expect(isValidCnpj("123")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("32858158000194")).toBe(false);
  });
});
