import { NextResponse } from "next/server";
import { maintenanceErrorResponse } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceDomainDashboard } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    const dashboard = await readMaintenanceDomainDashboard(actor);
    return NextResponse.json({ success: true, ...dashboard });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao carregar o painel de manutencao.");
  }
}
