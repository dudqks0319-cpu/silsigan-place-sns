import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./errors.ts";

export { ApiError };

export function ok<TData>(data: TData, meta?: Record<string, unknown>) {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function fail(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "요청 값이 올바르지 않습니다.",
          details: error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof ApiError) {
    const response = NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
    if (error.status === 429 && error.details && typeof error.details === "object" && "retryAfterSeconds" in error.details) {
      const retryAfterSeconds = (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        response.headers.set("retry-after", String(Math.ceil(retryAfterSeconds)));
      }
    }
    return response;
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "요청 처리 중 오류가 발생했습니다.",
      },
    },
    { status: 500 },
  );
}
