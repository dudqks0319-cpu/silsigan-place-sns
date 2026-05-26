import { fail, ok } from "@/lib/api";
import { flagReport } from "@/lib/mock-store";
import { flagReportSchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const input = flagReportSchema.parse(await request.json());

    return ok(flagReport(input), {
      policy: "개인정보/민감정보 1건, 허위 2건, 전체 3건 이상이면 임시 숨김 처리합니다."
    });
  } catch (error) {
    return fail(error);
  }
}
