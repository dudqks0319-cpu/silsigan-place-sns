import type { WorkerDataSourceSummary, WorkerSourceHealthSummary } from "@/lib/worker-admin-api";
import styles from "./page.module.css";

type SourceHealthPanelProps = {
  state: "connected" | "not_configured" | "unavailable";
  items: WorkerSourceHealthSummary[];
  sources: WorkerDataSourceSummary[];
};

const statusLabels = {
  healthy: "정상",
  degraded: "지연",
  down: "중단",
} as const;

export function SourceHealthPanel({ state, items, sources }: SourceHealthPanelProps) {
  return (
    <section className={styles.sourcePanel} aria-labelledby="source-health-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p>API 장애·수집 상태</p>
          <h2 id="source-health-heading">공공 API·데이터 출처 상태</h2>
        </div>
        <span className={styles.sourcePanelBadge}>{sourceHealthStateLabel(state)}</span>
      </div>

      {state === "not_configured" ? (
        <div className={styles.sourceHealthEmpty} role="status">
          <strong>운영 Worker가 연결되지 않았습니다.</strong>
          <span>Worker 운영 토큰 또는 API URL이 설정되지 않았습니다.</span>
        </div>
      ) : null}

      {state === "unavailable" ? (
        <div className={styles.sourceHealthEmpty} role="alert">
          <strong>출처 상태를 불러오지 못했습니다.</strong>
          <span>Worker health를 불러오지 못했습니다. staging 연결 상태를 확인하세요.</span>
        </div>
      ) : null}

      {state === "connected" && items.length === 0 ? (
        <div className={styles.sourceHealthEmpty} role="status">
          <strong>최근 health 기록 없음</strong>
          <span>수집기가 아직 상태를 기록하지 않았습니다. 현재 정보 부족으로 운영하세요.</span>
        </div>
      ) : null}

      {state === "connected" && items.length > 0 ? (
        <ul className={styles.sourceHealthList}>
          {items.map((item) => (
            <li className={styles.sourceHealthItem} key={item.id}>
              <div className={styles.sourceHealthTitleRow}>
                <div>
                  <strong>{item.sourceKey}</strong>
                  <span>{formatCheckedAt(item.checkedAt)}</span>
                </div>
                <em className={`${styles.sourceHealthStatus} ${styles[`sourceHealthStatus${capitalize(item.status)}`]}`}>
                  {statusLabels[item.status]}
                </em>
              </div>
              <p>{item.message ? item.message.slice(0, 240) : "상태 메시지 없음"}</p>
              {item.responseTimeMs !== null ? <small>응답 {item.responseTimeMs.toLocaleString("ko-KR")}ms</small> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state === "connected" && sources.length > 0 ? (
        <div className={styles.sourceRegistryBlock}>
          <div className={styles.sourceRegistryHeading}>
            <strong>출처 권리·활성화 상태</strong>
            <span>승인되지 않은 출처는 운영 판단에 사용하지 않습니다.</span>
          </div>
          <ul className={styles.sourceRegistryList}>
            {sources.map((source) => (
              <li className={styles.sourceRegistryItem} key={source.sourceKey}>
                <div>
                  <strong>{source.sourceName}</strong>
                  <span>{source.providerName} · {source.sourceKey}</span>
                </div>
                <div className={styles.sourceRegistryBadges}>
                  <em className={styles[`sourceRegistryActivation${capitalizeActivation(source.activationStatus)}`]}>
                    {activationStatusLabel(source.activationStatus)}
                  </em>
                  <small>{commercialStatusLabel(source.commercialUseStatus)} · {healthStatusLabel(source.healthStatus)}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function sourceHealthStateLabel(state: SourceHealthPanelProps["state"]) {
  if (state === "connected") return "Worker 연결됨";
  if (state === "unavailable") return "확인 필요";
  return "연결 대기";
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "관측시각 확인 필요";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function capitalize(value: WorkerSourceHealthSummary["status"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitalizeActivation(value: WorkerDataSourceSummary["activationStatus"]) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function activationStatusLabel(value: WorkerDataSourceSummary["activationStatus"]) {
  if (value === "active") return "활성";
  if (value === "awaiting_rights") return "권리 확인 대기";
  if (value === "unhealthy") return "건강성 확인 필요";
  return "비활성";
}

function commercialStatusLabel(value: WorkerDataSourceSummary["commercialUseStatus"]) {
  if (value === "allowed") return "상업 이용 허용";
  if (value === "allowed_with_attribution") return "출처 표시 조건";
  if (value === "agreement_required") return "계약 필요";
  if (value === "prohibited") return "사용 금지";
  if (value === "unknown") return "권리 미확인";
  return "검토 대기";
}

function healthStatusLabel(value: WorkerDataSourceSummary["healthStatus"]) {
  if (value === "healthy") return "정상";
  if (value === "degraded") return "지연";
  if (value === "down") return "중단";
  return "health 기록 없음";
}
