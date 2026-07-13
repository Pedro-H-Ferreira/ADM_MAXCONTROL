import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";
import { approveSupplierPreRegistration } from "@/lib/db/suppliers-repository";
import { supplierErrorResponse } from "@/lib/supplier-errors";
import { canActorPerformSupplierAction } from "@/lib/supplier-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function canApprovePreRegistration(actor: AppActor) {
  return canActorPerformSupplierAction(actor, "canApprove");
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
    return supplierErrorResponse(error, "Falha ao aprovar pre-cadastro Fluig.");
  }
}
