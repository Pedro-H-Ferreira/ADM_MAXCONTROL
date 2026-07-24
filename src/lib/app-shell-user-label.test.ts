import { describe, expect, it } from "vitest";
import { formatAppShellUserLabel } from "@/lib/app-shell-user-label";

describe("formatAppShellUserLabel", () => {
  it("combina o nome do usuario com os codigos unicos das filiais em ordem natural", () => {
    expect(
      formatAppShellUserLabel(
        "Administrativo",
        ["1035", "1017", "1035", " "],
        false,
      ),
    ).toBe("ADMINISTRATIVO - 1017 - 1035");
  });

  it("mantem somente o nome quando o usuario nao administra filiais", () => {
    expect(formatAppShellUserLabel("Administrativo", [], false)).toBe("ADMINISTRATIVO");
  });

  it("mostra somente Todas Filiais para administradores com acesso global", () => {
    expect(
      formatAppShellUserLabel("Pedro Henrique", ["1001", "1004", "1007"], true),
    ).toBe("Todas Filiais");
  });
});
