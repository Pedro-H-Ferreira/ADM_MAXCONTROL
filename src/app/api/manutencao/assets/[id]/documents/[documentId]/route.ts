import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { removeMaintenanceAssetDocument } from "@/lib/db/maintenance-domain-repository";
import { MAINTENANCE_DOCUMENTS_BUCKET, removeMaintenanceDocumentObjects } from "@/lib/supabase/maintenance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; documentId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id, documentId } = await context.params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(documentId).success) return maintenanceJsonError("Documento invalido.");
    const actor = await resolveCurrentAppUser();
    const document = await removeMaintenanceAssetDocument(actor, id, documentId);
    if (document.bucket === MAINTENANCE_DOCUMENTS_BUCKET && document.path) await removeMaintenanceDocumentObjects([String(document.path)]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao remover documento do ativo.");
  }
}
