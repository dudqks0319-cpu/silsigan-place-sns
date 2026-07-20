export type RecentReportRecord = {
  id: string;
  createdAt: string;
};

export function mergeReportCollections<TReport extends RecentReportRecord>(
  primaryReports: readonly TReport[],
  supplementalReports: readonly TReport[],
): TReport[] {
  const reportsById = new Map<string, TReport>();

  for (const report of supplementalReports) {
    reportsById.set(report.id, report);
  }
  for (const report of primaryReports) {
    reportsById.set(report.id, report);
  }

  return [...reportsById.values()].sort(
    (left, right) => safeTimestamp(right.createdAt) - safeTimestamp(left.createdAt),
  );
}

function safeTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
