import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 30;

const bucketOptions = {
  public: false,
  fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
  allowedMimeTypes: [...PRODUCT_IMAGE_ALLOWED_MIME_TYPES],
};

function assertServiceClient() {
  const client = getSupabaseServiceClient();
  if (!client) {
    const missing = getSupabaseServiceStatus().missing.join(", ");
    throw new Error(`Supabase service role nao configurado. Faltando: ${missing}`);
  }
  return client;
}

export function normalizeProductImageMime(value: unknown) {
  const mimeType = String(value || "").trim().toLowerCase();
  if (mimeType === "image/jpg") return "image/jpeg";
  return PRODUCT_IMAGE_ALLOWED_MIME_TYPES.includes(
    mimeType as (typeof PRODUCT_IMAGE_ALLOWED_MIME_TYPES)[number]
  )
    ? mimeType
    : null;
}

export function detectProductImageMime(bytes: Uint8Array) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateProductImage(input: {
  declaredMimeType: unknown;
  size: number;
  bytes: Uint8Array;
}) {
  if (input.size < 1 || input.bytes.length < 1) throw new Error("Arquivo de imagem vazio.");
  if (input.size > PRODUCT_IMAGE_MAX_BYTES || input.bytes.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error("Imagem maior que 5 MB.");
  }

  const declaredMimeType = normalizeProductImageMime(input.declaredMimeType);
  if (!declaredMimeType) throw new Error("Formato de imagem invalido. Use JPEG, PNG ou WebP.");
  const detectedMimeType = detectProductImageMime(input.bytes);
  if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
    throw new Error("Conteudo do arquivo nao corresponde a uma imagem JPEG, PNG ou WebP valida.");
  }

  return detectedMimeType;
}

function productImageExtension(mimeType: string) {
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
      .slice(0, 60) || "produto"
  );
}

export function createProductImagePath(productId: string, originalName: string, mimeType: string) {
  return `${productId}/${randomUUID()}-${safeFileStem(originalName)}.${productImageExtension(mimeType)}`;
}

export async function ensureProductImagesBucket(client: SupabaseClient = assertServiceClient()) {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) throw listError;
  const exists = (buckets || []).some(
    (bucket) => bucket.id === PRODUCT_IMAGES_BUCKET || bucket.name === PRODUCT_IMAGES_BUCKET
  );

  if (!exists) {
    const { error } = await client.storage.createBucket(PRODUCT_IMAGES_BUCKET, bucketOptions);
    if (error) throw error;
    return;
  }

  const { error } = await client.storage.updateBucket(PRODUCT_IMAGES_BUCKET, bucketOptions);
  if (error) throw error;
}

export async function uploadProductImageObject(input: {
  productId: string;
  originalName: string;
  declaredMimeType: string;
  size: number;
  bytes: Uint8Array;
}) {
  const mimeType = validateProductImage({
    declaredMimeType: input.declaredMimeType,
    size: input.size,
    bytes: input.bytes,
  });
  const client = assertServiceClient();
  await ensureProductImagesBucket(client);
  const path = createProductImagePath(input.productId, input.originalName, mimeType);
  const { error } = await client.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, input.bytes, {
    contentType: mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;

  const { data } = client.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return {
    bucket: PRODUCT_IMAGES_BUCKET,
    path,
    canonicalUrl: data.publicUrl,
    mimeType,
  };
}

export async function createProductImageSignedUrls(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (!uniquePaths.length) return new Map<string, string | null>();

  const client = assertServiceClient();
  const { data, error } = await client.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .createSignedUrls(uniquePaths, PRODUCT_IMAGE_SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.path, item.signedUrl || null]));
}

export async function removeProductImageObjects(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  if (!uniquePaths.length) return;
  const client = assertServiceClient();
  const { error } = await client.storage.from(PRODUCT_IMAGES_BUCKET).remove(uniquePaths);
  if (error) throw error;
}
