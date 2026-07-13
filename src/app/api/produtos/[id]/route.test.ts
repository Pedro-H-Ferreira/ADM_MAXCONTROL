import { describe, expect, it } from "vitest";
import { productPatchSchema } from "@/app/api/produtos/[id]/route";

describe("productPatchSchema", () => {
  it("permite classificacao, catalogos, link e reativacao sem patch vazio", () => {
    expect(productPatchSchema.safeParse({ itemType: "SERVICO", status: "ACTIVE" }).success).toBe(true);
    expect(productPatchSchema.safeParse({ categoryId: null, materialTypeId: null, productUrl: "" }).success).toBe(true);
    expect(productPatchSchema.safeParse({}).success).toBe(false);
  });
});
