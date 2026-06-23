import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  appendMaintenanceOrderPhotos,
  readMaintenanceOrder,
  type MaintenancePhotoInput,
} from "@/lib/db/maintenance-repository";
import {
  assertMaintenancePhotoObject,
  createMaintenancePhotoSignedUrls,
  MAINTENANCE_PHOTOS_BUCKET,
  normalizeMaintenancePhotoMime,
  removeMaintenancePhotoObjects,
} from "@/lib/supabase/maintenance-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const photoSchema = z.object({
  name: z.string().trim().min(1),
  size: z.coerce.number().int().min(0).nullable().optional(),
  type: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  bucket: z.string().trim().min(1).default(MAINTENANCE_PHOTOS_BUCKET),
  path: z.string().trim().min(1),
});

const photosSchema = z.object({
  photos: z.array(photoSchema).min(1, "Informe ao menos uma foto.").max(12, "Envie no maximo 12 fotos por vez."),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function normalizePhoto(input: z.infer<typeof photoSchema>, orderId: string): MaintenancePhotoInput {
  const type = normalizeMaintenancePhotoMime(input.mimeType || input.type);
  if (!type) throw new Error("Formato de foto invalido. Use JPG, PNG ou WebP.");
  if (input.bucket !== MAINTENANCE_PHOTOS_BUCKET) throw new Error("Bucket de foto invalido.");
  if (!input.path.startsWith(`${orderId}/`)) throw new Error("Caminho da foto nao pertence a OS.");

  return {
    name: input.name,
    size: input.size ?? null,
    type,
    bucket: MAINTENANCE_PHOTOS_BUCKET,
    path: input.path,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const order = await readMaintenanceOrder(actor, id);
    if (!order) return jsonError("OS nao encontrada.", 404);

    const photos = await createMaintenancePhotoSignedUrls(order.photos || []);
    return NextResponse.json({ success: true, photos });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar fotos da OS.", 500);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const registeredPaths: string[] = [];
  let appendedToOrder = false;
  try {
    const actor = await resolveCurrentAppUser();
    const { id } = await context.params;
    const order = await readMaintenanceOrder(actor, id);
    if (!order) return jsonError("OS nao encontrada.", 404);

    const body = await request.json().catch(() => ({}));
    const parsed = photosSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da foto invalidos.");
    }

    const photos = parsed.data.photos.map((photo) => normalizePhoto(photo, id));
    for (const photo of photos) {
      if (!photo.path) continue;
      await assertMaintenancePhotoObject(photo.path);
      registeredPaths.push(photo.path);
    }

    const updated = await appendMaintenanceOrderPhotos(actor, id, photos);
    if (!updated) return jsonError("OS nao encontrada.", 404);
    appendedToOrder = true;

    const signedPhotos = await createMaintenancePhotoSignedUrls(updated.photos || []);
    return NextResponse.json({ success: true, order: updated, photos: signedPhotos });
  } catch (error) {
    if (!appendedToOrder && registeredPaths.length) {
      await removeMaintenancePhotoObjects(registeredPaths).catch(() => undefined);
    }
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao registrar fotos da OS.", 500);
  }
}
