import { NextResponse } from "next/server";
import { maintenanceProviderUpdateSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { updateMaintenanceServiceProvider } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const parsed = maintenanceProviderUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Prestador invalido."));
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    return NextResponse.json({ success: true, provider: await updateMaintenanceServiceProvider(actor, id, parsed.data) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao atualizar prestador.");
  }
}
