import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminCookieName, isAdminTokenValid } from "@/lib/admin-auth";
import { store } from "@/lib/store";
import { listWorkerModerationReports, workerAdminApiConfigured, type WorkerModerationReportSummary } from "@/lib/worker-admin-api";
import { ModerationQueueClient } from "./ModerationQueueClient";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function PostModerationPage() {
  if (process.env.NODE_ENV === "production" && !process.env.SILSIGAN_ADMIN_TOKEN) {
    notFound();
  }

  const adminToken = (await cookies()).get(adminCookieName)?.value;
  if (!isAdminTokenValid(adminToken)) {
    redirect("/admin/login" as never);
  }

  const queue = await store.listPostModerationQueue();
  const activationRows = await store.listRegionActivationDashboard();
  const { state: workerQueueState, reports: workerReports } = await loadWorkerReports();
  const hiddenCount = queue.filter((item) => item.hidden).length;
  const sensitiveCount = queue.filter((item) =>
    item.flagReasons.some((reason) => ["privacy_face", "privacy_plate", "sensitive_info"].includes(reason)),
  ).length;
  const activatableCount = activationRows.filter((row) => row.status.canActivate).length;
  const workerOpenCount = workerReports.length;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p>#실시간 운영 큐</p>
        <h1>Worker 신고 큐와 게시물 검토</h1>
        <span>Worker 신고 큐, 지역 readiness, 데모 게시물 신고를 한 화면에서 점검합니다.</span>
      </section>

      <section className={styles.metrics} aria-label="신고 큐 요약">
        <div>
          <strong>{workerOpenCount}</strong>
          <span>Worker open 신고</span>
        </div>
        <div>
          <strong>{queue.length}</strong>
          <span>데모 게시물 신고</span>
        </div>
        <div>
          <strong>{hiddenCount}</strong>
          <span>임시 숨김</span>
        </div>
        <div>
          <strong>{sensitiveCount}</strong>
          <span>민감 우선</span>
        </div>
        <div>
          <strong>{activatableCount}</strong>
          <span>활성화 가능 area</span>
        </div>
      </section>

      <section className={styles.activationPanel} aria-labelledby="activation-heading">
        <div className={styles.sectionHeader}>
          <div>
            <p>지역 활성화 기준</p>
            <h2 id="activation-heading">area 오픈 readiness</h2>
          </div>
          <span>{activatableCount}/{activationRows.length} 활성화 가능</span>
        </div>

        <div className={styles.activationGrid}>
          {activationRows.map((row) => (
            <article className={styles.activationItem} key={row.areaId}>
              <div className={styles.activationTitleRow}>
                <div>
                  <strong>{row.regionName} · {row.areaName}</strong>
                  <span>{row.owner} · {formatUpdatedAt(row.updatedAt)}</span>
                </div>
                <em className={row.status.canActivate ? styles.readyBadge : styles.holdBadge}>
                  {row.status.canActivate ? "활성화 가능" : "보류"}
                </em>
              </div>

              <div className={styles.progressTrack} aria-label={`${row.regionName} ${row.areaName} 활성화 기준 ${row.status.passedCount}/${row.status.totalCount} 통과`}>
                <span style={{ width: `${(row.status.passedCount / row.status.totalCount) * 100}%` }} />
              </div>

              <ul className={styles.checkList}>
                {row.status.checks.map((check) => (
                  <li className={check.passed ? styles.checkPassed : styles.checkFailed} key={check.key}>
                    <span>{check.label}</span>
                    <strong>{formatActivationValue(check.current)} / {formatActivationValue(check.required)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <ModerationQueueClient initialItems={queue} initialWorkerReports={workerReports} workerQueueState={workerQueueState} />
    </main>
  );
}

async function loadWorkerReports(): Promise<{ state: "connected" | "not_configured" | "unavailable"; reports: WorkerModerationReportSummary[] }> {
  if (!workerAdminApiConfigured()) {
    return { state: "not_configured", reports: [] };
  }

  try {
    return {
      state: "connected",
      reports: await listWorkerModerationReports({ status: "open", limit: 20 }),
    };
  } catch {
    return { state: "unavailable", reports: [] };
  }
}

function formatActivationValue(value: number | boolean) {
  if (typeof value === "boolean") {
    return value ? "ready" : "not ready";
  }

  return value.toLocaleString("ko-KR");
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
