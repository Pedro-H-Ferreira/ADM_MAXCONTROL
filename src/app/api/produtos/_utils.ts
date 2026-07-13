import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import {
  canActorAccessPage,
  canActorPerformPageAction,
  type AppActor,
} from "@/lib/db/app-repository";

export function productJsonError(error: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status });
}

export function canViewProducts(actor: AppActor) {
  return canActorAccessPage(actor, "produtos");
}

export function canCreateProducts(actor: AppActor) {
  return canActorPerformPageAction(actor, "produtos", "canCreate");
}

export function canUpdateProducts(actor: AppActor) {
  return canActorPerformPageAction(actor, "produtos", "canUpdate");
}

export function productPermissions(actor: AppActor) {
  return {
    canView: canViewProducts(actor),
    canCreate: canCreateProducts(actor),
    canUpdate: canUpdateProducts(actor),
    canSyncHistory: actor.isAdmin,
  };
}

export function productErrorResponse(error: unknown, fallback: string) {
  const authResponse = appAuthErrorResponse(error);
  if (authResponse) return authResponse;
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === "23505") {
    return productJsonError("Ja existe um produto com esta identidade ou SKU.", 409, "PRODUCT_CONFLICT");
  }
  if (/PRODUCT_IDENTITY_IMMUTABLE/.test(value?.message || "")) {
    return productJsonError(
      "O tipo faz parte da identidade atual do produto e nao pode ser alterado por este schema.",
      409,
      "PRODUCT_IDENTITY_IMMUTABLE"
    );
  }
  return productJsonError(value?.message || fallback, 500);
}
