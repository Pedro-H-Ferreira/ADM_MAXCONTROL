import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceReport } from "@/lib/db/maintenance-domain-repository";

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
    if (!parsed.success || Date.parse(parsed.data.to) < Date.parse(parsed.data.from)) return maintenanceJsonError("Periodo do relatorio invalido.");
    const actor = await resolveCurrentAppUser();
    return NextResponse.json({ success: true, ...(await readMaintenanceReport(actor, parsed.data)) });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao gerar relatorio de manutencao.");
  }
}
