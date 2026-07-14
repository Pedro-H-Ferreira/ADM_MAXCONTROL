import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceAssetSchema } from "@/app/api/manutencao/_schemas";
import { firstValidationMessage, maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createMaintenanceAsset, listMaintenanceAssets } from "@/lib/db/maintenance-domain-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listSchema = z.object({
  search: z.string().trim().max(200).nullable(),
  branchId: z.string().uuid().nullable(),
  status: z.string().trim().max(80).nullable(),
  criticality: z.string().trim().max(80).nullable(),
  categoryId: z.string().uuid().nullable(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const parsed = listSchema.safeParse({
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      branchId: url.searchParams.get("branchId"),
      status: url.searchParams.get("status"),
      criticality: url.searchParams.get("criticality"),
      categoryId: url.searchParams.get("categoryId"),
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 20,
    });
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Filtros invalidos."));
    const payload = await listMaintenanceAssets(actor, parsed.data);
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar ativos.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const parsed = maintenanceAssetSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(firstValidationMessage(parsed.error, "Dados do ativo invalidos."));
    const asset = await createMaintenanceAsset(actor, parsed.data);
    return NextResponse.json({ success: true, asset }, { status: 201 });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao cadastrar ativo.");
  }
}
