import { NextResponse } from "next/server";
import { maintenanceErrorResponse } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listMaintenanceStockMovements } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = new URL(request.url).searchParams;
    const result = await listMaintenanceStockMovements(actor, {
      page: Number(params.get("page") || 1), pageSize: Number(params.get("pageSize") || 20),
      search: params.get("q"), branchId: params.get("branchId"), movementType: params.get("movementType"),
      from: params.get("from"), to: params.get("to"),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar movimentacoes.");
  }
}
