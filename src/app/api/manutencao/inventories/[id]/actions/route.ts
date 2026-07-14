import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceInventoryActionSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { runMaintenanceInventoryAction } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) return maintenanceJsonError("Inventario invalido.");
    const parsed = maintenanceInventoryActionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Acao de inventario invalida."));
    const actor = await resolveCurrentAppUser();
    const result = await runMaintenanceInventoryAction(actor, parsedId.data, parsed.data);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao executar acao no inventario.");
  }
}
