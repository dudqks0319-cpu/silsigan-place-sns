import { ok } from "@/lib/api";
import { isLegacyDemoEnabled, legacyDemoMeta, legacyUnavailableMeta } from "@/lib/legacy-access";
import { listQuestions } from "@/lib/mock-store";

export async function GET() {
  if (!isLegacyDemoEnabled()) return ok([], legacyUnavailableMeta);
  return ok(
    listQuestions().map((question) => ({
      ...question,
      status: question.answeredReportId ? "answered" : "pending",
    })),
    legacyDemoMeta,
  );
}
