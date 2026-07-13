import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { ignoreSupplierCandidate } from "@/lib/db/suppliers-repository";
import { resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";
import { canActorPerformSupplierAction } from "@/lib/supplier-permissions";
import { supplierErrorResponse } from "@/lib/supplier-errors";

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

function canWriteSuppliers(actor: AppActor) {
  return canActorPerformSupplierAction(actor, "canApprove");
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canWriteSuppliers(actor)) {
      return jsonError("Usuario sem permissao para ignorar candidato Fluig.", 403);
    }

    const candidate = await ignoreSupplierCandidate(actor, id);
    return NextResponse.json({ success: true, candidate });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return supplierErrorResponse(error, "Falha ao ignorar candidato Fluig.");
  }
}
