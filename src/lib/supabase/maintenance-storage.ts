import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

export const MAINTENANCE_PHOTOS_BUCKET = "maintenance-photos";
export const MAINTENANCE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const MAINTENANCE_PHOTO_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const bucketOptions = {
  public: false,
  fileSizeLimit: MAINTENANCE_PHOTO_MAX_BYTES,
  allowedMimeTypes: [...MAINTENANCE_PHOTO_ALLOWED_MIME_TYPES],
};

function assertServiceClient() {
  const client = getSupabaseServiceClient();
  if (!client) {
    const missing = getSupabaseServiceStatus().missing.join(", ");
    throw new Error(`Supabase service role nao configurado. Faltando: ${missing}`);
  }
  return client;
}

export function normalizeMaintenancePhotoMime(value: unknown) {
  const mimeType = String(value || "").trim().toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  return MAINTENANCE_PHOTO_ALLOWED_MIME_TYPES.includes(mimeType as (typeof MAINTENANCE_PHOTO_ALLOWED_MIME_TYPES)[number])
    ? mimeType
    : null;
}

export function maintenancePhotoExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function safeFileStem(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "foto"
  );
}

export function createMaintenancePhotoPath(orderId: string, originalName: string, mimeType: string) {
  const datePrefix = new Date().toISOString().slice(0, 10);
  const extension = maintenancePhotoExtension(mimeType);
  return `${orderId}/${datePrefix}/${randomUUID()}-${safeFileStem(originalName)}.${extension}`;
}

export async function ensureMaintenancePhotosBucket(client: SupabaseClient = assertServiceClient()) {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;

  const exists = (buckets || []).some((bucket) => bucket.id === MAINTENANCE_PHOTOS_BUCKET || bucket.name === MAINTENANCE_PHOTOS_BUCKET);
  if (!exists) {
    const { error } = await client.storage.createBucket(MAINTENANCE_PHOTOS_BUCKET, bucketOptions);
    if (error) throw error;
    return;
  }

  const { error } = await client.storage.updateBucket(MAINTENANCE_PHOTOS_BUCKET, bucketOptions);
  if (error) throw error;
}

export async function createMaintenancePhotoSignedUploadUrl(input: {
  orderId: string;
  name: string;
  mimeType: string;
  size: number;
}) {
  if (input.size < 1) throw new Error("Arquivo de foto vazio.");
  if (input.size > MAINTENANCE_PHOTO_MAX_BYTES) throw new Error("Foto maior que 10 MB.");

  const normalizedMimeType = normalizeMaintenancePhotoMime(input.mimeType);
  if (!normalizedMimeType) throw new Error("Formato de foto invalido. Use JPG, PNG ou WebP.");

  const client = assertServiceClient();
  await ensureMaintenancePhotosBucket(client);
  const path = createMaintenancePhotoPath(input.orderId, input.name, normalizedMimeType);
  const { data, error } = await client.storage.from(MAINTENANCE_PHOTOS_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;

  return {
    bucket: MAINTENANCE_PHOTOS_BUCKET,
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    mimeType: normalizedMimeType,
  };
}

export async function assertMaintenancePhotoObject(path: string) {
  const client = assertServiceClient();
  const { data, error } = await client.storage.from(MAINTENANCE_PHOTOS_BUCKET).info(path);
  if (error) throw error;
  if (!data) throw new Error("Foto enviada nao encontrada no Storage.");
  return data;
}

export async function createMaintenancePhotoSignedUrls<T extends { bucket?: string | null; path?: string | null }>(photos: T[]) {
  const client = assertServiceClient();
  const paths = photos
    .filter((photo) => (photo.bucket || MAINTENANCE_PHOTOS_BUCKET) === MAINTENANCE_PHOTOS_BUCKET && photo.path)
    .map((photo) => photo.path as string);

  if (!paths.length) return photos.map((photo) => ({ ...photo, signedUrl: null as string | null }));

  const { data, error } = await client.storage.from(MAINTENANCE_PHOTOS_BUCKET).createSignedUrls(paths, 60 * 30);
  if (error) throw error;

  const signedByPath = new Map((data || []).map((item) => [item.path, item.signedUrl || null]));
  return photos.map((photo) => ({
    ...photo,
    signedUrl: photo.path ? signedByPath.get(photo.path) || null : null,
  }));
}

export async function removeMaintenancePhotoObjects(paths: string[]) {
  if (!paths.length) return;
  const client = assertServiceClient();
  await client.storage.from(MAINTENANCE_PHOTOS_BUCKET).remove(paths);
}
