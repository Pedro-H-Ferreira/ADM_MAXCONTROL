import { NextResponse } from "next/server";
import { maintenanceProviderSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createMaintenanceServiceProvider, listMaintenanceServiceProviders } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = new URL(request.url).searchParams;
    const active = params.get("active");
    const result = await listMaintenanceServiceProviders(actor, {
      page: Number(params.get("page") || 1), pageSize: Number(params.get("pageSize") || 20), search: params.get("q"),
      active: active == null || active === "ALL" ? null : active === "true",
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar prestadores.");
  }
}

export async function POST(request: Request) {
  try {
    const parsed = maintenanceProviderSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Prestador invalido."));
    const actor = await resolveCurrentAppUser();
    const provider = await createMaintenanceServiceProvider(actor, parsed.data);
    return NextResponse.json({ success: true, provider }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao cadastrar prestador.");
  }
}
