import { describe, expect, it } from "vitest";
import { productCreateSchema } from "@/app/api/produtos/route";

describe("productCreateSchema", () => {
  it("aceita o contrato manual real e rejeita enums antigos", () => {
    expect(
      productCreateSchema.safeParse({
        name: "Filtro",
        itemType: "MATERIAL",
        status: "REVIEW",
        productUrl: "https://example.com/filtro",
      }).success
    ).toBe(true);
    expect(productCreateSchema.safeParse({ name: "Filtro", itemType: "PRODUCT" }).success).toBe(false);
    expect(productCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
