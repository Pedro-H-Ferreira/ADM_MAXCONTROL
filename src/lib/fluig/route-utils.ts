import { NextResponse } from "next/server";
import { isFluigModuleSlug, requireFluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

export function jsonError(error: string, status = 400, details?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error, ...(details ? { details } : {}) }, { status });
}

export async function readJsonBody<T>(request: Request, fallback: T): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return fallback;
  }
}

export function getModuleFromUrl(request: Request, fallback?: string | null) {
  const url = new URL(request.url);
  return url.searchParams.get("module") || fallback || "";
}

export function requireModule(moduleSlug: string) {
  if (!isFluigModuleSlug(moduleSlug)) {
    throw new Error(`Modulo Fluig invalido: ${moduleSlug || "(vazio)"}`);
  }

  return moduleSlug;
}

export function getProcessMapForRequest(moduleSlug: string) {
  const normalizedModule = requireModule(moduleSlug);
  return requireFluigProcessMap(normalizedModule);
}

export function parseBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|sim|yes|on)$/i.test(String(value).trim());
}

export function parseNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeRequestIds(value: unknown) {
  return (Array.isArray(value) ? value : String(value || "").split(/[,;\s]+/))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function normalizeFieldOverrides(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([field, value]) => [field, value == null ? "" : String(value)])
      .filter(([field]) => field)
  );
}

export function mergePersistence(...items: Array<{ configured: boolean; saved: Record<string, number>; errors: string[] }>) {
  return {
    configured: items.some((item) => item.configured),
    saved: items.reduce<Record<string, number>>((acc, item) => {
      for (const [key, value] of Object.entries(item.saved)) {
        acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {}),
    errors: items.flatMap((item) => item.errors),
  };
}

export function moduleOrNull(value: string): FluigModuleSlug | null {
  return isFluigModuleSlug(value) ? value : null;
}
