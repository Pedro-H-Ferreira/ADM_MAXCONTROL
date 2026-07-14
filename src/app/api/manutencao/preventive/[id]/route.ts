import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenancePreventivePlanUpdateSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { setMaintenancePreventivePlanActive, updateMaintenancePreventivePlan } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
const activeSchema = z.object({ active: z.boolean() }).strict();

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return maintenanceJsonError("Plano preventivo invalido.");
    const body = await request.json().catch(() => ({}));
    const actor = await resolveCurrentAppUser();
    const activeOnly = activeSchema.safeParse(body);
    if (activeOnly.success) {
      return NextResponse.json({ success: true, plan: await setMaintenancePreventivePlanActive(actor, id, activeOnly.data.active) });
    }
    const parsed = maintenancePreventivePlanUpdateSchema.safeParse(body);
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do plano preventivo invalidos."));
    return NextResponse.json({ success: true, plan: await updateMaintenancePreventivePlan(actor, id, parsed.data) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao atualizar plano preventivo.");
  }
}
