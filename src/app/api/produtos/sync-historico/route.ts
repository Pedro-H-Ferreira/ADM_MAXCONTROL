import { NextResponse } from "next/server";
import { productErrorResponse, productJsonError } from "@/app/api/produtos/_utils";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { syncProductsFromFluigHistory } from "@/lib/db/products-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return productJsonError("Somente administradores podem sincronizar o historico de produtos.", 403);
    }
    const sync = await syncProductsFromFluigHistory(actor);
    return NextResponse.json({ success: true, sync });
  } catch (error) {
    return productErrorResponse(error, "Falha ao sincronizar produtos do historico Fluig.");
  }
}
