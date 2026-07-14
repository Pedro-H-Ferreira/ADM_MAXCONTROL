import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listMaintenanceCalendar } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  branchId: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({ from: params.get("from"), to: params.get("to"), branchId: params.get("branchId") });
    if (!parsed.success) return maintenanceJsonError("Periodo do calendario invalido.");
    if (Date.parse(parsed.data.to) - Date.parse(parsed.data.from) > 370 * 86_400_000) return maintenanceJsonError("O periodo maximo do calendario e de 370 dias.");
    const actor = await resolveCurrentAppUser();
    return NextResponse.json({ success: true, ...(await listMaintenanceCalendar(actor, parsed.data)) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao carregar calendario.");
  }
}
