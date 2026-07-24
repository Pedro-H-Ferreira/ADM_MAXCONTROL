import { describe, expect, it } from "vitest";
import type { FluigLaunchTemplate } from "@/lib/fluig-data";
import { selectSupplierTemplate } from "@/lib/fluig-template-selection";

function template(
  id: string,
  lastSeenAt: string,
  branchCode: string,
  overrides: Partial<FluigLaunchTemplate> = {}
): FluigLaunchTemplate {
  return {
    id,
    module: "pagamentos",
    title: `Modelo ${id}`,
    recurrence: "model",
    sourceRequestId: id,
    supplierName: "FORNECEDOR MODELO",
    supplierCnpj: "00111222000133",
    branchCode,
    branchLabel: `${branchCode} - FILIAL`,
    defaultFields: {},
    occurrenceCount: 1,
    monthCount: 1,
    lastSeenAt,
    ...overrides,
  };
}

describe("supplier template selection", () => {
  it("usa o modelo mais recente do fornecedor", () => {
    const selection = selectSupplierTemplate(
      [
        template("antigo", "2026-05-01T10:00:00.000Z", "1017"),
        template("novo", "2026-06-01T10:00:00.000Z", "1017"),
      ],
      { cnpj: "00.111.222/0001-33" }
    );

    expect(selection.template?.id).toBe("novo");
    expect(selection.automaticBranch).toEqual({ code: "1017", label: "1017 - FILIAL" });
  });

  it("nao preenche filial quando o fornecedor aparece em mais de uma", () => {
    const selection = selectSupplierTemplate(
      [
        template("filial-1017", "2026-06-01T10:00:00.000Z", "1017"),
        template("filial-1052", "2026-07-01T10:00:00.000Z", "1052"),
      ],
      { name: "FORNECEDOR MODELO" }
    );

    expect(selection.template?.id).toBe("filial-1052");
    expect(selection.branchCount).toBe(2);
    expect(selection.automaticBranch).toBeNull();
  });
});
