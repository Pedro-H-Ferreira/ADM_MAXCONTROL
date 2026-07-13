import { canActorPerformPageAction, type AppActor } from "@/lib/db/app-repository";

export type SupplierPermissionAction = "canCreate" | "canUpdate" | "canApprove";

export function canActorPerformSupplierAction(
  actor: Pick<AppActor, "isAdmin" | "pageAccess">,
  action: SupplierPermissionAction
) {
  if (actor.isAdmin) return true;
  return canActorPerformPageAction(actor, "fornecedores", action);
}

export function canActorAccessSupplierBranches(
  actor: Pick<AppActor, "isAdmin" | "branchCodes">,
  supplierBranchCodes: Array<string | null | undefined>
) {
  if (actor.isAdmin) return true;
  const allowed = new Set(actor.branchCodes.map((code) => code.trim()).filter(Boolean));
  return supplierBranchCodes.some((code) => Boolean(code && allowed.has(code.trim())));
}
