"use client";

import {
  KOREA_SIDO_REGIONS,
  TOURISM_CCTV_CATALOG,
  isAllowedTourismCctvUrl,
  tourismCctvForRegion,
  type KoreaSidoId,
  type TourismCctvEntry,
} from "../../../packages/contracts/src/index.ts";
import styles from "./TourismCctvDirectory.module.css";

type TourismCctvDirectoryProps = {
  activeRegion: "nationwide" | KoreaSidoId;
};

function groupByLocality(entries: readonly TourismCctvEntry[]) {
  return entries.reduce<Map<string, TourismCctvEntry[]>>((groups, entry) => {
    const key = `${entry.regionName} · ${entry.locality}`;
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
    return groups;
  }, new Map());
}

export function TourismCctvDirectory({ activeRegion }: TourismCctvDirectoryProps) {
  const entries =
    activeRegion === "nationwide"
      ? TOURISM_CCTV_CATALOG
      : tourismCctvForRegion(activeRegion);
  const regionName =
    activeRegion === "nationwide"
      ? "전국"
      : (KOREA_SIDO_REGIONS.find((region) => region.id === activeRegion)?.name ??
        "선택 지역");
  const groups = groupByLocality(entries);

  return (
    <section className={styles.directory} aria-labelledby="tourism-cctv-heading">
      <div className={styles.headingRow}>
        <div>
          <p className={styles.verifiedBadge}>단독 영상 재생 확인</p>
          <h2 id="tourism-cctv-heading">{regionName} 관광 CCTV</h2>
        </div>
        <span className={styles.countBadge}>{entries.length}곳</span>
      </div>

      <p className={styles.safetyNote}>
        최근 실제 영상 재생을 확인한 장소만 표시합니다. 링크를 누르면 포털이 아닌
        해당 장소의 단독 CCTV 화면이 새 창에서 열립니다.
      </p>

      {entries.length === 0 ? (
        <p className={styles.emptyState}>
          이 지역에는 현재 단독 영상 재생까지 확인된 관광 CCTV가 없습니다. 포털
          첫 화면이나 재생되지 않는 장소는 표시하지 않습니다.
        </p>
      ) : (
        <div className={styles.locationList}>
          {[...groups].map(([locality, localityEntries]) => (
            <section className={styles.locationGroup} key={locality}>
              <h3 className={styles.locationHeading}>{locality}</h3>
              <div className={styles.entryList}>
                {localityEntries.map((entry) => {
                  if (!isAllowedTourismCctvUrl(entry.officialUrl)) return null;

                  return (
                    <article className={styles.entryCard} key={entry.id}>
                      <a
                        className={styles.cctvLink}
                        href={entry.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${entry.placeName} 단독 CCTV 새 창에서 보기`}
                      >
                        <span className={styles.entryHeader}>
                          <strong>{entry.placeName}</strong>
                          <span>재생 확인</span>
                        </span>
                        <span>{entry.providerName}</span>
                        <span className={styles.linkAction}>단독 CCTV 바로 보기 ↗</span>
                      </a>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
