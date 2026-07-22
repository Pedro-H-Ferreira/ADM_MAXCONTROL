import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  readFluigFieldSettings,
  replaceFluigFieldSettings,
  type FluigFieldSetting,
} from "@/lib/db/fluig-repository";
import { moduleOrNull } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function operationalModule(value: unknown) {
  const moduleSlug = moduleOrNull(String(value || ""));
  return moduleSlug === "pagamentos" || moduleSlug === "compras" || moduleSlug === "manutencao"
    ? moduleSlug
    : null;
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const moduleSlug = operationalModule(new URL(request.url).searchParams.get("module"));
    if (!moduleSlug) {
      return NextResponse.json({ success: false, error: "Modulo Fluig invalido." }, { status: 400 });
    }
    const result = await readFluigFieldSettings(moduleSlug);
    if (result.persistence.errors.length) throw new Error(result.persistence.errors.join(" "));
    return NextResponse.json({ success: true, settings: result.settings, configHash: result.configHash, isAdmin: actor.isAdmin });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Falha ao carregar campos Fluig." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return NextResponse.json({ success: false, error: "Somente administradores podem configurar os campos Fluig." }, { status: 403 });
    }
    const body = (await request.json()) as { module?: unknown; settings?: unknown };
    const moduleSlug = operationalModule(body.module);
    if (!moduleSlug || !Array.isArray(body.settings)) {
      return NextResponse.json({ success: false, error: "Modulo e campos Fluig sao obrigatorios." }, { status: 400 });
    }
    const settings = body.settings.map((item) => {
      const row = item as Record<string, unknown>;
      const sourceType: FluigFieldSetting["sourceType"] = row.sourceType === "request" ? "request" : "form";
      const active = row.active !== false;
      return {
        fieldKey: String(row.fieldKey || "").trim(),
        label: String(row.label || "").trim(),
        sourceType,
        active,
        visibleInList: active && row.visibleInList === true,
        listOrder: row.listOrder == null || row.listOrder === "" ? null : Number(row.listOrder),
        visibleInForm: active && row.visibleInForm === true,
        formOrder: row.formOrder == null || row.formOrder === "" ? null : Number(row.formOrder),
      };
    });
    const duplicate = settings.find((item, index) => settings.findIndex((other) => other.fieldKey === item.fieldKey) !== index);
    if (duplicate || settings.some((item) => !item.fieldKey || !item.label)) {
      return NextResponse.json({ success: false, error: "Existem campos vazios ou repetidos." }, { status: 400 });
    }
    const result = await replaceFluigFieldSettings({ actor, module: moduleSlug, settings });
    if (result.persistence.errors.length) throw new Error(result.persistence.errors.join(" "));
    return NextResponse.json({ success: true, settings: result.settings, configHash: result.configHash, isAdmin: true });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Falha ao salvar campos Fluig." }, { status: 500 });
  }
}
