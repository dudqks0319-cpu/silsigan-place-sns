"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import type {
  WorkerFieldReportModerationStatus,
  WorkerFieldReportSummary,
  WorkerModerationReportSummary,
  WorkerModerationStatus,
  WorkerPlaceAdditionRequestStatus,
  WorkerPlaceAdditionRequestSummary,
} from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type DemoModerationAction = "keep" | "hide" | "delete" | "restrict_author";

type ModerationQueueItem = {
  post: {
    id: string;
    creatorName: string;
    caption: string | null;
    photoLabel: string;
    createdAt: string;
  };
  place: {
    name: string;
  };
  flagReasons: string[];
  flagCount: number;
  hidden: boolean;
  recommendedAction: string;
};

type WorkerQueueState = "connected" | "not_configured" | "unavailable" | "action_failed";
type QueueFilterId = "all" | "privacy_face" | "privacy_plate" | "sensitive_info" | "false_content" | "spam" | "hidden";
type ModerationPostResponse = {
  success: boolean;
  data?: {
    postId: string;
    action: DemoModerationAction;
    hidden: boolean;
  };
};

type FieldReportModerationResponse = {
  success: boolean;
  data?: WorkerFieldReportSummary;
};

type PlaceRequestReviewResponse = {
  success: boolean;
  data?: WorkerPlaceAdditionRequestSummary;
};

const queueFilters = [
  { id: "all", label: "전체" },
  { id: "privacy_face", label: "얼굴" },
  { id: "privacy_plate", label: "차량번호" },
  { id: "sensitive_info", label: "민감정보" },
  { id: "false_content", label: "허위" },
  { id: "spam", label: "스팸" },
  { id: "hidden", label: "임시 숨김" },
] satisfies Array<{ id: QueueFilterId; label: string }>;

