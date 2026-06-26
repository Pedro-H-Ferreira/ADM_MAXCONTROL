import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";
import { approveSupplierPreRegistration } from "@/lib/db/suppliers-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const writeRoles = new Set(["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO"]);

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function canApprovePreRegistration(actor: AppActor) {
  return (
    canActorAccessPage(actor, "fornecedores") &&
    (writeRoles.has(actor.role) ||
      canActorPerformPageAction(actor, "fornecedores", "canApprove") ||
      canActorPerformPageAction(actor, "fornecedores", "canUpdate"))
  );
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canApprovePreRegistration(actor)) {
      return jsonError("Usuario sem permissao para aprovar pre-cadastro Fluig.", 403);
    }

    const supplier = await approveSupplierPreRegistration(actor, id);
    if (!supplier) return jsonError("Fornecedor nao encontrado.", 404);
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao aprovar pre-cadastro Fluig.", 500);
  }
}
