import { ok } from "@/lib/api";
import { listQuestions } from "@/lib/mock-store";

export async function GET() {
  return ok(
    listQuestions().map((question) => ({
      ...question,
      status: question.answeredReportId ? "answered" : "pending",
    })),
  );
}
