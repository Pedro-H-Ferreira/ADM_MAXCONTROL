import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { reviewMaintenanceOrderCompletion } from "@/lib/db/maintenance-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  notes: z.string().trim().min(1, "Informe um comentario para a decisao.").max(2_000),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const parsed = reviewSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(parsed.error.issues[0]?.message || "Decisao invalida.");
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const order = await reviewMaintenanceOrderCompletion(actor, id, parsed.data);
    if (!order) return maintenanceJsonError("OS nao encontrada.", 404);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao revisar a conclusao da OS.");
  }
}
