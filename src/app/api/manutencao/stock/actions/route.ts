import { NextResponse } from "next/server";
import { maintenanceStockActionSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { runMaintenanceStockAction } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const parsed = maintenanceStockActionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Acao de estoque invalida."));
    const actor = await resolveCurrentAppUser();
    const result = await runMaintenanceStockAction(actor, parsed.data);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao movimentar estoque.");
  }
}
