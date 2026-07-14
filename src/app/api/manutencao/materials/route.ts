import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceMaterialSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createMaintenanceMaterial, listMaintenanceMaterials } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listSchema = z.object({
  search: z.string().trim().max(200).nullable(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").nullable(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      active: url.searchParams.get("active"),
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 20,
    });
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Filtros invalidos."));
    const payload = await listMaintenanceMaterials(actor, parsed.data);
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar materiais.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const parsed = maintenanceMaterialSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do material invalidos."));
    const material = await createMaintenanceMaterial(actor, parsed.data);
    return NextResponse.json({ success: true, material }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao cadastrar material.");
  }
}