export function ModerationQueueClient({
  initialItems,
  initialWorkerReports,
  workerQueueState,
  initialFieldReports,
  fieldReportQueueState,
  initialPlaceRequests,
  placeRequestQueueState,
}: {
  initialItems: ModerationQueueItem[];
  initialWorkerReports: WorkerModerationReportSummary[];
  workerQueueState: WorkerQueueState;
  initialFieldReports: WorkerFieldReportSummary[];
  fieldReportQueueState: WorkerQueueState;
  initialPlaceRequests: WorkerPlaceAdditionRequestSummary[];
  placeRequestQueueState: WorkerQueueState;
}) {
  const [items, setItems] = useState(initialItems);
  const [workerReports, setWorkerReports] = useState(initialWorkerReports);
  const [workerState, setWorkerState] = useState<WorkerQueueState>(workerQueueState);
  const [fieldReports, setFieldReports] = useState(initialFieldReports);
  const [fieldReportState, setFieldReportState] = useState<WorkerQueueState>(fieldReportQueueState);
  const [placeRequests, setPlaceRequests] = useState(initialPlaceRequests);
  const [placeRequestState, setPlaceRequestState] = useState<WorkerQueueState>(placeRequestQueueState);
  const [placeRequestReasons, setPlaceRequestReasons] = useState<Record<string, string>>({});
  const [matchedPlaceIds, setMatchedPlaceIds] = useState<Record<string, string>>({});
  const [activeFilter, setActiveFilter] = useState<QueueFilterId>("all");
  const [pendingPostId, setPendingPostId] = useState<string | null>(null);
  const [pendingFieldReportId, setPendingFieldReportId] = useState<string | null>(null);
  const [pendingPlaceRequestId, setPendingPlaceRequestId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState("운영 액션을 선택하면 큐 상태가 즉시 반영됩니다.");
  const filteredWorkerReports = workerReports.filter((report) => workerReportMatchesFilter(report, activeFilter));
  const filteredItems = items.filter((item) => itemMatchesFilter(item, activeFilter));
  const visibleCount = filteredWorkerReports.length + filteredItems.length;

  const applyAction = async (postId: string, action: DemoModerationAction) => {
    const previousItems = items;
    setPendingPostId(postId);
    setActionNotice(`${actionLabel(action)} 요청 중입니다.`);
    setItems((current) => current.map((item) => (item.post.id === postId ? applyOptimisticAction(item, action) : item)));
    trackEvent("moderate_post", { postId, action });
    try {
      const response = await fetch("/api/admin/moderation/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ postId, action }),
      });
      const payload = (await response.json()) as ModerationPostResponse;
      const result = payload.data;
      if (!response.ok || !payload.success || !result || result.postId !== postId) {
        throw new Error("moderation action failed");
      }

      setItems((current) => current.map((item) => (item.post.id === postId ? applyModerationResult(item, result) : item)));
      setActionNotice(`${actionLabel(action)} 완료. 필터와 큐 상태를 갱신했습니다.`);
    } catch {
      setItems(previousItems);
      setActionNotice("처리 요청이 실패했습니다. 이전 큐 상태로 되돌렸습니다.");
    } finally {
      setPendingPostId(null);
    }
  };

  const applyWorkerReportAction = (reportId: string, status: Exclude<WorkerModerationStatus, "open">) => {
    const previousReports = workerReports;
    setWorkerReports((current) => current.filter((report) => report.id !== reportId));
    setWorkerState("connected");
    trackEvent("moderate_worker_report", { reportId, status });
    trackEvent(status === "accepted" ? "report_approved" : "report_rejected", { reportId });
    void fetch("/api/admin/moderation/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reportId,
        status,
        reason: status === "accepted" ? "admin accepted from queue" : "admin rejected from queue",
      }),
    }).catch(() => {
      setWorkerReports(previousReports);
      setWorkerState("action_failed");
    });
  };

  const applyFieldReportAction = async (
    reportId: string,
    status: Exclude<WorkerFieldReportModerationStatus, "pending">,
  ) => {
    const previousReports = fieldReports;
    setPendingFieldReportId(reportId);
    setFieldReports((current) => current.filter((report) => report.id !== reportId));
    setFieldReportState("connected");
    setActionNotice(`${fieldReportStatusLabel(status)} 요청 중입니다.`);
    trackEvent("moderate_worker_report", { status, surface: "field_report" });

    try {
      const response = await fetch("/api/admin/field-reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reportId,
          status,
          reason: `admin ${status} from field report queue`,
        }),
      });
      const payload = (await response.json()) as FieldReportModerationResponse;
      const result = payload.data;
      if (!response.ok || !payload.success || !result || result.id !== reportId || result.moderationStatus !== status) {
        throw new Error("field report moderation action failed");
      }

      if (status === "approved") {
        trackEvent("report_approved", { surface: "field_report" });
      } else if (status === "rejected") {
        trackEvent("report_rejected", { surface: "field_report" });
      }
      setActionNotice(`${fieldReportStatusLabel(status)} 완료. 현장 제보가 현재 상태에 반영되었습니다.`);
    } catch {
      setFieldReports(previousReports);
      setFieldReportState("action_failed");
      setActionNotice("현장 제보 처리 요청이 실패했습니다. 이전 큐 상태로 되돌렸습니다.");
    } finally {
      setPendingFieldReportId(null);
    }
  };

  const applyPlaceRequestAction = async (
    requestId: string,
    status: WorkerPlaceAdditionRequestStatus,
  ) => {
    const reason = (placeRequestReasons[requestId] ?? "").trim();
    const matchedPlaceId = (matchedPlaceIds[requestId] ?? "").trim();
    if (reason.length < 5 || reason.length > 300) {
      setActionNotice("장소 추가 요청의 검토 사유를 5자 이상 300자 이하로 입력해 주세요.");
      return;
    }
    if (status === "duplicate" && !matchedPlaceId) {
      setActionNotice("기존 장소로 분류하려면 일치하는 장소 ID를 입력해 주세요.");
      return;
    }

    setPendingPlaceRequestId(requestId);
    setActionNotice(`${placeRequestStatusLabel(status)} 처리 중입니다.`);
    try {
      const response = await fetch("/api/admin/place-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          status,
          reason,
          ...(status === "duplicate" ? { matchedPlaceId } : {}),
        }),
      });
      const payload = (await response.json()) as PlaceRequestReviewResponse;
      const reviewedRequest = payload.data;
      if (!response.ok || !payload.success || !reviewedRequest || reviewedRequest.id !== requestId) {
        throw new Error("place request review failed");
      }

      setPlaceRequests((current) => current.map((item) => (item.id === requestId ? reviewedRequest : item)));
      setPlaceRequestState("connected");
      setActionNotice(`${placeRequestStatusLabel(status)} 처리 완료. 장소 데이터는 변경되지 않았습니다.`);
    } catch {
      setPlaceRequestState("action_failed");
      setActionNotice("장소 추가 요청 처리가 실패했습니다. 입력 내용과 운영 연결을 확인해 주세요.");
    } finally {
      setPendingPlaceRequestId(null);
    }
  };

  return (
    <>
      <nav className={styles.tabs} aria-label="신고 사유 필터">
        {queueFilters.map((filter) => {
          const count = countForFilter(filter.id, workerReports, items);

          return (
            <button
              key={filter.id}
              className={activeFilter === filter.id ? styles.tabActive : ""}
              type="button"
              aria-pressed={activeFilter === filter.id}
              onClick={() => {
                setActiveFilter(filter.id);
                trackEvent("filter_moderation_queue", { filter: filter.id });
              }}
            >
              <span>{filter.label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </nav>

      <div className={styles.filterSummary} aria-live="polite">
        <strong>{queueFilterLabel(activeFilter)}</strong>
        <span>Worker 신고 {filteredWorkerReports.length}건 · 데모 게시물 {filteredItems.length}건</span>
      </div>
      <p className={styles.actionNotice} aria-live="polite">{actionNotice}</p>

      <section className={styles.workerQueuePanel} aria-labelledby="worker-queue-heading">
        <div className={styles.sectionHeader}>
          <div>
            <p>Cloudflare Worker</p>
            <h2 id="worker-queue-heading">실시간 신고 큐</h2>
          </div>
          <span>{workerQueueStatusLabel(workerState)}</span>
        </div>

        <div className={styles.queueList}>
          {filteredWorkerReports.map((report) => (
            <article key={report.id} className={styles.queueItem}>
              <div className={styles.thumb}>{targetTypeLabel(report.targetType)}</div>
              <div className={styles.itemBody}>
                <div className={styles.itemHeader}>
                  <div>
                    <strong>{targetTypeLabel(report.targetType)} 신고</strong>
                    <span>{report.targetId} · {formatCreatedAt(report.createdAt)}</span>
                  </div>
                  <em>{statusLabel(report.status)}</em>
                </div>
                <p>{reasonLabel(report.reason)}</p>
                <div className={styles.reasonRow}>
                  <span>{reasonLabel(report.reason)}</span>
                  <span>{report.id}</span>
                </div>
                <div className={styles.actionRow}>
                  <button type="button" onClick={() => applyWorkerReportAction(report.id, "accepted")}>승인</button>
                  <button type="button" onClick={() => applyWorkerReportAction(report.id, "rejected")}>거절</button>
                </div>
              </div>
            </article>
          ))}

          {filteredWorkerReports.length === 0 && (
            <section className={styles.empty}>
              <strong>{workerEmptyTitle(workerState)}</strong>
              <p>{workerEmptyDescription(workerState, activeFilter)}</p>
            </section>
          )}
        </div>
      </section>

      <section className={styles.workerQueuePanel} aria-labelledby="field-report-queue-heading">
        <div className={styles.sectionHeader}>
          <div>
            <p>현장 제보 · D1 moderation</p>
            <h2 id="field-report-queue-heading">현장 제보 검수 큐</h2>
          </div>
          <span>{workerQueueStatusLabel(fieldReportState)}</span>
        </div>

        <div className={styles.queueList}>
          {fieldReports.map((report) => (
            <article key={report.id} className={styles.queueItem}>
              <div className={styles.thumb}>{report.moderationStatus === "pending" ? "검수" : "상태"}</div>
              <div className={styles.itemBody}>
                <div className={styles.itemHeader}>
                  <div>
                    <strong>{report.placeName}</strong>
                    <span>{fieldReportCategoryLabel(report.category)} · {formatCreatedAt(report.createdAt)}</span>
                  </div>
                  <em>{fieldReportStatusLabel(report.moderationStatus)}</em>
                </div>
                <p>{fieldReportEvidenceLabel(report)}</p>
                <div className={styles.fieldReportMeta} aria-label="현장 제보 검수 정보">
                  <span>현장 인증 {verificationMethodLabel(report.verificationMethod)}</span>
                  <span>정확도 {accuracyBucketLabel(report.accuracyBucket)}</span>
                  <span>만료 {formatCreatedAt(report.expiresAt)}</span>
                </div>
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    onClick={() => void applyFieldReportAction(report.id, "approved")}
                    disabled={pendingFieldReportId === report.id}
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyFieldReportAction(report.id, "rejected")}
                    disabled={pendingFieldReportId === report.id}
                  >
                    거절
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyFieldReportAction(report.id, "hidden")}
                    disabled={pendingFieldReportId === report.id}
                  >
                    숨김
                  </button>
                </div>
              </div>
            </article>
          ))}

          {fieldReports.length === 0 && (
            <section className={styles.empty}>
              <strong>{fieldReportEmptyTitle(fieldReportState)}</strong>
              <p>{fieldReportEmptyDescription(fieldReportState)}</p>
            </section>
          )}
        </div>
      </section>

      <section className={styles.workerQueuePanel} aria-labelledby="place-request-queue-heading">
        <div className={styles.sectionHeader}>
          <div>
            <p>수동 검토 전용 · 장소 데이터 변경 없음</p>
            <h2 id="place-request-queue-heading">장소 추가 요청 큐</h2>
          </div>
          <span>{workerQueueStatusLabel(placeRequestState)}</span>
        </div>

        <div className={styles.queueList}>
          {placeRequests.map((request) => (
            <article key={request.id} className={styles.queueItem}>
              <div className={styles.thumb}>장소</div>
              <div className={styles.itemBody}>
                <div className={styles.itemHeader}>
                  <div>
                    <strong>{request.name}</strong>
                    <span>{request.category} · {formatCreatedAt(request.createdAt)}</span>
                  </div>
                  <em>{placeRequestStatusLabel(request.status)}</em>
                </div>
                <p>{request.address}</p>
                {request.reviewReason && <p className={styles.placeRequestReview}>최근 검토 사유: {request.reviewReason}</p>}
                {request.matchedPlaceId && <p className={styles.placeRequestReview}>일치 장소 ID: {request.matchedPlaceId}</p>}

                <div className={styles.placeRequestForm}>
                  <label>
                    <span>검토 사유 (5~300자)</span>
                    <input
                      type="text"
                      minLength={5}
                      maxLength={300}
                      value={placeRequestReasons[request.id] ?? ""}
                      onChange={(event) => setPlaceRequestReasons((current) => ({ ...current, [request.id]: event.target.value }))}
                      disabled={pendingPlaceRequestId === request.id}
                    />
                  </label>
                  <label>
                    <span>일치 장소 ID (기존 장소 선택 시 필수)</span>
                    <input
                      type="text"
                      maxLength={100}
                      value={matchedPlaceIds[request.id] ?? ""}
                      onChange={(event) => setMatchedPlaceIds((current) => ({ ...current, [request.id]: event.target.value }))}
                      disabled={pendingPlaceRequestId === request.id}
                    />
                  </label>
                  <div className={styles.placeRequestActions}>
                    {placeRequestActions.map((action) => (
                      <button
                        key={action.status}
                        type="button"
                        onClick={() => void applyPlaceRequestAction(request.id, action.status)}
                        disabled={pendingPlaceRequestId === request.id}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}

          {placeRequests.length === 0 && (
            <section className={styles.empty}>
              <strong>{placeRequestEmptyTitle(placeRequestState)}</strong>
              <p>{placeRequestEmptyDescription(placeRequestState)}</p>
            </section>
          )}
        </div>
      </section>

      <div className={styles.queueList} aria-label="데모 게시물 신고 큐">
        {filteredItems.map((item) => (
          <article key={item.post.id} className={styles.queueItem}>
            <div className={styles.thumb}>{item.hidden ? "숨김" : "검토"}</div>
            <div className={styles.itemBody}>
              <div className={styles.itemHeader}>
                <div>
                  <strong>{item.place.name}</strong>
                  <span>{item.post.creatorName} · 신고 {item.flagCount}건</span>
                </div>
                <em>{item.recommendedAction}</em>
              </div>
              <p>{item.post.caption ?? item.post.photoLabel}</p>
              <div className={styles.reasonRow}>
                {(item.flagReasons.length ? item.flagReasons : ["신고 대기 없음"]).map((reason) => (
                  <span key={reason}>{reasonLabel(reason)}</span>
                ))}
              </div>
              <div className={styles.actionRow}>
                <button type="button" onClick={() => void applyAction(item.post.id, "keep")} disabled={pendingPostId === item.post.id}>유지</button>
                <button type="button" onClick={() => void applyAction(item.post.id, "hide")} disabled={pendingPostId === item.post.id}>숨김</button>
                <button type="button" onClick={() => void applyAction(item.post.id, "delete")} disabled={pendingPostId === item.post.id}>삭제</button>
                <button type="button" onClick={() => void applyAction(item.post.id, "restrict_author")} disabled={pendingPostId === item.post.id}>작성자 제한</button>
              </div>
            </div>
          </article>
        ))}
        {filteredItems.length === 0 && (
          <section className={styles.empty}>
            <strong>{visibleCount === 0 ? `${queueFilterLabel(activeFilter)} 대기 항목이 없습니다.` : "데모 게시물 대기 항목이 없습니다."}</strong>
            <p>필터를 바꾸거나 Worker 신고 큐를 확인해 주세요.</p>
          </section>
        )}
      </div>
    </>
  );
}

function applyOptimisticAction(item: ModerationQueueItem, action: DemoModerationAction): ModerationQueueItem {
  if (action === "keep") {
    return {
      ...item,
      flagCount: 0,
      flagReasons: [],
      hidden: false,
      recommendedAction: actionLabel(action),
    };
  }

  if (action === "hide" || action === "delete") {
    return {
      ...item,
      hidden: true,
      recommendedAction: actionLabel(action),
    };
  }

  return {
    ...item,
    recommendedAction: actionLabel(action),
  };
}

function applyModerationResult(item: ModerationQueueItem, result: NonNullable<ModerationPostResponse["data"]>): ModerationQueueItem {
  return {
    ...applyOptimisticAction(item, result.action),
    hidden: result.hidden,
  };
}

function countForFilter(filter: QueueFilterId, reports: WorkerModerationReportSummary[], items: ModerationQueueItem[]) {
  return reports.filter((report) => workerReportMatchesFilter(report, filter)).length + items.filter((item) => itemMatchesFilter(item, filter)).length;
}

function workerReportMatchesFilter(report: WorkerModerationReportSummary, filter: QueueFilterId) {
  if (filter === "all") {
    return true;
  }

  if (filter === "hidden") {
    return report.status !== "open";
  }

  return report.reason === filter;
}

function itemMatchesFilter(item: ModerationQueueItem, filter: QueueFilterId) {
  if (filter === "all") {
    return item.flagCount > 0 || item.hidden;
  }

  if (filter === "hidden") {
    return item.hidden;
  }

  return item.flagReasons.includes(filter);
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    privacy_face: "얼굴",
    privacy_plate: "차량번호",
    sensitive_info: "민감정보",
    false_content: "허위",
    spam: "광고/스팸",
    other: "기타",
  };

  return labels[reason] ?? reason;
}

function queueFilterLabel(filter: QueueFilterId) {
  const found = queueFilters.find((item) => item.id === filter);
  return found?.label ?? "전체";
}

function actionLabel(action: DemoModerationAction) {
  if (action === "keep") return "유지 처리";
  if (action === "hide") return "임시 숨김 처리";
  if (action === "delete") return "삭제 처리";
  return "작성자 제한 검토";
}

function targetTypeLabel(targetType: WorkerModerationReportSummary["targetType"]) {
  if (targetType === "place") return "장소";
  if (targetType === "comment") return "댓글";
  return "사진";
}

function fieldReportCategoryLabel(category: WorkerFieldReportSummary["category"]) {
  const labels: Record<WorkerFieldReportSummary["category"], string> = {
    tourism: "관광지",
    festival: "축제",
    restaurant_cafe: "음식점·카페",
    hospital: "병원",
    public_office: "공공기관",
    parking: "주차장",
  };

  return labels[category];
}

function fieldReportEvidenceLabel(report: WorkerFieldReportSummary) {
  const evidence = [
    report.crowdLevel ? `인파 ${crowdLevelLabel(report.crowdLevel)}` : null,
    report.lineStatus ? `대기 ${lineStatusLabel(report.lineStatus)}` : null,
    report.parkingStatus ? `주차 ${parkingStatusLabel(report.parkingStatus)}` : null,
  ].filter((value): value is string => Boolean(value));

  return evidence.length > 0 ? evidence.join(" · ") : "확인한 상태 항목이 없습니다.";
}

function crowdLevelLabel(level: NonNullable<WorkerFieldReportSummary["crowdLevel"]>) {
  return ({ quiet: "여유", normal: "보통", busy: "혼잡", packed: "매우 혼잡" })[level];
}

function lineStatusLabel(status: NonNullable<WorkerFieldReportSummary["lineStatus"]>) {
  return ({ none: "없음", short: "10분 이하", medium: "10~30분", long: "30분 이상" })[status];
}

function parkingStatusLabel(status: NonNullable<WorkerFieldReportSummary["parkingStatus"]>) {
  return ({ available: "여유", limited: "일부 남음", full: "만차", unknown: "확인 필요" })[status];
}

function verificationMethodLabel(method: WorkerFieldReportSummary["verificationMethod"]) {
  return ({ none: "일반 제보", radius: "반경", polygon: "영역" })[method];
}

function accuracyBucketLabel(bucket: WorkerFieldReportSummary["accuracyBucket"]) {
  return ({ high: "높음", medium: "보통", low: "낮음", unknown: "미확인" })[bucket];
}

function fieldReportStatusLabel(status: WorkerFieldReportModerationStatus) {
  return ({ pending: "검수 대기", approved: "승인", rejected: "거절", hidden: "숨김" })[status];
}

const placeRequestActions: Array<{ status: WorkerPlaceAdditionRequestStatus; label: string }> = [
  { status: "needs_verification", label: "추가 확인" },
  { status: "duplicate", label: "기존 장소" },
  { status: "ready_for_manual_import", label: "등록 준비" },
  { status: "rejected", label: "거절" },
];

function placeRequestStatusLabel(status: WorkerPlaceAdditionRequestStatus) {
  return placeRequestActions.find((action) => action.status === status)?.label ?? status;
}

function statusLabel(status: WorkerModerationStatus) {
  if (status === "open") return "검토 대기";
  if (status === "accepted") return "승인됨";
  return "거절됨";
}

function workerQueueStatusLabel(state: WorkerQueueState) {
  if (state === "connected") return "연결됨";
  if (state === "not_configured") return "미설정";
  if (state === "action_failed") return "처리 실패";
  return "연결 실패";
}

function workerEmptyTitle(state: WorkerQueueState) {
  if (state === "not_configured") return "Worker 운영 연결이 설정되지 않았습니다.";
  if (state === "unavailable") return "Worker 신고 큐를 불러오지 못했습니다.";
  if (state === "action_failed") return "처리 요청이 실패했습니다.";
  return "Worker open 신고가 없습니다.";
}

function workerEmptyDescription(state: WorkerQueueState, filter: QueueFilterId) {
  if (state === "not_configured") return "서버 환경변수에 Worker API URL과 운영 토큰을 설정하면 open 신고 큐를 표시합니다.";
  if (state === "unavailable") return "Worker API URL, 운영 토큰, 권한 role을 확인해야 합니다.";
  if (state === "action_failed") return "네트워크나 권한 오류를 확인한 뒤 다시 시도합니다.";
  if (filter !== "all") return `${queueFilterLabel(filter)} 필터에 해당하는 Worker open 신고가 없습니다.`;
  return "새 신고가 접수되면 여기에서 승인 또는 거절할 수 있습니다.";
}

function fieldReportEmptyTitle(state: WorkerQueueState) {
  if (state === "not_configured") return "Worker 운영 연결이 설정되지 않았습니다.";
  if (state === "unavailable") return "현장 제보 검수 큐를 불러오지 못했습니다.";
  if (state === "action_failed") return "현장 제보 처리 요청이 실패했습니다.";
  return "현장 제보 검수 대기가 없습니다.";
}

function fieldReportEmptyDescription(state: WorkerQueueState) {
  if (state === "not_configured") return "서버 환경변수에 Worker API URL과 운영 토큰을 설정하면 pending 제보를 표시합니다.";
  if (state === "unavailable") return "Worker API URL, 운영 토큰, moderator role을 확인해야 합니다.";
  if (state === "action_failed") return "네트워크나 권한 오류를 확인한 뒤 다시 시도합니다.";
  return "새 현장 제보가 접수되면 승인 후 장소의 현재 상태에 반영할 수 있습니다.";
}

function placeRequestEmptyTitle(state: WorkerQueueState) {
  if (state === "not_configured") return "Worker 운영 연결이 설정되지 않았습니다.";
  if (state === "unavailable") return "장소 추가 요청 큐를 불러오지 못했습니다.";
  if (state === "action_failed") return "장소 추가 요청 처리가 실패했습니다.";
  return "장소 추가 요청이 없습니다.";
}

function placeRequestEmptyDescription(state: WorkerQueueState) {
  if (state === "not_configured") return "서버 환경변수에 Worker API URL과 운영 토큰을 설정해 주세요.";
  if (state === "unavailable") return "Worker API URL, 운영 토큰, moderator 역할을 확인해 주세요.";
  if (state === "action_failed") return "검토 입력과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  return "새 요청이 접수되면 여기에서 수동 검토 상태만 분류할 수 있습니다.";
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
