import { fail, ok } from "@/lib/api";
import { createReport, listReports } from "@/lib/mock-store";
import { createReportSchema, listReportsSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = listReportsSchema.parse({
      placeId: url.searchParams.get("placeId") ?? undefined,
      includeExpired: url.searchParams.get("includeExpired") ?? undefined,
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
    const input = createReportSchema.parse(await request.json());

    return ok(createReport(input));
  } catch (error) {
    return fail(error);
  }
}
