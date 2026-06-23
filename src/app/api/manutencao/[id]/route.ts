import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  readMaintenanceOrder,
  updateMaintenanceOrder,
  type MaintenanceOrderUpdateInput,
} from "@/lib/db/maintenance-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateSchema = z.object({
  source: z.enum(["manual", "fluig"]).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  area: z.string().trim().min(1).optional(),
  priority: z.enum(["CRITICA", "ALTA", "MEDIA", "BAIXA"]).optional(),
  status: z.enum(["ABERTA", "INICIADA", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "FINALIZADA", "CANCELADA"]).optional(),
  requester: z.string().nullable().optional(),
  technician: z.string().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  materialSummary: z.string().nullable().optional(),
  materialCostCents: z.coerce.number().int().min(0).nullable().optional(),
  materials: z
    .array(
      z.object({
        item: z.string().trim().min(1),
        quantity: z.string().nullable().optional(),
        valueCents: z.coerce.number().int().min(0).nullable().optional(),
      })
    )
    .optional(),
  photos: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        size: z.coerce.number().int().min(0).nullable().optional(),
        type: z.string().nullable().optional(),
      })
    )
    .optional(),
  pendingReason: z.string().nullable().optional(),
  fluigRequestId: z.string().nullable().optional(),
  fluigNumLancW: z.string().nullable().optional(),
  fluigCurrentTask: z.string().nullable().optional(),
  fluigTaskOwner: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const order = await readMaintenanceOrder(actor, id);
    if (!order) return jsonError("OS nao encontrada.", 404);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar OS.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da OS invalidos.");
    }

    const order = await updateMaintenanceOrder(actor, id, parsed.data as MaintenanceOrderUpdateInput);
    if (!order) return jsonError("OS nao encontrada.", 404);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao atualizar OS.", 500);
  }
}
