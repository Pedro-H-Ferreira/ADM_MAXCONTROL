import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { reconcileSupplierPreRegistrations } from "@/lib/db/suppliers-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST() {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return jsonError("Somente administradores podem reconciliar o historico de fornecedores.", 403);
    }

    const persistence = await reconcileSupplierPreRegistrations({ actorId: actor.id });
    return NextResponse.json({ success: true, persistence });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao reconciliar fornecedores do Fluig.", 500);
  }
}
