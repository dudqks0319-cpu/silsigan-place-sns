import { fail, ok } from "@/lib/api";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { createReport, listReports } from "@/lib/mock-store";
import { assertLocalDemoApiAvailable } from "@/lib/runtime-data-mode";
import { createReportSchema, listReportsSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    assertLocalDemoApiAvailable();
    const url = new URL(request.url);
    const filters = listReportsSchema.parse({
      placeId: url.searchParams.get("placeId") ?? undefined,
      regionId: url.searchParams.get("regionId") ?? url.searchParams.get("region") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    return ok(listReports(filters), {
      privacy: "사용자 정확 좌표는 응답하지 않습니다. 제보에는 verifiedRadiusM만 포함됩니다.",
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalDemoApiAvailable();
    assertRateLimit({ key: await rateLimitKey(request, "create-report"), limit: 12, windowMs: 60_000 });
    const input = createReportSchema.parse(await request.json());

    return ok(createReport(input));
  } catch (error) {
    return fail(error);
  }
}
