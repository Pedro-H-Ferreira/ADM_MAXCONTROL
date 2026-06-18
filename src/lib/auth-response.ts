import { NextResponse } from "next/server";
import { isAppAuthError } from "@/lib/db/app-repository";

export function appAuthErrorResponse(error: unknown) {
  if (isAppAuthError(error)) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
      },
      { status: error.status }
    );
  }

  return null;
}
