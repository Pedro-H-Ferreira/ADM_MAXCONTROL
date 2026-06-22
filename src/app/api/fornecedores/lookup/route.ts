import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { lookupSupplierByCnpj } from "@/lib/db/suppliers-repository";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const cnpj = url.searchParams.get("cnpj") || "";
    const result = await lookupSupplierByCnpj(actor, cnpj);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar CNPJ.", 500);
  }
}
