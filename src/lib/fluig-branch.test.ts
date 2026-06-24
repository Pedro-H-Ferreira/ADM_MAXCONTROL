import { describe, expect, it } from "vitest";
import { normalizeFluigBranch } from "@/lib/fluig-branch";

describe("Fluig branch normalization", () => {
  it("mantem filial Fluig normal", () => {
    expect(normalizeFluigBranch({ label: "1022 - 1022-CA" })).toEqual({
      code: "1022",
      label: "1022 - 1022-CA",
    });
  });

  it("remove identificador interno prefixado ao codigo real", () => {
    expect(normalizeFluigBranch({ label: "0064986403813601846-1012 - GAMA" })).toEqual({
      code: "1012",
      label: "1012 - GAMA",
    });
    expect(
      normalizeFluigBranch({
        label: "0064986403813601846-1012 - GAMA",
        explicitCode: "0064986403813601846-1012",
      })
    ).toEqual({
      code: "1012",
      label: "1012 - GAMA",
    });
  });

  it("ignora objetos serializados e textos sem codigo de filial", () => {
    expect(normalizeFluigBranch({ label: "[object HTMLInputElement]" })).toEqual({
      code: null,
      label: null,
    });
    expect(normalizeFluigBranch({ label: "Dia a Dia - LUZIANIA II" })).toEqual({
      code: null,
      label: null,
    });
  });
});
