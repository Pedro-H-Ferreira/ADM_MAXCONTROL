import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canUpdateProducts,
  canViewProducts,
  productErrorResponse,
  productJsonError,
} from "@/app/api/produtos/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  deleteProduct,
  readProduct,
  updateProduct,
  type ProductPatchInput,
} from "@/lib/db/products-repository";
import { PRODUCT_ITEM_TYPES, PRODUCT_STATUSES } from "@/lib/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductRouteContext = { params: Promise<{ id: string }> };

export const productPatchSchema = z
  .object({
    itemType: z.enum(PRODUCT_ITEM_TYPES).optional(),
    categoryId: z.uuid().nullable().optional(),
    materialTypeId: z.uuid().nullable().optional(),
    status: z.enum(PRODUCT_STATUSES).optional(),
    productUrl: z.union([z.url(), z.literal("")]).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos um campo para atualizar.",
  });

async function routeId(context: ProductRouteContext) {
  const { id } = await context.params;
  return z.uuid().safeParse(id);
}

export async function GET(_request: Request, context: ProductRouteContext) {
  try {
    const id = await routeId(context);
    if (!id.success) return productJsonError("Id de produto invalido.");
    const actor = await resolveCurrentAppUser();
    if (!canViewProducts(actor)) return productJsonError("Usuario sem permissao para consultar produtos.", 403);
    const product = await readProduct(actor, id.data);
    return NextResponse.json({ success: true, product });
  } catch (error) {
    return productErrorResponse(error, "Falha ao consultar produto.");
  }
}

export async function PATCH(request: Request, context: ProductRouteContext) {
  try {
    const id = await routeId(context);
    if (!id.success) return productJsonError("Id de produto invalido.");
    const actor = await resolveCurrentAppUser();
    if (!canUpdateProducts(actor)) return productJsonError("Usuario sem permissao para editar produtos.", 403);
    const body = await request.json().catch(() => ({}));
    const parsed = productPatchSchema.safeParse(body);
    if (!parsed.success) return productJsonError(parsed.error.issues[0]?.message || "Dados do produto invalidos.");
    const product = await updateProduct(actor, id.data, parsed.data as ProductPatchInput);
    return NextResponse.json({ success: true, product });
  } catch (error) {
    return productErrorResponse(error, "Falha ao editar produto.");
  }
}

export async function DELETE(_request: Request, context: ProductRouteContext) {
  try {
    const id = await routeId(context);
    if (!id.success) return productJsonError("Id de produto invalido.");
    const actor = await resolveCurrentAppUser();
    if (!canUpdateProducts(actor)) return productJsonError("Usuario sem permissao para excluir produtos.", 403);
    const result = await deleteProduct(actor, id.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return productErrorResponse(error, "Falha ao excluir produto.");
  }
}
