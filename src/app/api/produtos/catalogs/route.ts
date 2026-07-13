import { NextResponse } from "next/server";
import {
  canViewProducts,
  productErrorResponse,
  productJsonError,
} from "@/app/api/produtos/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listProductCatalogs } from "@/lib/db/products-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canViewProducts(actor)) return productJsonError("Usuario sem permissao para consultar produtos.", 403);
    const catalogs = await listProductCatalogs(actor);
    return NextResponse.json({ success: true, ...catalogs });
  } catch (error) {
    return productErrorResponse(error, "Falha ao carregar catalogos de produtos.");
  }
}
