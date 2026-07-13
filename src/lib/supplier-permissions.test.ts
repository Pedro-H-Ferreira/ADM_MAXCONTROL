import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canActorAccessSupplierBranches,
  canActorPerformSupplierAction,
  type SupplierPermissionAction,
} from "@/lib/supplier-permissions";

const actions: SupplierPermissionAction[] = ["canCreate", "canUpdate", "canApprove"];

function actor(input: {
  isAdmin?: boolean;
  canView?: boolean;
  canCreate?: boolean;
  canUpdate?: boolean;
  canApprove?: boolean;
}) {
  return {
    isAdmin: input.isAdmin ?? false,
    pageAccess: [
      {
        pageSlug: "fornecedores",
        canView: input.canView ?? true,
        canCreate: input.canCreate ?? false,
        canUpdate: input.canUpdate ?? false,
        canApprove: input.canApprove ?? false,
      },
    ],
  };
}

describe("supplier permissions", () => {
  it("concede todas as acoes somente pelo sinalizador administrativo", () => {
    const admin = actor({ isAdmin: true, canView: false });

    for (const action of actions) {
      expect(canActorPerformSupplierAction(admin, action)).toBe(true);
    }
  });

  it("exige a permissao especifica para atores nao administrativos", () => {
    const creator = actor({ canCreate: true });

    expect(canActorPerformSupplierAction(creator, "canCreate")).toBe(true);
    expect(canActorPerformSupplierAction(creator, "canUpdate")).toBe(false);
    expect(canActorPerformSupplierAction(creator, "canApprove")).toBe(false);
  });

  it("nao concede acoes sem acesso de visualizacao", () => {
    const hidden = actor({ canView: false, canCreate: true, canUpdate: true, canApprove: true });

    for (const action of actions) {
      expect(canActorPerformSupplierAction(hidden, action)).toBe(false);
    }
  });
});

describe("supplier branch scope", () => {
  it("permite administradores independentemente de vinculo", () => {
    expect(canActorAccessSupplierBranches({ isAdmin: true, branchCodes: [] }, [])).toBe(true);
  });

  it("exige intersecao explicita para usuario comum", () => {
    const scopedActor = { isAdmin: false, branchCodes: ["1007", "1022"] };
    expect(canActorAccessSupplierBranches(scopedActor, ["1022"])).toBe(true);
    expect(canActorAccessSupplierBranches(scopedActor, ["2011"])).toBe(false);
    expect(canActorAccessSupplierBranches(scopedActor, [])).toBe(false);
  });
});

describe("supplier route permission contracts", () => {
  it.each([
    ["src/app/api/fornecedores/route.ts", "canCreate"],
    ["src/app/api/fornecedores/[id]/route.ts", "canUpdate"],
    ["src/app/api/fornecedores/[id]/sync-fluig/route.ts", "canUpdate"],
    ["src/app/api/fornecedores/[id]/approve-pre-registration/route.ts", "canApprove"],
    ["src/app/api/fornecedores/candidates/[id]/approve/route.ts", "canApprove"],
    ["src/app/api/fornecedores/candidates/[id]/ignore/route.ts", "canApprove"],
  ])("protege %s com %s sem bypass por perfil", async (path, action) => {
    const route = await readFile(resolve(process.cwd(), path), "utf8");

    expect(route).toContain(`canActorPerformSupplierAction(actor, "${action}")`);
    expect(route).not.toContain("ADMINISTRATIVO");
    expect(route).not.toContain("writeRoles");
  });

  it("encaminha o fornecedor revisado opcional na aprovacao do candidato", async () => {
    const route = await readFile(
      resolve(process.cwd(), "src/app/api/fornecedores/candidates/[id]/approve/route.ts"),
      "utf8"
    );

    expect(route).toContain("supplierSchema.safeParse(body)");
    expect(route).toContain("approveSupplierCandidate(actor, id, parsed?.data");
  });
});
