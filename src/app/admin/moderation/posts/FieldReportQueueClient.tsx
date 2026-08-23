"use client";

import { useEffect, useState } from "react";
import type { WorkerFieldReportModerationStatus, WorkerFieldReportSummary } from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type FieldReportQueueState = "connected" | "not_configured" | "unavailable" | "action_failed";
type FieldReportDecision = Exclude<WorkerFieldReportModerationStatus, "pending">;
type FieldReportDecisionResponse = {
  success: boolean;
  data?: {
    reportId: string;
    decision: FieldReportDecision;
    public: boolean;
  };
};

export function FieldReportQueueClient({
  initialItems,
  queueState,
}: {
  initialItems: WorkerFieldReportSummary[];
  queueState: FieldReportQueueState;
}) {
  const [items, setItems] = useState(initialItems);
  const [state, setState] = useState(queueState);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("승인 전에는 현장 제보가 공개 상태와 현재 판단에 반영되지 않습니다.");

  useEffect(() => {
    const queue = document.querySelector('[aria-labelledby="field-report-queue-heading"]');
    queue?.setAttribute("data-silsigan-hydrated", "true");

    return () => {
      queue?.removeAttribute("data-silsigan-hydrated");
    };
  }, []);

  const applyDecision = async (reportId: string, decision: FieldReportDecision) => {
    const previousItems = items;
    setPendingId(reportId);
    setState("connected");
    setNotice(`${decisionLabel(decision)} 요청 중입니다.`);
    setItems((current) => current.filter((item) => item.id !== reportId));

    try {
      const response = await fetch("/api/admin/field-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportId,
          decision,
          reason: decision === "approved" ? "moderator approved field report" : "moderator rejected field report",
        }),
      });
      const payload = (await response.json()) as FieldReportDecisionResponse;
      if (!response.ok || !payload.success || payload.data?.reportId !== reportId || payload.data.decision !== decision) {
        throw new Error("field report moderation failed");
      }

      setNotice(payload.data.public ? "승인 완료. 현장 제보가 현재 장소 판단에 반영됩니다." : `${decisionLabel(decision)} 완료. 만료된 제보는 공개하지 않았습니다.`);
    } catch {
      setItems(previousItems);
      setState("action_failed");
      setNotice("처리 요청이 실패했습니다. 큐 항목을 복원했습니다.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className={styles.workerQueuePanel} aria-labelledby="field-report-queue-heading" data-silsigan-hydrated="false">
      <div className={styles.sectionHeader}>
        <div>
          <p>현장 상태 신호</p>
          <h2 id="field-report-queue-heading">현장 제보 검수 큐</h2>
        </div>
        <span>{queueStatusLabel(state)} · {items.length}건</span>
      </div>

      <p className={styles.actionNotice} aria-live="polite">{notice}</p>

      <div className={styles.queueList}>
        {items.map((item) => (
          <article key={item.id} className={styles.queueItem}>
            <div className={styles.thumb}>제보</div>
            <div className={styles.itemBody}>
              <div className={styles.itemHeader}>
                <div>
                  <strong>{item.placeName}</strong>
                  <span>{categoryLabel(item.category)} · {formatTime(item.createdAt)}</span>
                </div>
                <em>{item.moderationStatus === "pending" ? "검수 대기" : item.moderationStatus}</em>
              </div>
              <p>{observedSummary(item)}.</p>
              <div className={styles.reasonRow}>
                <span>만료 {formatTime(item.expiresAt)}</span>
                <span>{item.verifiedRadiusM ? `현장 반경 ${item.verifiedRadiusM}m` : "일반 제보"}</span>
                <span>제보 ID 끝자리 {item.id.slice(-8)}</span>
              </div>
              <div className={styles.actionRow}>
                <button type="button" onClick={() => void applyDecision(item.id, "approved")} disabled={pendingId === item.id}>승인</button>
                <button type="button" onClick={() => void applyDecision(item.id, "rejected")} disabled={pendingId === item.id}>반려</button>
              </div>
            </div>
          </article>
        ))}

        {items.length === 0 && (
          <section className={styles.empty}>
            <strong>{emptyTitle(state)}</strong>
            <p>{emptyDescription(state)}</p>
          </section>
        )}
      </div>
    </section>
  );
}

function observedSummary(report: WorkerFieldReportSummary) {
  const labels = report.observedDimensions.map((dimension) => ({
    crowd: "인파",
    queue: "대기",
    parking: "주차",
    local_condition: "현장 상태",
  })[dimension]);
  const values = [
    report.crowdLevel ? `인파 ${crowdLabel(report.crowdLevel)}` : null,
    report.lineStatus ? `대기 ${lineLabel(report.lineStatus)}` : null,
    report.parkingStatus ? `주차 ${parkingLabel(report.parkingStatus)}` : null,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" · ") : `확인한 항목 ${labels.join(" · ") || "없음"}`;
}

function categoryLabel(category: WorkerFieldReportSummary["category"]) {
  return {
    tourism: "관광지",
    festival: "축제",
    restaurant_cafe: "음식점·카페",
    hospital: "병원",
    public_office: "공공기관",
    parking: "주차장",
  }[category];
}

function crowdLabel(value: NonNullable<WorkerFieldReportSummary["crowdLevel"]>) {
  return { quiet: "여유", normal: "보통", busy: "혼잡", packed: "매우 혼잡" }[value];
}

function lineLabel(value: NonNullable<WorkerFieldReportSummary["lineStatus"]>) {
  return { none: "없음", short: "짧음", medium: "10~30분", long: "30분 이상" }[value];
}

function parkingLabel(value: NonNullable<WorkerFieldReportSummary["parkingStatus"]>) {
  return { available: "여유", limited: "일부 남음", full: "만차", unknown: "확인하지 못함" }[value];
}

function decisionLabel(decision: FieldReportDecision) {
  return decision === "approved" ? "승인" : "반려";
}

function queueStatusLabel(state: FieldReportQueueState) {
  if (state === "connected") return "연결됨";
  if (state === "not_configured") return "미설정";
  if (state === "action_failed") return "처리 실패";
  return "연결 실패";
}

function emptyTitle(state: FieldReportQueueState) {
  if (state === "not_configured") return "Worker 운영 연결이 설정되지 않았습니다.";
  if (state === "unavailable") return "현장 제보 검수 큐를 불러오지 못했습니다.";
  if (state === "action_failed") return "처리 요청이 실패했습니다.";
  return "검수 대기 현장 제보가 없습니다.";
}

function emptyDescription(state: FieldReportQueueState) {
  if (state === "not_configured") return "서버에 Worker API URL과 운영 토큰을 설정하면 검수 큐를 표시합니다.";
  if (state === "unavailable") return "Worker API URL, 운영 토큰, moderator role을 확인해야 합니다.";
  if (state === "action_failed") return "네트워크나 권한 오류를 확인한 뒤 다시 시도합니다.";
  return "새 현장 제보는 승인 전까지 공개 목록과 현재 상태 집계에서 제외됩니다.";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시각 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
