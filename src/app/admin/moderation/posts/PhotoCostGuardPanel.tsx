"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkerPhotoCostGuardSummary } from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type PhotoCostGuardResponse = {
  success: boolean;
  data?: WorkerPhotoCostGuardSummary;
  error?: {
    message?: string;
  };
};

const MIN_REASON_LENGTH = 5;
const STATUS_REFRESH_INTERVAL_MS = 60_000;

export function PhotoCostGuardPanel() {
  const [guard, setGuard] = useState<WorkerPhotoCostGuardSummary | null>(null);
  const [reason, setReason] = useState("");
  const [resumeReviewed, setResumeReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState("사진 비용 보호 상태를 확인하고 있습니다.");

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/photo-cost-guard", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as PhotoCostGuardResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "사진 비용 보호 상태를 불러오지 못했습니다.");
      }

      setGuard(payload.data);
      setNotice(photoCostGuardNotice(payload.data));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setNotice(error instanceof Error ? error.message : "사진 비용 보호 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => void loadStatus(controller.signal), 0);
    const intervalId = window.setInterval(() => void loadStatus(), STATUS_REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadStatus]);

  const updateGuard = async (enabled: boolean) => {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < MIN_REASON_LENGTH) {
      setNotice("중단 또는 재개 사유를 5자 이상 입력해 주세요.");
      return;
    }
    if (enabled && !resumeReviewed) {
      setNotice("재개 전 R2 사용량과 D1 원장을 대조했는지 확인해 주세요.");
      return;
    }

    setUpdating(true);
    setNotice(enabled ? "R2 사진 업로드와 조회 재개를 요청하고 있습니다." : "R2 사진 업로드와 조회를 즉시 중단하고 있습니다.");
    try {
      const response = await fetch("/api/admin/photo-cost-guard", {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          uploadsEnabled: enabled,
          readsEnabled: enabled,
          reconciliationAcknowledged: enabled ? resumeReviewed : false,
          reason: normalizedReason,
        }),
      });
      const payload = (await response.json()) as PhotoCostGuardResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "R2 사진 비용 제어 요청이 실패했습니다.");
      }

      setGuard(payload.data);
      setReason("");
      setResumeReviewed(false);
      setNotice(enabled ? "검토 기록과 함께 R2 사진 업로드와 조회를 재개했습니다." : "R2 사진 업로드와 조회를 즉시 중단했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "R2 사진 비용 제어 요청이 실패했습니다.");
    } finally {
      setUpdating(false);
    }
  };

  const stopped = guard ? !guard.uploadsEnabled || !guard.readsEnabled : false;

  return (
    <section className={`${styles.costGuardPanel} ${stopped ? styles.costGuardStopped : ""}`} aria-labelledby="photo-cost-guard-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p>R2 무료 사용량 방어</p>
          <h2 id="photo-cost-guard-heading">사진 R2 비용 보호 · 80% 자동 중단</h2>
        </div>
        <span className={stopped ? styles.stoppedBadge : styles.runningBadge}>
          {loading ? "확인 중" : stopped ? "R2 중단" : guard ? "보호 작동 중" : "연결 필요"}
        </span>
      </div>

      {guard ? (
        <div className={styles.costGuardGrid}>
          <UsageMeter
            label="활성 사진 저장량"
            value={formatBytes(guard.activeBytes)}
            limit={`${formatBytes(guard.storageStopBytes)}에서 자동 중단`}
            percent={guard.storagePercent}
          />
          <UsageMeter
            label={`${guard.periodUtc} 업로드 쓰기`}
            value={`${guard.writesInPeriod.toLocaleString("ko-KR")}회`}
            limit={`${guard.monthlyWriteStopLimit.toLocaleString("ko-KR")}회에서 자동 중단`}
            percent={guard.writePercent}
          />
          <UsageMeter
            label={`${guard.transformPeriodUtc} Images 변환`}
            value={`${guard.transformsInPeriod.toLocaleString("ko-KR")}회`}
            limit={`${guard.monthlyTransformStopLimit.toLocaleString("ko-KR")}회에서 자동 중단`}
            percent={guard.transformPercent}
          />
          <UsageMeter
            label={`${guard.readPeriodUtc} 사진 조회 (Class B)`}
            value={`${guard.readsInPeriod.toLocaleString("ko-KR")}회`}
            limit={`${guard.monthlyReadStopLimit.toLocaleString("ko-KR")}회에서 자동 중단`}
            percent={guard.readPercent}
          />
          <UsageMeter
            label={`${guard.dayUtc} D1 보호 조회`}
            value={`${guard.readsInDay.toLocaleString("ko-KR")}회`}
            limit={`${guard.dailyReadStopLimit.toLocaleString("ko-KR")}회에서 자동 중단`}
            percent={guard.dailyReadPercent}
          />
        </div>
      ) : (
        <p className={styles.costGuardUnavailable}>Worker API가 연결되면 저장량과 월간 쓰기·조회 사용량이 여기에 표시됩니다.</p>
      )}

      <div className={styles.costGuardPolicy}>
        <strong>중단이 알림보다 먼저 실행됩니다.</strong>
        <span>앱의 보수적 상한 80%에서 D1이 업로드·저장·Images 변환·Class B 조회를 먼저 막고, 설정된 비용 웹훅은 그 뒤 알림을 전송합니다.</span>
      </div>

      {guard?.reason && (
        <p className={styles.costGuardReason}>
          최근 사유: {guard.reason} · {formatUpdatedAt(guard.updatedAt)}
        </p>
      )}

      <label className={styles.reasonField}>
        <span>운영 사유</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="예: 비정상 트래픽 확인으로 긴급 중단"
          minLength={MIN_REASON_LENGTH}
          maxLength={300}
          disabled={updating}
        />
      </label>

      {stopped && (
        <label className={styles.resumeCheck}>
          <input
            type="checkbox"
            checked={resumeReviewed}
            onChange={(event) => setResumeReviewed(event.target.checked)}
            disabled={updating}
          />
          <span>R2 사용량과 D1 원장을 대조했습니다.</span>
        </label>
      )}

      <div className={styles.costGuardActions}>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => void updateGuard(false)}
          disabled={updating || loading || !guard || stopped || reason.trim().length < MIN_REASON_LENGTH}
        >
          사진 R2 사용 즉시 중단
        </button>
        <button
          type="button"
          className={styles.resumeButton}
          onClick={() => void updateGuard(true)}
          disabled={updating || loading || !guard || !stopped || !resumeReviewed || reason.trim().length < MIN_REASON_LENGTH}
        >
          검토 후 R2 사용 재개
        </button>
        <button type="button" className={styles.refreshButton} onClick={() => void loadStatus()} disabled={updating || loading}>
          상태 새로고침
        </button>
      </div>

      <p className={styles.costGuardNotice} aria-live="polite">{notice}</p>
    </section>
  );
}

function photoCostGuardNotice(guard: WorkerPhotoCostGuardSummary) {
  if (guard.uploadsEnabled && guard.readsEnabled) {
    return "R2 사진 업로드와 조회가 허용되어 있습니다.";
  }
  if (!guard.uploadsEnabled && !guard.readsEnabled) {
    return "R2 사진 업로드와 조회가 중단되어 있습니다.";
  }
  return guard.uploadsEnabled ? "R2 사진 조회가 중단되어 있습니다." : "R2 사진 업로드가 중단되어 있습니다.";
}

function UsageMeter({ label, value, limit, percent }: { label: string; value: string; limit: string; percent: number }) {
  const boundedPercent = Math.min(100, Math.max(0, percent));
  return (
    <article className={styles.usageMeter}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <span>{boundedPercent.toLocaleString("ko-KR")}% / 앱 상한</span>
      <div className={styles.usageTrack} aria-label={`${label} 앱 상한 대비 ${boundedPercent}%`}>
        <span style={{ width: `${boundedPercent}%` }} />
        <i aria-hidden="true" />
      </div>
      <small>{limit}</small>
    </article>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes.toLocaleString("ko-KR")} B`;
  }
  const units = ["KiB", "MiB", "GiB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${units[unitIndex]}`;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
