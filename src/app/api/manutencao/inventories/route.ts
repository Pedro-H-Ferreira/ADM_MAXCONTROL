import { NextResponse } from "next/server";
import { maintenanceInventorySchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createMaintenanceInventory, listMaintenanceInventories } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const searchParams = new URL(request.url).searchParams;
    const payload = await listMaintenanceInventories(actor, {
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20),
      branchId: searchParams.get("branchId"),
      inventoryType: searchParams.get("inventoryType"),
      status: searchParams.get("status"),
    });
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar inventarios.");
  }
}

export async function POST(request: Request) {
  try {
    const parsed = maintenanceInventorySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do inventario invalidos."));
    const actor = await resolveCurrentAppUser();
    const inventory = await createMaintenanceInventory(actor, parsed.data);
    return NextResponse.json({ success: true, inventory }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao iniciar inventario.");
  }
}
