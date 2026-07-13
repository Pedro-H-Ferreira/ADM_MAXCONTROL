import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { lookupSupplierByCnpj } from "@/lib/db/suppliers-repository";
import { canActorAccessPage, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { supplierErrorResponse } from "@/lib/supplier-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorAccessPage(actor, "fornecedores")) {
      return jsonError("Usuario sem permissao para consultar fornecedores.", 403);
    }

    const url = new URL(request.url);
    const cnpj = url.searchParams.get("cnpj") || "";
    const result = await lookupSupplierByCnpj(actor, cnpj);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return supplierErrorResponse(error, "Falha ao consultar CNPJ.");
  }
}
