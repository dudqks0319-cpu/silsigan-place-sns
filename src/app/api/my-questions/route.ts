import { fail, ok } from "@/lib/api";
import { listQuestions } from "@/lib/mock-store";
import { assertLocalDemoApiAvailable } from "@/lib/runtime-data-mode";

export async function GET() {
  try {
    assertLocalDemoApiAvailable();
    return ok(
      listQuestions().map((question) => ({
        ...question,
        status: question.answeredReportId ? "answered" : "pending",
      })),
    );
  } catch (error) {
    return fail(error);
  }
}
