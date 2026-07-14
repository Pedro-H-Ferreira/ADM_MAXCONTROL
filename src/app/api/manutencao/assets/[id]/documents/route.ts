import { NextResponse } from "next/server";
import { z } from "zod";
import { maintenanceErrorResponse, maintenanceJsonError } from "@/app/api/manutencao/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { addMaintenanceAssetDocument, readMaintenanceAsset } from "@/lib/db/maintenance-domain-repository";
import {
  assertMaintenanceDocumentObject,
  createMaintenanceDocumentSignedUrls,
  MAINTENANCE_DOCUMENTS_BUCKET,
  normalizeMaintenanceDocumentMime,
  removeMaintenanceDocumentObjects,
} from "@/lib/supabase/maintenance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

const schema = z.object({
  documentType: z.enum(["MANUAL", "PHOTO", "INVOICE", "WARRANTY", "CERTIFICATE", "OTHER"]).default("OTHER"),
  name: z.string().trim().min(1).max(240),
  bucket: z.literal(MAINTENANCE_DOCUMENTS_BUCKET),
  path: z.string().trim().min(1).max(1_000),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().min(1),
  expiresAt: z.string().date().nullable().optional(),
}).strict();

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return maintenanceJsonError("Ativo invalido.");
    const actor = await resolveCurrentAppUser();
    const asset = await readMaintenanceAsset(actor, id);
    if (!asset) return maintenanceJsonError("Ativo nao encontrado.", 404);
    const documents = await createMaintenanceDocumentSignedUrls(Array.isArray(asset.documents) ? asset.documents : []);
    return NextResponse.json({ success: true, documents });
  } catch (error) {
    return maintenanceErrorResponse(error, "Falha ao listar documentos do ativo.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  let uploadedPath: string | null = null;
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return maintenanceJsonError("Ativo invalido.");
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return maintenanceJsonError(parsed.error.issues[0]?.message || "Documento invalido.");
    if (!parsed.data.path.startsWith(`${id}/`)) return maintenanceJsonError("Documento nao pertence ao ativo.");
    if (!normalizeMaintenanceDocumentMime(parsed.data.mimeType)) return maintenanceJsonError("Formato de documento invalido.");
    uploadedPath = parsed.data.path;
    await assertMaintenanceDocumentObject(uploadedPath);
    const actor = await resolveCurrentAppUser();
    const document = await addMaintenanceAssetDocument(actor, id, parsed.data);
    uploadedPath = null;
    return NextResponse.json({ success: true, document }, { status: 201 });
  } catch (error) {
    if (uploadedPath) await removeMaintenanceDocumentObjects([uploadedPath]).catch(() => undefined);
    return maintenanceErrorResponse(error, "Falha ao registrar documento do ativo.");
  }
}
