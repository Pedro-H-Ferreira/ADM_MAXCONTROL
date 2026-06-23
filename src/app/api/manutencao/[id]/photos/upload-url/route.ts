import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMaintenanceOrder } from "@/lib/db/maintenance-repository";
import {
  createMaintenancePhotoSignedUploadUrl,
  MAINTENANCE_PHOTO_MAX_BYTES,
  normalizeMaintenancePhotoMime,
} from "@/lib/supabase/maintenance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const uploadUrlSchema = z.object({
  name: z.string().trim().min(1, "Nome do arquivo e obrigatorio."),
  mimeType: z.string().trim().min(1, "Tipo da foto e obrigatorio."),
  size: z.coerce.number().int().min(1, "Arquivo de foto vazio.").max(MAINTENANCE_PHOTO_MAX_BYTES, "Foto maior que 10 MB."),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const order = await readMaintenanceOrder(actor, id);
    if (!order) return jsonError("OS nao encontrada.", 404);

    const body = await request.json().catch(() => ({}));
    const parsed = uploadUrlSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da foto invalidos.");
    }

    const mimeType = normalizeMaintenancePhotoMime(parsed.data.mimeType);
    if (!mimeType) return jsonError("Formato de foto invalido. Use JPG, PNG ou WebP.");

    const upload = await createMaintenancePhotoSignedUploadUrl({
      orderId: id,
      name: parsed.data.name,
      mimeType,
      size: parsed.data.size,
    });

    return NextResponse.json({ success: true, upload });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao preparar upload da foto.", 500);
  }
}
