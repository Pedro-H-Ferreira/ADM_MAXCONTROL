import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceInventory } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) return maintenanceJsonError("Inventario invalido.");
    const actor = await resolveCurrentAppUser();
    const searchParams = new URL(request.url).searchParams;
    const inventory = await readMaintenanceInventory(actor, parsedId.data, {
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 20),
    });
    if (!inventory) return maintenanceJsonError("Inventario nao encontrado.", 404);
    return NextResponse.json({ success: true, inventory });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao consultar inventario.");
  }
}
