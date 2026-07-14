import { NextResponse } from "next/server";
import { maintenanceWarehouseUpdateSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceSettings, updateMaintenanceWarehouse } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    return NextResponse.json({ success: true, ...(await readMaintenanceSettings(actor)) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao carregar configuracoes de manutencao.");
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = maintenanceWarehouseUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Configuracao invalida."));
    const actor = await resolveCurrentAppUser();
    return NextResponse.json({ success: true, warehouse: await updateMaintenanceWarehouse(actor, parsed.data) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao atualizar configuracao.");
  }
}
