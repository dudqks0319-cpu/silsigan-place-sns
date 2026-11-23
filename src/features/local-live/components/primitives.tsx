"use client";

import { ArrowUpRight, Clock3, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { DataResult, DataStatus } from "../types";
import styles from "./LocalLive.module.css";

export function safeUrl(value: string): string | undefined {
  if (value === "/") return "/";
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return undefined; }
}

export function formatTime(value: string | null, withDate = false) {
  if (!value || Number.isNaN(Date.parse(value))) return "기준 시각 없음";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...(withDate ? { month: "numeric", day: "numeric" } : {}), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export const DisplayTimeContext = createContext(0);

export function effectiveStatus(result: DataResult<unknown>, now: number): DataStatus {
  if (result.status === "fresh" && result.expiresAt && Date.parse(result.expiresAt) <= now) return "stale";
  return result.status;
}

const statusLabels: Record<DataStatus, string> = { fresh: "최근 정보", stale: "이전 정보", unavailable: "조회 지연", not_configured: "연결 준비 중", unsupported: "제공 지역 확인 중" };

export function SourceLine({ result, inverse = false }: { result: DataResult<unknown>; inverse?: boolean }) {
  const now = useContext(DisplayTimeContext);
  const status = effectiveStatus(result, now);
  const referenceTime = result.observedAt ?? (result.source.kind === "directory" ? result.fetchedAt : null);
  const known = referenceTime && result.data !== null;
  return <div className={`${styles.sourceLine} ${inverse ? styles.sourceInverse : ""}`}>
    <span className={`${styles.statusDot} ${status === "fresh" ? styles.statusFresh : styles.statusMuted}`} />
    <span>{known ? `${formatTime(referenceTime, true)} ${result.source.kind === "forecast" ? "발표" : result.source.kind === "observation" ? "관측" : result.source.kind === "directory" ? "조회" : "기준"}` : statusLabels[status]}</span>
    {status === "stale" && <strong>이전 정보</strong>}
    <a href={safeUrl(result.source.url)} target="_blank" rel="noreferrer">{result.source.name}<ArrowUpRight size={12} aria-hidden="true" /></a>
  </div>;
}

export function Dialog({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="local-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className={styles.dialogHead}><div><h2 id="local-dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className={styles.iconButton} onClick={onClose} aria-label="닫기"><X size={21} /></button></div>
    {children}
  </dialog>;
}

export function EmptyState({ icon, title, children, compact = false }: { icon: ReactNode; title: string; children: ReactNode; compact?: boolean }) {
  return <div className={`${styles.emptyState} ${compact ? styles.emptyCompact : ""}`}><span className={styles.emptyIcon}>{icon}</span><h3>{title}</h3><div className={styles.emptyDescription}>{children}</div></div>;
}

export function LoadingCards() {
  return <div className={styles.placeGrid} aria-label="장소를 불러오는 중" aria-busy="true">{[0, 1, 2, 3].map((id) => <div key={id} className={styles.skeletonCard}><div /><span /><span /></div>)}</div>;
}

export function SourceDetails({ data, onClose }: { data: { label: string; result: DataResult<unknown> }[]; onClose: () => void }) {
  const now = useContext(DisplayTimeContext);
  return <Dialog title="정보는 이렇게 확인해요" description="정보마다 출처와 갱신 주기가 달라요." onClose={onClose} wide>
    <div className={styles.sourceDetails}>{data.map(({ label, result }) => <section key={label}><div className={styles.sourceDetailsTitle}><h3>{label}</h3><span>{statusLabels[effectiveStatus(result, now)]}</span></div><SourceLine result={result} /><p>{result.message}</p>{result.fetchedAt && <small><Clock3 size={13} /> 앱 조회: {formatTime(result.fetchedAt, true)}</small>}</section>)}</div>
    <p className={styles.dialogNote}>현장 제보는 이용자가 전한 내용입니다. 날씨 관측, 장소 기본정보, 제보를 서로 구분해 확인해 주세요.</p>
  </Dialog>;
}
