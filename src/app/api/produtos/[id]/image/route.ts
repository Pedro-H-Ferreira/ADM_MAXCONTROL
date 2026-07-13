import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canUpdateProducts,
  productErrorResponse,
  productJsonError,
} from "@/app/api/produtos/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { uploadProductImage } from "@/lib/db/products-repository";
import { PRODUCT_IMAGE_MAX_BYTES } from "@/lib/supabase/product-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductImageRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: ProductImageRouteContext) {
  try {
    const { id: rawId } = await context.params;
    const id = z.uuid().safeParse(rawId);
    if (!id.success) return productJsonError("Id de produto invalido.");
    const actor = await resolveCurrentAppUser();
    if (!canUpdateProducts(actor)) return productJsonError("Usuario sem permissao para editar produtos.", 403);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > PRODUCT_IMAGE_MAX_BYTES + 1024 * 1024) {
      return productJsonError("Imagem maior que 5 MB.", 413, "PRODUCT_IMAGE_TOO_LARGE");
    }
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) return productJsonError("Envie a imagem no campo multipart 'file'.");
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      return productJsonError("Imagem maior que 5 MB.", 413, "PRODUCT_IMAGE_TOO_LARGE");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const product = await uploadProductImage(actor, id.data, {
      name: file.name,
      type: file.type,
      size: file.size,
      bytes,
    });
    return NextResponse.json({ success: true, product });
  } catch (error) {
    return productErrorResponse(error, "Falha ao enviar imagem do produto.");
  }
}
