import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canCreateProducts,
  canViewProducts,
  productErrorResponse,
  productJsonError,
  productPermissions,
} from "@/app/api/produtos/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  createProduct,
  listProducts,
  type ProductCreateInput,
  type ProductListInput,
} from "@/lib/db/products-repository";
import { PRODUCT_ITEM_TYPES, PRODUCT_STATUSES } from "@/lib/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableUrl = z.union([z.url(), z.literal("")]).nullable().optional();

export const productCreateSchema = z.object({
  sku: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1, "Nome do produto e obrigatorio.").max(500),
  description: z.string().trim().max(10_000).nullable().optional(),
  specification: z.string().trim().max(20_000).nullable().optional(),
  itemType: z.enum(PRODUCT_ITEM_TYPES).optional(),
  categoryId: z.uuid().nullable().optional(),
  materialTypeId: z.uuid().nullable().optional(),
  unit: z.string().trim().max(100).nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  productUrl: nullableUrl,
});

const productListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).nullable().optional(),
  itemType: z.enum(PRODUCT_ITEM_TYPES).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  categoryCode: z.string().trim().max(100).nullable().optional(),
  materialTypeId: z.uuid().nullable().optional(),
  unit: z.string().trim().max(100).nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).nullable().optional(),
});

function queryValue(url: URL, key: string) {
  return url.searchParams.get(key) || null;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canViewProducts(actor)) return productJsonError("Usuario sem permissao para consultar produtos.", 403);
    const url = new URL(request.url);
    const parsed = productListSchema.safeParse({
      page: queryValue(url, "page") || 1,
      pageSize: queryValue(url, "pageSize") || 25,
      search: queryValue(url, "search") || queryValue(url, "q"),
      itemType: queryValue(url, "itemType"),
      categoryId: queryValue(url, "categoryId"),
      categoryCode: queryValue(url, "categoryCode"),
      materialTypeId: queryValue(url, "materialTypeId"),
      unit: queryValue(url, "unit"),
      status: queryValue(url, "status"),
    });
    if (!parsed.success) return productJsonError(parsed.error.issues[0]?.message || "Filtros invalidos.");
    const payload = await listProducts(actor, parsed.data as ProductListInput);
    return NextResponse.json({ success: true, permissions: productPermissions(actor), ...payload });
  } catch (error) {
    return productErrorResponse(error, "Falha ao listar produtos.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canCreateProducts(actor)) return productJsonError("Usuario sem permissao para criar produtos.", 403);
    const body = await request.json().catch(() => ({}));
    const parsed = productCreateSchema.safeParse(body);
    if (!parsed.success) return productJsonError(parsed.error.issues[0]?.message || "Dados do produto invalidos.");
    const product = await createProduct(actor, parsed.data as ProductCreateInput);
    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error) {
    return productErrorResponse(error, "Falha ao criar produto.");
  }
}
