import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenancePreventivePlanSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  createMaintenancePreventivePlan,
  generateMaintenancePreventiveOrders,
  listMaintenancePreventivePlans,
} from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    const payload = await listMaintenancePreventivePlans(actor);
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar planos preventivos.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    if (z.object({ action: z.literal("GENERATE") }).strict().safeParse(body).success) {
      const orders = await generateMaintenancePreventiveOrders(actor);
      return NextResponse.json({ success: true, orders });
    }
    const parsed = maintenancePreventivePlanSchema.safeParse(body);
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do plano preventivo invalidos."));
    const plan = await createMaintenancePreventivePlan(actor, parsed.data);
    return NextResponse.json({ success: true, plan }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao salvar plano preventivo.");
  }
}
