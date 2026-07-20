"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkerApiCostGuardSummary } from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type ApiCostGuardResponse = {
  success: boolean;
  data?: WorkerApiCostGuardSummary;
  error?: { message?: string };
};

const REFRESH_INTERVAL_MS = 60_000;
const MIN_REASON_LENGTH = 5;

export function ApiCostGuardPanel() {
  const [guard, setGuard] = useState<WorkerApiCostGuardSummary | null>(null);
  const [reason, setReason] = useState("");
  const [workersUsage, setWorkersUsage] = useState("");
  const [d1ReadUsage, setD1ReadUsage] = useState("");
  const [d1WriteUsage, setD1WriteUsage] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState("전역 비용 보호 상태를 확인하고 있습니다.");

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/api-cost-guard", {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as ApiCostGuardResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error?.message ?? "전역 비용 보호 상태를 불러오지 못했습니다.");
      }
      setGuard(payload.data);
      setNotice(apiCostGuardNotice(payload.data));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(error instanceof Error ? error.message : "전역 비용 보호 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoadId = window.setTimeout(() => void loadStatus(controller.signal), 0);
    const intervalId = window.setInterval(() => void loadStatus(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
    };
  }, [loadStatus]);

  const stopImmediately = async () => {
    if (!guard || reason.trim().length < MIN_REASON_LENGTH) {
      setNotice("긴급 중단 사유를 5자 이상 입력해 주세요.");
      return;
    }
    setUpdating(true);
    setNotice("비필수 API를 즉시 중단하고 있습니다.");
    try {
      const next = await requestGuard("PATCH", {
        mode: "stopped",
        reason: reason.trim(),
        expectedGeneration: guard.control.generation,
      });
      setGuard(next);
      setReason("");
      setNotice("비필수 API를 중단했고 감사 기록을 남겼습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "전역 비용 보호 중단에 실패했습니다.");
    } finally {
      setUpdating(false);
    }
  };

  const reconcileAndResume = async () => {
    if (!guard || reason.trim().length < MIN_REASON_LENGTH) {
      setNotice("대조 및 재개 사유를 5자 이상 입력해 주세요.");
      return;
    }
    const observedWorkersRequests = parseUsage(workersUsage);
    const observedD1RowsRead = parseUsage(d1ReadUsage);
    const observedD1RowsWritten = parseUsage(d1WriteUsage);
    if (observedWorkersRequests === null || observedD1RowsRead === null || observedD1RowsWritten === null) {
      setNotice("Cloudflare 대시보드의 세 사용량을 0 이상의 정수로 입력해 주세요.");
      return;
    }
    setUpdating(true);
    setNotice("Cloudflare 사용량을 대조하고 안전한 경우에만 재개합니다.");
    try {
      const reconciled = await requestGuard("POST", {
        observedWorkersRequests,
        observedD1RowsRead,
        observedD1RowsWritten,
        note: reason.trim(),
      });
      const resumed = await requestGuard("PATCH", {
        mode: "running",
        reason: reason.trim(),
        expectedGeneration: reconciled.control.generation,
      });
      setGuard(resumed);
      setReason("");
      setWorkersUsage("");
      setD1ReadUsage("");
      setD1WriteUsage("");
      setNotice("15분 이내 Cloudflare 사용량 대조와 감사 기록을 확인하고 재개했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "전역 비용 보호 재개에 실패했습니다.");
    } finally {
      setUpdating(false);
    }
  };

  const stopped = guard?.control.mode !== "running";

  return (
    <section className={`${styles.costGuardPanel} ${stopped ? styles.costGuardStopped : ""}`} aria-labelledby="api-cost-guard-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p>악의적 사용량 방어</p>
          <h2 id="api-cost-guard-heading">Workers · D1 전역 비용 보호</h2>
        </div>
        <span className={stopped ? styles.stoppedBadge : styles.runningBadge}>
          {loading ? "확인 중" : guard ? modeLabel(guard.control.mode) : "연결 필요"}
        </span>
      </div>

      {guard ? (
        <div className={styles.costGuardGrid}>
          <ApiUsageMeter label="Workers 일일 요청" value={guard.usage.workersRequests} limit={guard.limits.workersRequests} percent={guard.meters.workersPercent} />
          <ApiUsageMeter label="D1 일일 rows read" value={guard.usage.d1RowsRead} limit={guard.limits.d1RowsRead} percent={guard.meters.d1ReadPercent} />
          <ApiUsageMeter label="D1 일일 rows written" value={guard.usage.d1RowsWritten} limit={guard.limits.d1RowsWritten} percent={guard.meters.d1WritePercent} />
        </div>
      ) : (
        <p className={styles.costGuardUnavailable}>Worker API와 0026 원장이 연결되면 전역 사용량이 표시됩니다.</p>
      )}

      <div className={styles.costGuardPolicy}>
        <strong>60% 경고 · 70% 축소 · 80% 중단</strong>
        <span>70%부터 비필수·고비용 기능을 막고 필수 장소 조회는 읽기 전용 스냅샷으로 전환합니다. Workers 요청은 코드 실행 전에 집계되므로 Cloudflare WAF와 대시보드 대조도 필요합니다.</span>
      </div>

      <label className={styles.reasonField}>
        <span>운영 사유 또는 대조 메모</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={300} disabled={updating} />
      </label>

      {stopped && (
        <div className={styles.costGuardGrid} aria-label="Cloudflare 대시보드 사용량 대조 입력">
          <UsageInput label="Workers 요청" value={workersUsage} onChange={setWorkersUsage} disabled={updating} />
          <UsageInput label="D1 rows read" value={d1ReadUsage} onChange={setD1ReadUsage} disabled={updating} />
          <UsageInput label="D1 rows written" value={d1WriteUsage} onChange={setD1WriteUsage} disabled={updating} />
        </div>
      )}

      <div className={styles.costGuardActions}>
        <button type="button" className={styles.dangerButton} onClick={() => void stopImmediately()} disabled={updating || loading || !guard || guard.control.mode === "stopped" || reason.trim().length < 5}>
          비필수 API 즉시 중단
        </button>
        <button type="button" className={styles.resumeButton} onClick={() => void reconcileAndResume()} disabled={updating || loading || !guard || !stopped || reason.trim().length < 5}>
          사용량 대조 후 재개
        </button>
        <button type="button" className={styles.refreshButton} onClick={() => void loadStatus()} disabled={updating || loading}>
          상태 새로고침
        </button>
      </div>
      <p className={styles.costGuardNotice} aria-live="polite">{notice}</p>
    </section>
  );
}

async function requestGuard(method: "PATCH" | "POST", body: Record<string, unknown>) {
  const response = await fetch("/api/admin/api-cost-guard", {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiCostGuardResponse;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message ?? "전역 비용 보호 요청이 실패했습니다.");
  }
  return payload.data;
}

function ApiUsageMeter({ label, value, limit, percent }: { label: string; value: number; limit: number; percent: number }) {
  const bounded = Math.min(100, Math.max(0, percent));
  return (
    <article className={styles.usageMeter}>
      <div><span>{label}</span><strong>{value.toLocaleString("ko-KR")}</strong></div>
      <span>{bounded.toLocaleString("ko-KR")}% / 무료 상한</span>
      <div className={styles.usageTrack} aria-label={`${label} 무료 상한 대비 ${bounded}%`}>
        <span style={{ width: `${bounded}%` }} /><i aria-hidden="true" />
      </div>
      <small>{limit.toLocaleString("ko-KR")} 기준</small>
    </article>
  );
}

function UsageInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className={styles.reasonField}>
      <span>{label}</span>
      <input inputMode="numeric" pattern="[0-9]*" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} placeholder="0" />
    </label>
  );
}

function parseUsage(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function apiCostGuardNotice(guard: WorkerApiCostGuardSummary) {
  if (guard.control.mode === "running") return "전역 비용 보호가 작동 중입니다.";
  if (guard.control.mode === "degraded") return "비필수 기능이 제한되고 필수 읽기는 스냅샷으로 제공됩니다.";
  return "80% 안전선 또는 운영자 조치로 비필수 API가 중단되었습니다.";
}

function modeLabel(mode: WorkerApiCostGuardSummary["control"]["mode"]) {
  if (mode === "running") return "보호 작동 중";
  if (mode === "degraded") return "축소 운영";
  return "API 중단";
}
