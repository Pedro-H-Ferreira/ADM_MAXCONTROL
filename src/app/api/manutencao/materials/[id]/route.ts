import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceMaterialUpdateSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { updateMaintenanceMaterial } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) return maintenanceJsonError("Material invalido.");
    const parsed = maintenanceMaterialUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do material invalidos."));
    if (!Object.keys(parsed.data).length) return maintenanceJsonError("Informe pelo menos um campo para atualizar.");
    const actor = await resolveCurrentAppUser();
    const material = await updateMaintenanceMaterial(actor, parsedId.data, parsed.data);
    return NextResponse.json({ success: true, material });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao atualizar material.");
  }
}
