import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceAssetUpdateSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceAsset, updateMaintenanceAsset } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function validId(context: RouteContext) {
  const { id } = await context.params;
  return z.string().uuid().safeParse(id);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const id = await validId(context);
    if (!id.success) return maintenanceJsonError("Ativo invalido.");
    const actor = await resolveCurrentAppUser();
    const asset = await readMaintenanceAsset(actor, id.data);
    if (!asset) return maintenanceJsonError("Ativo nao encontrado.", 404);
    return NextResponse.json({ success: true, asset });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao consultar ativo.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const id = await validId(context);
    if (!id.success) return maintenanceJsonError("Ativo invalido.");
    const parsed = maintenanceAssetUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do ativo invalidos."));
    if (!Object.keys(parsed.data).length) return maintenanceJsonError("Informe pelo menos um campo para atualizar.");
    const actor = await resolveCurrentAppUser();
    const asset = await updateMaintenanceAsset(actor, id.data, parsed.data);
    return NextResponse.json({ success: true, asset });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao atualizar ativo.");
  }
}
