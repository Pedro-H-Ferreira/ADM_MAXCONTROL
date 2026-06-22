import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { approveSupplierCandidate } from "@/lib/db/suppliers-repository";
import { resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";

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

function canWriteSuppliers(actor: AppActor) {
  return writeRoles.has(actor.role);
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canWriteSuppliers(actor)) {
      return jsonError("Usuario sem permissao para aprovar candidato Fluig.", 403);
    }

    const supplier = await approveSupplierCandidate(actor, id);
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao aprovar candidato Fluig.", 500);
  }
}
