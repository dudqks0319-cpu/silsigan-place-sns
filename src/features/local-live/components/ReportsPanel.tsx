"use client";

import { ArrowUpRight, MessageCircle, ShieldCheck } from "lucide-react";
import { useContext } from "react";
import type { DataResult, CommunityReport, Region } from "../types";
import { DisplayTimeContext, EmptyState, formatTime, SourceLine } from "./primitives";
import styles from "./LocalLive.module.css";

export function ReportsPanel({ reports, region }: { reports: DataResult<CommunityReport[]> | undefined; region: Region }) {
  const now = useContext(DisplayTimeContext);
  const items = (reports?.data ?? []).filter((report) => {
    const age = now - Date.parse(report.createdAt);
    return Number.isFinite(age) && age >= 0 && age < 3 * 60 * 60_000;
  });
  return <aside className={styles.sidePanels}>
    <section className={styles.reportsPanel} aria-labelledby="reports-title"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>FROM THE NEIGHBORHOOD</span><h2 id="reports-title">현장에서 전해요</h2></div><MessageCircle size={21} /></div>
      {items.length > 0 ? <div className={styles.reportList}>{items.slice(0, 4).map((report) => <article key={report.id} className={styles.report}><div><strong>{report.placeName}</strong><time dateTime={report.createdAt}>{formatTime(report.createdAt, true)}</time></div><p>{report.caption}</p><div className={styles.reportTags}><span>{report.crowd}</span><span>{report.parking}</span></div>{report.locationVerified && <small><ShieldCheck size={13} /> 이용자 위치 정보 기반 · 내용 미검증</small>}</article>)}</div> : <EmptyState compact icon={<MessageCircle size={27} />} title="아직 새로운 소식이 없어요">확인 가능한 최근 현장 제보가 올라오면 여기에서 볼 수 있어요.</EmptyState>}
      {reports && <SourceLine result={reports} />}
    </section>
    <section className={styles.mapLinkCard}><div className={styles.mapLinkIcon}><MapOutline /></div><span className={styles.eyebrow}>EXPLORE A LITTLE FURTHER</span><h3>{region.name}, 지도에서 둘러보기</h3><p>정확한 길 찾기와 장소 상세정보는<br />네이버 지도에서 확인하세요.</p><a href={`https://map.naver.com/p/search/${encodeURIComponent(region.name)}`} target="_blank" rel="noreferrer">네이버 지도 열기<ArrowUpRight size={17} /></a></section>
    <div className={styles.honestyNote}><ShieldCheck size={19} /><p>확인한 정보만, 출처와 함께.<br /><span>모르는 현장 상황은 추측하지 않아요.</span></p></div>
  </aside>;
}

function MapOutline() { return <svg width="66" height="49" viewBox="0 0 66 49" fill="none" aria-hidden="true"><path d="m4 11 18-6 20 7 19-6v33l-19 6-20-7-18 6V11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M22 5v33M42 12v33" stroke="currentColor" strokeWidth="1.5" /><path d="M34 14c-5.1 0-9 3.8-9 8.5C25 29 34 35 34 35s9-6 9-12.5c0-4.7-3.9-8.5-9-8.5Z" fill="var(--ll-paper)" stroke="currentColor" strokeWidth="1.5" /><circle cx="34" cy="22" r="3" fill="currentColor" /></svg>; }
