import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { assertMaintenanceAction, readMaintenanceAsset } from "@/lib/db/maintenance-domain-repository";
import {
  createMaintenanceDocumentSignedUploadUrl,
  MAINTENANCE_DOCUMENT_MAX_BYTES,
} from "@/lib/supabase/maintenance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  size: z.coerce.number().int().min(1).max(MAINTENANCE_DOCUMENT_MAX_BYTES),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return maintenanceJsonError("Ativo invalido.");
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(parsed.error.issues[0]?.message || "Documento invalido.");
    const actor = await resolveCurrentAppUser();
    await assertMaintenanceAction(actor, "MANAGE_ASSETS");
    if (!await readMaintenanceAsset(actor, id)) return maintenanceJsonError("Ativo nao encontrado.", 404);
    const upload = await createMaintenanceDocumentSignedUploadUrl({ assetId: id, ...parsed.data });
    return NextResponse.json({ success: true, upload });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao preparar upload do documento.");
  }
}
