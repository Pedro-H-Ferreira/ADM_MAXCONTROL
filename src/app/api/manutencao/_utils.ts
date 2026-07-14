import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";

export function maintenanceJsonError(error: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status });
}

export function maintenanceErrorResponse(error: unknown, fallback: string) {
  const authResponse = appAuthErrorResponse(error);
  if (authResponse) return authResponse;
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === "23505") {
    return maintenanceJsonError("Ja existe um registro de manutencao com estes dados.", 409, "MAINTENANCE_CONFLICT");
  }
  if (value?.code === "23503") {
    return maintenanceJsonError("O registro relacionado nao existe ou nao esta mais disponivel.", 409, "MAINTENANCE_REFERENCE_INVALID");
  }
  if (value?.code === "22P02") {
    return maintenanceJsonError("Um dos identificadores informados e invalido.", 400, "MAINTENANCE_ID_INVALID");
  }
  return maintenanceJsonError(value?.message || fallback, 500);
}

export function firstValidationMessage(error: { issues: Array<{ message: string }> }, fallback: string) {
  return error.issues[0]?.message || fallback;
}
