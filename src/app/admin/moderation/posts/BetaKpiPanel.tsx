"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkerBetaKpiSummary } from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type BetaKpiResponse = {
  success: boolean;
  data?: WorkerBetaKpiSummary;
};

const STATUS_REFRESH_INTERVAL_MS = 60_000;

export function BetaKpiPanel() {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const [summary, setSummary] = useState<WorkerBetaKpiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("베타 KPI 집계치를 확인하고 있습니다.");

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/beta-kpis?days=${windowDays}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as BetaKpiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error("베타 KPI 집계치를 불러오지 못했습니다.");
      }

      setSummary(payload.data);
      setNotice(`${payload.data.windowDays}일 집계 · ${formatUpdatedAt(payload.data.generatedAt)} 갱신`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setSummary(null);
      setNotice("Worker가 연결되면 개인정보를 제외한 베타 KPI 집계치가 표시됩니다.");
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => void loadSummary(controller.signal), 0);
    const intervalId = window.setInterval(() => void loadSummary(), STATUS_REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadSummary]);

  return (
    <section className={styles.betaKpiPanel} aria-labelledby="beta-kpi-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p>집중 베타 운영</p>
          <h2 id="beta-kpi-heading">출시 판단 KPI</h2>
        </div>
        <div className={styles.kpiWindowTabs} aria-label="KPI 조회 기간">
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
              disabled={loading && windowDays === days}
            >
              {days}일
            </button>
          ))}
        </div>
      </div>

      {summary ? (
        <div className={styles.kpiGrid}>
          <KpiCard
            label="활성 사용자"
            value={`${summary.audience.activeUsers.toLocaleString("ko-KR")}명`}
            detail={`앱 열기 ${summary.audience.appOpens.toLocaleString("ko-KR")}회`}
          />
          <KpiCard
            label="제보 완료 중앙값"
            value={formatSeconds(summary.reportFunnel.medianCompletionSeconds)}
            detail="목표 15초 이하"
            state={thresholdState(summary.reportFunnel.medianCompletionSeconds, 15, "max")}
          />
          <KpiCard
            label="제보 완료율"
            value={formatPercent(summary.reportFunnel.conversionPercent)}
            detail={`${summary.reportFunnel.submitted}/${summary.reportFunnel.started}건 완료`}
          />
          <KpiCard
            label="지도 성공률"
            value={formatPercent(summary.mapReliability.successPercent)}
            detail="목표 99% 이상"
            state={thresholdState(summary.mapReliability.successPercent, 99, "min")}
          />
          <KpiCard
            label="D1 재방문"
            value={formatPercent(summary.retention.d1.percent)}
            detail={`성숙 코호트 ${summary.retention.d1.cohortUsers.toLocaleString("ko-KR")}명`}
          />
          <KpiCard
            label="D7 재방문"
            value={formatPercent(summary.retention.d7.percent)}
            detail={`성숙 코호트 ${summary.retention.d7.cohortUsers.toLocaleString("ko-KR")}명`}
          />
          <KpiCard
            label="집중 장소 최신 정보"
            value={formatPercent(summary.freshCoverage.percent)}
            detail={`전체 참고 · ${summary.freshCoverage.coveredPlaces}/${summary.freshCoverage.eligiblePlaces}곳`}
          />
          <KpiCard
            label="Tier A 최신 정보"
            value={formatPercent(summary.freshCoverage.tierA.percent)}
            detail={`출시 기준 70% 이상 · ${summary.freshCoverage.tierA.coveredPlaces}/${summary.freshCoverage.tierA.eligiblePlaces}곳`}
            state={thresholdState(summary.freshCoverage.tierA.percent, 70, "min")}
          />
          <KpiCard
            label="Tier B 최신 정보"
            value={formatPercent(summary.freshCoverage.tierB.percent)}
            detail={`승격 후보 관찰 · ${summary.freshCoverage.tierB.coveredPlaces}/${summary.freshCoverage.tierB.eligiblePlaces}곳`}
          />
          <KpiCard
            label="검수 24시간 이내"
            value={formatPercent(summary.moderation.reviewedWithin24HoursPercent)}
            detail={`대기 ${summary.moderation.pending} · 승인 ${summary.moderation.approved} · 거절 ${summary.moderation.rejected}`}
            state={thresholdState(summary.moderation.reviewedWithin24HoursPercent, 100, "min")}
          />
          <KpiCard
            label="오류 없는 앱 열기"
            value={formatPercent(summary.runtimeReliability.errorFreePercent)}
            detail="웹 오류 경계 목표 99.5% 이상 · 실기기 crash-free는 별도"
            state={thresholdState(summary.runtimeReliability.errorFreePercent, 99.5, "min")}
          />
        </div>
      ) : (
        <p className={styles.kpiUnavailable}>집계 데이터가 아직 없습니다. 실제 Worker 연결 전에는 임의 수치를 표시하지 않습니다.</p>
      )}

      <div className={styles.kpiPrivacyNote}>
        <strong>집계 전용</strong>
        <span>Tier A는 운영 중인 active 장소, Tier B는 승격 후보 beta 장소만 집계합니다. 사용자 식별값과 이벤트 원문은 내려받지 않으며, 거절률은 허위 제보율로 단정하지 않습니다.</span>
      </div>
      <p className={styles.kpiNotice} aria-live="polite">{notice}</p>
    </section>
  );
}

function KpiCard({
  label,
  value,
  detail,
  state = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  state?: "pass" | "hold" | "neutral";
}) {
  return (
    <article className={`${styles.kpiCard} ${state === "pass" ? styles.kpiPass : state === "hold" ? styles.kpiHold : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function thresholdState(value: number | null, threshold: number, direction: "min" | "max") {
  if (value === null) {
    return "neutral" as const;
  }
  const passed = direction === "min" ? value >= threshold : value <= threshold;
  return passed ? "pass" as const : "hold" as const;
}

function formatPercent(value: number | null) {
  return value === null ? "데이터 부족" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function formatSeconds(value: number | null) {
  return value === null ? "데이터 부족" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}초`;
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
