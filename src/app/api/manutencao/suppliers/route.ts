import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listMaintenanceSupplierOptions } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const search = z.string().trim().max(200).safeParse(new URL(request.url).searchParams.get("q") || "");
    if (!search.success) return maintenanceJsonError("Busca de fornecedor invalida.");
    const actor = await resolveCurrentAppUser();
    return NextResponse.json({ success: true, items: await listMaintenanceSupplierOptions(actor, search.data) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao consultar fornecedores.");
  }
}
